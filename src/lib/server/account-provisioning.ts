/**
 * Strynkix LMS — trusted account creation (LMS completion milestone, G37/G50).
 *
 * Every staff, student and University Admin account is created here: the
 * Firebase Auth login (Admin SDK), the profile, any Course Design membership,
 * the branch-manager link and an `account_create` audit entry. The profile,
 * link and audit commit in one transaction; if it fails, the new login is
 * deleted again so the email can be reused. firestore.rules no longer let any
 * client create another user's profile (self sign-up stays).
 *
 * Who may create what (mirrors the pre-milestone rules):
 * - Super Admin: University Admins (any academy), Branch Managers, content
 *   team, instructors and students; only they attach Course Design membership.
 * - University Admin: Branch Managers, instructors and students of their academy.
 * - Branch Manager (with a branch): instructors and students of their branch.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { Course } from '@/types/domain';
import { ACADEMY_WIDE_ROLES, PROVISIONABLE_ROLES, ProvisionableRole, canProvision } from '@/lib/admin/account-authority';
import { courseDesignInputSchema, idSchema } from '@/types/validation';
import { ALL_COURSES, buildMembership, validateMembershipAssignment } from '@/lib/admin/course-design';
import { validateUserProfile } from '@/lib/auth/profile';
import { ReviewError } from '@/lib/review/workflow';
import { verifyCaller } from '@/lib/server/content-route';

export const MIN_PASSWORD_LENGTH = 8;
export { ACADEMY_WIDE_ROLES, PROVISIONABLE_ROLES, canProvision };
export type { ProvisionableRole };

export const accountCreateSchema = z.object({
  role: z.enum(PROVISIONABLE_ROLES),
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.').max(254),
  password: z.string().trim().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`).max(128),
  displayName: z.string().trim().min(2, 'Please enter a full name (at least 2 characters).').max(100),
  orgId: idSchema,
  branchId: idSchema.optional(),
  courseDesign: courseDesignInputSchema.optional(),
}).strict();

export type AccountCreateRequest = z.infer<typeof accountCreateSchema>;

const denied = (msg = 'You can’t create this account.') => new ReviewError(403, 'not_allowed', msg);
const invalid = (msg: string) => new ReviewError(400, 'invalid_request', msg);

export interface ProvisionResult {
  uid: string;
  email: string;
  displayName: string;
  role: ProvisionableRole;
  orgId: string;
  branchId: string;
  /** True when an existing account of the same role in this branch was reused. */
  existing: boolean;
  auditId?: string;
}

export async function createAccount(services: { db: Firestore; auth: Auth }, idToken: string | null, body: unknown): Promise<ProvisionResult> {
  const callerId = await verifyCaller(services.auth, idToken);
  const parsed = accountCreateSchema.safeParse(body);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'The request is malformed.');
  const req = parsed.data;
  const { db, auth } = services;
  const academyWide = ACADEMY_WIDE_ROLES.includes(req.role);
  if (academyWide && req.branchId) throw invalid('This role belongs to the whole academy; don’t choose a branch.');
  if (!academyWide && !req.branchId) throw invalid('Choose a branch for this account.');
  if (req.courseDesign && !['content_lead', 'content_designer', 'instructor'].includes(req.role)) {
    throw invalid('Course Design membership is only for Content Leads, Content Designers and Instructors.');
  }

  const actorSnap = await db.doc(`users/${callerId}`).get();
  const actor = actorSnap.exists ? validateUserProfile(callerId, actorSnap.data()).profile : null;
  if (!canProvision(actor, req)) {
    // Another academy's data doesn't exist for non-Super-Admins.
    if (actor && actor.role !== 'super_admin' && actor.orgId !== req.orgId) throw new ReviewError(404, 'not_found', 'That academy isn’t available.');
    throw denied();
  }

  const [orgSnap, branchSnap] = await Promise.all([
    db.doc(`organizations/${req.orgId}`).get(),
    req.branchId ? db.doc(`branches/${req.branchId}`).get() : Promise.resolve(null),
  ]);
  if (!orgSnap.exists || (orgSnap.data()?.status ?? 'active') !== 'active') throw invalid('That academy isn’t active.');
  if (branchSnap && (!branchSnap.exists || branchSnap.data()?.orgId !== req.orgId)) throw invalid('That branch doesn’t belong to this academy.');
  if (branchSnap && (branchSnap.data()?.status ?? 'active') !== 'active') throw invalid('That branch isn’t active.');

  if (req.courseDesign) {
    const ids = req.courseDesign.assignedCourseIds.filter((id) => id !== ALL_COURSES);
    const courseSnaps = ids.length ? await db.getAll(...ids.map((id) => db.doc(`courses/${id}`))) : [];
    const courses = courseSnaps.flatMap((s) => (s.exists ? [{ id: s.id, ...s.data() } as Course] : []));
    const err = validateMembershipAssignment({
      actor: { uid: callerId, role: actor!.role, status: actor!.status },
      target: { id: '__new__', orgId: req.orgId, role: req.role, status: 'active', email: req.email, displayName: req.displayName, createdAt: '', updatedAt: '' },
      input: req.courseDesign, courses,
    });
    if (err) throw invalid(err);
  }

  let uid: string;
  try {
    uid = (await auth.createUser({ email: req.email, password: req.password, displayName: req.displayName })).uid;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/email-already-exists') {
      // Reuse only an account of the same role in the same branch (batch enrollment of an existing student).
      if (!academyWide && req.role !== 'branch_admin') {
        const match = await db.collection('users').where('orgId', '==', req.orgId).where('branchId', '==', req.branchId).where('email', '==', req.email).get();
        const same = match.docs.find((d) => d.data().role === req.role);
        if (same) {
          return { uid: same.id, email: req.email, displayName: (same.data().displayName as string) || req.displayName, role: req.role, orgId: req.orgId, branchId: req.branchId ?? '', existing: true };
        }
      }
      throw new ReviewError(409, 'email_in_use', 'An account with this email address already exists. Use a different email, or ask the Super Admin to check it.');
    }
    if (code === 'auth/invalid-password') throw invalid(`The password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (code === 'auth/invalid-email') throw invalid('Invalid email format.');
    throw err;
  }

  const now = new Date().toISOString();
  const membership = req.courseDesign ? buildMembership(req.courseDesign, callerId) : undefined;
  try {
    const auditId = await db.runTransaction(async (tx) => {
      const profileRef = db.doc(`users/${uid}`);
      tx.create(profileRef, {
        id: uid, email: req.email, displayName: req.displayName, role: req.role, orgId: req.orgId,
        ...(academyWide ? {} : { branchId: req.branchId }), status: 'active',
        ...(membership ? { courseDesign: membership } : {}), createdAt: now, updatedAt: now,
      });
      if (req.role === 'branch_admin') tx.update(db.doc(`branches/${req.branchId}`), { branchAdminUserIds: FieldValue.arrayUnion(uid), updatedAt: now });
      const auditRef = db.collection('auditLog').doc();
      tx.create(auditRef, {
        orgId: req.orgId, courseId: null, targetType: 'user', targetId: uid, action: 'account_create',
        actorId: callerId, actorRole: actor!.role, toRole: req.role, ...(academyWide ? {} : { branchId: req.branchId }),
        ...(membership ? { membershipAfter: { responsibilities: membership.responsibilities, assignedCourseIds: membership.assignedCourseIds } } : {}),
        at: FieldValue.serverTimestamp(),
      });
      return auditRef.id;
    });
    return { uid, email: req.email, displayName: req.displayName, role: req.role, orgId: req.orgId, branchId: req.branchId ?? '', existing: false, auditId };
  } catch (err) {
    // Roll back the login so a retry doesn't hit "email already exists".
    await auth.deleteUser(uid).catch((e) => console.error('[accounts] could not roll back new login', e?.code ?? 'error'));
    throw err;
  }
}

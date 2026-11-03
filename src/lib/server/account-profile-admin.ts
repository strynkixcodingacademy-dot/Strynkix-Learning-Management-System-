/**
 * Strynkix LMS — trusted account corrections (milestone G40/G50): change a
 * user's role, move them to another branch, or correct their sign-in email.
 * Each change is authorized here, validated against the target's academy and
 * branch, and written together with an audit entry; firestore.rules refuse
 * these fields from every client.
 *
 * Authority (never on oneself, never on a Super Admin):
 * - Super Admin: any role in PROVISIONABLE_ROLES, any branch of the target's academy.
 * - University Admin: Branch Managers, instructors and students of their academy.
 * - Branch Manager: only switch instructor ↔ student in their own branch.
 * Changes that would leave data inconsistent are refused with an explanation:
 * a Course Design member must lose membership before an ineligible role; a
 * student with active enrollments or an instructor with running batches must
 * be withdrawn/unassigned first.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema } from '@/types/validation';
import { COURSE_DESIGN_ELIGIBLE_ROLES } from '@/types/domain';
import { validateUserProfile } from '@/lib/auth/profile';
import { ReviewError } from '@/lib/review/workflow';
import { verifyCaller } from '@/lib/server/content-route';
import { ACADEMY_WIDE_ROLES, PROVISIONABLE_ROLES, canCorrectAccount, manageableRoles } from '@/lib/admin/account-authority';

export const accountProfileRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('change_role'), userId: idSchema, role: z.enum(PROVISIONABLE_ROLES), branchId: idSchema.optional() }).strict(),
  z.object({ action: z.literal('move_branch'), userId: idSchema, branchId: idSchema }).strict(),
  z.object({ action: z.literal('change_email'), userId: idSchema, email: z.string().trim().toLowerCase().email('Please enter a valid email address.').max(254) }).strict(),
]);

const denied = (msg = 'You can’t change this account.') => new ReviewError(403, 'not_allowed', msg);
const notFound = () => new ReviewError(404, 'not_found', 'That account isn’t available.');
const conflict = (msg: string) => new ReviewError(409, 'invalid_transition', msg);

async function activeEnrollments(tx: Transaction, db: Firestore, uid: string, orgId: string): Promise<number> {
  const snap = await tx.get(db.collection('enrollments').where('orgId', '==', orgId).where('studentId', '==', uid));
  return snap.docs.filter((d) => d.data().status === 'active').length;
}

async function runningBatches(tx: Transaction, db: Firestore, uid: string, orgId: string): Promise<number> {
  const snap = await tx.get(db.collection('batches').where('orgId', '==', orgId).where('instructorUserIds', 'array-contains', uid));
  return snap.docs.filter((d) => !['archived', 'completed', 'cancelled'].includes(d.data().status)).length;
}

export async function correctAccount(services: { db: Firestore; auth: Auth }, idToken: string | null, body: unknown) {
  const uid = await verifyCaller(services.auth, idToken);
  const parsed = accountProfileRequestSchema.safeParse(body);
  if (!parsed.success) throw new ReviewError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'The request is malformed.');
  const req = parsed.data;
  const { db, auth } = services;

  // The sign-in email lives in Firebase Auth; change it there first and roll it
  // back if the profile transaction fails.
  let previousEmail: string | undefined;
  if (req.action === 'change_email') {
    const [actorSnap, targetSnap] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`users/${req.userId}`).get()]);
    const actor = actorSnap.exists ? validateUserProfile(uid, actorSnap.data()).profile : null;
    const target = targetSnap.exists ? validateUserProfile(req.userId, targetSnap.data()).profile : null;
    if (!target) throw actor?.role === 'super_admin' ? notFound() : denied();
    if (actor && actor.role !== 'super_admin' && actor.orgId !== target.orgId) throw notFound();
    if (!canCorrectAccount(actor, target) || actor!.role === 'branch_admin') throw denied();
    if (target.email === req.email) throw conflict('That is already the account’s email address.');
    try {
      previousEmail = (await auth.getUser(req.userId)).email;
      await auth.updateUser(req.userId, { email: req.email, emailVerified: false });
    } catch (err) {
      if ((err as { code?: string }).code === 'auth/email-already-exists') throw new ReviewError(409, 'email_in_use', 'Another account already uses that email address.');
      if ((err as { code?: string }).code === 'auth/user-not-found') throw new ReviewError(409, 'invalid_transition', 'This account has no sign-in login to update.');
      throw err;
    }
  }

  try {
    return await db.runTransaction(async (tx) => {
      const [actorSnap, targetSnap] = await Promise.all([tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`users/${req.userId}`))]);
      const actor = actorSnap.exists ? validateUserProfile(uid, actorSnap.data()).profile : null;
      const raw = targetSnap.data();
      const target = raw ? validateUserProfile(req.userId, raw).profile : null;
      if (!target || !raw) throw actor?.role === 'super_admin' ? notFound() : denied();
      if (actor && actor.role !== 'super_admin' && actor.orgId !== target.orgId) throw notFound();
      if (!canCorrectAccount(actor, target)) throw denied();
      const iso = new Date().toISOString();
      const audit = (extra: Record<string, unknown>) => tx.create(db.collection('auditLog').doc(), {
        orgId: target.orgId, courseId: null, targetType: 'user', targetId: req.userId, actorId: uid, actorRole: actor!.role, ...extra, at: FieldValue.serverTimestamp(),
      });

      if (req.action === 'change_email') {
        const enrollments = await tx.get(db.collection('enrollments').where('orgId', '==', target.orgId).where('studentId', '==', req.userId));
        tx.update(targetSnap.ref, { email: req.email, updatedAt: iso });
        // Enrollment rosters keep a copy of the email.
        enrollments.docs.forEach((d) => { if (d.data().studentEmail !== undefined) tx.update(d.ref, { studentEmail: req.email, updatedAt: iso }); });
        audit({ action: 'account_email_change', emailChanged: true });
        return { userId: req.userId, email: req.email };
      }

      const fromRole = target.role;
      const toRole = req.action === 'change_role' ? req.role : fromRole;
      if (req.action === 'change_role') {
        if (toRole === fromRole) throw conflict('The account already has that role.');
        if (!manageableRoles(actor!).includes(toRole)) throw denied('You can’t give this role.');
        if (raw.courseDesign && !COURSE_DESIGN_ELIGIBLE_ROLES.includes(toRole)) throw conflict('Revoke this person’s Course Design membership first.');
      }
      const academyWide = ACADEMY_WIDE_ROLES.includes(toRole);
      const fromBranch: string | undefined = raw.branchId || undefined;
      const toBranch: string | undefined = academyWide ? undefined : (req.action === 'move_branch' ? req.branchId : req.branchId ?? fromBranch);
      if (!academyWide && !toBranch) throw new ReviewError(400, 'invalid_request', 'Choose a branch for this role.');
      if (req.action === 'move_branch') {
        if (ACADEMY_WIDE_ROLES.includes(fromRole)) throw conflict('This role belongs to the whole academy and has no branch.');
        if (actor!.role === 'branch_admin') throw denied('Only academy administrators move people between branches.');
        if (toBranch === fromBranch) throw conflict('The account is already in that branch.');
      }
      if (actor!.role === 'branch_admin' && toBranch !== actor!.branchId) throw denied();
      if (toBranch && toBranch !== fromBranch) {
        const b = (await tx.get(db.doc(`branches/${toBranch}`))).data();
        if (!b || b.orgId !== target.orgId) throw new ReviewError(400, 'invalid_request', 'That branch doesn’t belong to this academy.');
        if ((b.status ?? 'active') !== 'active') throw new ReviewError(400, 'invalid_request', 'That branch isn’t active.');
      }
      const leavesStudent = fromRole === 'student' && (toRole !== 'student' || toBranch !== fromBranch);
      const leavesInstructor = fromRole === 'instructor' && (toRole !== 'instructor' || toBranch !== fromBranch);
      if (leavesStudent && await activeEnrollments(tx, db, req.userId, target.orgId)) throw conflict('Withdraw this student from their active batches first.');
      if (leavesInstructor && await runningBatches(tx, db, req.userId, target.orgId)) throw conflict('Remove this instructor from their running batches first.');

      if (fromRole === 'branch_admin' && fromBranch && (toRole !== 'branch_admin' || toBranch !== fromBranch)) {
        tx.update(db.doc(`branches/${fromBranch}`), { branchAdminUserIds: FieldValue.arrayRemove(req.userId), updatedAt: iso });
      }
      if (toRole === 'branch_admin' && toBranch && (fromRole !== 'branch_admin' || toBranch !== fromBranch)) {
        tx.update(db.doc(`branches/${toBranch}`), { branchAdminUserIds: FieldValue.arrayUnion(req.userId), updatedAt: iso });
      }
      tx.update(targetSnap.ref, { role: toRole, branchId: toBranch ?? FieldValue.delete(), updatedAt: iso });
      audit(req.action === 'change_role'
        ? { action: 'account_role_change', fromRole, toRole, ...(fromBranch !== toBranch ? { fromBranchId: fromBranch ?? null, toBranchId: toBranch ?? null } : {}) }
        : { action: 'account_branch_move', fromBranchId: fromBranch ?? null, toBranchId: toBranch });
      return { userId: req.userId, role: toRole, branchId: toBranch ?? null };
    });
  } catch (err) {
    if (req.action === 'change_email' && previousEmail) {
      await auth.updateUser(req.userId, { email: previousEmail }).catch((e) => console.error('[account-profile] could not restore email', e?.code ?? 'error'));
    }
    throw err;
  }
}

/**
 * Milestone G06: after a user verifies a new sign-in email (Firebase
 * verifyBeforeUpdateEmail), copy it onto their profile and enrollment rosters.
 * The address comes from Firebase Auth on the server, never from the request.
 */
export async function syncOwnEmail(services: { db: Firestore; auth: Auth }, idToken: string | null) {
  const uid = await verifyCaller(services.auth, idToken);
  const { db, auth } = services;
  const record = await auth.getUser(uid);
  const email = record.email?.toLowerCase();
  if (!email || !record.emailVerified) return { email: email ?? '', changed: false };
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${uid}`);
    const snap = await tx.get(ref);
    const profile = snap.exists ? validateUserProfile(uid, snap.data()).profile : null;
    if (!profile) throw new ReviewError(403, 'not_allowed', 'This account has no profile.');
    if (profile.email.toLowerCase() === email) return { email, changed: false };
    const enrollments = await tx.get(db.collection('enrollments').where('orgId', '==', profile.orgId).where('studentId', '==', uid));
    const iso = new Date().toISOString();
    tx.update(ref, { email, updatedAt: iso });
    enrollments.docs.forEach((d) => { if (d.data().studentEmail !== undefined) tx.update(d.ref, { studentEmail: email, updatedAt: iso }); });
    tx.create(db.collection('auditLog').doc(), {
      orgId: profile.orgId, courseId: null, targetType: 'user', targetId: uid, action: 'account_email_change', actorId: uid, actorRole: profile.role,
      emailChanged: true, selfService: true, at: FieldValue.serverTimestamp(),
    });
    return { email, changed: true };
  });
}


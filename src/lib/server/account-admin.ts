/**
 * Strynkix LMS — trusted account administration (Stage C5).
 *
 * Course Design membership changes and account status changes (approve,
 * suspend, reactivate) run here, so each one and its auditLog entry commit in
 * one transaction with a Firestore server timestamp. firestore.rules refuse
 * these changes from every client.
 *
 * Authority mirrors the rules that applied to the old client writes:
 * - membership: Super Admin only (Stage B), never on their own profile;
 * - status: Super Admin for any non-Super-Admin account; University Admin for
 *   branch admins, instructors and students of their org; a scoped Branch
 *   Admin for instructors and students of their branch. Nobody changes their own.
 * Suspending an account also revokes its Course Design membership; reactivating
 * never restores it.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { Course, CourseDesignProfile, UserProfile, UserStatus } from '@/types/domain';
import { courseDesignInputSchema, idSchema } from '@/types/validation';
import { ALL_COURSES, buildMembership, validateMembershipAssignment, validateMembershipRevocation } from '@/lib/admin/course-design';
import { validateUserProfile } from '@/lib/auth/profile';
import { ReviewError } from '@/lib/review/workflow';
import { verifyCaller } from '@/lib/server/content-route';

const membershipRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), userId: idSchema, membership: courseDesignInputSchema }).strict(),
  z.object({ action: z.literal('revoke'), userId: idSchema, reason: z.string().trim().max(1000).optional() }).strict(),
]);

const statusRequestSchema = z.object({
  userId: idSchema,
  action: z.enum(['approve', 'suspend', 'reactivate']),
  reason: z.string().trim().max(1000).optional(),
}).strict();

const denied = (msg = 'You can’t change this account.') => new ReviewError(403, 'not_allowed', msg);
const notFound = () => new ReviewError(404, 'not_found', 'That account isn’t available.');

/** What an audit entry may say about a membership: no personal data. */
const membershipSummary = (m: CourseDesignProfile | undefined | null) =>
  m ? { responsibilities: m.responsibilities, assignedCourseIds: m.assignedCourseIds } : null;

function loadProfile(uid: string, data: FirebaseFirestore.DocumentData | undefined): UserProfile | null {
  return data ? validateUserProfile(uid, data).profile : null;
}

export async function manageCourseDesignMembership(services: { db: Firestore; auth: Auth }, idToken: string | null, body: unknown) {
  const uid = await verifyCaller(services.auth, idToken);
  const parsed = membershipRequestSchema.safeParse(body);
  if (!parsed.success) throw new ReviewError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'The request is malformed.');
  const req = parsed.data;
  const { db } = services;

  return db.runTransaction(async (tx) => {
    const [actorSnap, targetSnap] = await Promise.all([tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`users/${req.userId}`))]);
    const actorProfile = loadProfile(uid, actorSnap.data());
    const actor = actorProfile ? { uid, role: actorProfile.role, status: actorProfile.status } : null;
    const target = loadProfile(req.userId, targetSnap.data());
    if (actor?.role === 'super_admin' && !target) throw notFound();

    let next: CourseDesignProfile | null = null;
    if (req.action === 'assign') {
      const ids = req.membership.assignedCourseIds.filter((id) => id !== ALL_COURSES);
      const courseSnaps = ids.length ? await tx.getAll(...ids.map((id) => db.doc(`courses/${id}`))) : [];
      const courses = courseSnaps.flatMap((s) => (s.exists ? [{ id: s.id, ...s.data() } as Course] : []));
      const error = validateMembershipAssignment({ actor, target, input: req.membership, courses });
      if (error) throw actor?.role === 'super_admin' && actor.status === 'active' ? new ReviewError(409, 'invalid_membership', error) : denied(error);
      next = buildMembership(req.membership, uid);
      tx.update(targetSnap.ref, { courseDesign: next, updatedAt: next.assignedAt });
    } else {
      const error = validateMembershipRevocation({ actor, target });
      if (error) throw actor?.role === 'super_admin' && actor.status === 'active' ? new ReviewError(409, 'invalid_membership', error) : denied(error);
      tx.update(targetSnap.ref, { courseDesign: FieldValue.delete(), updatedAt: new Date().toISOString() });
    }

    const auditRef = db.collection('auditLog').doc();
    tx.create(auditRef, {
      orgId: target!.orgId, courseId: null, targetType: 'user', targetId: req.userId,
      action: req.action === 'revoke' ? 'membership_revoke' : target!.courseDesign ? 'membership_update' : 'membership_assign',
      actorId: uid, actorRole: actor!.role,
      membershipBefore: membershipSummary(target!.courseDesign), membershipAfter: membershipSummary(next),
      // Org-wide scope is flagged so it stands out in reviews of the log.
      orgWide: next?.assignedCourseIds[0] === ALL_COURSES,
      ...(req.action === 'revoke' && req.reason ? { reason: req.reason } : {}),
      at: FieldValue.serverTimestamp(),
    });
    return { userId: req.userId, courseDesign: next, auditId: auditRef.id };
  });
}

const TRANSITIONS: Record<'approve' | 'suspend' | 'reactivate', { from: UserStatus[]; to: UserStatus }> = {
  approve: { from: ['pending_verification', 'invited'], to: 'active' },
  suspend: { from: ['active'], to: 'suspended' },
  reactivate: { from: ['suspended'], to: 'active' },
};

/** May this administrator change this account's status? Mirrors the pre-C5 rules. */
export function canChangeAccountStatus(actor: UserProfile | null, target: UserProfile): boolean {
  if (!actor || actor.status !== 'active' || actor.id === target.id) return false;
  if (target.role === 'super_admin') return false;
  if (actor.role === 'super_admin') return true;
  if (actor.orgId !== target.orgId) return false;
  if (actor.role === 'university_admin') return ['branch_admin', 'instructor', 'student'].includes(target.role);
  if (actor.role === 'branch_admin') {
    return Boolean(actor.branchId) && actor.branchId === target.branchId && ['instructor', 'student'].includes(target.role);
  }
  return false;
}

export async function changeAccountStatus(services: { db: Firestore; auth: Auth }, idToken: string | null, body: unknown) {
  const uid = await verifyCaller(services.auth, idToken);
  const parsed = statusRequestSchema.safeParse(body);
  if (!parsed.success) throw new ReviewError(400, 'invalid_request', 'The request is malformed.');
  const { userId, action, reason } = parsed.data;
  const { db } = services;

  const result = await db.runTransaction(async (tx) => {
    const [actorSnap, targetSnap] = await Promise.all([tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`users/${userId}`))]);
    const actor = loadProfile(uid, actorSnap.data());
    const raw = targetSnap.data();
    const target = loadProfile(userId, raw);
    if (!target || !raw) throw actor?.role === 'super_admin' ? notFound() : denied();
    // Another organization's accounts don't exist for the caller.
    if (actor && actor.role !== 'super_admin' && actor.orgId !== target.orgId) throw notFound();
    if (!canChangeAccountStatus(actor, target)) throw denied();
    const from = (raw.status ?? 'active') as UserStatus;
    const t = TRANSITIONS[action];
    if (!t.from.includes(from)) throw new ReviewError(409, 'invalid_transition', `This account is ${from.replace('_', ' ')}; it can’t be ${action === 'approve' ? 'approved' : action + 'd'}.`);

    const revokeMembership = action === 'suspend' && Boolean(raw.courseDesign);
    tx.update(targetSnap.ref, {
      status: t.to, updatedAt: new Date().toISOString(),
      ...(revokeMembership ? { courseDesign: FieldValue.delete() } : {}),
    });
    const auditRef = db.collection('auditLog').doc();
    tx.create(auditRef, {
      orgId: target.orgId, courseId: null, targetType: 'user', targetId: userId, action: `account_${action}`,
      actorId: uid, actorRole: actor!.role, fromStatus: from, toStatus: t.to,
      ...(revokeMembership ? { membershipBefore: membershipSummary(raw.courseDesign), membershipAfter: null, membershipRevoked: true } : {}),
      ...(reason ? { reason } : {}),
      at: FieldValue.serverTimestamp(),
    });
    return { userId, status: t.to, membershipRevoked: revokeMembership, auditId: auditRef.id };
  });

  // End the suspended user's sessions; the route checks revocation on every request.
  if (action === 'suspend') {
    await services.auth.revokeRefreshTokens(userId).catch((err) => console.warn('[account-status] could not revoke sessions', err?.code ?? 'error'));
  }
  return result;
}

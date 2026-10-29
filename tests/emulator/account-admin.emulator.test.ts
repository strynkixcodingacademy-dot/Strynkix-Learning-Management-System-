/**
 * Stage C5 — POST /api/admin/course-design and POST /api/admin/account-status
 * on the Auth + Firestore emulators, with real ID tokens. Membership and status
 * changes are authorized on the server, audited atomically, and suspension
 * revokes membership and sessions; failed or refused requests audit nothing.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST as membershipPOST } from '@/app/api/admin/course-design/route';
import { POST as statusPOST } from '@/app/api/admin/account-status/route';
import { POST as reviewPOST } from '@/app/api/content/review/route';
import { getAdminServices } from '@/lib/server/firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-10-29T00:00:00.000Z';
const USERS = ['aa_super', 'aa_super_sus', 'aa_uni', 'aa_uni_b', 'aa_ba', 'aa_ba_b2', 'aa_inst', 'aa_member', 'aa_designer', 'aa_stu', 'aa_pending', 'aa_noprofile', 'aa_student2'];

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();

async function idToken(uid: string, fresh = false): Promise<string> {
  if (!fresh && tokens.has(uid)) return tokens.get(uid)!;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const t = (await res.json()).idToken;
  tokens.set(uid, t);
  return t;
}

async function call(handler: (r: Request) => Promise<Response>, uid: string | null, payload: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token || uid) headers.Authorization = `Bearer ${token ?? (await idToken(uid!))}`;
  const res = await handler(new Request('http://localhost/api', { method: 'POST', headers, body: JSON.stringify(payload) }));
  return { status: res.status, json: await res.json() };
}

const assign = (uid: string, userId: string, responsibilities: string[], assignedCourseIds: string[]) =>
  call(membershipPOST, uid, { action: 'assign', userId, membership: { responsibilities, assignedCourseIds } });
const setStatus = (uid: string, userId: string, action: string, extra: Record<string, unknown> = {}) => call(statusPOST, uid, { userId, action, ...extra });
const user = async (id: string) => (await db.doc(`users/${id}`).get()).data()!;
const audits = async () => (await db.collection('auditLog').get()).docs.map((d) => d.data());

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  for (const uid of USERS) {
    await auth.deleteUser(uid).catch(() => undefined);
    await auth.createUser({ uid, email: `${uid}@admin.test` });
  }
});

beforeEach(async () => {
  tokens.clear();
  const res = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error('clear failed');
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const u = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
    put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@admin.test`, displayName: uid, ...extra });
  const cd = (r: string[], c: string[]) => ({ department: 'course_design', responsibilities: r, assignedCourseIds: c, assignedAt: NOW, assignedByUserId: 'aa_super' });
  await u('aa_super', 'super_admin');
  await u('aa_super_sus', 'super_admin', { status: 'suspended' });
  await u('aa_uni', 'university_admin');
  await u('aa_uni_b', 'university_admin', { orgId: 'org_b' });
  await u('aa_ba', 'branch_admin', { branchId: 'b1' });
  await u('aa_ba_b2', 'branch_admin', { branchId: 'b2' });
  await u('aa_inst', 'instructor', { branchId: 'b1' });
  await u('aa_member', 'instructor', { branchId: 'b1', courseDesign: cd(['reviewer'], ['c1']) });
  await u('aa_designer', 'content_designer');
  await u('aa_stu', 'student', { branchId: 'b1' });
  await u('aa_student2', 'student', { branchId: 'b2' });
  await u('aa_pending', 'student', { branchId: 'b1', status: 'pending_verification' });
  await put('courses/c1', { orgId: 'org_a', title: 'C1', status: 'draft', createdById: 'aa_inst' });
  await put('courses/c_b', { orgId: 'org_b', title: 'Other org', status: 'draft', createdById: 'x' });
  await put('lessons/l1', { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'L1', status: 'draft', blocks: [], lastEditedById: 'aa_inst', review: { state: 'in_review', submittedById: 'aa_inst', submittedAt: NOW } });
});

describe('Course Design membership route', () => {
  it('the Super Admin grants, updates and revokes, each audited with a server timestamp and no personal data', async () => {
    const a = await assign('aa_super', 'aa_designer', ['content_developer'], ['c1']);
    expect(a.status).toBe(200);
    expect(await user('aa_designer')).toMatchObject({ courseDesign: { responsibilities: ['content_developer'], assignedCourseIds: ['c1'], assignedByUserId: 'aa_super' } });
    expect((await assign('aa_super', 'aa_designer', ['lead'], ['*'])).status).toBe(200);
    expect((await call(membershipPOST, 'aa_super', { action: 'revoke', userId: 'aa_designer', reason: 'Left the team' })).status).toBe(200);
    expect((await user('aa_designer')).courseDesign).toBeUndefined();

    const entries = (await audits()).sort((x, y) => (x.at as Timestamp).toMillis() - (y.at as Timestamp).toMillis());
    expect(entries.map((e) => e.action)).toEqual(['membership_assign', 'membership_update', 'membership_revoke']);
    for (const e of entries) {
      expect(e).toMatchObject({ orgId: 'org_a', courseId: null, targetType: 'user', targetId: 'aa_designer', actorId: 'aa_super', actorRole: 'super_admin' });
      expect(e.at).toBeInstanceOf(Timestamp);
      expect(JSON.stringify(e)).not.toContain('@admin.test');
    }
    expect(entries[1]).toMatchObject({ orgWide: true, membershipBefore: { responsibilities: ['content_developer'] }, membershipAfter: { assignedCourseIds: ['*'] } });
    expect(entries[2]).toMatchObject({ reason: 'Left the team', membershipAfter: null });
  });

  it('only an active Super Admin manages membership; nobody assigns themselves', async () => {
    for (const uid of ['aa_uni', 'aa_ba', 'aa_inst', 'aa_member', 'aa_designer', 'aa_stu', 'aa_super_sus']) {
      expect((await assign(uid, 'aa_designer', ['lead'], ['c1'])).status, uid).toBe(403);
    }
    expect((await assign('aa_super', 'aa_super', ['lead'], ['c1'])).status).toBe(409);
    expect((await assign('aa_designer', 'aa_designer', ['lead'], ['*'])).status).toBe(403);
    expect(await audits()).toEqual([]);
  });

  it('refuses ineligible or inactive targets, cross-organization courses and malformed memberships', async () => {
    expect((await assign('aa_super', 'aa_stu', ['reviewer'], ['c1'])).json.error).toBe('invalid_membership');
    expect((await assign('aa_super', 'aa_pending', ['reviewer'], ['c1'])).json.error).toBe('invalid_membership');
    expect((await assign('aa_super', 'aa_designer', ['reviewer'], ['c_b'])).json.error).toBe('invalid_membership');
    expect((await assign('aa_super', 'aa_designer', ['reviewer'], ['missing'])).json.error).toBe('invalid_membership');
    for (const membership of [{ responsibilities: ['publisher'], assignedCourseIds: ['c1'] }, { responsibilities: ['lead'], assignedCourseIds: ['*', 'c1'] }, { responsibilities: [], assignedCourseIds: ['c1'] }]) {
      expect((await call(membershipPOST, 'aa_super', { action: 'assign', userId: 'aa_designer', membership })).status).toBe(400);
    }
    expect((await call(membershipPOST, 'aa_super', { action: 'assign', userId: 'aa_designer', membership: { responsibilities: ['lead'], assignedCourseIds: ['c1'] }, assignedByUserId: 'x' })).status).toBe(400);
    expect((await assign('aa_super', 'aa_missing', ['lead'], ['c1'])).status).toBe(404);
    expect(await audits()).toEqual([]);
  });
});

describe('account status route', () => {
  it('University and Branch Admins approve and suspend within their scope, audited', async () => {
    expect((await setStatus('aa_uni', 'aa_pending', 'approve')).json).toMatchObject({ status: 'active' });
    expect((await setStatus('aa_ba', 'aa_stu', 'suspend', { reason: 'Policy breach' })).json).toMatchObject({ status: 'suspended', membershipRevoked: false });
    expect((await setStatus('aa_ba', 'aa_stu', 'reactivate')).json).toMatchObject({ status: 'active' });
    const actions = (await audits()).map((e) => `${e.action}:${e.actorId}:${e.fromStatus}>${e.toStatus}`).sort();
    expect(actions).toEqual(['account_approve:aa_uni:pending_verification>active', 'account_reactivate:aa_ba:suspended>active', 'account_suspend:aa_ba:active>suspended']);
  });

  it('suspension revokes Course Design membership and sessions; reactivation restores neither', async () => {
    const stale = await idToken('aa_member');
    expect((await call(reviewPOST, 'aa_member', { targetType: 'lesson', targetId: 'l1', action: 'approve' })).status).toBe(200);
    await db.doc('lessons/l1').update({ review: { state: 'in_review', submittedById: 'aa_inst', submittedAt: NOW } });
    await new Promise((r) => setTimeout(r, 1100));
    const r = await setStatus('aa_ba', 'aa_member', 'suspend');
    expect(r.json).toMatchObject({ status: 'suspended', membershipRevoked: true });
    expect((await user('aa_member')).courseDesign).toBeUndefined();
    expect((await audits()).find((e) => e.action === 'account_suspend')).toMatchObject({ membershipRevoked: true, membershipBefore: { responsibilities: ['reviewer'] } });
    // The old session is dead.
    expect((await call(reviewPOST, null, { targetType: 'lesson', targetId: 'l1', action: 'approve' }, stale)).status).toBe(401);

    expect((await setStatus('aa_ba', 'aa_member', 'reactivate')).json.status).toBe('active');
    expect((await user('aa_member')).courseDesign).toBeUndefined();
    const again = await call(reviewPOST, null, { targetType: 'lesson', targetId: 'l1', action: 'approve' }, await idToken('aa_member', true));
    expect(again.status).toBe(403);
  });

  it('refuses out-of-scope, cross-organization, self, peer-admin and Super Admin targets', async () => {
    expect((await setStatus('aa_ba', 'aa_student2', 'suspend')).status).toBe(403);
    expect((await setStatus('aa_ba_b2', 'aa_stu', 'suspend')).status).toBe(403);
    expect((await setStatus('aa_ba', 'aa_ba_b2', 'suspend')).status).toBe(403);
    expect((await setStatus('aa_ba', 'aa_designer', 'suspend')).status).toBe(403);
    expect((await setStatus('aa_uni_b', 'aa_stu', 'suspend')).status).toBe(404);
    expect((await setStatus('aa_uni', 'aa_uni', 'suspend')).status).toBe(403);
    expect((await setStatus('aa_uni', 'aa_super', 'suspend')).status).toBe(403);
    expect((await setStatus('aa_inst', 'aa_stu', 'suspend')).status).toBe(403);
    expect((await setStatus('aa_stu', 'aa_stu', 'reactivate')).status).toBe(403);
    expect((await setStatus('aa_super_sus', 'aa_stu', 'suspend')).status).toBe(403);
    expect(await audits()).toEqual([]);
  });

  it('the Super Admin manages any non-Super-Admin account, including content team members', async () => {
    expect((await setStatus('aa_super', 'aa_designer', 'suspend')).status).toBe(200);
    expect((await setStatus('aa_super', 'aa_uni', 'suspend')).status).toBe(200);
  });

  it('invalid transitions, malformed bodies and unprovisioned callers are refused without audit', async () => {
    expect((await setStatus('aa_ba', 'aa_stu', 'reactivate')).status).toBe(409);
    expect((await setStatus('aa_ba', 'aa_stu', 'approve')).status).toBe(409);
    expect((await setStatus('aa_ba', 'aa_stu', 'delete')).status).toBe(400);
    expect((await setStatus('aa_ba', 'aa_stu', 'suspend', { status: 'active' })).status).toBe(400);
    expect((await setStatus('aa_noprofile', 'aa_stu', 'suspend')).status).toBe(403);
    expect((await call(statusPOST, null, { userId: 'aa_stu', action: 'suspend' })).status).toBe(401);
    expect(await audits()).toEqual([]);
  });

  it('concurrent suspensions: exactly one lands', async () => {
    const results = await Promise.all([setStatus('aa_ba', 'aa_stu', 'suspend'), setStatus('aa_uni', 'aa_stu', 'suspend'), setStatus('aa_super', 'aa_stu', 'suspend')]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await audits()).filter((e) => e.action === 'account_suspend')).toHaveLength(1);
  });
});

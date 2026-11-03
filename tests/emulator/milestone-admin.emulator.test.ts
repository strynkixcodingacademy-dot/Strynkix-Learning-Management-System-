/**
 * LMS completion milestone — trusted administration routes on the Auth +
 * Firestore emulators with real ID tokens:
 *   G37/G50 POST /api/admin/accounts       (account creation, incl. University Admins)
 *   G35     POST /api/admin/academy        (academy and branch edits and (de)activation)
 *   G40     POST /api/admin/account-profile (role change, branch move, email correction)
 *   G06     POST /api/account/email-sync   (verified self-service email change → profile)
 * Every change is authorized on the server, scoped to the caller's academy and
 * branch, and audited in the same transaction; refusals write nothing.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST as accountsPOST } from '@/app/api/admin/accounts/route';
import { POST as academyPOST } from '@/app/api/admin/academy/route';
import { POST as profilePOST } from '@/app/api/admin/account-profile/route';
import { POST as emailSyncPOST } from '@/app/api/account/email-sync/route';
import { POST as statusPOST } from '@/app/api/admin/account-status/route';
import { POST as membershipPOST } from '@/app/api/admin/course-design/route';
import { getAdminServices } from '@/lib/server/firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-10-30T00:00:00.000Z';
const USERS = ['ma_super', 'ma_uni', 'ma_uni_b', 'ma_ba', 'ma_inst', 'ma_stu', 'ma_stu_b2', 'ma_ba_b2', 'ma_designer'];

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();

async function idToken(uid: string): Promise<string> {
  if (tokens.has(uid)) return tokens.get(uid)!;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const t = (await res.json()).idToken;
  tokens.set(uid, t);
  return t;
}

async function call(handler: (r: Request) => Promise<Response>, uid: string | null, payload: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = `Bearer ${await idToken(uid)}`;
  const res = await handler(new Request('http://localhost/api', { method: 'POST', headers, body: JSON.stringify(payload) }));
  return { status: res.status, json: await res.json() };
}

const audits = async () => (await db.collection('auditLog').get()).docs.map((d) => d.data());
const account = (overrides: Record<string, unknown>) => ({ email: `n${Math.random().toString(36).slice(2, 9)}@new.test`, password: 'Temp-Passw0rd!', displayName: 'New Person', orgId: 'org_a', ...overrides });

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
});

beforeEach(async () => {
  tokens.clear();
  await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  for (const uid of USERS) await auth.createUser({ uid, email: `${uid}@admin.test` });
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const u = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
    put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@admin.test`, displayName: uid, createdAt: NOW, updatedAt: NOW, ...extra });
  await put('organizations/org_a', { name: 'Academy A', status: 'active' });
  await put('organizations/org_b', { name: 'Academy B', status: 'active' });
  await put('organizations/org_off', { name: 'Closed', status: 'suspended' });
  await put('branches/b1', { orgId: 'org_a', name: 'B1', status: 'active', branchAdminUserIds: ['ma_ba'] });
  await put('branches/b2', { orgId: 'org_a', name: 'B2', status: 'active', branchAdminUserIds: ['ma_ba_b2'] });
  await put('branches/b_arch', { orgId: 'org_a', name: 'Old', status: 'archived' });
  await put('branches/bx', { orgId: 'org_b', name: 'BX', status: 'active' });
  await u('ma_super', 'super_admin');
  await u('ma_uni', 'university_admin');
  await u('ma_uni_b', 'university_admin', { orgId: 'org_b' });
  await u('ma_ba', 'branch_admin', { branchId: 'b1' });
  await u('ma_ba_b2', 'branch_admin', { branchId: 'b2' });
  await u('ma_inst', 'instructor', { branchId: 'b1' });
  await u('ma_stu', 'student', { branchId: 'b1' });
  await u('ma_stu_b2', 'student', { branchId: 'b2' });
  await u('ma_designer', 'content_designer');
  await put('courses/c1', { orgId: 'org_a', title: 'C1', status: 'draft' });
  await put('enrollments/c1_ma_stu', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', batchId: 'bt1', studentId: 'ma_stu', studentEmail: 'ma_stu@admin.test', status: 'active' });
  await put('batches/bt1', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', instructorUserIds: ['ma_inst'], status: 'in_progress' });
});

describe('G37 — account creation through the audited server route', () => {
  it('the Super Admin creates a University Admin: login, academy-wide profile and audit entry', async () => {
    const res = await call(accountsPOST, 'ma_super', account({ role: 'university_admin', email: 'dean@new.test' }));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ role: 'university_admin', orgId: 'org_a', existing: false });
    const profile = (await db.doc(`users/${res.json.uid}`).get()).data()!;
    expect(profile).toMatchObject({ role: 'university_admin', orgId: 'org_a', status: 'active', email: 'dean@new.test' });
    expect('branchId' in profile).toBe(false);
    expect((await auth.getUser(res.json.uid)).email).toBe('dean@new.test');
    expect(await audits()).toEqual([expect.objectContaining({ action: 'account_create', actorId: 'ma_super', targetId: res.json.uid, toRole: 'university_admin', orgId: 'org_a', courseId: null })]);
    expect(JSON.stringify(await audits())).not.toContain('Temp-Passw0rd!');
  });

  it('only the Super Admin creates University Admins and content team members', async () => {
    for (const uid of ['ma_uni', 'ma_ba', 'ma_inst', 'ma_stu', 'ma_designer']) {
      expect((await call(accountsPOST, uid, account({ role: 'university_admin' }))).status, uid).toBe(403);
      expect((await call(accountsPOST, uid, account({ role: 'content_designer' }))).status, uid).toBe(403);
    }
    expect(await audits()).toEqual([]);
  });

  it('a University Admin creates branch roles in their own academy only', async () => {
    const ok = await call(accountsPOST, 'ma_uni', account({ role: 'branch_admin', branchId: 'b2' }));
    expect(ok.status).toBe(200);
    expect((await db.doc('branches/b2').get()).data()!.branchAdminUserIds).toContain(ok.json.uid);
    expect((await call(accountsPOST, 'ma_uni', account({ role: 'instructor', branchId: 'b1' }))).status).toBe(200);
    // Another academy: refused as if it didn't exist; a branch of another academy is refused too.
    expect((await call(accountsPOST, 'ma_uni', account({ role: 'student', orgId: 'org_b', branchId: 'bx' }))).status).toBe(404);
    expect((await call(accountsPOST, 'ma_uni', account({ role: 'student', branchId: 'bx' }))).status).toBe(400);
  });

  it('a Branch Manager creates instructors and students in their own branch only', async () => {
    expect((await call(accountsPOST, 'ma_ba', account({ role: 'student', branchId: 'b1' }))).status).toBe(200);
    expect((await call(accountsPOST, 'ma_ba', account({ role: 'student', branchId: 'b2' }))).status).toBe(403);
    expect((await call(accountsPOST, 'ma_ba', account({ role: 'branch_admin', branchId: 'b1' }))).status).toBe(403);
  });

  it('validates branch placement, academy status and request shape', async () => {
    expect((await call(accountsPOST, 'ma_super', account({ role: 'student' }))).status).toBe(400);
    expect((await call(accountsPOST, 'ma_super', account({ role: 'university_admin', branchId: 'b1' }))).status).toBe(400);
    expect((await call(accountsPOST, 'ma_super', account({ role: 'student', branchId: 'b_arch' }))).status).toBe(400);
    expect((await call(accountsPOST, 'ma_super', account({ role: 'university_admin', orgId: 'org_off' }))).status).toBe(400);
    expect((await call(accountsPOST, 'ma_super', account({ role: 'super_admin' }))).status).toBe(400);
    expect((await call(accountsPOST, 'ma_super', { ...account({ role: 'student', branchId: 'b1' }), status: 'active' })).status).toBe(400);
    expect((await call(accountsPOST, 'ma_super', account({ role: 'student', branchId: 'b1', password: 'short' }))).status).toBe(400);
    expect((await call(accountsPOST, null, account({ role: 'student', branchId: 'b1' }))).status).toBe(401);
    expect(await audits()).toEqual([]);
  });

  it('reuses an existing account of the same role in the same branch; refuses any other email clash', async () => {
    const reuse = await call(accountsPOST, 'ma_ba', account({ role: 'student', branchId: 'b1', email: 'ma_stu@admin.test' }));
    expect(reuse).toMatchObject({ status: 200, json: { uid: 'ma_stu', existing: true } });
    expect((await call(accountsPOST, 'ma_ba', account({ role: 'instructor', branchId: 'b1', email: 'ma_stu@admin.test' }))).status).toBe(409);
    expect(await audits()).toEqual([]);
  });

  it('Course Design membership on creation is Super Admin only and validated', async () => {
    const ok = await call(accountsPOST, 'ma_super', account({ role: 'content_designer', courseDesign: { responsibilities: ['content_developer'], assignedCourseIds: ['c1'] } }));
    expect(ok.status).toBe(200);
    expect((await db.doc(`users/${ok.json.uid}`).get()).data()!.courseDesign).toMatchObject({ assignedByUserId: 'ma_super', assignedCourseIds: ['c1'] });
    expect((await call(accountsPOST, 'ma_super', account({ role: 'content_designer', courseDesign: { responsibilities: ['content_developer'], assignedCourseIds: ['nope'] } }))).status).toBe(400);
    expect((await call(accountsPOST, 'ma_super', account({ role: 'student', branchId: 'b1', courseDesign: { responsibilities: ['reviewer'], assignedCourseIds: ['c1'] } }))).status).toBe(400);
  });

  it('refused requests leave no login behind', async () => {
    const before = (await auth.listUsers()).users.length;
    await call(accountsPOST, 'ma_uni', account({ role: 'student', orgId: 'org_b', branchId: 'bx', email: 'ghost@new.test' }));
    expect((await auth.listUsers()).users.length).toBe(before);
    await expect(auth.getUserByEmail('ghost@new.test')).rejects.toBeTruthy();
  });
});

describe('G35 — academy and branch maintenance', () => {
  it('the Super Admin edits and suspends an academy; nothing is deleted; audited', async () => {
    expect((await call(academyPOST, 'ma_super', { action: 'update_org', orgId: 'org_b', fields: { name: 'Academy Bee', defaultTimezone: 'Asia/Kolkata' } })).status).toBe(200);
    expect((await db.doc('organizations/org_b').get()).data()).toMatchObject({ name: 'Academy Bee', settings: { defaultTimezone: 'Asia/Kolkata' } });
    expect((await call(academyPOST, 'ma_super', { action: 'set_org_status', orgId: 'org_b', status: 'suspended', reason: 'Contract ended' })).status).toBe(200);
    expect((await db.doc('organizations/org_b').get()).data()!.status).toBe('suspended');
    expect((await db.doc('branches/bx').get()).exists).toBe(true);
    // No new accounts in a suspended academy.
    expect((await call(accountsPOST, 'ma_super', account({ role: 'university_admin', orgId: 'org_b' }))).status).toBe(400);
    expect((await audits()).map((a) => a.action).sort()).toEqual(['set_org_status', 'update_org']);
  });

  it('refuses academy changes from anyone but the Super Admin, and bad input', async () => {
    expect((await call(academyPOST, 'ma_uni', { action: 'update_org', orgId: 'org_a', fields: { name: 'Mine' } })).status).toBe(403);
    expect((await call(academyPOST, 'ma_uni', { action: 'set_org_status', orgId: 'org_b', status: 'suspended' })).status).toBe(404);
    expect((await call(academyPOST, 'ma_super', { action: 'set_org_status', orgId: 'org_a', status: 'suspended' })).status).toBe(409);
    expect((await call(academyPOST, 'ma_super', { action: 'update_org', orgId: 'org_b', fields: { defaultTimezone: 'Mars/Base' } })).status).toBe(400);
    expect((await call(academyPOST, 'ma_super', { action: 'update_org', orgId: 'org_b', fields: { status: 'suspended' } })).status).toBe(400);
    expect(await audits()).toEqual([]);
  });

  it('University Admins edit and deactivate branches of their academy only; inactive branches get no accounts', async () => {
    expect((await call(academyPOST, 'ma_uni', { action: 'update_branch', branchId: 'b2', fields: { name: 'Branch Two', code: 'b-02' } })).status).toBe(200);
    expect((await db.doc('branches/b2').get()).data()).toMatchObject({ name: 'Branch Two', code: 'B-02' });
    expect((await call(academyPOST, 'ma_uni', { action: 'set_branch_status', branchId: 'b2', status: 'inactive' })).status).toBe(200);
    expect((await call(accountsPOST, 'ma_uni', account({ role: 'student', branchId: 'b2' }))).status).toBe(400);
    expect((await call(academyPOST, 'ma_uni', { action: 'update_branch', branchId: 'bx', fields: { name: 'Theirs' } })).status).toBe(404);
    expect((await call(academyPOST, 'ma_ba', { action: 'set_branch_status', branchId: 'b1', status: 'inactive' })).status).toBe(403);
    expect((await call(academyPOST, 'ma_inst', { action: 'update_branch', branchId: 'b1', fields: { name: 'X1' } })).status).toBe(403);
  });
});

describe('G40 — role changes, branch moves and email corrections', () => {
  it('a University Admin changes a student’s role only after withdrawal; audited with from/to', async () => {
    expect((await call(profilePOST, 'ma_uni', { action: 'change_role', userId: 'ma_stu', role: 'instructor' })).status).toBe(409);
    await db.doc('enrollments/c1_ma_stu').update({ status: 'dropped' });
    const ok = await call(profilePOST, 'ma_uni', { action: 'change_role', userId: 'ma_stu', role: 'instructor' });
    expect(ok.status).toBe(200);
    expect((await db.doc('users/ma_stu').get()).data()).toMatchObject({ role: 'instructor', branchId: 'b1' });
    expect(await audits()).toEqual([expect.objectContaining({ action: 'account_role_change', fromRole: 'student', toRole: 'instructor', targetId: 'ma_stu', actorId: 'ma_uni' })]);
  });

  it('no self-escalation, no Super Admin targets, no privileged roles from academy admins', async () => {
    expect((await call(profilePOST, 'ma_uni', { action: 'change_role', userId: 'ma_uni', role: 'student', branchId: 'b1' })).status).toBe(403);
    expect((await call(profilePOST, 'ma_uni', { action: 'change_role', userId: 'ma_super', role: 'student', branchId: 'b1' })).status).toBe(403);
    expect((await call(profilePOST, 'ma_uni', { action: 'change_role', userId: 'ma_ba', role: 'university_admin' })).status).toBe(403);
    expect((await call(profilePOST, 'ma_ba', { action: 'change_role', userId: 'ma_stu_b2', role: 'instructor' })).status).toBe(403);
    expect((await call(profilePOST, 'ma_ba', { action: 'change_role', userId: 'ma_inst', role: 'branch_admin' })).status).toBe(403);
    expect((await call(profilePOST, 'ma_uni_b', { action: 'change_role', userId: 'ma_inst', role: 'student' })).status).toBe(404);
    expect((await call(profilePOST, 'ma_stu', { action: 'change_role', userId: 'ma_stu', role: 'branch_admin', branchId: 'b1' })).status).toBe(403);
    expect(await audits()).toEqual([]);
  });

  it('moving a Branch Manager updates both branch documents; instructors with running batches stay put', async () => {
    const ok = await call(profilePOST, 'ma_uni', { action: 'move_branch', userId: 'ma_ba', branchId: 'b2' });
    expect(ok.status).toBe(200);
    expect((await db.doc('branches/b1').get()).data()!.branchAdminUserIds).not.toContain('ma_ba');
    expect((await db.doc('branches/b2').get()).data()!.branchAdminUserIds).toContain('ma_ba');
    expect((await call(profilePOST, 'ma_uni', { action: 'move_branch', userId: 'ma_inst', branchId: 'b2' })).status).toBe(409);
    expect((await call(profilePOST, 'ma_uni', { action: 'move_branch', userId: 'ma_stu_b2', branchId: 'bx' })).status).toBe(400);
    expect((await call(profilePOST, 'ma_uni', { action: 'move_branch', userId: 'ma_stu_b2', branchId: 'b_arch' })).status).toBe(400);
    expect((await call(profilePOST, 'ma_super', { action: 'move_branch', userId: 'ma_designer', branchId: 'b1' })).status).toBe(409);
  });

  it('becoming academy-wide removes the branch; Course Design members must lose membership first', async () => {
    const ok = await call(profilePOST, 'ma_super', { action: 'change_role', userId: 'ma_stu_b2', role: 'content_designer' });
    expect(ok.status).toBe(200);
    expect('branchId' in (await db.doc('users/ma_stu_b2').get()).data()!).toBe(false);
    await db.doc('users/ma_designer').update({ courseDesign: { department: 'course_design', responsibilities: ['reviewer'], assignedCourseIds: ['c1'], assignedAt: NOW, assignedByUserId: 'ma_super' } });
    expect((await call(profilePOST, 'ma_super', { action: 'change_role', userId: 'ma_designer', role: 'student', branchId: 'b1' })).status).toBe(409);
  });

  it('corrects a sign-in email in Auth, the profile and enrollment rosters, without logging the address', async () => {
    const ok = await call(profilePOST, 'ma_uni', { action: 'change_email', userId: 'ma_stu', email: 'Fixed.Student@New.test' });
    expect(ok.status).toBe(200);
    expect((await auth.getUser('ma_stu')).email).toBe('fixed.student@new.test');
    expect((await db.doc('users/ma_stu').get()).data()!.email).toBe('fixed.student@new.test');
    expect((await db.doc('enrollments/c1_ma_stu').get()).data()!.studentEmail).toBe('fixed.student@new.test');
    expect(JSON.stringify(await audits())).not.toContain('fixed.student');
    expect((await call(profilePOST, 'ma_uni', { action: 'change_email', userId: 'ma_inst', email: 'ma_stu_b2@admin.test' })).status).toBe(409);
    expect((await auth.getUser('ma_inst')).email).toBe('ma_inst@admin.test');
    expect((await call(profilePOST, 'ma_ba', { action: 'change_email', userId: 'ma_stu', email: 'x@new.test' })).status).toBe(403);
  });
});

describe('G06 — self-service email change reaches the profile only once verified', () => {
  it('unverified: nothing changes; verified: profile and rosters follow Auth, audited without the address', async () => {
    await auth.updateUser('ma_stu', { email: 'new.me@new.test', emailVerified: false });
    expect(await call(emailSyncPOST, 'ma_stu', {})).toMatchObject({ status: 200, json: { changed: false } });
    expect((await db.doc('users/ma_stu').get()).data()!.email).toBe('ma_stu@admin.test');

    await auth.updateUser('ma_stu', { emailVerified: true });
    tokens.clear();
    expect(await call(emailSyncPOST, 'ma_stu', {})).toMatchObject({ status: 200, json: { changed: true, email: 'new.me@new.test' } });
    expect((await db.doc('users/ma_stu').get()).data()!.email).toBe('new.me@new.test');
    expect((await db.doc('enrollments/c1_ma_stu').get()).data()!.studentEmail).toBe('new.me@new.test');
    expect(await audits()).toEqual([expect.objectContaining({ action: 'account_email_change', actorId: 'ma_stu', targetId: 'ma_stu', selfService: true })]);
    expect(JSON.stringify(await audits())).not.toContain('new.me');
    // Idempotent.
    expect((await call(emailSyncPOST, 'ma_stu', {})).json.changed).toBe(false);
  });

  it('the address is taken from Auth, never from the request; unauthenticated calls are refused', async () => {
    expect((await call(emailSyncPOST, 'ma_inst', { email: 'hijack@new.test' })).json.changed).toBe(false);
    expect((await db.doc('users/ma_inst').get()).data()!.email).toBe('ma_inst@admin.test');
    expect((await call(emailSyncPOST, null, {})).status).toBe(401);
  });
});

describe('G46 — server-created notifications', () => {
  it('approving an account and granting membership notify the person, in the same transaction', async () => {
    await db.doc('users/ma_stu_b2').update({ status: 'pending_verification' });
    expect((await call(statusPOST, 'ma_uni', { userId: 'ma_stu_b2', action: 'approve' })).status).toBe(200);
    expect((await call(membershipPOST, 'ma_super', { action: 'assign', userId: 'ma_designer', membership: { responsibilities: ['reviewer'], assignedCourseIds: ['c1'] } })).status).toBe(200);
    const notes = (await db.collection('notifications').get()).docs.map((d) => d.data());
    expect(notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'ma_stu_b2', type: 'account_activated', orgId: 'org_a', read: false }),
      expect.objectContaining({ userId: 'ma_designer', type: 'membership_granted', orgId: 'org_a', read: false }),
    ]));
    // A refused action notifies nobody.
    await call(statusPOST, 'ma_inst', { userId: 'ma_stu', action: 'suspend' });
    expect((await db.collection('notifications').get()).size).toBe(2);
  });
});


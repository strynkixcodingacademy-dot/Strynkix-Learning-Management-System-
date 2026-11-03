/**
 * Stage 8 — Super Admin Command Centre and announcements through the real
 * routes on the Auth + Firestore emulators: Super-Admin-only access, totals
 * that reconcile with the ledger, scoped drill-downs, anomaly indicators,
 * academic monitoring, global people search and targeted announcements.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST as command } from '@/app/api/command/route';
import { POST as announcements } from '@/app/api/announcements/route';
import { POST as admissions } from '@/app/api/admissions/route';
import { POST as finance } from '@/app/api/finance/route';
import { POST as reports } from '@/app/api/reports/route';
import { getAdminServices } from '@/lib/server/firebase-admin';
import { localDate } from '@/lib/server/academy-scope';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-01-01T00:00:00.000Z';
const TODAY = localDate();
const STAFF = ['cc_sa', 'cc_ua', 'cc_ba1', 'cc_ba2', 'cc_inst', 'cc_stu', 'cc_stuB', 'cc_uaB'];
const PRICING = { standardFee: 10_000_00, registrationFee: 0, otherFees: [], installmentOptions: [1, 2], discountLimits: { branch_admin: 1000, university_admin: 5000 }, available: true };

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();
let seq = 0;
const rid = () => `cc_${Date.now().toString(36)}_${seq++}`;

async function idToken(uid: string) {
  if (tokens.has(uid)) return tokens.get(uid)!;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const t = (await res.json()).idToken;
  tokens.set(uid, t);
  return t;
}
type Handler = (r: Request) => Promise<Response>;
async function call(h: Handler, uid: string, body: unknown) {
  const res = await h(new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(uid)}` }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const C = (uid: string, b: unknown) => call(command, uid, b);
const get = async (p: string) => (await db.doc(p).get()).data();

async function admit(email: string, branchId: string, batchId: string, pay: number, discountValue = 0) {
  const uid = branchId === 'b1' ? 'cc_ba1' : branchId === 'b2' ? 'cc_ba2' : 'cc_uaB';
  const d = await call(admissions, uid, {
    action: 'save_draft', branchId, personal: { firstName: email.split('@')[0], lastName: 'Test', email, mobile: `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}` },
    courseId: branchId === 'bx' ? 'cB' : 'c1', batchId,
    fee: { discountType: discountValue ? 'percent' : 'none', discountValue, ...(discountValue ? { discountReason: 'Scholarship' } : {}), plan: 'one_time', installments: [], ...(pay ? { initialPayment: { amount: pay, method: 'cash' } } : {}) },
  });
  const c = await call(admissions, uid, { action: 'confirm', admissionId: d.json.admissionId, password: 'Welcome-123' });
  expect(c.status).toBe(200);
  return c.json as { studentId: string; feeAccountId: string };
}

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
  for (const uid of STAFF) await auth.createUser({ uid, email: `${uid}@cc.test` });
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const u = (uid: string, role: string, extra: Record<string, unknown> = {}) => put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@cc.test`, displayName: uid, createdAt: NOW, updatedAt: NOW, ...extra });
  await put('organizations/org_a', { name: 'Alpha Academy', slug: 'alp', status: 'active', createdAt: '2025-01-01T00:00:00.000Z' });
  await put('organizations/org_b', { name: 'Beta Academy', slug: 'bet', status: 'active', createdAt: '2025-06-01T00:00:00.000Z' });
  await put('branches/b1', { orgId: 'org_a', name: 'Pune', code: 'PUN', status: 'active', branchAdminUserIds: ['cc_ba1'] });
  await put('branches/b2', { orgId: 'org_a', name: 'Mumbai', code: 'MUM', status: 'active', branchAdminUserIds: ['cc_ba2'] });
  await put('branches/bx', { orgId: 'org_b', name: 'Delhi', code: 'DEL', status: 'active', branchAdminUserIds: [] });
  await u('cc_sa', 'super_admin');
  await u('cc_ua', 'university_admin');
  await u('cc_uaB', 'university_admin', { orgId: 'org_b' });
  await u('cc_ba1', 'branch_admin', { branchId: 'b1' });
  await u('cc_ba2', 'branch_admin', { branchId: 'b2' });
  await u('cc_inst', 'instructor', { branchId: 'b1' });
  await u('cc_stu', 'student', { branchId: 'b1' });
  await u('cc_stuB', 'student', { orgId: 'org_b', branchId: 'bx' });
  await put('courses/c1', { orgId: 'org_a', title: 'Web Dev', status: 'published', createdById: 'cc_sa', createdAt: NOW, updatedAt: NOW });
  await put('courses/cB', { orgId: 'org_b', title: 'Data Science', status: 'published', createdById: 'cc_sa', createdAt: NOW, updatedAt: NOW });
  await put('lessons/l1', { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'L1', status: 'published', blocks: [] });
  await put('batches/bt1', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', name: 'Pune A', code: 'PA', instructorUserIds: ['cc_inst'], instructorNames: ['cc_inst'], startDate: '2025-01-01', status: 'in_progress' });
  await put('batches/bt2', { orgId: 'org_a', branchId: 'b2', courseId: 'c1', name: 'Mumbai A', code: 'MA', instructorUserIds: [], startDate: '2025-01-01', status: 'in_progress' });
  await put('batches/btx', { orgId: 'org_b', branchId: 'bx', courseId: 'cB', name: 'Delhi A', code: 'DA', instructorUserIds: [], startDate: '2025-01-01', status: 'in_progress' });
  await put('enrollments/c1_cc_stu', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', batchId: 'bt1', studentId: 'cc_stu', studentDisplayName: 'cc_stu', status: 'active', enrolledAt: NOW });
  await put('enrollments/cB_cc_stuB', { orgId: 'org_b', branchId: 'bx', courseId: 'cB', batchId: 'btx', studentId: 'cc_stuB', status: 'active', enrolledAt: NOW });
  for (const c of ['c1', 'cB']) await put(`coursePricing/${c}`, { courseId: c, orgId: c === 'c1' ? 'org_a' : 'org_b', currency: 'INR', ...PRICING, version: 1, approvedById: 'cc_sa', updatedAt: NOW });
});

describe('Super Admin only', () => {
  it('every other role is refused, whatever academy they name', async () => {
    for (const uid of ['cc_ua', 'cc_ba1', 'cc_inst', 'cc_stu']) {
      expect((await C(uid, { action: 'overview' })).status).toBe(403);
      expect((await C(uid, { action: 'academy', orgId: 'org_a', tab: 'finance' })).status).toBe(403);
      expect((await C(uid, { action: 'people', q: 'cc_stu' })).status).toBe(403);
      expect((await C(uid, { action: 'create_announcement', title: 'Hi all', message: 'Hello there', audience: { scope: 'all' } })).status).toBe(403);
    }
  });
});

describe('global dashboard and drill-downs', () => {
  it('counts and money reconcile with the ledger and the finance summary', async () => {
    const a = await admit('asha@x.test', 'b1', 'bt1', 4_000_00);
    await admit('ravi@x.test', 'b2', 'bt2', 1_000_00);
    await admit('dev@x.test', 'bx', 'btx', 2_500_00);
    await call(finance, 'cc_ba1', { action: 'record_refund', feeAccountId: a.feeAccountId, requestId: rid(), amount: 500_00, method: 'cash', date: TODAY, reason: 'Overcharged' });
    const o = await C('cc_sa', { action: 'overview', from: TODAY, to: TODAY });
    expect(o.status).toBe(200);
    expect(o.json.stats).toMatchObject({ branches: 3, activeBranches: 3, admissions: 3, expected: 30_000_00, collected: 7_000_00, outstanding: 23_000_00, universityAdmins: 2 });
    expect(o.json.stats.students).toBeGreaterThanOrEqual(5);
    expect(o.json.admissions).toMatchObject({ today: 3, inPeriod: 3 });
    expect(o.json.finance).toMatchObject({ expected: 30_000_00, collectedToDate: 7_000_00, collectedInPeriod: 7_000_00, refunds: 500_00, outstanding: 23_000_00 });
    // The same numbers as the scoped finance report for one academy.
    const ua = await call(reports, 'cc_ua', { action: 'finance_summary', from: TODAY, to: TODAY });
    const alpha = await C('cc_sa', { action: 'overview', orgId: 'org_a', from: TODAY, to: TODAY });
    expect(alpha.json.finance.collectedInPeriod).toBe(ua.json.totals.collected);
    expect(alpha.json.stats.expected).toBe(ua.json.totals.expected);
    expect(o.json.recent.map((r: { action: string }) => r.action)).toContain('admission_confirm');
  });

  it('academy and branch 360° tabs are scoped to that academy or branch', async () => {
    await admit('one@x.test', 'b1', 'bt1', 1_000_00);
    await admit('two@x.test', 'b2', 'bt2', 2_000_00);
    const list = await C('cc_sa', { action: 'academies', sort: 'name' });
    expect(list.json.academies.map((x: { name: string }) => x.name)).toEqual(['Alpha Academy', 'Beta Academy']);
    expect((await C('cc_sa', { action: 'academies', q: 'beta' })).json.total).toBe(1);
    const branches = await C('cc_sa', { action: 'academy', orgId: 'org_a', tab: 'branches' });
    expect(branches.json.branches.map((b: { name: string; stats: { collected: number } }) => [b.name, b.stats.collected])).toEqual([['Mumbai', 2_000_00], ['Pune', 1_000_00]]);
    const fin = await C('cc_sa', { action: 'branch', branchId: 'b1', tab: 'finance' });
    expect(fin.json.transactions.every((t: { studentName: string }) => t.studentName.startsWith('one'))).toBe(true);
    const students = await C('cc_sa', { action: 'branch', branchId: 'b1', tab: 'students' });
    expect(students.json.people.map((p: { displayName: string }) => p.displayName).sort()).toEqual(['cc_stu', 'one Test']);
    expect(students.json.people.find((p: { displayName: string }) => p.displayName === 'one Test').fees[0]).toMatchObject({ balance: 9_000_00 });
    for (const tab of ['overview', 'people', 'courses', 'academics', 'finance', 'audit']) expect((await C('cc_sa', { action: 'academy', orgId: 'org_a', tab })).status).toBe(200);
    for (const tab of ['overview', 'staff', 'courses', 'academics', 'audit']) expect((await C('cc_sa', { action: 'branch', branchId: 'b1', tab })).status).toBe(200);
    expect((await C('cc_sa', { action: 'academy', orgId: 'nope', tab: 'overview' })).status).toBe(404);
  });
});

describe('finance and academic intelligence', () => {
  it('flags accounts for review without changing them', async () => {
    const a = await admit('big@x.test', 'b1', 'bt1', 0, 4000);
    await db.doc(`feeAccounts/${a.feeAccountId}`).update({ 'totals.paid': 123 }); // stored totals no longer match the ledger
    const r = await C('cc_sa', { action: 'finance_intel', orgId: 'org_a' });
    expect(r.json.anomalies.highDiscounts.map((x: { feeAccountId: string }) => x.feeAccountId)).toContain(a.feeAccountId);
    expect(r.json.anomalies.inconsistentAccounts.map((x: { feeAccountId: string }) => x.feeAccountId)).toEqual([a.feeAccountId]);
    expect((await get(`feeAccounts/${a.feeAccountId}`))!.totals.paid).toBe(123);
  });

  it('lists students who need attention with neutral reasons, and instructor activity', async () => {
    await db.doc('attendance/bt1_2026-01-05').set({ orgId: 'org_a', branchId: 'b1', courseId: 'c1', batchId: 'bt1', date: localDate(new Date(Date.now() - 5 * 86400_000)), records: { cc_stu: 'present' }, takenById: 'cc_inst' });
    const r = await C('cc_sa', { action: 'academic_intel', orgId: 'org_a', courseId: 'c1' });
    const row = r.json.attention.find((x: { studentId: string }) => x.studentId === 'cc_stu');
    expect(row.reasons).toContain('No lesson activity in 14 days');
    expect(row.reasons.join(' ')).not.toMatch(/fail/i);
    expect(r.json.instructors.find((i: { id: string }) => i.id === 'cc_inst')).toMatchObject({ students: 1, attendanceSessions30d: 1 });
    expect(r.json.coursePerformance[0]).toMatchObject({ courseId: 'c1', lessons: 1 });
  });
});

describe('global people directory', () => {
  it('searches by name, email, user id and mobile across academies, filters and pages', async () => {
    await db.doc('personProfiles/cc_stuB').set({ orgId: 'org_b', role: 'student', personal: { firstName: 'B', lastName: 'S', email: 'cc_stuB@cc.test', mobile: '9811122233' } });
    expect((await C('cc_sa', { action: 'people', q: '9811122233' })).json.people.map((p: { id: string }) => p.id)).toEqual(['cc_stuB']);
    await db.doc('users/cc_stuB').update({ email: 'cc_stub@cc.test' }); // emails are stored lower-case
    expect((await C('cc_sa', { action: 'people', q: 'CC_STUB@cc.test' })).json.people[0]).toMatchObject({ id: 'cc_stuB', academy: 'Beta Academy' });
    expect((await C('cc_sa', { action: 'people', q: 'cc_inst' })).json.people.map((p: { id: string }) => p.id)).toEqual(['cc_inst']);
    expect((await C('cc_sa', { action: 'people', q: 'cc_stu', orgId: 'org_b' })).json.people.map((p: { id: string }) => p.id)).toEqual(['cc_stuB']);
    expect((await C('cc_sa', { action: 'people', role: 'student', orgId: 'org_a' })).json.people.map((p: { id: string }) => p.id)).toEqual(['cc_stu']);
    expect((await C('cc_sa', { action: 'people', batchId: 'bt1' })).json.people.map((p: { id: string }) => p.id).sort()).toEqual(['cc_inst', 'cc_stu']);
    for (let i = 0; i < 30; i++) await db.doc(`users/zz_${String(i).padStart(2, '0')}`).set({ role: 'student', orgId: 'org_b', branchId: 'bx', status: 'active', email: `z${i}@x.test`, displayName: `Z ${i}` });
    const p1 = await C('cc_sa', { action: 'people', orgId: 'org_b', role: 'student' });
    expect(p1.json.people).toHaveLength(25);
    const p2 = await C('cc_sa', { action: 'people', orgId: 'org_b', role: 'student', cursor: p1.json.cursor });
    expect(p2.json.people).toHaveLength(6);
    expect(p2.json.cursor).toBeNull();
  });
});

describe('announcements', () => {
  it('reach exactly their audience, respect publish/expiry, and can be withdrawn (audited)', async () => {
    const mk = (extra: Record<string, unknown>) => C('cc_sa', { action: 'create_announcement', title: 'Notice', message: 'Hello everyone', ...extra });
    const academyStudents = await mk({ audience: { scope: 'academy', orgId: 'org_a', roles: ['student'] } });
    await mk({ title: 'Batch notice', audience: { scope: 'branch', branchId: 'b1', roles: ['student'], batchId: 'bt1' } });
    await mk({ title: 'Later', audience: { scope: 'all' }, publishAt: new Date(Date.now() + 3600_000).toISOString() });
    await mk({ title: 'Old', audience: { scope: 'all' }, publishAt: new Date(Date.now() - 7200_000).toISOString(), expiresAt: new Date(Date.now() - 3600_000).toISOString() });
    await mk({ title: 'Everyone', audience: { scope: 'all' } });
    const mine = async (uid: string) => (await call(announcements, uid, { action: 'mine' })).json.announcements.map((a: { title: string }) => a.title).sort();
    expect(await mine('cc_stu')).toEqual(['Batch notice', 'Everyone', 'Notice']);
    expect(await mine('cc_stuB')).toEqual(['Everyone']);
    expect(await mine('cc_inst')).toEqual(['Everyone']);
    expect((await mk({ audience: { scope: 'branch', branchId: 'b1', orgId: 'org_b' } })).status).toBe(404);
    expect((await mk({ audience: { scope: 'academy', orgId: 'org_a', roles: ['instructor'], courseId: 'c1' } })).status).toBe(400);
    expect((await C('cc_sa', { action: 'withdraw_announcement', announcementId: academyStudents.json.announcementId, reason: 'Sent by mistake' })).status).toBe(200);
    expect(await mine('cc_stu')).toEqual(['Batch notice', 'Everyone']);
    expect((await db.collection('auditLog').where('action', '==', 'announcement_withdraw').get()).size).toBe(1);
  });
});

describe('exports and profiles keep the same boundaries', () => {
  it('people, discount, refund and organization exports respect scope', async () => {
    await admit('exp@x.test', 'b1', 'bt1', 1_000_00, 1000);
    const R = (uid: string, b: Record<string, unknown>) => call(reports, uid, { action: 'export', ...b });
    const ba = await R('cc_ba1', { dataset: 'people' });
    expect(ba.json.rows.every((r: { branch: string }) => r.branch === 'Pune')).toBe(true);
    expect(Object.keys(ba.json.rows[0])).not.toContain('mobile');
    expect((await R('cc_ba1', { dataset: 'people', branchId: 'b2' })).status).toBe(404);
    expect((await R('cc_ua', { dataset: 'academies' })).status).toBe(403);
    expect((await R('cc_uaB', { dataset: 'people', orgId: 'org_a' })).status).toBe(404);
    const all = await R('cc_sa', { dataset: 'academies', orgId: '*' });
    expect(all.json.rows.map((r: { name: string }) => r.name).sort()).toEqual(['Alpha Academy', 'Beta Academy']);
    expect((await R('cc_ba1', { dataset: 'discounts' })).json.rows[0]).toMatchObject({ discount: 1_000_00, status: 'approved' });
    expect((await R('cc_ba2', { dataset: 'discounts' })).json.rows).toEqual([]);
    expect((await R('cc_inst', { dataset: 'refunds' })).status).toBe(403);
  });

  it('the global profile adds certificates and access history; other academies stay hidden', async () => {
    await db.doc('certificates/c1_cc_stu').set({ orgId: 'org_a', branchId: 'b1', courseId: 'c1', studentId: 'cc_stu', courseTitle: 'Web Dev', certificateNumber: 'X-1', status: 'issued', completedOn: '2026-05-01' });
    await db.collection('auditLog').add({ orgId: 'org_a', targetType: 'user', targetId: 'cc_stu', action: 'account_status', actorId: 'cc_ua', actorRole: 'university_admin', reason: 'Test', at: new Date() });
    const p = await call(admissions, 'cc_sa', { action: 'person', userId: 'cc_stu' });
    expect(p.json).toMatchObject({ academyName: 'Alpha Academy', branchName: 'Pune', certificates: [{ certificateNumber: 'X-1' }] });
    expect(p.json.history[0]).toMatchObject({ action: 'account_status', by: 'cc_ua' });
    expect((await call(admissions, 'cc_uaB', { action: 'person', userId: 'cc_stu' })).status).toBe(404);
    expect((await call(admissions, 'cc_ba2', { action: 'person', userId: 'cc_stu' })).status).toBe(404);
  });
});


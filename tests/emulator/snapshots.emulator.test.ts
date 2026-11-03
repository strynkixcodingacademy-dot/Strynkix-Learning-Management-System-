/**
 * Stage 9 — reporting snapshots, jobs, reconciliation and recalculation on the
 * Auth + Firestore emulators: totals per level and scope, idempotent and
 * concurrent runs, retry after failure, reconciliation success and mismatch,
 * historical corrections, snapshot-backed history with live fallback, period
 * boundaries and access control. The ledger is never modified by these jobs.
 */

import { describe, it, beforeAll, beforeEach, afterEach, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST as reporting } from '@/app/api/reporting/route';
import { GET as cron } from '@/app/api/jobs/snapshots/route';
import { POST as finance } from '@/app/api/finance/route';
import { POST as reports } from '@/app/api/reports/route';
import { getAdminServices } from '@/lib/server/firebase-admin';
import { localDate } from '@/lib/server/academy-scope';
import { applyInvalidations, reconcileSnapshot, runJob } from '@/lib/server/snapshots';
import { periodBounds, previousPeriod } from '@/lib/reporting/periods';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const TODAY = localDate();
const M = previousPeriod('monthly', TODAY); // last completed month
const D = previousPeriod('daily', TODAY); // yesterday
const day = (n: number) => `${M}-${String(n).padStart(2, '0')}`;
const USERS = ['sn_sa', 'sn_ua', 'sn_ba1', 'sn_inst', 'sn_stu'];

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();

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
const get = async (p: string) => (await db.doc(p).get()).data();
const gen = (type: 'daily' | 'monthly' | 'yearly', key: string) => runJob(db, { kind: 'generate', periodType: type, periodKey: key }, { trigger: 'manual', actorId: 'test' });

const account = (id: string, orgId: string, branchId: string, agreed: number, paid: number, refunded = 0) => ({
  orgId, branchId, courseId: 'c1', batchId: 'bt', studentId: `s_${id}`, studentName: `Student ${id}`, admissionId: `ad_${id}`, admissionNumber: `N-${id}`, courseTitle: 'Course', currency: 'INR', pricingVersion: 1,
  grossFee: agreed, discount: { type: 'none', value: 0, amount: 0, status: 'none' }, agreedFee: agreed, plan: 'one_time', installments: [{ number: 1, dueDate: day(28), amount: agreed }],
  totals: { paid, refunded, adjustments: 0 }, status: 'active', createdById: 'x', createdAt: `${day(5)}T06:00:00.000Z`, updatedAt: `${day(5)}T06:00:00.000Z`,
});
const entry = (fa: string, orgId: string, branchId: string, type: string, amount: number, date: string, extra: Record<string, unknown> = {}) => ({ orgId, branchId, courseId: 'c1', feeAccountId: fa, studentId: `s_${fa}`, studentName: `Student ${fa}`, type, amount, date, createdById: 'x', createdByName: 'X', createdAt: `${date}T07:00:00.000Z`, ...extra });

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  for (const uid of USERS) { await auth.deleteUser(uid).catch(() => undefined); await auth.createUser({ uid, email: `${uid}@sn.test` }); }
});

beforeEach(async () => {
  tokens.clear();
  await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const u = (uid: string, role: string, extra: Record<string, unknown> = {}) => put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@sn.test`, displayName: uid, createdAt: 'x', updatedAt: 'x', ...extra });
  await put('organizations/org_a', { name: 'Alpha', slug: 'alp', status: 'active' });
  await put('organizations/org_b', { name: 'Beta', slug: 'bet', status: 'active' });
  await put('branches/b1', { orgId: 'org_a', name: 'Pune', code: 'PUN', status: 'active' });
  await put('branches/b2', { orgId: 'org_a', name: 'Mumbai', code: 'MUM', status: 'active' });
  await put('branches/bx', { orgId: 'org_b', name: 'Delhi', code: 'DEL', status: 'active' });
  await u('sn_sa', 'super_admin'); await u('sn_ua', 'university_admin'); await u('sn_ba1', 'branch_admin', { branchId: 'b1' }); await u('sn_inst', 'instructor', { branchId: 'b1' }); await u('sn_stu', 'student', { branchId: 'b1' });
  await put('feeAccounts/a1', account('a1', 'org_a', 'b1', 10_000_00, 4_000_00, 500_00));
  await put('feeAccounts/a2', account('a2', 'org_a', 'b2', 5_000_00, 0));
  await put('feeAccounts/aX', account('aX', 'org_b', 'bx', 3_000_00, 2_000_00));
  await put('feeTransactions/p1', entry('a1', 'org_a', 'b1', 'payment', 4_000_00, day(10)));
  await put('feeTransactions/rf', entry('a1', 'org_a', 'b1', 'refund', 500_00, day(12)));
  await put('feeTransactions/p2', entry('a2', 'org_a', 'b2', 'payment', 1_000_00, day(11)));
  await put('feeTransactions/rv', entry('a2', 'org_a', 'b2', 'reversal', 1_000_00, day(13), { reversesId: 'p2' }));
  await put('feeTransactions/pX', entry('aX', 'org_b', 'bx', 'payment', 2_000_00, day(15)));
  await put('expenses/e1', { orgId: 'org_a', branchId: 'b1', title: 'Rent', categoryId: 'builtin_rent', categoryName: 'Rent', amount: 700_00, date: day(20), method: 'cash', status: 'paid', createdById: 'x', createdByName: 'X', createdAt: `${day(20)}T08:00:00.000Z` });
  await put('expenses/eX', { orgId: 'org_b', branchId: 'bx', title: 'Wi-Fi', categoryId: 'builtin_internet', categoryName: 'Internet', amount: 300_00, date: day(21), method: 'cash', status: 'paid', createdById: 'x', createdByName: 'X', createdAt: `${day(21)}T08:00:00.000Z` });
});

afterEach(() => { delete process.env.CRON_SECRET; });

describe('generation and isolation', () => {
  it('computes each level and scope from the ledger (refunds and reversals included)', async () => {
    const r = await gen('monthly', M);
    expect(r).toMatchObject({ status: 'succeeded', results: { created: 6, reconciled: 6, failed: 0 } }); // org + 2 academies + 3 branches
    expect((await get(`reportSnapshots/org_all_monthly_${M}`))!.finance).toMatchObject({ collected: 5_500_00, payments: 7_000_00, paymentReversals: 1_000_00, refunds: 500_00, expenses: 1_000_00, net: 4_500_00, expectedAtEnd: 18_000_00, outstandingAtEnd: 12_500_00 });
    expect((await get(`reportSnapshots/academy_org_a_monthly_${M}`))!.finance).toMatchObject({ collected: 3_500_00, expenses: 700_00, expectedAtEnd: 15_000_00, outstandingAtEnd: 11_500_00 });
    expect((await get(`reportSnapshots/branch_b1_monthly_${M}`))!.finance).toMatchObject({ collected: 3_500_00, refunds: 500_00, expectedAtEnd: 10_000_00 });
    expect((await get(`reportSnapshots/branch_b2_monthly_${M}`))!.finance).toMatchObject({ collected: 0, payments: 1_000_00, paymentReversals: 1_000_00 });
    const snap = (await get(`reportSnapshots/branch_bx_monthly_${M}`))!;
    expect(snap).toMatchObject({ orgId: 'org_b', branchId: 'bx', status: 'reconciled', version: 1, schemaVersion: 1, timezone: 'Asia/Kolkata', from: `${M}-01`, watermark: { ledgerEntries: 1, expenses: 1 } });
    expect(snap.jobId).toBe(r.jobId);
    expect(JSON.stringify(snap)).not.toMatch(/Student/); // no personal data copied
  });

  it('refuses the current, incomplete period', async () => {
    const r = await gen('monthly', TODAY.slice(0, 7));
    expect(r.status).toBe('failed');
    expect(r.errors[0].message).toMatch(/completed periods/);
  });

  it('daily boundaries follow local midnight for timestamped records', async () => {
    const b = periodBounds('daily', D);
    const before = new Date(Date.parse(b.startUtc) - 1).toISOString();
    for (const [id, at] of [['in1', b.startUtc], ['in2', new Date(Date.parse(b.endUtc) - 1).toISOString()], ['out1', before], ['out2', b.endUtc]]) {
      await db.doc(`admissions/${id}`).set({ orgId: 'org_a', branchId: 'b1', status: 'confirmed', confirmedAt: at });
    }
    await gen('daily', D);
    expect((await get(`reportSnapshots/branch_b1_daily_${D}`))!.academic.admissions).toBe(2);
  });
});

describe('idempotency, concurrency and retry', () => {
  it('re-running verifies the same snapshot without a new version or double counting', async () => {
    await gen('monthly', M);
    const again = await gen('monthly', M);
    expect(again.results).toMatchObject({ unchanged: 6, created: 0, updated: 0 });
    const s = (await get(`reportSnapshots/org_all_monthly_${M}`))!;
    expect(s).toMatchObject({ version: 1, finance: { collected: 5_500_00 } });
    expect((await db.collection(`reportSnapshots/org_all_monthly_${M}/versions`).get()).size).toBe(0);
  });

  it('concurrent runs never double count: each snapshot is created once, and the other run skips or verifies', async () => {
    const [x, y] = await Promise.all([gen('monthly', M), gen('monthly', M)]);
    expect(x.results.created + y.results.created).toBe(6);
    expect([x.status, y.status].every((st) => st === 'succeeded' || st === 'skipped')).toBe(true);
    expect((await get(`reportSnapshots/org_all_monthly_${M}`))!).toMatchObject({ version: 1, finance: { collected: 5_500_00 } });
    expect((await db.collection('snapshotLocks').get()).size).toBe(0); // released
  });

  it('a run that arrives while another holds the period lock is skipped and changes nothing', async () => {
    await db.doc(`snapshotLocks/monthly_${M}`).set({ jobId: 'other', acquiredAt: new Date().toISOString(), expiresAt: Date.now() + 60_000 });
    const r = await gen('monthly', M);
    expect(r.status).toBe('skipped');
    expect(await get(`reportSnapshots/org_all_monthly_${M}`)).toBeUndefined();
    // An expired lease is taken over.
    await db.doc(`snapshotLocks/monthly_${M}`).set({ jobId: 'other', acquiredAt: 'x', expiresAt: Date.now() - 1 });
    expect((await gen('monthly', M)).status).toBe('succeeded');
  });

  it('a failed job can be retried; the retry produces the same totals once', async () => {
    await db.doc('feeAccounts/broken').set({ orgId: 'org_a', branchId: 'b1', status: 'active', agreedFee: 1, discount: { status: 'none', amount: 0 } }); // missing createdAt
    const failed = await gen('monthly', M);
    expect(failed.status).toBe('failed');
    await db.doc('feeAccounts/broken').delete();
    const retry = await call(reporting, 'sn_sa', { action: 'retry', jobId: failed.jobId });
    expect(retry.json).toMatchObject({ status: 'succeeded' });
    expect((await get(`snapshotJobs/${retry.json.jobId}`))!).toMatchObject({ retryOf: failed.jobId, trigger: 'retry' });
    expect((await get(`reportSnapshots/org_all_monthly_${M}`))!.finance.collected).toBe(5_500_00);
    expect((await call(reporting, 'sn_sa', { action: 'retry', jobId: retry.json.jobId })).status).toBe(409);
  });
});

describe('reconciliation', () => {
  it('flags a snapshot that disagrees with the ledger, with differences and a review — the ledger is untouched', async () => {
    await gen('monthly', M);
    const id = `branch_b1_monthly_${M}`;
    await db.doc(`reportSnapshots/${id}`).update({ 'finance.collected': 1 });
    expect(await reconcileSnapshot(db, id, 'test')).toBe('mismatched');
    const s = (await get(`reportSnapshots/${id}`))!;
    expect(s.reconciliation.differences).toEqual([{ metric: 'collected', snapshot: 1, source: 3_500_00, difference: 3_500_00 - 1 }]);
    expect((await get(`reconciliationReviews/${id}_v1`))!).toMatchObject({ status: 'open', snapshotId: id });
    expect((await get('feeTransactions/p1'))!.amount).toBe(4_000_00);
  });

  it('flags fee accounts whose stored totals no longer match their ledger', async () => {
    await db.doc('feeAccounts/a1').update({ 'totals.paid': 1 });
    await gen('monthly', M);
    const s = (await get(`reportSnapshots/branch_b1_monthly_${M}`))!;
    expect(s).toMatchObject({ status: 'mismatched', reconciliation: { inconsistentAccounts: 1, inconsistentAccountIds: ['a1'] } });
    expect((await get(`reportSnapshots/branch_b2_monthly_${M}`))!.status).toBe('reconciled');
  });
});

describe('historical corrections and recalculation', () => {
  it('a backdated payment marks closed periods stale; recalculation versions the snapshot and history falls back to live meanwhile', async () => {
    await gen('monthly', M);
    const pay = await call(finance, 'sn_ba1', { action: 'record_payment', feeAccountId: 'a1', requestId: 'backdated-0001', amount: 1_000_00, method: 'cash', date: day(25) });
    expect(pay.status).toBe(200);
    expect((await db.collection('snapshotInvalidations').where('status', '==', 'pending').get()).docs[0].data()).toMatchObject({ orgId: 'org_a', branchId: 'b1', fromDate: day(25), toDate: null, reason: 'Backdated payment recorded' });
    // Until it is applied, history doesn't trust the affected snapshot.
    let hist = await call(reports, 'sn_ua', { action: 'monthly_history', from: `${M}-01`, to: TODAY });
    expect(hist.json.rows[0]).toMatchObject({ month: M, source: 'live', collected: 4_500_00 });
    expect((await applyInvalidations(db)).markedStale).toBeGreaterThanOrEqual(3);
    expect((await get(`reportSnapshots/branch_b1_monthly_${M}`))!).toMatchObject({ status: 'stale', staleReasons: ['Backdated payment recorded'] });
    expect((await get(`reportSnapshots/branch_b2_monthly_${M}`))!.status).toBe('reconciled'); // other branch unaffected
    const rc = await call(reporting, 'sn_sa', { action: 'recalculate', snapshotId: `academy_org_a_monthly_${M}`, reason: 'Backdated payment' });
    expect(rc.json).toMatchObject({ status: 'succeeded', results: { updated: 1, reconciled: 1 } });
    const s = (await get(`reportSnapshots/academy_org_a_monthly_${M}`))!;
    expect(s).toMatchObject({ version: 2, status: 'reconciled', finance: { collected: 4_500_00 } });
    expect(s.recalcReason).toMatch(/Backdated payment/);
    expect((await get(`reportSnapshots/academy_org_a_monthly_${M}/versions/1`))!.finance.collected).toBe(3_500_00);
    hist = await call(reports, 'sn_ua', { action: 'monthly_history', from: `${M}-01`, to: TODAY });
    expect(hist.json.rows[0]).toMatchObject({ month: M, source: 'snapshot', collected: 4_500_00 });
    expect(hist.json.rows.at(-1)).toMatchObject({ month: TODAY.slice(0, 7), source: 'live' });
  });

  it('the scheduled job applies invalidations, recalculates stale snapshots and creates missing ones', async () => {
    await gen('monthly', M);
    await call(finance, 'sn_ba1', { action: 'record_refund', feeAccountId: 'a1', requestId: 'backdated-0002', amount: 100_00, method: 'cash', date: day(26), reason: 'Overcharged' });
    process.env.CRON_SECRET = 'test-secret-123';
    const res = await cron(new Request('http://localhost/api/jobs/snapshots', { headers: { Authorization: 'Bearer test-secret-123' } }));
    expect(res.status).toBe(200);
    expect((await get(`reportSnapshots/branch_b1_monthly_${M}`))!).toMatchObject({ status: 'reconciled', version: 2, finance: { refunds: 600_00 } });
    expect(await get(`reportSnapshots/org_all_daily_${D}`)).toBeTruthy();
  });
});

describe('access control', () => {
  it('only the Super Admin uses reporting controls; the cron route needs the secret', async () => {
    for (const uid of ['sn_ua', 'sn_ba1', 'sn_inst', 'sn_stu']) {
      expect((await call(reporting, uid, { action: 'status' })).status).toBe(403);
      expect((await call(reporting, uid, { action: 'run', periodType: 'monthly', periodKey: M })).status).toBe(403);
    }
    expect((await call(reporting, 'sn_sa', { action: 'status' })).status).toBe(200);
    expect((await cron(new Request('http://localhost/x'))).status).toBe(503);
    process.env.CRON_SECRET = 'test-secret-123';
    expect((await cron(new Request('http://localhost/x', { headers: { Authorization: 'Bearer wrong' } }))).status).toBe(401);
  });

  it('a Branch Manager’s history uses their branch only; snapshot rows match the live report', async () => {
    await gen('monthly', M);
    const h = await call(reports, 'sn_ba1', { action: 'monthly_history', from: `${M}-01`, to: `${M}-28` });
    expect(h.json.rows[0]).toMatchObject({ source: 'snapshot', snapshotId: `branch_b1_monthly_${M}`, collected: 3_500_00 });
    expect((await call(reports, 'sn_ba1', { action: 'monthly_history', branchId: 'b2', from: `${M}-01`, to: `${M}-28` })).status).toBe(404);
    const live = await call(reports, 'sn_ba1', { action: 'finance_summary', from: `${M}-01`, to: periodBounds('monthly', M).to });
    expect(live.json.totals).toMatchObject({ collected: h.json.rows[0].collected, refunds: h.json.rows[0].refunds, expenses: h.json.rows[0].expenses });
  });
});

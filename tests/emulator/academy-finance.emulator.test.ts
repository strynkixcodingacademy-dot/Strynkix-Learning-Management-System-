/**
 * Academy operations, Batches 3–5 — admissions and people, course pricing, fee
 * ledgers, receipts, discounts, refunds and adjustments, expenses, recurring
 * schedules and reports, through the real route handlers on the Auth +
 * Firestore emulators with real ID tokens.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST as admissions } from '@/app/api/admissions/route';
import { POST as finance } from '@/app/api/finance/route';
import { POST as expenses } from '@/app/api/expenses/route';
import { POST as reports } from '@/app/api/reports/route';
import { getAdminServices } from '@/lib/server/firebase-admin';
import { localDate } from '@/lib/server/academy-scope';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-01-01T00:00:00.000Z';
const STAFF = ['af_sa', 'af_ua', 'af_ba1', 'af_ba2', 'af_inst', 'af_stu'];
const TODAY = localDate();
const YEAR = TODAY.slice(0, 4);

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();
let seq = 0;
const rid = () => `req_${Date.now().toString(36)}_${seq++}`;

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
type Handler = (r: Request) => Promise<Response>;
async function call(handler: Handler, uid: string, body: unknown) {
  const res = await handler(new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(uid)}` }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const AD = (uid: string, b: unknown) => call(admissions, uid, b);
const F = (uid: string, b: unknown) => call(finance, uid, b);
const E = (uid: string, b: unknown) => call(expenses, uid, b);
const R = (uid: string, b: unknown) => call(reports, uid, b);
const get = async (p: string) => (await db.doc(p).get()).data();
const audits = async (action: string) => (await db.collection('auditLog').where('action', '==', action).get()).docs.map((d) => d.data());

const PRICING = { standardFee: 30_000_00, registrationFee: 1_000_00, otherFees: [{ label: 'Exam fee', amount: 1_000_00 }], installmentOptions: [1, 2, 3], discountLimits: { branch_admin: 1000, university_admin: 2500 }, available: true };
const GROSS = 32_000_00;
const personal = (email: string) => ({ firstName: 'Asha', lastName: 'Patil', email, mobile: '+91 98765 43210', city: 'Pune', pinCode: '411001' });
const plus = (days: number) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

async function admit(uid: string, email: string, fee: Record<string, unknown>, batchId = 'bt1', branchId = 'b1') {
  const draft = await AD(uid, { action: 'save_draft', branchId, personal: personal(email), academic: { highestQualification: 'B.Sc.' }, courseId: 'c1', batchId, fee });
  expect(draft.status).toBe(200);
  return { draftId: draft.json.admissionId as string, confirm: await AD(uid, { action: 'confirm', admissionId: draft.json.admissionId, password: 'Welcome-123' }) };
}
const threeParts = (total: number) => [{ number: 1, dueDate: TODAY, amount: total - 2 * Math.floor(total / 3) }, { number: 2, dueDate: plus(30), amount: Math.floor(total / 3) }, { number: 3, dueDate: plus(60), amount: Math.floor(total / 3) }];

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
  for (const uid of STAFF) await auth.createUser({ uid, email: `${uid}@af.test` });
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const u = (uid: string, role: string, extra: Record<string, unknown> = {}) => put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@af.test`, displayName: uid, createdAt: NOW, updatedAt: NOW, ...extra });
  await put('organizations/org_a', { name: 'Strynkix Academy', slug: 'stx', status: 'active' });
  await put('organizations/org_b', { name: 'Other Academy', slug: 'oth', status: 'active' });
  await put('branches/b1', { orgId: 'org_a', name: 'Pune', code: 'PUN', status: 'active', branchAdminUserIds: ['af_ba1'] });
  await put('branches/b2', { orgId: 'org_a', name: 'Mumbai', code: 'MUM', status: 'active', branchAdminUserIds: ['af_ba2'] });
  await u('af_sa', 'super_admin');
  await u('af_ua', 'university_admin');
  await u('af_ba1', 'branch_admin', { branchId: 'b1' });
  await u('af_ba2', 'branch_admin', { branchId: 'b2' });
  await u('af_inst', 'instructor', { branchId: 'b1' });
  await u('af_stu', 'student', { branchId: 'b1' });
  await put('courses/c1', { orgId: 'org_a', title: 'Full-Stack Web', status: 'published', createdById: 'af_sa', createdAt: NOW, updatedAt: NOW });
  await put('batches/bt1', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', name: 'Pune Alpha', code: 'PA', instructorUserIds: [], instructorNames: [], startDate: '2026-01-01', status: 'upcoming', maxStudents: 3, activeEnrollmentCount: 0 });
  await put('batches/bt2', { orgId: 'org_a', branchId: 'b2', courseId: 'c1', name: 'Mumbai Alpha', code: 'MA', instructorUserIds: [], startDate: '2026-01-01', status: 'upcoming' });
});

describe('course pricing', () => {
  it('only the Super Admin sets pricing; every change is versioned and audited', async () => {
    expect((await F('af_ua', { action: 'save_pricing', courseId: 'c1', pricing: PRICING })).status).toBe(403);
    expect((await F('af_ba1', { action: 'save_pricing', courseId: 'c1', pricing: PRICING })).status).toBe(403);
    expect((await F('af_sa', { action: 'save_pricing', courseId: 'c1', pricing: { ...PRICING, discountLimits: { branch_admin: 3000, university_admin: 1000 } } })).status).toBe(400);
    expect((await F('af_sa', { action: 'save_pricing', courseId: 'c1', pricing: PRICING })).json).toEqual({ version: 1, gross: GROSS });
    expect((await F('af_sa', { action: 'save_pricing', courseId: 'c1', pricing: { ...PRICING, standardFee: 35_000_00 } })).json.version).toBe(2);
    expect(await get('coursePricing/c1/history/1')).toMatchObject({ standardFee: 30_000_00, version: 1 });
    expect((await audits('pricing_update')).map((a) => a.toGross).sort()).toEqual([GROSS, 37_000_00]);
    const list = await F('af_ba1', { action: 'list_pricing' });
    expect(list.json).toMatchObject({ canEdit: false, courses: [{ id: 'c1', gross: 37_000_00 }] });
  });
});

describe('admission confirmation', () => {
  beforeEach(async () => { await F('af_sa', { action: 'save_pricing', courseId: 'c1', pricing: PRICING }); });

  it('creates the login, enrollment, fee account, first payment and receipt in one step, once', async () => {
    const discount = 3_200_00; // 10%: within the Branch Manager's limit
    const { draftId, confirm } = await admit('af_ba1', 'asha@stu.test', { discountType: 'percent', discountValue: 1000, discountReason: 'Early bird', plan: 'installments', installments: threeParts(GROSS - discount), initialPayment: { amount: 5_000_00, method: 'upi', reference: 'UPI-1' } });
    expect(confirm.status).toBe(200);
    expect(confirm.json.admissionNumber).toBe(`STX-PUN-${YEAR}-0001`);
    const { studentId, feeAccountId } = confirm.json;
    expect(await get(`users/${studentId}`)).toMatchObject({ role: 'student', branchId: 'b1', orgId: 'org_a', metadata: { studentIdNumber: `STX-PUN-${YEAR}-0001` } });
    expect(await get(`enrollments/c1_${studentId}`)).toMatchObject({ status: 'active', batchId: 'bt1', enrolledById: 'af_ba1' });
    expect((await get('batches/bt1'))!.activeEnrollmentCount).toBe(1);
    expect(await get(`feeAccounts/${feeAccountId}`)).toMatchObject({ grossFee: GROSS, agreedFee: GROSS - discount, discount: { status: 'approved', amount: discount }, totals: { paid: 5_000_00, refunded: 0, adjustments: 0 }, pricingVersion: 1 });
    expect(await get(`feeTransactions/pay_adm_${draftId}`)).toMatchObject({ type: 'payment', amount: 5_000_00, receiptNumber: `STX-PUN-R-${YEAR}-00001` });
    expect(await get(`personProfiles/${studentId}`)).toMatchObject({ personal: { mobile: '+91 98765 43210' }, admissionNumber: `STX-PUN-${YEAR}-0001` });
    expect((await AD('af_ba1', { action: 'confirm', admissionId: draftId, password: 'Welcome-123' })).json.error).toBe('duplicate');
    // The same student can't be admitted to the same course twice.
    expect((await admit('af_ba1', 'asha@stu.test', { discountType: 'none', discountValue: 0, plan: 'one_time', installments: [] })).confirm.json.error).toBe('duplicate');
    expect((await audits('admission_confirm'))).toHaveLength(1);
  });

  it('branch isolation, validation and rollback', async () => {
    const draft = await AD('af_ba1', { action: 'save_draft', branchId: 'b1', personal: personal('x@stu.test'), courseId: 'c1', batchId: 'bt1' });
    expect((await AD('af_ba2', { action: 'get', admissionId: draft.json.admissionId })).status).toBe(404);
    expect((await AD('af_ba2', { action: 'save_draft', branchId: 'b1', personal: {} })).status).toBe(404);
    expect((await AD('af_inst', { action: 'list' })).status).toBe(403);
    expect((await AD('af_ba1', { action: 'confirm', admissionId: draft.json.admissionId, password: 'Welcome-123' })).status).toBe(400); // no fee plan
    // Schedule that doesn't add up, and a batch at another branch.
    expect((await admit('af_ba1', 'y@stu.test', { discountType: 'none', discountValue: 0, plan: 'installments', installments: threeParts(GROSS - 1) })).confirm.status).toBe(400);
    expect((await admit('af_ua', 'z@stu.test', { discountType: 'none', discountValue: 0, plan: 'one_time', installments: [] }, 'bt2', 'b1')).confirm.status).toBe(400);
    expect((await auth.getUserByEmail('z@stu.test').catch(() => null))).toBeNull();
    // Full batch: the new login is removed again.
    await db.doc('batches/bt1').update({ activeEnrollmentCount: 3 });
    expect((await admit('af_ba1', 'full@stu.test', { discountType: 'none', discountValue: 0, plan: 'one_time', installments: [] })).confirm.status).toBe(409);
    expect((await auth.getUserByEmail('full@stu.test').catch(() => null))).toBeNull();
  });

  it('a discount above the Branch Manager’s limit waits for approval by someone with a higher limit', async () => {
    const { confirm } = await admit('af_ba1', 'disc@stu.test', { discountType: 'percent', discountValue: 2000, discountReason: 'Scholarship', plan: 'installments', installments: threeParts(GROSS), initialPayment: { amount: 1_000_00, method: 'cash' } });
    expect(confirm.json.discountPending).toBe(true);
    const id = confirm.json.feeAccountId;
    expect(await get(`feeAccounts/${id}`)).toMatchObject({ agreedFee: GROSS, discount: { status: 'pending', amount: 6_400_00 } });
    // Payments are capped at what is due if the discount is approved.
    expect((await F('af_ba1', { action: 'record_payment', feeAccountId: id, requestId: rid(), amount: GROSS - 6_400_00, method: 'cash', date: TODAY })).status).toBe(400);
    expect((await F('af_ba1', { action: 'decide_discount', feeAccountId: id, approve: true })).status).toBe(403);
    expect((await F('af_ua', { action: 'decide_discount', feeAccountId: id, approve: true })).json.agreedFee).toBe(GROSS - 6_400_00);
    const acct = (await get(`feeAccounts/${id}`))!;
    expect(acct.installments.reduce((s: number, i: { amount: number }) => s + i.amount, 0)).toBe(GROSS - 6_400_00);
    expect(await audits('discount_approved')).toHaveLength(1);
  });
});

describe('fee ledger', () => {
  let id = '';
  beforeEach(async () => {
    await F('af_sa', { action: 'save_pricing', courseId: 'c1', pricing: PRICING });
    id = (await admit('af_ba1', 'pay@stu.test', { discountType: 'none', discountValue: 0, plan: 'installments', installments: threeParts(GROSS) })).confirm.json.feeAccountId;
  });

  it('partial and duplicate payments, receipts, reversal, refund, waiver and reconciliation', async () => {
    const r1 = rid();
    const p1 = await F('af_ba1', { action: 'record_payment', feeAccountId: id, requestId: r1, amount: 10_000_00, method: 'upi', reference: 'UTR-77', date: TODAY });
    expect(p1.json).toMatchObject({ receiptNumber: `STX-PUN-R-${YEAR}-00001`, balance: GROSS - 10_000_00 });
    expect((await F('af_ba1', { action: 'record_payment', feeAccountId: id, requestId: r1, amount: 10_000_00, method: 'upi', reference: 'UTR-77', date: TODAY })).json.duplicate).toBe(true);
    expect((await F('af_ba1', { action: 'record_payment', feeAccountId: id, requestId: rid(), amount: 1_00, method: 'upi', reference: 'UTR-77', date: TODAY })).json.error).toBe('duplicate_reference');
    expect((await F('af_ba1', { action: 'record_payment', feeAccountId: id, requestId: rid(), amount: GROSS, method: 'cash', date: TODAY })).status).toBe(400);
    expect((await F('af_ba1', { action: 'record_payment', feeAccountId: id, requestId: rid(), amount: 1_00, method: 'cash', date: plus(3) })).status).toBe(400);
    const p2 = await F('af_ba1', { action: 'record_payment', feeAccountId: id, requestId: rid(), amount: 2_000_00, method: 'cash', date: TODAY });
    expect(p2.json.receiptNumber).toBe(`STX-PUN-R-${YEAR}-00002`);
    // Installment 1 (10,666.68) is partly paid by 12,000 → 1st paid, 2nd partly.
    const view = await F('af_ba1', { action: 'account', feeAccountId: id });
    expect(view.json.account.allocation.map((i: { state: string }) => i.state)).toEqual(['paid', 'partial', 'upcoming']);
    // Reverse the cash payment once.
    expect((await F('af_ba1', { action: 'reverse', transactionId: p2.json.transactionId, reason: 'Entered twice' })).json.balance).toBe(GROSS - 10_000_00);
    expect((await F('af_ba1', { action: 'reverse', transactionId: p2.json.transactionId, reason: 'Entered twice' })).json.error).toBe('duplicate');
    // Refunds can't exceed what was collected.
    expect((await F('af_ba1', { action: 'record_refund', feeAccountId: id, requestId: rid(), amount: 10_000_01, method: 'bank_transfer', date: TODAY, reason: 'Withdrawal' })).status).toBe(400);
    expect((await F('af_ba1', { action: 'record_refund', feeAccountId: id, requestId: rid(), amount: 4_000_00, method: 'bank_transfer', date: TODAY, reason: 'Withdrawal' })).json.balance).toBe(GROSS - 6_000_00);
    // A waiver needs an academy administrator and a matching schedule.
    const waive = { action: 'add_adjustment', feeAccountId: id, amount: -(GROSS - 6_000_00), reason: 'Withdrawn; balance waived', installments: [{ number: 1, dueDate: TODAY, amount: 6_000_00 }] };
    expect((await F('af_ba1', { ...waive, requestId: rid() })).status).toBe(403);
    expect((await F('af_ua', { ...waive, requestId: rid(), installments: undefined })).status).toBe(400);
    expect((await F('af_ua', { ...waive, requestId: rid() })).json.balance).toBe(0);
    const rec = await F('af_ua', { action: 'reconcile', feeAccountId: id });
    expect(rec.json).toMatchObject({ matches: true, fromLedger: { paid: 10_000_00, refunded: 4_000_00, adjustments: -(GROSS - 6_000_00) } });
    expect((await db.collection('feeTransactions').where('feeAccountId', '==', id).get()).size).toBe(5);
    const receipt = await F('af_ba1', { action: 'receipt', transactionId: p1.json.transactionId });
    expect(receipt.json.receipt).toMatchObject({ receiptNumber: `STX-PUN-R-${YEAR}-00001`, amount: 10_000_00, method: 'UPI', student: { name: 'Asha Patil' }, branch: { code: 'PUN' } });
  });

  it('other branches, students and instructors can’t see or change fees', async () => {
    expect((await F('af_ba2', { action: 'account', feeAccountId: id })).status).toBe(404);
    expect((await F('af_ba2', { action: 'record_payment', feeAccountId: id, requestId: rid(), amount: 1_00, method: 'cash', date: TODAY })).status).toBe(404);
    expect((await F('af_stu', { action: 'account', feeAccountId: id })).status).toBe(403);
    expect((await F('af_inst', { action: 'accounts' })).status).toBe(403);
    expect((await F('af_ba2', { action: 'accounts' })).json.accounts).toEqual([]);
    expect((await F('af_ba1', { action: 'accounts', branchId: 'b2' })).status).toBe(404);
    expect((await F('af_ua', { action: 'accounts' })).json.accounts).toHaveLength(1);
  });

  it('a student sees only their own fees and receipts, without internal details', async () => {
    const owner = (await get(`feeAccounts/${id}`))!.studentId as string;
    const pay = await F('af_ba1', { action: 'record_payment', feeAccountId: id, requestId: rid(), amount: 5_000_00, method: 'upi', reference: 'UTR-9', date: TODAY, note: 'internal note' });
    const mine = await F(owner, { action: 'my_fees' });
    expect(mine.status).toBe(200);
    expect(mine.json.accounts).toHaveLength(1);
    const acc = mine.json.accounts[0];
    expect(acc).toMatchObject({ id, due: GROSS, collected: 5_000_00, balance: GROSS - 5_000_00, paymentStatus: 'partial' });
    expect(acc.installments).toHaveLength(3);
    expect(acc.entries).toEqual([expect.objectContaining({ id: pay.json.transactionId, type: 'payment', amount: 5_000_00, method: 'UPI', reversed: false })]);
    expect(JSON.stringify(mine.json)).not.toMatch(/internal note|createdBy|af_ba1/);
    expect((await F(owner, { action: 'receipt', transactionId: pay.json.transactionId })).json.receipt).toMatchObject({ amount: 5_000_00 });
    // Another student: no accounts, and the receipt is not found. Staff can't use the student view.
    expect((await F('af_stu', { action: 'my_fees' })).json.accounts).toEqual([]);
    expect((await F('af_stu', { action: 'receipt', transactionId: pay.json.transactionId })).status).toBe(404);
    expect((await F('af_ba1', { action: 'my_fees' })).status).toBe(403);
    expect((await F(owner, { action: 'account', feeAccountId: id })).status).toBe(403);
  });
});

describe('expenses', () => {
  it('recorded once, branch-scoped, voided not deleted; recurring occurrences paid once', async () => {
    const r = rid();
    const add = { action: 'add_expense', requestId: r, branchId: 'b1', title: 'Printer paper', categoryId: 'builtin_stationery', amount: 1_200_00, date: TODAY, method: 'cash' };
    const e1 = await E('af_ba1', add);
    expect((await E('af_ba1', add)).json.duplicate).toBe(true);
    expect((await E('af_ba2', { ...add, requestId: rid() })).status).toBe(404);
    expect((await E('af_ba1', { ...add, requestId: rid(), date: plus(2) })).status).toBe(400);
    expect((await E('af_ba1', { ...add, requestId: rid(), categoryId: 'nope' })).status).toBe(400);
    expect((await E('af_ba2', { action: 'list' })).json.expenses).toEqual([]);
    expect((await E('af_ba1', { action: 'void_expense', expenseId: e1.json.expenseId, reason: 'Wrong branch' })).status).toBe(200);
    expect((await E('af_ba1', { action: 'list' })).json.total).toBe(0);
    expect(await get(`expenses/${e1.json.expenseId}`)).toMatchObject({ status: 'void', amount: 1_200_00 });
    // Custom category, then a monthly rent schedule.
    const cat = await E('af_ba1', { action: 'add_category', name: 'Water' });
    expect((await E('af_ba1', { action: 'add_category', name: 'water' })).status).toBe(409);
    expect((await E('af_ba1', { action: 'categories' })).json.categories.some((c: { id: string }) => c.id === cat.json.categoryId)).toBe(true);
    const start = plus(-40);
    const rent = await E('af_ba1', { action: 'add_recurring', branchId: 'b1', title: 'Rent', categoryId: 'builtin_rent', amount: 25_000_00, frequency: 'monthly', startDate: start });
    const sched = await E('af_ba1', { action: 'schedule', from: start, to: plus(40) });
    const states = sched.json.occurrences.map((o: { state: string }) => o.state);
    expect(states[0]).toBe('overdue');
    expect(states).toContain('scheduled');
    const pay = { action: 'pay_occurrence', recurringId: rent.json.recurringId, period: start, date: TODAY, method: 'bank_transfer' };
    expect((await E('af_ba1', pay)).status).toBe(200);
    expect((await E('af_ba1', pay)).json.error).toBe('duplicate');
    expect((await E('af_ba1', { ...pay, period: plus(-39) })).status).toBe(400);
    expect((await E('af_ba1', { action: 'schedule', from: start, to: start })).json.occurrences[0].state).toBe('paid');
    expect((await E('af_inst', { action: 'list' })).status).toBe(403);
  });
});

describe('reports and exports', () => {
  it('totals come from the records, respect scope and never leak another branch', async () => {
    await F('af_sa', { action: 'save_pricing', courseId: 'c1', pricing: PRICING });
    const a1 = (await admit('af_ba1', 'r1@stu.test', { discountType: 'none', discountValue: 0, plan: 'one_time', installments: [], initialPayment: { amount: 12_000_00, method: 'cash' } })).confirm.json;
    await admit('af_ba2', 'r2@stu.test', { discountType: 'none', discountValue: 0, plan: 'one_time', installments: [], initialPayment: { amount: 7_000_00, method: 'cash' } }, 'bt2', 'b2');
    await F('af_ba1', { action: 'record_refund', feeAccountId: a1.feeAccountId, requestId: rid(), amount: 2_000_00, method: 'cash', date: TODAY, reason: 'Overcharged' });
    await E('af_ba1', { action: 'add_expense', requestId: rid(), branchId: 'b1', title: 'Wi-Fi', categoryId: 'builtin_internet', amount: 1_500_00, date: TODAY, method: 'upi' });
    const b1 = await R('af_ba1', { action: 'finance_summary', from: TODAY, to: TODAY });
    expect(b1.json.totals).toMatchObject({ expected: GROSS, collected: 10_000_00, refunds: 2_000_00, expenses: 1_500_00, net: 8_500_00, outstanding: GROSS - 10_000_00, students: 1 });
    expect(b1.json.byBranch.map((b: { name: string }) => b.name)).toEqual(['Pune']);
    const academy = await R('af_ua', { action: 'finance_summary', from: TODAY, to: TODAY });
    expect(academy.json.totals).toMatchObject({ collected: 17_000_00, students: 2 });
    expect((await R('af_ba1', { action: 'finance_summary', orgId: '*' })).status).toBe(403);
    const all = await R('af_sa', { action: 'finance_summary', orgId: '*', from: TODAY, to: TODAY });
    expect(all.json.byAcademy).toEqual([expect.objectContaining({ id: 'org_a', name: 'Strynkix Academy', collected: 17_000_00 })]);
    const exp = await R('af_ba2', { action: 'export', dataset: 'transactions' });
    expect(exp.json.rows.every((r: { branch: string }) => r.branch === 'Mumbai')).toBe(true);
    expect((await R('af_stu', { action: 'export', dataset: 'fee_accounts' })).status).toBe(403);
    expect((await R('af_inst', { action: 'finance_summary' })).status).toBe(403);
    const course = await R('af_ua', { action: 'course_analytics', courseId: 'c1' });
    expect(course.json).toMatchObject({ students: { enrolled: 2, active: 2 }, fees: { expected: 2 * GROSS, collected: 17_000_00, refunds: 2_000_00 } });
    const academic = await R('af_ba1', { action: 'academic_summary' });
    expect(academic.json.totals).toMatchObject({ admissions: 1, activeStudents: 1 });
  });
});

describe('staff onboarding and people', () => {
  it('onboards an instructor to a batch with compensation visible only to finance-authorized users', async () => {
    const r = await AD('af_ba1', {
      action: 'onboard_staff', role: 'instructor', branchId: 'b1', password: 'Teach-12345', batchIds: ['bt1'],
      personal: { firstName: 'Ravi', lastName: 'Kulkarni', email: 'ravi@staff.test', mobile: '9876500000', dateOfBirth: '1990-05-01' },
      professional: { qualification: 'M.Tech', skills: ['React', 'Node'], experienceYears: 6, joiningDate: TODAY, employmentStatus: 'active' },
      compensation: { type: 'monthly', amount: 60_000_00 },
    });
    expect(r.status).toBe(200);
    const uid = r.json.userId;
    expect(await get(`users/${uid}`)).toMatchObject({ role: 'instructor', branchId: 'b1' });
    expect((await get('batches/bt1'))!.instructorUserIds).toEqual([uid]);
    expect((await AD('af_ba1', { action: 'person', userId: uid })).json.profile.compensation).toMatchObject({ amount: 60_000_00 });
    expect((await AD('af_ba2', { action: 'person', userId: uid })).status).toBe(404);
    expect((await AD('af_inst', { action: 'person', userId: uid })).status).toBe(403);
    expect((await AD('af_ba2', { action: 'onboard_staff', role: 'instructor', branchId: 'b1', password: 'Teach-12345', personal: { firstName: 'X', lastName: 'Y', email: 'xy@staff.test', mobile: '9876500001' }, professional: {}, compensation: { type: 'monthly', amount: 1 } })).status).toBe(403);
    // Search by mobile and by admission number style lookups stay in scope.
    expect((await AD('af_ba1', { action: 'search', q: '9876500000' })).json.people.map((p: { id: string }) => p.id)).toEqual([uid]);
    expect((await AD('af_ba2', { action: 'search', q: '9876500000' })).json.people).toEqual([]);
    expect(await audits('staff_onboard')).toHaveLength(1);
  });
});

describe('review fixes', () => {
  beforeEach(async () => {
    await F('af_sa', { action: 'save_pricing', courseId: 'c1', pricing: PRICING });
    await db.doc('branches/bx').set({ orgId: 'org_b', name: 'Other', code: 'OTH', status: 'active' });
  });

  it('concurrent payments: never over the balance, and the same request is recorded once', async () => {
    const id = (await admit('af_ba1', 'race@stu.test', { discountType: 'none', discountValue: 0, plan: 'one_time', installments: [] })).confirm.json.feeAccountId;
    const pay = (requestId: string, amount: number) => F('af_ba1', { action: 'record_payment', feeAccountId: id, requestId, amount, method: 'cash', date: TODAY });
    const [a, b] = await Promise.all([pay(rid(), 20_000_00), pay(rid(), 20_000_00)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const same = rid();
    const [c, d] = await Promise.all([pay(same, 1_000_00), pay(same, 1_000_00)]);
    expect([c.status, d.status]).toEqual([200, 200]);
    expect([c.json.duplicate, d.json.duplicate].filter(Boolean)).toHaveLength(1);
    const ledger = (await db.collection('feeTransactions').where('feeAccountId', '==', id).get()).docs.map((x) => x.data());
    expect(ledger.map((t) => t.amount).sort((x, y) => x - y)).toEqual([1_000_00, 20_000_00]);
    expect(new Set(ledger.map((t) => t.receiptNumber)).size).toBe(2);
    expect((await F('af_ba1', { action: 'reconcile', feeAccountId: id })).json.matches).toBe(true);
  });

  it('expenses and admission drafts take the academy from the stored branch', async () => {
    const add = (uid: string, branchId: string) => E(uid, { action: 'add_expense', requestId: rid(), branchId, title: 'Chairs', categoryId: 'builtin_equipment', amount: 100_00, date: TODAY, method: 'cash' });
    expect((await add('af_ua', 'bx')).status).toBe(404);
    expect((await add('af_ua', 'missing')).status).toBe(404);
    const sa = await add('af_sa', 'bx');
    expect(await get(`expenses/${sa.json.expenseId}`)).toMatchObject({ orgId: 'org_b', branchId: 'bx' });
    expect((await AD('af_ua', { action: 'save_draft', branchId: 'bx', personal: {} })).status).toBe(404);
    expect((await AD('af_ua', { action: 'save_draft', orgId: 'org_a', branchId: 'missing', personal: {} })).status).toBe(404);
  });
});


/** Stage 8 — Super Admin Command Centre browser scenarios 1–6. */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { admin, idTokenFor, resetData, signInAs } from './fixtures';

test.beforeEach(resetData);

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const shift = (days: number) => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const NOW = new Date().toISOString();

/** A real fee account: two payments (one reversed), an overdue first installment, an admission and a class. */
async function seed() {
  const { db } = admin();
  const base = { orgId: 'e2e_org', branchId: 'e2e_branch', courseId: 'e2e_course', feeAccountId: 'e2e_fa', studentId: 'e2e_stu', studentName: 'E2E stu', createdById: 'e2e_ba', createdByName: 'E2E ba' };
  await db.doc('coursePricing/e2e_course').set({ courseId: 'e2e_course', orgId: 'e2e_org', currency: 'INR', standardFee: 20_000_00, registrationFee: 0, otherFees: [], installmentOptions: [1, 2], discountLimits: { branch_admin: 1000, university_admin: 2500 }, available: true, version: 1, approvedById: 'e2e_super', updatedAt: NOW });
  await db.doc('feeAccounts/e2e_fa').set({
    orgId: 'e2e_org', branchId: 'e2e_branch', courseId: 'e2e_course', batchId: 'e2e_batch', studentId: 'e2e_stu', studentName: 'E2E stu', admissionId: 'e2e_adm', admissionNumber: 'E2E-E2E-2026-0001',
    courseTitle: 'E2E Live Course', currency: 'INR', pricingVersion: 1, grossFee: 20_000_00, discount: { type: 'none', value: 0, amount: 0, status: 'none' }, agreedFee: 20_000_00, plan: 'installments',
    installments: [{ number: 1, dueDate: shift(-30), amount: 10_000_00 }, { number: 2, dueDate: shift(30), amount: 10_000_00 }], totals: { paid: 5_000_00, refunded: 0, adjustments: 0 }, status: 'active', createdById: 'e2e_ba', createdAt: NOW, updatedAt: NOW,
  });
  await db.doc('feeTransactions/pay_e2e_1').set({ ...base, type: 'payment', amount: 5_000_00, method: 'upi', reference: 'UTR-1', date: today(), receiptNumber: 'E2E-E2E-R-2026-00001', createdAt: NOW, balanceAfter: 15_000_00 });
  await db.doc('feeTransactions/pay_e2e_2').set({ ...base, type: 'payment', amount: 1_000_00, method: 'cash', date: today(), receiptNumber: 'E2E-E2E-R-2026-00002', createdAt: NOW, balanceAfter: 14_000_00 });
  await db.doc('feeTransactions/rev_pay_e2e_2').set({ ...base, type: 'reversal', amount: 1_000_00, date: today(), reversesId: 'pay_e2e_2', reason: 'Entered twice', createdAt: NOW, balanceAfter: 15_000_00 });
  await db.doc('admissions/e2e_adm').set({ orgId: 'e2e_org', branchId: 'e2e_branch', status: 'confirmed', admissionNumber: 'E2E-E2E-2026-0001', personal: { firstName: 'E2E', lastName: 'stu', email: 'e2e_stu@e2e.test', mobile: '9876543210' }, academic: {}, courseId: 'e2e_course', batchId: 'e2e_batch', studentId: 'e2e_stu', feeAccountId: 'e2e_fa', createdById: 'e2e_ba', confirmedAt: NOW, createdAt: NOW, updatedAt: NOW });
  await db.doc('personProfiles/e2e_stu').set({ orgId: 'e2e_org', branchId: 'e2e_branch', role: 'student', personal: { firstName: 'E2E', lastName: 'stu', email: 'e2e_stu@e2e.test', mobile: '9876543210' }, admissionNumber: 'E2E-E2E-2026-0001', updatedAt: NOW });
  await db.doc('users/e2e_stu').update({ 'metadata.studentIdNumber': 'E2E-E2E-2026-0001' });
  await db.doc(`attendance/e2e_batch_${shift(-1)}`).set({ orgId: 'e2e_org', branchId: 'e2e_branch', courseId: 'e2e_course', batchId: 'e2e_batch', date: shift(-1), records: { e2e_stu: 'absent' }, takenById: 'e2e_inst', createdAt: NOW, updatedAt: NOW });
}

test('Scenario 1 — global view → academy → branch → students, courses, attendance and finance', async ({ page }) => {
  await seed();
  await signInAs(page, 'super');
  await page.getByRole('link', { name: 'Command Centre' }).first().click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Command Centre', level: 1, exact: true })).toBeVisible();
  await expect(page.getByText('Fees expected')).toBeVisible();
  await page.locator('#cf-org').selectOption('e2e_org');
  await expect(page.getByText('₹15,000.00').first()).toBeVisible(); // outstanding for this academy
  await page.getByRole('link', { name: 'Academies' }).first().click();
  await page.getByRole('link', { name: 'E2E Academy' }).click();
  await expect(page.getByText('Academy 360°')).toBeVisible();
  await page.getByRole('tab', { name: 'Branches' }).click();
  await page.getByRole('link', { name: 'E2E Branch' }).click();
  await expect(page.getByText(/Branch 360°/)).toBeVisible();
  await page.getByRole('tab', { name: 'Students' }).click();
  await expect(page.locator('tr', { hasText: 'E2E stu' }).first()).toContainText('E2E Live Course');
  await expect(page.locator('tr', { hasText: 'E2E stu' }).first()).toContainText('₹15,000.00 due');
  await page.getByRole('tab', { name: 'Courses and batches' }).click();
  await expect(page.locator('tr', { hasText: 'E2E Live Course' })).toContainText('E2E Batch');
  await page.getByRole('tab', { name: 'Attendance and academics' }).click();
  await expect(page.getByRole('heading', { name: /Students who may need attention/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Finance' }).click();
  await expect(page.locator('tr', { hasText: 'reversal' })).toContainText('₹1,000.00');
});

test('Scenario 2 — financial inspection: ledger, installments, payments and reversal, statement', async ({ page }) => {
  await seed();
  await signInAs(page, 'super');
  await page.goto('/dashboard/command/finance');
  await page.locator('#cf-org').selectOption('e2e_org');
  await expect(page.getByRole('heading', { name: /Overdue installments \(1\)/ })).toBeVisible();
  await page.locator('#cf-branch').selectOption('e2e_branch');
  await page.locator('#fi-status').selectOption('overdue');
  await page.locator('tr', { hasText: 'E2E stu' }).getByRole('link', { name: 'E2E stu' }).click();
  await expect(page.getByText(/E2E Academy · E2E Branch · admitted/)).toBeVisible();
  await expect(page.locator('tr', { has: page.getByText('Overdue', { exact: true }) }).filter({ visible: true })).toContainText('₹5,000.00'); // installment 1: 10,000 due, 5,000 paid
  await expect(page.locator('tr', { hasText: 'E2E-E2E-R-2026-00001' })).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Entered twice' })).toContainText('reversal');
  await expect(page.getByText('The stored totals for this account don’t match')).toHaveCount(0);
  await page.getByRole('link', { name: 'Print statement' }).click();
  await expect(page.getByText('Fee statement')).toBeVisible();
  await expect(page.getByText(/balance ₹15,000\.00/)).toBeVisible();
});

test('Scenario 3 — academic monitoring: academy → course → batches → needs attention → profile', async ({ page }) => {
  await seed();
  await signInAs(page, 'super');
  await page.goto('/dashboard/command/academics');
  await page.locator('#cf-org').selectOption('e2e_org');
  await page.locator('#ai-course').selectOption('e2e_course');
  await expect(page.getByRole('heading', { name: 'Course performance' })).toBeVisible();
  const row = page.locator('tr', { hasText: 'No lesson activity in 14 days' }).first();
  await expect(row).toContainText('E2E stu');
  await row.getByRole('link', { name: 'E2E stu' }).click();
  await expect(page.getByRole('heading', { name: 'E2E stu' })).toBeVisible();
  await expect(page.getByText('Courses, results and attendance')).toBeVisible();
});

test('Scenario 4 — people: search a student and review admission, course, batch, attendance and fees', async ({ page }) => {
  await seed();
  await signInAs(page, 'super');
  await page.goto('/dashboard/command/people');
  await page.getByLabel('Search').fill('9876543210');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: 'E2E stu' }).click();
  await expect(page.getByText(/Student ID E2E-E2E-2026-0001/)).toBeVisible();
  await expect(page.locator('tr', { hasText: 'E2E Live Course' })).toContainText('E2E Batch');
  await expect(page.getByText('Balance ₹15,000.00')).toBeVisible();
});

test('Scenario 5 — other roles can’t open the Command Centre or its API', async ({ browser }) => {
  for (const role of ['uni', 'ba', 'inst', 'stu'] as const) {
    const page = await browser.newPage();
    await signInAs(page, role);
    await page.goto('/dashboard/command');
    await expect(page.getByText("This area isn't available to you")).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Command Centre', level: 1, exact: true })).toHaveCount(0);
    const res = await page.request.post('/api/command', { headers: { Authorization: `Bearer ${await idTokenFor(role)}` }, data: { action: 'overview', orgId: 'e2e_org' } });
    expect(res.status()).toBe(403);
    await page.close();
  }
});

test('Scenario 6 — reports: academy, branch and dates → financial report → CSV totals match the ledger', async ({ page }) => {
  await seed();
  await signInAs(page, 'super');
  await page.goto('/dashboard/reports?orgId=e2e_org&branchId=e2e_branch');
  await page.getByLabel('From').fill(shift(-7));
  await page.getByLabel('To').fill(today());
  await expect(page.getByText('Net operating position')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export this report (CSV)' }).click();
  const file = await (await download).path();
  const csv = fs.readFileSync(file!, 'utf8');
  expect(csv).toContain('"Branch","e2e_branch"');
  // Collected = 5,000 + 1,000 − 1,000 reversed = 5,000.00 in the month row.
  const monthRow = csv.split('\r\n').find((l) => l.startsWith('"Month"'));
  expect(monthRow).toContain('"5000.00"');
  const ledger = (await admin().db.collection('feeTransactions').where('feeAccountId', '==', 'e2e_fa').get()).docs.map((d) => d.data());
  const cash = ledger.reduce((s, t) => s + (t.type === 'payment' ? t.amount : t.type === 'reversal' ? -t.amount : 0), 0);
  expect(cash).toBe(5_000_00);
});

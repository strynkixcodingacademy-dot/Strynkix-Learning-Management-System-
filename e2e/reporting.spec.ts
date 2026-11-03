/** Stage 9 — reporting snapshots and reconciliation in the browser. */
import { test, expect } from '@playwright/test';
import { admin, idTokenFor, resetData, signInAs } from './fixtures';

test.beforeEach(resetData);

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const prevMonth = () => { const [y, m] = today().split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

async function seed() {
  const { db } = admin();
  const M = prevMonth();
  await db.doc('feeAccounts/e2e_fa').set({
    orgId: 'e2e_org', branchId: 'e2e_branch', courseId: 'e2e_course', batchId: 'e2e_batch', studentId: 'e2e_stu', studentName: 'E2E stu', admissionId: 'e2e_adm', admissionNumber: 'E2E-1', courseTitle: 'E2E Live Course',
    currency: 'INR', pricingVersion: 1, grossFee: 20_000_00, discount: { type: 'none', value: 0, amount: 0, status: 'none' }, agreedFee: 20_000_00, plan: 'one_time',
    installments: [{ number: 1, dueDate: `${M}-28`, amount: 20_000_00 }], totals: { paid: 6_000_00, refunded: 0, adjustments: 0 }, status: 'active', createdById: 'e2e_ba', createdAt: `${M}-03T06:00:00.000Z`, updatedAt: `${M}-03T06:00:00.000Z`,
  });
  await db.doc('feeTransactions/pay_e2e_m').set({ orgId: 'e2e_org', branchId: 'e2e_branch', courseId: 'e2e_course', feeAccountId: 'e2e_fa', studentId: 'e2e_stu', studentName: 'E2E stu', type: 'payment', amount: 6_000_00, method: 'upi', date: `${M}-10`, receiptNumber: 'R-1', createdById: 'e2e_ba', createdByName: 'E2E ba', createdAt: `${M}-10T07:00:00.000Z` });
  return M;
}

test('Super Admin generates last month’s snapshots, inspects one, and Reports uses the reconciled snapshot', async ({ page }) => {
  const M = await seed();
  await signInAs(page, 'super');
  await page.goto('/dashboard/command/reporting');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Reporting & reconciliation', level: 1 }).first()).toBeVisible();
  await page.locator('#rp-type').selectOption('monthly');
  await expect(page.locator('#rp-key')).toHaveValue(M);
  await page.getByRole('button', { name: 'Generate snapshots' }).click();
  await expect(page.getByText(/Generate: succeeded/)).toBeVisible({ timeout: 30000 });
  const row = page.locator('tr', { hasText: `monthly ${M}` }).filter({ hasText: /branch · e2e_branch(?!_)/ });
  await expect(row).toContainText('reconciled');
  await expect(row).toContainText('₹6,000.00');
  await row.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByText(`branch_e2e_branch_monthly_${M}`)).toBeVisible();
  await expect(page.getByText(/Reconciliation reconciled at/)).toBeVisible();
  await page.goto(`/dashboard/reports?orgId=e2e_org&branchId=e2e_branch`);
  await page.getByLabel('From').fill(`${M}-01`);
  const monthRow = page.locator('tr', { hasText: M }).filter({ hasText: 'Reconciled snapshot' }).filter({ visible: true });
  await expect(monthRow).toContainText('₹6,000.00');
  await expect(page.locator('tr', { hasText: today().slice(0, 7) }).filter({ hasText: 'Current period (live)' }).filter({ visible: true })).toBeVisible();
});

test('other roles can’t open reporting controls or call the reporting API', async ({ page }) => {
  await signInAs(page, 'ba');
  await page.goto('/dashboard/command/reporting');
  await expect(page.getByText("This area isn't available to you")).toBeVisible();
  const res = await page.request.post('/api/reporting', { headers: { Authorization: `Bearer ${await idTokenFor('ba')}` }, data: { action: 'run', periodType: 'monthly', periodKey: prevMonth() } });
  expect(res.status()).toBe(403);
});

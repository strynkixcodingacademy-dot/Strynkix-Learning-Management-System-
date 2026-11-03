/**
 * Consolidation — every role's navigation opens without errors, refusals or
 * duplicate titles; the student's own fees and receipts; in-app reason
 * dialogs instead of browser prompts.
 */
import { test, expect, type Page } from '@playwright/test';
import { admin, resetData, signInAs, type FixtureUser } from './fixtures';

test.beforeEach(resetData);

async function navLinks(page: Page): Promise<string[]> {
  await page.goto('/dashboard');
  await expect(page.locator('nav[aria-label="Main"] a').first()).toBeAttached();
  const hrefs = await page.locator('nav[aria-label="Main"] a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  return [...new Set(hrefs.filter((h) => h.startsWith('/dashboard')))];
}

async function expectPageWorks(page: Page, href: string) {
  await page.goto(href);
  const main = page.locator('main');
  await expect(main.locator('[role="status"]'), `${href} finished loading`).toHaveCount(0);
  await expect(page.getByText("This area isn't available to you"), `${href} is allowed`).toHaveCount(0);
  await expect(main.getByText('Something went wrong'), `${href} has no error`).toHaveCount(0);
  await expect(main.locator('h1').filter({ visible: true }), `${href} has one title`).toHaveCount(1);
}

for (const [user, min] of [['stu', 15], ['inst', 10], ['ba', 14], ['uni', 14], ['super', 15]] as [FixtureUser, number][]) {
  test(`every navigation entry opens for ${user}`, async ({ page }) => {
    test.setTimeout(240_000);
    await signInAs(page, user);
    const links = await navLinks(page);
    expect(links.length).toBeGreaterThanOrEqual(min);
    for (const href of links) await expectPageWorks(page, href);
  });
}

test('a student sees their own fees and opens a receipt', async ({ page }) => {
  const { db } = admin();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  await db.doc('feeAccounts/e2e_fee').set({
    orgId: 'e2e_org', branchId: 'e2e_branch', courseId: 'e2e_course', batchId: 'e2e_batch', studentId: 'e2e_stu', studentName: 'E2E Student',
    admissionId: 'e2e_adm', admissionNumber: 'E2E-0001', courseTitle: 'E2E Live Course', currency: 'INR', pricingVersion: 1,
    grossFee: 20_000_00, discount: { type: 'none', value: 0, amount: 0, status: 'none' }, agreedFee: 20_000_00, plan: 'installments',
    installments: [{ number: 1, dueDate: today, amount: 10_000_00 }, { number: 2, dueDate: '2099-01-01', amount: 10_000_00 }],
    totals: { paid: 10_000_00, refunded: 0, adjustments: 0 }, status: 'active', createdById: 'e2e_ba', createdAt: now, updatedAt: now,
  });
  await db.doc('feeTransactions/e2e_pay').set({
    orgId: 'e2e_org', branchId: 'e2e_branch', courseId: 'e2e_course', feeAccountId: 'e2e_fee', studentId: 'e2e_stu', studentName: 'E2E Student',
    type: 'payment', amount: 10_000_00, method: 'upi', date: today, receiptNumber: 'E2E-R-1', createdById: 'e2e_ba', createdByName: 'Branch Admin', createdAt: now,
  });
  await signInAs(page, 'stu');
  await page.goto('/dashboard');
  await page.locator('nav[aria-label="Main"]').filter({ visible: true }).getByRole('link', { name: 'My Fees' }).click();
  await expect(page.getByRole('heading', { name: 'My fees' })).toBeVisible();
  await expect(page.getByText('Partly paid').first()).toBeVisible();
  await page.getByRole('link', { name: 'Receipt E2E-R-1' }).click();
  await expect(page.getByText('E2E-R-1').first()).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('voiding an expense asks for a reason in the page and validates it', async ({ page }) => {
  await signInAs(page, 'ba');
  await page.goto('/dashboard/expenses');
  await page.getByLabel('What for').fill('Broken chair');
  await page.getByLabel('Category').first().selectOption('builtin_internet');
  await page.getByLabel('Amount (₹)').fill('800');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await page.locator('tr', { hasText: 'Broken chair' }).getByRole('button', { name: 'Void' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('no');
  await dialog.getByRole('button', { name: 'Void expense' }).click();
  await expect(dialog.getByText('Please write at least 5 characters.')).toBeVisible();
  await dialog.getByRole('textbox').fill('Recorded under the wrong category');
  await dialog.getByRole('button', { name: 'Void expense' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('tr', { hasText: 'Broken chair' })).toHaveCount(0);
});

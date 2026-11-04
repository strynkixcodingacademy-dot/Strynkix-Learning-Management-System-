import { test, expect } from '@playwright/test';
import { admin, idTokenFor, resetData, signInAs } from './fixtures';

/**
 * The Students register: reachable from People, scoped per role, hidden from
 * instructors and students, and every export recorded in the audit log.
 */

test.beforeEach(resetData);

test('Super Admin opens Students from People, switches academy and exports an audited CSV', async ({ page }) => {
  await admin().db.doc('personProfiles/e2e_stu').set({
    id: 'e2e_stu', orgId: 'e2e_org', branchId: 'e2e_branch', role: 'student', admissionNumber: 'E2E-0001', updatedAt: '2026-01-01T00:00:00.000Z',
    personal: { firstName: 'E2E', lastName: 'Stu', email: 'e2e_stu@e2e.test', mobile: '+91 98765 43210', guardianName: 'E2E Guardian', guardianRelation: 'Mother', guardianPhone: '+91 90000 00001' },
    academic: { institution: 'E2E College' },
  });
  await signInAs(page, 'super');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'People' }).click();
  await page.getByRole('link', { name: /^Students/ }).click();
  await expect(page.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible();

  const row = page.getByRole('row', { name: /E2E stu\b/ });
  await expect(row).toContainText('E2E-0001');
  await expect(row).toContainText('E2E Guardian (Mother)');
  await expect(page.getByRole('row', { name: /E2E stuB/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Show details for E2E stu', exact: true }).click();
  await expect(page.locator('#d-e2e_stu').getByText('E2E College')).toBeVisible();

  await page.getByLabel('Search students').fill('E2E-0001');
  await expect(page.getByText(/^1 of \d+ students?$/)).toBeVisible();
  await page.getByLabel('Search students').fill('');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^students-\d{4}-\d{2}-\d{2}\.csv$/);
  await expect.poll(async () => (await admin().db.collection('auditLog').where('action', '==', 'students_export').get()).size).toBe(1);

  await page.getByLabel('Academy').selectOption('e2e_org_b');
  await expect(page.getByRole('row', { name: /E2E stuB/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /E2E stu\b/ })).toHaveCount(0);
});

test('a Branch Manager sees only their branch, with no academy or branch switch', async ({ page }) => {
  await signInAs(page, 'ba');
  await page.goto('/dashboard/students');
  await expect(page.getByRole('row', { name: /E2E stu\b/ })).toBeVisible();
  await expect(page.getByLabel('Academy')).toHaveCount(0);
  await expect(page.getByLabel('Branch', { exact: true })).toHaveCount(0);
});

test('instructors and students can’t open the register, in the app or through the API', async ({ page }) => {
  await signInAs(page, 'inst');
  await page.goto('/dashboard/students');
  await expect(page.getByText("This area isn't available to you")).toBeVisible();
  for (const role of ['inst', 'stu'] as const) {
    const res = await page.request.post('/api/students', { headers: { Authorization: `Bearer ${await idTokenFor(role)}` }, data: { action: 'list' } });
    expect(res.status()).toBe(403);
  }
  const ba = await page.request.post('/api/students', { headers: { Authorization: `Bearer ${await idTokenFor('ba')}` }, data: { action: 'list', branchId: 'e2e_branch_b' } });
  expect(ba.status()).toBe(404);
  const uni = await page.request.post('/api/students', { headers: { Authorization: `Bearer ${await idTokenFor('uni')}` }, data: { action: 'list', orgId: 'e2e_org_b' } });
  expect(uni.status()).toBe(404);
});

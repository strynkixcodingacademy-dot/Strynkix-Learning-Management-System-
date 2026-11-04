import { test, expect } from '@playwright/test';
import { admin, resetData, signInAs } from './fixtures';

/**
 * Weekly timetable: an unplanned week opens (it used to show a raw permission
 * error, Super Admin included), and draft → submit → approve works end to end
 * with an audit entry for each step (approval used to fail on an undefined field).
 */

test.beforeEach(async () => {
  await resetData();
  const { db } = admin();
  const old = await db.collection('timetables').get();
  await Promise.all(old.docs.map((d) => db.recursiveDelete(d.ref)));
});

const timetableOf = async () => {
  const snap = await admin().db.collection('timetables').where('batchId', '==', 'e2e_batch').get();
  return snap.docs[0];
};

test('Super Admin opens a week nobody has planned yet', async ({ page }) => {
  await signInAs(page, 'super');
  await page.goto('/dashboard/batches/e2e_batch/timetable');
  await expect(page.getByText('No activities scheduled for this day yet.')).toBeVisible();
  await expect(page.getByText(/insufficient permissions/i)).toHaveCount(0);
});

test('a branch manager drafts and submits a week, and Super Admin approves it', async ({ page, browser }) => {
  await signInAs(page, 'ba');
  await page.goto('/dashboard/batches/e2e_batch/timetable');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect.poll(async () => (await timetableOf())?.get('latestStatus')).toBe('draft');

  await page.getByRole('button', { name: 'Submit for Approval' }).click();
  await expect.poll(async () => (await timetableOf())?.get('latestStatus')).toBe('submitted');
  const tt = await timetableOf();
  const rev = await tt.ref.collection('revisions').doc(tt.get('currentRevisionId')).get();
  expect(rev.get('status')).toBe('submitted');
  expect((await tt.ref.collection('auditLogs').get()).docs.map((d) => d.get('action')).sort()).toEqual(['create_draft', 'submit']);

  const sa = await browser.newPage();
  await signInAs(sa, 'super');
  await sa.goto('/dashboard/batches/e2e_batch/timetable');
  await sa.getByRole('button', { name: 'Approve & Activate Timetable' }).click();
  await sa.getByRole('button', { name: 'Confirm Approval' }).click();
  await expect.poll(async () => (await timetableOf())?.get('activeRevisionId')).toBe(tt.get('currentRevisionId'));
  expect((await tt.ref.collection('auditLogs').get()).docs.map((d) => d.get('action')).sort()).toEqual(['approve', 'create_draft', 'submit']);
  await sa.close();
});

test('an activity without optional details saves', async ({ page }) => {
  await signInAs(page, 'ba');
  await page.goto('/dashboard/batches/e2e_batch/timetable');
  await page.getByRole('button', { name: 'Add Activity' }).click();
  await page.locator('#actType').selectOption('revision');
  await page.locator('#actTitle').fill('Recap of week one');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Activity' }).click();
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect.poll(async () => {
    const tt = await timetableOf();
    if (!tt) return null;
    const rev = await tt.ref.collection('revisions').doc(tt.get('currentRevisionId')).get();
    return Object.values(rev.get('days') as Record<string, { activities: { title: string }[] }>).flatMap((d) => d.activities.map((a) => a.title));
  }).toEqual(['Recap of week one']);
  await expect(page.getByText(/unsupported field value/i)).toHaveCount(0);
});

import { test, expect } from '@playwright/test';
import { admin, resetData, signInAs } from './fixtures';

/**
 * The batch page's account dialogs: a Branch Manager creates an instructor
 * (assigned to the batch) and a student (enrolled), and gets each login to share.
 */

test.beforeEach(resetData);

const uidOf = async (email: string) => (await admin().db.collection('users').where('email', '==', email).get()).docs[0]?.id;

test('a Branch Manager adds an instructor to the batch and is shown the login to share', async ({ page }) => {
  await signInAs(page, 'ba');
  await page.goto('/dashboard/batches/e2e_batch');
  await page.getByRole('button', { name: /Add Instructor/ }).click();
  await expect(page.getByRole('heading', { name: 'Add Lead Instructor' })).toBeVisible();
  await page.getByPlaceholder('e.g. Prof. Priya Nair').fill('New Teacher');
  await page.getByPlaceholder('e.g. priya@strynkix.com').fill('new.teacher@e2e.test');
  await page.getByRole('button', { name: 'Create & Assign Instructor' }).click();

  await expect(page.getByRole('heading', { name: 'Instructor Assigned Successfully!' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('new.teacher@e2e.test').first()).toBeVisible();
  await expect(page.getByText('Lead Instructor', { exact: true })).toBeVisible();
  const uid = await uidOf('new.teacher@e2e.test');
  expect((await admin().db.doc('batches/e2e_batch').get()).get('instructorUserIds')).toContain(uid);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Instructor Assigned Successfully!' })).toHaveCount(0);
  await expect(page.getByText('New Teacher').first()).toBeVisible();
});

test('a Branch Manager creates a student and is shown the login to share', async ({ page }) => {
  await signInAs(page, 'ba');
  await page.goto('/dashboard/batches/e2e_batch');
  await page.getByRole('button', { name: /Create & Enroll New Student/ }).click();
  await page.getByPlaceholder('e.g. Rahul Sharma').fill('Second Learner');
  await page.getByPlaceholder('e.g. rahul@strynkix.com').fill('second.learner@e2e.test');
  await page.getByRole('button', { name: 'Create & Enroll Student' }).click();

  await expect(page.getByRole('heading', { name: 'Student Enrolled Successfully!' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('second.learner@e2e.test').first()).toBeVisible();
  const uid = await uidOf('second.learner@e2e.test');
  await expect.poll(async () => (await admin().db.doc(`enrollments/e2e_course_${uid}`).get()).exists).toBe(true);
});

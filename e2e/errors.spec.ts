/** Journey E — error states, double submission, cross-org access and conflicts. */
import { test, expect } from '@playwright/test';
import { admin, resetData, signInAs } from './fixtures';

test.beforeEach(resetData);

test('a missing lesson shows an unavailable state', async ({ page }) => {
  await signInAs(page, 'stu');
  await page.goto('/courses/e2e_course/lessons/does_not_exist');
  await expect(page.getByText(/Lesson unavailable|not found/i).first()).toBeVisible();
});

test('a student of another organization cannot open the course', async ({ page }) => {
  await signInAs(page, 'stuB');
  await page.goto('/courses/e2e_course/lessons/e2e_plain');
  await expect(page.getByText(/not enrolled|unavailable|not found/i).first()).toBeVisible();
  await expect(page.getByText('E2E Reading Lesson reading content.')).toHaveCount(0);
});

test('a double-clicked quiz submission is graded once', async ({ page }) => {
  await signInAs(page, 'stu');
  await page.goto('/courses/e2e_course/lessons/e2e_quiz_pass');
  await page.getByRole('button', { name: 'Start Quiz' }).click();
  await page.getByLabel('Option B').check();
  await page.getByRole('button', { name: 'Submit answers' }).dblclick();
  await expect(page.getByText('You scored 0%')).toBeVisible();
  const attempts = await admin().db.collection('progress/e2e_stu_e2e_course_e2e_quiz_pass/quizAttempts').get();
  expect(attempts.size).toBe(1);
});

test('a network failure during grading shows a recoverable error', async ({ page }) => {
  await signInAs(page, 'stu');
  await page.goto('/courses/e2e_course/lessons/e2e_quiz_pass');
  await page.route('**/api/quiz/attempt', (route) => route.abort());
  await page.getByRole('button', { name: 'Start Quiz' }).click();
  await page.getByLabel('Option A').check();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText(/couldn.t reach the server/)).toBeVisible();
  await page.unroute('**/api/quiz/attempt');
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText('You scored 100%')).toBeVisible();
});

test('a review conflict (state changed elsewhere) is reported, not applied', async ({ page }) => {
  await signInAs(page, 'inst');
  await page.goto('/dashboard/courses/e2e_course/lessons/e2e_draft');
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeVisible();
  // Someone else submits it first.
  await admin().db.doc('lessons/e2e_draft').update({ review: { state: 'in_review', submittedById: 'e2e_ba', submittedAt: '2026-10-29T00:00:00.000Z' } });
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('This draft is already in review or approved.')).toBeVisible();
  expect((await admin().db.collection('auditLog').get()).size).toBe(0);
});

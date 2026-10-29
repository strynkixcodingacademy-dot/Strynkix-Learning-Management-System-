/** Journey B — course authoring and Course Design scope. */
import { test, expect } from '@playwright/test';
import { admin, resetData, signInAs } from './fixtures';

test.beforeEach(resetData);

test('an instructor edits and saves a draft lesson in the Block Studio', async ({ page }) => {
  await signInAs(page, 'inst');
  await page.goto('/dashboard/courses/e2e_course/lessons/e2e_draft');
  const title = page.locator('input[type="text"]').first();
  await expect(title).toHaveValue('E2E Draft Lesson');
  await title.fill('E2E Draft Lesson, edited');
  await page.getByRole('button', { name: 'Save Blocks' }).click();
  await expect(page.getByText('All lesson blocks saved successfully!')).toBeVisible();
  const saved = (await admin().db.doc('lessons/e2e_draft').get()).data()!;
  expect(saved).toMatchObject({ title: 'E2E Draft Lesson, edited', lastEditedById: 'e2e_inst' });
});

test('a branch admin reaches the same draft authoring', async ({ page }) => {
  await signInAs(page, 'ba');
  await page.goto('/dashboard/courses/e2e_course/lessons/e2e_draft');
  await expect(page.getByRole('button', { name: 'Save Blocks' })).toBeVisible();
});

test('a Course Design member sees only the courses in their scope', async ({ page }) => {
  await signInAs(page, 'designer');
  await page.goto('/dashboard/courses');
  await expect(page.getByText('E2E Live Course').first()).toBeVisible();
  await expect(page.getByText('E2E Out Of Scope Course')).toHaveCount(0);
});

test('a reviewer can read a lesson but has no editing controls', async ({ page }) => {
  await signInAs(page, 'reviewer');
  await page.goto('/dashboard/courses/e2e_course/lessons/e2e_draft');
  await expect(page.getByText('You can read this lesson but not edit it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Blocks' })).toHaveCount(0);
});

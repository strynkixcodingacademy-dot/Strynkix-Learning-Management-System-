/** Journey C — review, publishing and working revisions of published lessons. */
import { test, expect, type Page } from '@playwright/test';
import { admin, resetData, signInAs } from './fixtures';

test.beforeEach(resetData);

const studio = (page: Page, lessonId: string) => page.goto(`/dashboard/courses/e2e_course/lessons/${lessonId}`);

test('submit → approve → publish, with students seeing the lesson only once published', async ({ browser }) => {
  const author = await browser.newPage();
  await signInAs(author, 'inst');
  await studio(author, 'e2e_draft');
  await author.getByRole('button', { name: 'Submit for review' }).click();
  await expect(author.getByText('In review').first()).toBeVisible();
  await expect(author.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(author.getByRole('button', { name: /^Publish/ })).toHaveCount(0);

  const student = await browser.newPage();
  await signInAs(student, 'stu');
  await student.goto('/courses/e2e_course/lessons/e2e_draft');
  await expect(student.getByText('E2E Draft Lesson reading content.')).toHaveCount(0);

  const reviewer = await browser.newPage();
  await signInAs(reviewer, 'reviewer');
  await studio(reviewer, 'e2e_draft');
  await reviewer.getByRole('button', { name: 'Approve' }).click();
  await reviewer.locator('form').getByRole('button', { name: 'Approve' }).click();
  await expect(reviewer.getByText('Approved').first()).toBeVisible();
  await expect(reviewer.getByRole('button', { name: /^Publish/ })).toHaveCount(0);

  const sup = await browser.newPage();
  await signInAs(sup, 'super');
  await studio(sup, 'e2e_draft');
  await sup.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(sup.getByText('Published').first()).toBeVisible();

  await student.goto('/courses/e2e_course/lessons/e2e_draft');
  await expect(student.getByText('E2E Draft Lesson reading content.')).toBeVisible();
  const audit = (await admin().db.collection('auditLog').where('targetId', '==', 'e2e_draft').get()).docs.map((d) => d.data().action).sort();
  expect(audit).toEqual(['approve', 'publish', 'submit']);
});

test('reviewers can request changes, and the author resubmits', async ({ browser }) => {
  const author = await browser.newPage();
  await signInAs(author, 'inst');
  await studio(author, 'e2e_draft');
  await author.getByRole('button', { name: 'Submit for review' }).click();
  await expect(author.getByText('In review').first()).toBeVisible();

  const reviewer = await browser.newPage();
  await signInAs(reviewer, 'reviewer');
  await studio(reviewer, 'e2e_draft');
  await reviewer.getByRole('button', { name: 'Request changes' }).click();
  const confirm = reviewer.locator('form').getByRole('button', { name: 'Request changes' });
  await expect(confirm).toBeDisabled();
  await reviewer.locator('form textarea').fill('Please add an example.');
  await confirm.click();
  await expect(reviewer.getByText('Changes requested').first()).toBeVisible();

  await author.reload();
  await expect(author.getByText('Please add an example.').first()).toBeVisible();
  await expect(author.getByRole('button', { name: 'Save Blocks' })).toBeVisible();
  await author.getByRole('button', { name: 'Submit for review' }).click();
  await expect(author.getByText('In review').first()).toBeVisible();
});

test('the Super Admin cannot approve their own submission; publishing it needs a recorded reason', async ({ page }) => {
  await signInAs(page, 'super');
  await studio(page, 'e2e_draft');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('In review').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish without approval…' }).click();
  const confirm = page.locator('form').getByRole('button', { name: 'Publish' });
  await page.locator('form textarea').fill('short');
  await expect(confirm).toBeDisabled();
  await page.locator('form textarea').fill('Urgent release for the e2e cohort');
  await confirm.click();
  await expect(page.getByText('Published').first()).toBeVisible();
  const publish = (await admin().db.collection('auditLog').where('action', '==', 'publish').get()).docs[0].data();
  expect(publish).toMatchObject({ override: true, reason: 'Urgent release for the e2e cohort' });
});

test('editing a published lesson saves a revision; students keep the published version', async ({ browser }) => {
  const author = await browser.newPage();
  await signInAs(author, 'inst');
  await studio(author, 'e2e_plain');
  await expect(author.getByText(/Students see/)).toBeVisible();
  const title = author.locator('input[type="text"]').first();
  await title.fill('E2E Reading Lesson v2');
  await author.getByRole('button', { name: 'Save Blocks' }).click();
  await expect(author.getByText(/Revision saved/)).toBeVisible();
  expect((await admin().db.doc('lessons/e2e_plain').get()).data()!.title).toBe('E2E Reading Lesson');

  const student = await browser.newPage();
  await signInAs(student, 'stu');
  await student.goto('/courses/e2e_course/lessons/e2e_plain');
  await expect(student.getByRole('heading', { name: 'E2E Reading Lesson', exact: true })).toBeVisible();
  await expect(student.getByText('E2E Reading Lesson v2')).toHaveCount(0);
});

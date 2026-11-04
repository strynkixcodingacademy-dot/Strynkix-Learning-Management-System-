/** LMS completion milestone — browser journeys for the new and changed workflows. */
import { test, expect, type Page } from '@playwright/test';
import { PASSWORD, admin, emailOf, resetData, signIn, signInAs } from './fixtures';

test.beforeEach(resetData);

const audit = async (action: string) => (await admin().db.collection('auditLog').where('action', '==', action).get()).docs.map((d) => d.data());

test('G10 — a Course Design member’s home shows only pages they can open', async ({ page }) => {
  await signInAs(page, 'designer');
  await expect(page.getByRole('heading', { name: 'Your courses' })).toBeVisible();
  await expect(page.getByText('E2E Live Course').first()).toBeVisible();
  for (const hidden of ['Daily Plans', 'Review Work', 'My Batches']) await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Course Authoring' }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/courses$/);
  await expect(page.getByText("This area isn't available to you")).toHaveCount(0);
});

test('G37 — the Super Admin creates a University Admin from the academy card (audited)', async ({ page }) => {
  await signInAs(page, 'super');
  await page.goto('/dashboard/organizations');
  await page.getByRole('button', { name: 'Add University Admin' }).first().click();
  await page.getByLabel('Full name').fill('Dean Example');
  await page.getByLabel('Email address').fill('dean.example@e2e.test');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/can now sign in as University Admin/)).toBeVisible();
  const created = (await admin().db.collection('users').where('email', '==', 'dean.example@e2e.test').get()).docs[0]?.data();
  expect(created).toMatchObject({ role: 'university_admin', status: 'active' });
  expect(await audit('account_create')).toHaveLength(1);
});

test('G37 — a Branch Manager creates and enrolls a student from the batch (server-created account)', async ({ page }) => {
  await signInAs(page, 'ba');
  await page.goto('/dashboard/batches/e2e_batch');
  await page.getByRole('button', { name: /Create & Enroll New Student/ }).click();
  await page.getByPlaceholder('e.g. Rahul Sharma').fill('New Learner');
  await page.getByPlaceholder('e.g. rahul@strynkix.com').fill('new.learner@e2e.test');
  await page.getByRole('button', { name: 'Create & Enroll Student' }).click();
  await expect.poll(async () => (await admin().db.collection('users').where('email', '==', 'new.learner@e2e.test').get()).size, { timeout: 20000 }).toBe(1);
  const uid = (await admin().db.collection('users').where('email', '==', 'new.learner@e2e.test').get()).docs[0].id;
  await expect.poll(async () => (await admin().db.doc(`enrollments/e2e_course_${uid}`).get()).exists, { timeout: 20000 }).toBe(true);
});

test('G38/G40/G44 — a University Admin manages academy people, changes a role, and sees it in the audit log', async ({ page }) => {
  await signInAs(page, 'uni');
  await page.goto('/dashboard/people');
  await expect(page.getByText('E2E stuFree')).toBeVisible();
  await expect(page.getByText('E2E designer')).toHaveCount(0); // content team is Super-Admin-managed
  const row = page.locator('li', { hasText: 'E2E stuFree' });
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('New role').selectOption('instructor');
  await page.getByRole('button', { name: 'Review change' }).first().click();
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(page.getByText('E2E stuFree is now Instructor.')).toBeVisible();
  expect((await admin().db.doc('users/e2e_stu_free').get()).data()).toMatchObject({ role: 'instructor' });

  await page.goto('/dashboard/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(page.getByText('Role changed')).toBeVisible();
});

test('G28/G29/G15 — an instructor edits draft course details and reorders modules', async ({ page }) => {
  await signInAs(page, 'inst');
  await page.goto('/dashboard/courses/e2e_dcourse');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Course Authoring');
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel('Title').fill('E2E Draft Course, renamed');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Course details saved.')).toBeVisible();
  expect((await admin().db.doc('courses/e2e_dcourse').get()).data()!.title).toBe('E2E Draft Course, renamed');

  await page.getByRole('button', { name: 'Move module Second Module up' }).click();
  await expect(page.getByText('Module order saved.')).toBeVisible();
  const order = (await admin().db.collection('modules').where('courseId', '==', 'e2e_dcourse').get()).docs
    .map((d) => d.data()).sort((a, b) => a.orderIndex - b.orderIndex).map((m) => m.title);
  expect(order).toEqual(['Second Module', 'First Module']);
});

test('G32 — an Assessment Designer edits only quiz questions in assessment mode', async ({ page }) => {
  await signInAs(page, 'assessor');
  await page.goto('/dashboard/courses/e2e_dcourse/lessons/e2e_dlesson');
  await expect(page.getByText(/Assessment mode:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Blocks' })).toHaveCount(0);
  // The second option of question q1 becomes the correct answer.
  await page.locator('input[type="radio"][name="quiz_q1"]').nth(1).check();
  await page.getByRole('button', { name: 'Save Assessment' }).click();
  await expect(page.getByText(/Assessment saved: 1 question/)).toBeVisible();
  const key = (await admin().db.doc('lessons/e2e_dlesson/answerKey/current').get()).data()!;
  expect(key).toMatchObject({ keyVersion: 2, items: [{ blockId: 'q1', correctOptionId: 'opt_b' }] });
  const lesson = (await admin().db.doc('lessons/e2e_dlesson').get()).data()!;
  expect(lesson.blocks[0]).toMatchObject({ id: 't1', content: 'Assessment lesson reading content.' });
});

test('G13 — leaving the Block Studio with unsaved changes asks first', async ({ page }) => {
  await signInAs(page, 'inst');
  await page.goto('/dashboard/courses/e2e_course/lessons/e2e_draft');
  await page.locator('input[type="text"]').first().fill('Unsaved title');
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Course Authoring' }).click();
  expect(asked).toMatch(/unsaved changes/);
  await expect(page).toHaveURL(/lessons\/e2e_draft/);
});

async function startQuiz(page: Page) {
  await page.goto('/courses/e2e_course/lessons/e2e_quiz');
  await page.getByRole('button', { name: /Start Quiz|Retake Quiz/ }).click();
}

test('G21 — quiz answers survive a reload until submitted', async ({ page }) => {
  await signInAs(page, 'stu');
  await startQuiz(page);
  await page.getByLabel('Option B').check();
  await page.reload();
  await expect(page.getByText('We restored the answers you had chosen.')).toBeVisible();
  await expect(page.getByLabel('Option B')).toBeChecked();
});

test('G22/G23 — students see their quiz history; the batch instructor sees the class results', async ({ browser }) => {
  const stu = await browser.newPage();
  await signInAs(stu, 'stu');
  await startQuiz(stu);
  await stu.getByLabel('Option A').check();
  await stu.getByRole('button', { name: 'Next question' }).click();
  await stu.getByLabel('Option B').check();
  await stu.getByRole('button', { name: 'Submit answers' }).click();
  await expect(stu.getByText('You scored 0%')).toBeVisible();
  await stu.goto('/dashboard/analytics');
  await expect(stu.getByRole('heading', { name: 'Quiz results' })).toBeVisible();
  const row = stu.locator('tr', { hasText: 'E2E Quiz Lesson' });
  await expect(row).toContainText('0%');
  await row.getByRole('button', { name: /Show attempts/ }).click();
  await expect(stu.getByText('Attempt 1')).toBeVisible();

  const inst = await browser.newPage();
  await signInAs(inst, 'inst');
  await inst.goto('/dashboard/batches/e2e_batch');
  await expect(inst.getByRole('heading', { name: 'Quiz results' })).toBeVisible();
  await expect(inst.locator('tr', { hasText: 'E2E Quiz Lesson' })).toContainText('E2E stu');
  await expect(inst.locator('tr', { hasText: 'E2E Quiz Lesson' })).toContainText('Not passed yet');
});

test('G46 — notifications arrive live and can be marked read', async ({ page }) => {
  await signInAs(page, 'stu');
  await page.goto('/dashboard/profile');
  const { db } = admin();
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.collection('notifications').add({ orgId: 'e2e_org', userId: 'e2e_stu', type: 'submission_graded', title: '“Lab 1” was marked', body: 'You scored 9 / 10.', read: false, createdAt: FieldValue.serverTimestamp() });
  const bell = page.getByRole('button', { name: 'Notifications, 1 unread' });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByText('“Lab 1” was marked')).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await expect.poll(async () => (await db.collection('notifications').where('userId', '==', 'e2e_stu').get()).docs[0].data().read).toBe(true);
});

test('G08 — a suspension takes effect on screen without a reload', async ({ page }) => {
  await signInAs(page, 'stu');
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await admin().db.doc('users/e2e_stu').update({ status: 'suspended' });
  // The in-app paused screen (the login page words it "Your account is paused").
  await expect(page.getByText("Your account isn't active")).toBeVisible({ timeout: 20000 });
});

test('G05 — a signed-in user changes their password and signs in with it', async ({ page }) => {
  await signInAs(page, 'pwUser');
  await page.goto('/dashboard/profile');
  await page.locator('#pw-current').fill('wrong-password-1');
  await page.locator('#pw-new').fill('A-new-Passw0rd!');
  await page.locator('#pw-confirm').fill('A-new-Passw0rd!');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Your current password is incorrect.')).toBeVisible();
  await page.locator('#pw-current').fill(PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible();
  await page.getByRole('button', { name: /^Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByText(/Please sign in|Sign in with the email/).first()).toBeVisible();
  await page.goto('/login');
  await page.locator('input[type="email"]').first().fill(emailOf('pwUser'));
  await page.locator('input[type="password"]').fill('A-new-Passw0rd!');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // Restore the fixture password for later runs.
  await admin().auth.updateUser('e2e_pw', { password: PASSWORD });
});

test('G12 — unknown addresses show the branded not-found page', async ({ page }) => {
  await signInAs(page, 'stu');
  await page.goto('/this/does/not/exist');
  await expect(page.getByText('We couldn’t find that page')).toBeVisible();
  await page.getByRole('link', { name: 'Go to Home' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test('signIn helper sanity: the new fixture users can sign in', async ({ page }) => {
  await signIn(page, 'assessor');
  await expect(page).toHaveURL(/\/dashboard/);
});

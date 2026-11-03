/** Stage 10 — student engagement, doubts, feedback, activities and project review in the browser. */
import { test, expect } from '@playwright/test';
import { admin, resetData, signInAs } from './fixtures';

test.beforeEach(resetData);

const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

test('student sees a streak from recorded learning, asks a doubt; the instructor answers; the student resolves it', async ({ browser }) => {
  const { db } = admin();
  for (const n of [0, 1]) await db.doc(`progress/e2e_stu_x${n}`).set({ orgId: 'e2e_org', courseId: 'e2e_course', lessonId: `x${n}`, studentId: 'e2e_stu', batchId: 'e2e_batch', status: 'completed', completedAt: day(n), updatedAt: day(n) });
  const stu = await browser.newPage();
  await signInAs(stu, 'stu');
  await stu.goto('/dashboard/overview');
  await expect(stu.getByText('Learning streak')).toBeVisible();
  await expect(stu.getByText(/New achievement: First Lesson Completed/)).toBeVisible();
  await stu.getByRole('link', { name: 'Ask a doubt' }).first().click();
  await stu.getByRole('button', { name: 'Ask a doubt' }).click();
  await stu.locator('#dq-course').selectOption('e2e_course');
  await stu.locator('#dq-title').fill('Why does my loop never stop?');
  await stu.locator('#dq-body').fill('My while loop keeps running even after the counter reaches ten.');
  await stu.getByRole('button', { name: 'Ask your instructors' }).click();
  await expect(stu.getByRole('heading', { name: 'Why does my loop never stop?' }).last()).toBeVisible();

  const inst = await browser.newPage();
  await signInAs(inst, 'inst');
  await inst.goto('/dashboard/doubts');
  await inst.getByRole('link', { name: /Why does my loop never stop\?/ }).click();
  await inst.locator('#reply').fill('Check that you increment the counter inside the loop.');
  await inst.getByRole('button', { name: 'Send reply' }).click();
  await expect(inst.getByText('Check that you increment the counter inside the loop.')).toBeVisible();

  await stu.reload();
  await expect(stu.getByText('Check that you increment the counter inside the loop.')).toBeVisible();
  await stu.getByRole('button', { name: 'My doubt is resolved' }).click();
  await expect(stu.getByText('This doubt is resolved.')).toBeVisible();
});

test('feedback with a hidden name reaches the instructor without the student’s name', async ({ browser }) => {
  const stu = await browser.newPage();
  await signInAs(stu, 'stu');
  await stu.goto('/dashboard/feedback');
  await stu.locator('#fb-type').selectOption('teaching');
  await stu.locator('#fb-target').selectOption('e2e_batch');
  await stu.getByRole('radio', { name: '4 stars' }).click();
  await stu.getByRole('button', { name: 'Helpful examples' }).click();
  await stu.locator('#fb-comment').fill('The worked examples really help.');
  await stu.getByText('Hide my name from staff.').click();
  await stu.getByRole('button', { name: 'Send feedback' }).click();
  await expect(stu.getByText('Thank you — your feedback was sent.')).toBeVisible();
  const inst = await browser.newPage();
  await signInAs(inst, 'inst');
  await inst.goto('/dashboard/feedback');
  const card = inst.locator('li', { hasText: 'The worked examples really help.' });
  await expect(card).toContainText('Name hidden by the student');
  await expect(card).not.toContainText('E2E stu');
  await expect(inst.getByText(/average shown from 3 ratings/)).toBeVisible();
});

test('a branch manager creates an activity and a student registers for it', async ({ browser }) => {
  const ba = await browser.newPage();
  await signInAs(ba, 'ba');
  await ba.goto('/dashboard/activities');
  await ba.getByRole('button', { name: 'New activity' }).click();
  await ba.locator('#af-title').fill('Git workshop');
  const local = (h: number) => { const d = new Date(Date.now() + h * 3600_000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  await ba.locator('#af-start').fill(local(72));
  await ba.locator('#af-end').fill(local(74));
  await ba.locator('#af-dl').fill(local(48));
  await ba.locator('#af-cap').fill('20');
  await ba.locator('#af-org').fill('E2E inst');
  await ba.getByRole('button', { name: 'Create activity' }).click();
  await expect(ba.getByText('Activity created.')).toBeVisible();
  const stu = await browser.newPage();
  await signInAs(stu, 'stu');
  await stu.goto('/dashboard/activities');
  const card = stu.locator('li', { hasText: 'Git workshop' });
  await expect(card).toContainText('20 of 20 seats left');
  await card.getByRole('button', { name: 'Register' }).click();
  await expect(stu.getByText('You’re registered for “Git workshop”.')).toBeVisible();
  await expect(card).toContainText('19 of 20 seats left');
});

test('a project is verified only after the instructor approves it', async ({ browser }) => {
  const stu = await browser.newPage();
  await signInAs(stu, 'stu');
  await stu.goto('/dashboard/portfolio');
  await stu.getByRole('button', { name: 'Add project' }).click();
  await stu.locator('#pf-title').fill('Weather app');
  await stu.locator('#pf-desc').fill('Shows the forecast using a public API.');
  await stu.locator('#pf-repo').fill('https://github.com/example/weather');
  await stu.getByRole('button', { name: 'Save project' }).click();
  const card = stu.locator('.rounded-card', { hasText: 'Weather app' }).filter({ visible: true });
  await expect(card).toContainText('Draft');
  await card.getByRole('button', { name: 'Submit for instructor review' }).click();
  await expect(card).toContainText('Submitted for review');
  await expect(card).not.toContainText('Verified by');

  const inst = await browser.newPage();
  await signInAs(inst, 'inst');
  await inst.goto('/dashboard/projects/review');
  const item = inst.locator('li', { hasText: 'Weather app' });
  await item.getByRole('button', { name: 'Approve (verified)' }).click();
  await expect(inst.getByText('Approved “Weather app”.')).toBeVisible();
  await stu.reload();
  await expect(stu.locator('.rounded-card', { hasText: 'Weather app' }).filter({ visible: true })).toContainText('Verified by E2E inst');
});

test('instructor and manager engagement views open; students can’t open the admin view', async ({ browser }) => {
  const inst = await browser.newPage();
  await signInAs(inst, 'inst');
  await inst.goto('/dashboard/teaching');
  await expect(inst.locator('tr', { hasText: 'E2E Batch' })).toBeVisible();
  const ba = await browser.newPage();
  await signInAs(ba, 'ba');
  await ba.goto('/dashboard/engagement');
  await expect(ba.getByText('Current learning streaks')).toBeVisible();
  const stu = await browser.newPage();
  await signInAs(stu, 'stu');
  await stu.goto('/dashboard/engagement');
  await expect(stu.getByText("This area isn't available to you")).toBeVisible();
});

/** Academy operations — browser journeys across students, managers, instructors and the Super Admin. */
import { test, expect } from '@playwright/test';
import { admin, resetData, signInAs } from './fixtures';

test.beforeEach(resetData);

const NOW = '2026-01-01T00:00:00.000Z';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

async function seedPricing() {
  await admin().db.doc('coursePricing/e2e_course').set({
    courseId: 'e2e_course', orgId: 'e2e_org', currency: 'INR', standardFee: 20_000_00, registrationFee: 0, otherFees: [], installmentOptions: [1, 2],
    discountLimits: { branch_admin: 1000, university_admin: 2500 }, available: true, version: 1, approvedById: 'e2e_super', updatedAt: NOW,
  });
}

async function seedActivity(extra: Record<string, unknown> = {}) {
  const { db } = admin();
  await db.doc('assessments/e2e_act').set({
    orgId: 'e2e_org', courseId: 'e2e_course', lessonId: 'e2e_plain', moduleId: 'e2e_mod', kind: 'quiz', title: 'Reading check', description: '', instructions: 'Answer both.',
    questions: [
      { id: 'a1', type: 'mcq_single', prompt: 'Pick B', options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Bravo' }], marks: 2 },
      { id: 'a2', type: 'mcq_multi', prompt: 'Pick A and C', options: [{ id: 'a', text: 'Apple' }, { id: 'b', text: 'Banana' }, { id: 'c', text: 'Cherry' }], marks: 2 },
    ],
    totalMarks: 4, passingPercent: 50, maxAttempts: 2, allowLate: false, allowResubmission: true, negativeMarking: false, resultRelease: 'immediate',
    status: 'published', createdById: 'e2e_inst', createdAt: NOW, updatedAt: NOW, ...extra,
  });
  await db.doc('assessments/e2e_act/key/current').set({ orgId: 'e2e_org', items: [{ questionId: 'a1', correctOptionIds: ['b'] }, { questionId: 'a2', correctOptionIds: ['a', 'c'] }] });
}

test('student — lesson activity at the end of a lesson, scored on the server, visible in My Scores and the dashboard', async ({ page }) => {
  await seedActivity();
  await signInAs(page, 'stu');
  await page.goto('/courses/e2e_course/lessons/e2e_plain');
  await page.getByRole('link', { name: /Reading check/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByLabel('Bravo').check();
  await page.getByLabel('Apple').check();
  await page.getByLabel('Cherry').check();
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Submitted. You scored 4 / 4 — passed.')).toBeVisible();
  await expect(page.getByText('Submission history')).toBeVisible();
  await page.goto('/dashboard/scores');
  await page.getByRole('tab', { name: /Quizzes/ }).click();
  await expect(page.locator('tr', { hasText: 'Reading check' })).toContainText('4 / 4');
  await page.goto('/dashboard/overview');
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  await expect(page.getByText('Recent results')).toBeVisible();
  await expect(page.locator('li', { hasText: 'Reading check' }).first()).toContainText('4/4');
});

test('instructor takes attendance; the student sees it', async ({ browser }) => {
  const inst = await browser.newPage();
  await signInAs(inst, 'inst');
  await inst.goto('/dashboard/attendance');
  await inst.getByRole('button', { name: 'Mark everyone present' }).click();
  await inst.getByRole('button', { name: 'Save attendance' }).click();
  await expect(inst.getByText(/Attendance saved/)).toBeVisible();
  const stu = await browser.newPage();
  await signInAs(stu, 'stu');
  await stu.goto('/dashboard/attendance');
  await expect(stu.getByText('Classes held')).toBeVisible();
  await expect(stu.locator('tr', { hasText: 'Present' })).toHaveCount(1);
});

test('branch manager admits a student, prints the receipt, and records a second payment', async ({ page }) => {
  await seedPricing();
  await signInAs(page, 'ba');
  await page.goto('/dashboard/admissions/new');
  await page.getByLabel('First name').fill('Meera');
  await page.getByLabel('Surname').fill('Joshi');
  await page.getByLabel('Email address').fill('meera.joshi@e2e.test');
  await page.getByLabel('Mobile number').fill('9800011111');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel('Highest qualification').fill('B.Com');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.locator('#course').selectOption('e2e_course');
  await page.getByLabel(/E2E Batch/).check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel('Amount (₹)').fill('5000');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel('Initial password for the student').fill('Welcome-123');
  await page.getByRole('button', { name: 'Confirm admission' }).click();
  await expect(page.getByRole('heading', { name: 'Admission confirmed' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(new RegExp(`E2E-E2E-${today().slice(0, 4)}-0001`))).toBeVisible();
  await page.getByRole('link', { name: 'Print receipt' }).click();
  await expect(page.getByText('Payment receipt')).toBeVisible();
  await expect(page.getByText(/₹5,000\.00/).first()).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: 'Fee account' }).click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Amount (₹)').fill('2500');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Payment recorded\. Receipt/)).toBeVisible();
  await expect(page.getByText('₹12,500.00').first()).toBeVisible(); // balance after 5,000 + 2,500 of 20,000
  const ledger = await admin().db.collection('feeTransactions').where('studentName', '==', 'Meera Joshi').get();
  expect(ledger.size).toBe(2);
});

test('branch manager records an expense; it appears in the history and the financial report', async ({ page }) => {
  await signInAs(page, 'ba');
  await page.goto('/dashboard/expenses');
  await page.getByLabel('What for').fill('Internet bill');
  await page.getByLabel('Category').first().selectOption('builtin_internet');
  await page.getByLabel('Amount (₹)').fill('1499');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText(/Saved ₹1,499\.00/)).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Internet bill' })).toBeVisible();
  await page.goto('/dashboard/reports');
  await expect(page.getByText('Expenses by category')).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Internet / Wi-Fi' })).toContainText('1,499.00');
});

test('Super Admin sees consolidated finance across academies and can export', async ({ page }) => {
  await seedPricing();
  await signInAs(page, 'super');
  await page.goto('/dashboard/finance');
  await page.getByLabel('Academy').selectOption('*');
  await expect(page.getByText('Collected in period')).toBeVisible();
  await page.getByRole('tab', { name: 'Course pricing' }).click();
  await expect(page.getByText('E2E Live Course')).toBeVisible();
  await page.goto('/dashboard/reports');
  await page.getByRole('tab', { name: 'CSV exports' }).click();
  const download = page.waitForEvent('download');
  await page.locator('div', { hasText: /^Student list \(enrollments\)/ }).getByRole('button', { name: 'Download CSV' }).first().click();
  expect((await download).suggestedFilename()).toMatch(/^students-.*\.csv$/);
});

test('student builds a resume with a live preview and saves it', async ({ page }) => {
  await signInAs(page, 'stu');
  await page.goto('/dashboard/resume');
  await page.getByRole('button', { name: 'New resume' }).click();
  await page.getByLabel('Headline').fill('Junior web developer');
  await expect(page.getByText('Junior web developer')).toBeVisible(); // the live preview
  await page.getByRole('button', { name: 'Summary and skills' }).click();
  await page.getByLabel(/Technical skills/).fill('HTML, CSS, JavaScript');
  await expect(page.getByText('HTML · CSS · JavaScript')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved\. You can come back/)).toBeVisible();
  expect((await admin().db.collection('resumes').where('studentId', '==', 'e2e_stu').get()).size).toBe(1);
});

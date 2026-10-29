/** Journey D — quiz security in the real reader, plus direct API probes. */
import { test, expect, type Page } from '@playwright/test';
import { SECRET, admin, collectResponses, idTokenFor, resetData, signInAs } from './fixtures';

test.beforeEach(resetData);

async function answerAll(page: Page, choices: string[]) {
  await page.getByRole('button', { name: /Start Quiz|Retake Quiz/ }).click();
  for (const [i, choice] of choices.entries()) {
    await page.getByLabel(choice).check();
    if (i < choices.length - 1) await page.getByRole('button', { name: 'Next question' }).click();
  }
  await page.getByRole('button', { name: 'Submit answers' }).click();
}

test('a failed attempt is graded on the server and reveals no answers; a quick retake hits the cooldown', async ({ page }) => {
  const seen = collectResponses(page);
  await signInAs(page, 'stu');
  await page.goto('/courses/e2e_course/lessons/e2e_quiz');
  await expect(page.getByText('Which option is right for question one?')).toHaveCount(0);
  await answerAll(page, ['Option A', 'Option B']);
  await expect(page.getByText('You scored 0%')).toBeVisible();
  await expect(page.getByText('Correct answers and explanations unlock once you pass.')).toBeVisible();
  await expect(page.getByText(/attempts? left today/)).toBeVisible();

  await page.getByRole('button', { name: 'Retake quiz' }).click();
  await page.getByLabel('Option B').check();
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByLabel('Option A').check();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText(/Please wait \d+ seconds/)).toBeVisible();

  expect(await page.content()).not.toContain(SECRET);
  for (const body of seen) {
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain('correctOptionId');
  }
  const progress = (await admin().db.doc('progress/e2e_stu_e2e_course_e2e_quiz').get()).data()!;
  expect(progress).toMatchObject({ status: 'in_progress', quiz: { attemptCount: 1, passed: false } });
});

test('passing completes the lesson and only then releases answers and explanations', async ({ page }) => {
  await signInAs(page, 'stu');
  await page.goto('/courses/e2e_course/lessons/e2e_quiz_pass');
  await answerAll(page, ['Option A']);
  await expect(page.getByText('You scored 100%')).toBeVisible();
  await expect(page.getByText('Lesson complete — nicely done.')).toBeVisible();
  await expect(page.getByText(`${SECRET} for q1.`)).toBeVisible();
  const progress = (await admin().db.doc('progress/e2e_stu_e2e_course_e2e_quiz_pass').get()).data()!;
  expect(progress).toMatchObject({ status: 'completed', quiz: { passed: true } });
});

test('a no-quiz lesson is completed by the student', async ({ page }) => {
  await signInAs(page, 'stu');
  await page.goto('/courses/e2e_course/lessons/e2e_plain');
  await page.getByRole('button', { name: 'Mark lesson complete' }).click();
  await expect(page.getByText('Lesson complete — nicely done.')).toBeVisible();
  expect((await admin().db.doc('progress/e2e_stu_e2e_course_e2e_plain').get()).data()).toMatchObject({ status: 'completed' });
});

test('API probes: forged scores, stale versions and missing tokens are refused without leaking answers', async ({ request }) => {
  const token = await idTokenFor('stu');
  const post = (data: unknown, auth = true) => request.post('/api/quiz/attempt', { data, headers: auth ? { Authorization: `Bearer ${token}` } : {} });
  const base = { courseId: 'e2e_course', lessonId: 'e2e_quiz_pass', answers: { q1: 'opt_b' } };
  for (const [body, status] of [
    [{ ...base, score: 100, passed: true }, 400],
    [{ ...base, lessonVersion: 0 }, 409],
    [{ ...base, answers: { q1: 'opt_z' } }, 400],
  ] as const) {
    const res = await post(body);
    expect(res.status(), JSON.stringify(body)).toBe(status);
    expect(await res.text()).not.toContain(SECRET);
  }
  expect((await post(base, false)).status()).toBe(401);
  expect((await admin().db.doc('progress/e2e_stu_e2e_course_e2e_quiz_pass').get()).exists).toBe(false);
});

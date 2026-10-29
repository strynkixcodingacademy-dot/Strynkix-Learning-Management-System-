/**
 * Stage C1 — POST /api/quiz/attempt on the Auth + Firestore emulators, using
 * the real route handler, the Admin SDK and real emulator ID tokens.
 * Covers authentication, enrollment, cross-organization access, malformed and
 * forged submissions, answer-key leakage, pass/fail, attempt limits on the
 * server clock, concurrent requests, retakes and immutable attempt history.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST } from '@/app/api/quiz/attempt/route';
import { getAdminServices } from '@/lib/server/firebase-admin';
import { QuizAttemptError, submitQuizAttempt } from '@/lib/server/quiz-attempts';
import { MAX_ATTEMPTS_PER_DAY, attemptDayKey } from '@/lib/livebook/quiz';
import type { QuizAttemptResult } from '@/types/domain';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();

const EXPLANATIONS = ['Explanation one.', 'Explanation two.', 'Explanation three.', 'Explanation four.', 'Explanation five.'];
const QUESTIONS = ['q1', 'q2', 'q3', 'q4', 'q5'];
const ALL_RIGHT = Object.fromEntries(QUESTIONS.map((q) => [q, 'a']));
/** n correct answers out of five (the rest pick "b"). */
const correct = (n: number) => Object.fromEntries(QUESTIONS.map((q, i) => [q, i < n ? 'a' : 'b']));
const body = (answers: Record<string, string>, extra: Record<string, unknown> = {}) => ({ courseId: 'c_pub', lessonId: 'l_quiz', answers, ...extra });

const quizBlock = (id: string) => ({
  id, type: 'quiz', question: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }],
});
const KEY = {
  orgId: 'org_a', courseId: 'c_pub', lessonId: 'l_quiz', keyVersion: 3, release: 'after_pass',
  items: QUESTIONS.map((q, i) => ({ blockId: q, correctOptionId: 'a', explanation: EXPLANATIONS[i] })),
  updatedById: 'inst', updatedAt: '2026-10-01T00:00:00.000Z',
};

// 2026-10-29 10:00 IST. The academy's day boundary is midnight Asia/Kolkata (18:30 UTC).
const T0 = new Date('2026-10-29T04:30:00.000Z');
const at = (seconds: number) => () => new Date(T0.getTime() + seconds * 1000);

async function clearFirestore() {
  const res = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`clear failed: ${res.status}`);
}

async function idToken(uid: string): Promise<string> {
  const cached = tokens.get(uid);
  if (cached) return cached;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`sign-in failed for ${uid}`);
  tokens.set(uid, json.idToken);
  return json.idToken;
}

async function post(payload: unknown, uid: string | null = 'stu', opts: { raw?: string; authHeader?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.authHeader !== undefined) headers.Authorization = opts.authHeader;
  else if (uid) headers.Authorization = `Bearer ${await idToken(uid)}`;
  const res = await POST(new Request('http://localhost/api/quiz/attempt', { method: 'POST', headers, body: opts.raw ?? JSON.stringify(payload) }));
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: JSON.parse(text) };
}

/** Grades with an injected server clock (limits and day boundaries). */
const submit = async (answers: Record<string, string>, now: () => Date, uid = 'stu') =>
  submitQuizAttempt({ db, auth }, await idToken(uid), body(answers), now);

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as QuizAttemptError;
  }
  throw new Error('expected the attempt to be rejected');
};

/** A response or error must never carry any part of the answer key. */
function expectNoKeyLeak(text: string) {
  for (const e of EXPLANATIONS) expect(text).not.toContain(e);
  expect(text).not.toContain('correctOptionId');
  expect(text).not.toContain('feedback');
}

const progressRef = () => db.doc('progress/stu_c_pub_l_quiz');

/** Server-written state for HTTP tests, which run on the real clock. */
async function seedSummary(attemptCount: number, attemptsToday: number) {
  const now = new Date();
  await progressRef().set({
    id: 'stu_c_pub_l_quiz', orgId: 'org_a', courseId: 'c_pub', moduleId: 'm1', lessonId: 'l_quiz', studentId: 'stu', batchId: 'bt1',
    status: 'in_progress', timeSpentSeconds: 30,
    quiz: {
      attemptCount, bestCorrect: 1, bestPercent: 20, lastCorrect: 1, lastPercent: 20, total: 5, passed: false, keyVersion: 3,
      attemptDay: attemptDayKey(now, 'Asia/Kolkata'), attemptsToday, lastAttemptAt: new Date(now.getTime() - 60_000).toISOString(),
    },
  });
}
const attempts = async () => (await progressRef().collection('quizAttempts').get()).docs;

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  for (const uid of ['stu', 'stu2', 'stu_sus', 'stu_dropped', 'stu_b', 'stu_disabled', 'stu_revoked', 'inst']) {
    await auth.deleteUser(uid).catch(() => undefined);
    tokens.delete(uid);
    await auth.createUser({ uid, email: `${uid}@quiz.test` });
  }
});

beforeEach(async () => {
  await clearFirestore();
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  await put('organizations/org_a', { name: 'Org A', settings: { defaultTimezone: 'Asia/Kolkata' } });
  await put('organizations/org_b', { name: 'Org B' });
  const user = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
    put(`users/${uid}`, { role, orgId: 'org_a', branchId: 'b1', status: 'active', email: `${uid}@quiz.test`, ...extra });
  await user('stu', 'student');
  await user('stu2', 'student');
  await user('stu_sus', 'student', { status: 'suspended' });
  await user('stu_dropped', 'student');
  await user('stu_b', 'student', { orgId: 'org_b' });
  await user('stu_disabled', 'student');
  await user('stu_revoked', 'student');
  await user('inst', 'instructor');

  await put('courses/c_pub', { orgId: 'org_a', title: 'Course', status: 'published' });
  await put('courses/c_draft', { orgId: 'org_a', title: 'Draft', status: 'draft' });
  await put('courses/c_b', { orgId: 'org_b', title: 'Org B course', status: 'published' });
  const lesson = (id: string, extra: Record<string, unknown> = {}) => put(`lessons/${id}`, {
    orgId: 'org_a', courseId: 'c_pub', moduleId: 'm1', title: id, status: 'published',
    blocks: [{ id: 't1', type: 'text', content: 'Read first.' }, ...QUESTIONS.map(quizBlock)], ...extra,
  });
  await lesson('l_quiz');
  await lesson('l_unpub', { status: 'draft' });
  await lesson('l_plain', { blocks: [{ id: 't1', type: 'text', content: 'No quiz.' }] });
  await lesson('l_draftcourse', { courseId: 'c_draft' });
  await lesson('l_b', { orgId: 'org_b', courseId: 'c_b' });
  await put('lessons/l_quiz/answerKey/current', KEY);
  await put('lessons/l_unpub/answerKey/current', { ...KEY, lessonId: 'l_unpub' });
  await put('lessons/l_draftcourse/answerKey/current', { ...KEY, courseId: 'c_draft', lessonId: 'l_draftcourse' });
  await put('lessons/l_b/answerKey/current', { ...KEY, orgId: 'org_b', courseId: 'c_b', lessonId: 'l_b' });

  const enroll = (studentId: string, extra: Record<string, unknown> = {}) => put(`enrollments/c_pub_${studentId}`, {
    orgId: 'org_a', branchId: 'b1', courseId: 'c_pub', batchId: 'bt1', studentId, status: 'active', enrolledAt: '2026-10-01T00:00:00.000Z', ...extra,
  });
  for (const s of ['stu', 'stu_sus', 'stu_disabled', 'stu_revoked']) await enroll(s);
  await enroll('stu_dropped', { status: 'dropped' });
  // A forged cross-org enrollment: stu_b belongs to org_b.
  await enroll('stu_b');
  await put('enrollments/c_draft_stu', { orgId: 'org_a', branchId: 'b1', courseId: 'c_draft', batchId: 'bt2', studentId: 'stu', status: 'active' });
  await put('enrollments/c_b_stu', { orgId: 'org_b', branchId: 'bx', courseId: 'c_b', batchId: 'btb', studentId: 'stu', status: 'active' });
});

describe('authentication', () => {
  it('rejects a missing, malformed or forged token with 401', async () => {
    for (const authHeader of ['', 'Bearer', 'Basic abc', 'Bearer not-a-token', `Bearer ${'x'.repeat(40)}.${'y'.repeat(40)}.z`]) {
      const res = await post(body(ALL_RIGHT), null, { authHeader });
      expect(res.status, authHeader).toBe(401);
      expect(res.json.error).toBe('unauthenticated');
      expectNoKeyLeak(res.text);
    }
    expect((await post(body(ALL_RIGHT), null)).status).toBe(401);
    expect((await progressRef().get()).exists).toBe(false);
  });

  it('rejects disabled accounts and revoked sessions', async () => {
    // A token issued before the account was disabled must stop working.
    await idToken('stu_disabled');
    await auth.updateUser('stu_disabled', { disabled: true });
    expect((await post(body(ALL_RIGHT), 'stu_disabled')).status).toBe(401);
    const stale = await idToken('stu_revoked');
    await new Promise((r) => setTimeout(r, 1100));
    await auth.revokeRefreshTokens('stu_revoked');
    expect((await post(body(ALL_RIGHT), null, { authHeader: `Bearer ${stale}` })).status).toBe(401);
  });
});

describe('authorization and enrollment', () => {
  it('rejects staff, suspended students, unenrolled and dropped students with 403', async () => {
    for (const uid of ['inst', 'stu_sus', 'stu2', 'stu_dropped']) {
      const res = await post(body(ALL_RIGHT), uid);
      expect(res.status, uid).toBe(403);
      expect(res.json.error).toBe('not_allowed');
      expectNoKeyLeak(res.text);
    }
  });

  it('rejects a student of another organization, even with a forged enrollment record', async () => {
    const res = await post(body(ALL_RIGHT), 'stu_b');
    expect(res.status).toBe(403);
    expectNoKeyLeak(res.text);
  });

  it('rejects lessons of another organization, of a draft course, unpublished or not in the course (404)', async () => {
    const cases = [
      { courseId: 'c_b', lessonId: 'l_b' },
      { courseId: 'c_draft', lessonId: 'l_draftcourse' },
      { courseId: 'c_pub', lessonId: 'l_unpub' },
      { courseId: 'c_pub', lessonId: 'l_b' },
      { courseId: 'c_pub', lessonId: 'l_missing' },
    ];
    for (const c of cases) {
      const res = await post({ ...c, answers: ALL_RIGHT });
      expect([403, 404], JSON.stringify(c)).toContain(res.status);
      expectNoKeyLeak(res.text);
    }
  });

  it('a lesson without an answer key is not graded here (404)', async () => {
    const res = await post({ courseId: 'c_pub', lessonId: 'l_plain', answers: { t1: 'a' } });
    expect(res.status).toBe(404);
  });
});

describe('malformed and forged submissions', () => {
  it('rejects bad JSON, oversized bodies and malformed shapes with 400/413 and writes nothing', async () => {
    expect((await post(null, 'stu', { raw: '{not json' })).status).toBe(400);
    expect((await post(null, 'stu', { raw: JSON.stringify({ ...body(ALL_RIGHT), pad: 'x'.repeat(20_000) }) })).status).toBe(413);
    const bad: unknown[] = [
      null, [], 'answers', {},
      { courseId: 'c_pub', lessonId: 'l_quiz' },
      body({}),
      body({ q1: 7 as unknown as string }),
      body(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`q${i}`, 'a']))),
      { courseId: 'c/pub', lessonId: 'l_quiz', answers: ALL_RIGHT },
      { courseId: 'c_pub', lessonId: '../l_quiz', answers: ALL_RIGHT },
    ];
    for (const b of bad) {
      const res = await post(b);
      expect(res.status, JSON.stringify(b)).toBe(400);
      expectNoKeyLeak(res.text);
    }
    expect((await progressRef().get()).exists).toBe(false);
  });

  it('rejects forged score, result, identity and timestamp fields (strict schema)', async () => {
    const forged = [
      { score: 100 }, { passed: true }, { percent: 100 }, { correct: 5 }, { studentId: 'stu2' },
      { orgId: 'org_b' }, { attemptedAt: '2020-01-01T00:00:00.000Z' }, { keyVersion: 1 }, { completed: true },
    ];
    for (const extra of forged) {
      const res = await post(body(correct(0), extra));
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect((await progressRef().get()).exists).toBe(false);
  });

  it('rejects answers to unknown questions, non-quiz blocks or unknown options', async () => {
    const cases: Record<string, string>[] = [{ ...ALL_RIGHT, q9: 'a' }, { t1: 'a' }, { q1: 'z' }, { ...ALL_RIGHT, q2: 'correct' }];
    for (const answers of cases) {
      const res = await post(body(answers));
      expect(res.status, JSON.stringify(answers)).toBe(400);
      expectNoKeyLeak(res.text);
    }
    expect((await progressRef().get()).exists).toBe(false);
  });
});

describe('grading and answer release', () => {
  it('a failing attempt returns only the score: no answers, no explanations', async () => {
    const res = await post(body(correct(2)));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const r = res.json as QuizAttemptResult;
    expect(r).toEqual({ attemptNumber: 1, correct: 2, total: 5, percent: 40, passed: false, lessonCompleted: false, attemptsRemainingToday: MAX_ATTEMPTS_PER_DAY - 1 });
    expectNoKeyLeak(res.text);
    const p = (await progressRef().get()).data()!;
    expect(p.status).toBe('in_progress');
    expect(p.completedAt).toBeUndefined();
    expect(p.quiz).toMatchObject({ attemptCount: 1, lastCorrect: 2, total: 5, passed: false, keyVersion: 3, attemptsToday: 1 });
  });

  it('unanswered questions count as wrong', async () => {
    const r = await submit({ q1: 'a', q2: 'a' }, at(0));
    expect(r).toMatchObject({ correct: 2, total: 5, passed: false });
  });

  it('exactly the pass mark (60%) passes, completes the lesson and releases answers', async () => {
    const res = await post(body(correct(3)));
    const r = res.json as QuizAttemptResult;
    expect(r).toMatchObject({ correct: 3, total: 5, percent: 60, passed: true, lessonCompleted: true, attemptsRemainingToday: null });
    expect(r.feedback).toHaveLength(5);
    expect(r.feedback![0]).toEqual({ blockId: 'q1', yourAnswer: 'a', correctOptionId: 'a', isCorrect: true, explanation: EXPLANATIONS[0] });
    expect(r.feedback![4]).toEqual({ blockId: 'q5', yourAnswer: 'b', correctOptionId: 'a', isCorrect: false, explanation: EXPLANATIONS[4] });
    const p = (await progressRef().get()).data()!;
    expect(p).toMatchObject({ status: 'completed', studentId: 'stu', orgId: 'org_a', courseId: 'c_pub', lessonId: 'l_quiz', moduleId: 'm1', batchId: 'bt1' });
    expect(p.completedAt).toEqual(p.quiz.firstPassedAt);
  });

  it('one below the pass mark fails (key with 3 questions: 1/3 = 33%, 2/3 = 67%)', async () => {
    await db.doc('lessons/l_quiz/answerKey/current').set({ ...KEY, items: KEY.items.slice(0, 3) });
    expect(await submit({ q1: 'a', q2: 'b', q3: 'b' }, at(0))).toMatchObject({ percent: 33, passed: false });
    expect(await submit({ q1: 'a', q2: 'a', q3: 'b' }, at(31))).toMatchObject({ percent: 67, passed: true });
  });

  it('records each attempt with server-derived identity, key version and timestamp', async () => {
    await submit(correct(1), at(0));
    await submit(correct(4), at(45));
    const docs = await attempts();
    expect(docs.map((d) => d.id)).toEqual(['000001', '000002']);
    expect(docs[0].data()).toEqual({
      attemptNumber: 1, studentId: 'stu', orgId: 'org_a', courseId: 'c_pub', lessonId: 'l_quiz', batchId: 'bt1',
      keyVersion: 3, lessonVersion: null, answers: correct(1), correct: 1, total: 5, percent: 20, passed: false, attemptedAt: T0.toISOString(),
    });
    expect(docs[1].data()).toMatchObject({ attemptNumber: 2, correct: 4, passed: true, attemptedAt: at(45)().toISOString() });
  });

  it('keeps time spent and other progress written by the student', async () => {
    await progressRef().set({
      id: 'stu_c_pub_l_quiz', orgId: 'org_a', courseId: 'c_pub', moduleId: 'm1', lessonId: 'l_quiz', studentId: 'stu', batchId: 'bt1',
      status: 'in_progress', timeSpentSeconds: 420, lastAccessedAt: '2026-10-28T00:00:00.000Z', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
    });
    await submit(ALL_RIGHT, at(0));
    const p = (await progressRef().get()).data()!;
    expect(p).toMatchObject({ status: 'completed', timeSpentSeconds: 420, createdAt: '2026-10-28T00:00:00.000Z' });
  });
});

describe('attempt limits (server clock, academy time zone)', () => {
  it('enforces a 30-second cooldown between attempts', async () => {
    await submit(correct(0), at(0));
    const err = await rejects(submit(correct(0), at(10)));
    expect(err).toMatchObject({ status: 429, code: 'cooldown', retryAfterSeconds: 20 });
    expect((await rejects(submit(correct(0), at(29.5)))).code).toBe('cooldown');
    await expect(submit(correct(0), at(30))).resolves.toMatchObject({ attemptNumber: 2 });
  });

  it('the HTTP response carries Retry-After and no key material', async () => {
    await post(body(correct(0)));
    const res = await post(body(correct(0)));
    expect(res.status).toBe(429);
    expect(res.json.error).toBe('cooldown');
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expectNoKeyLeak(res.text);
  });

  it(`allows at most ${MAX_ATTEMPTS_PER_DAY} attempts per lesson per academy day`, async () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_DAY; i++) {
      const r = await submit(correct(1), at(i * 31));
      expect(r.attemptsRemainingToday).toBe(MAX_ATTEMPTS_PER_DAY - 1 - i);
    }
    const err = await rejects(submit(correct(1), at(MAX_ATTEMPTS_PER_DAY * 31)));
    expect(err).toMatchObject({ status: 429, code: 'daily_limit' });
    // Next attempt opens at midnight IST (18:30 UTC), 14 hours after T0.
    expect(err.retryAfterSeconds).toBeGreaterThan(13 * 3600);
    expect(err.retryAfterSeconds).toBeLessThanOrEqual(14 * 3600);
    expect((await attempts()).length).toBe(MAX_ATTEMPTS_PER_DAY);
  });

  it('the day boundary is midnight in the academy time zone, not UTC', async () => {
    const day = (iso: string) => () => new Date(iso);
    // 18:00 UTC is 23:30 IST on the 29th; use up the day.
    for (let i = 0; i < MAX_ATTEMPTS_PER_DAY; i++) await submit(correct(1), () => new Date(Date.parse('2026-10-29T17:00:00.000Z') + i * 31_000));
    expect((await rejects(submit(correct(1), day('2026-10-29T18:29:00.000Z')))).code).toBe('daily_limit');
    // 18:31 UTC is 00:01 IST on the 30th — a new academy day, though still the 29th in UTC.
    await expect(submit(correct(1), day('2026-10-29T18:31:00.000Z'))).resolves.toMatchObject({ attemptsRemainingToday: MAX_ATTEMPTS_PER_DAY - 1 });
  });

  it('the summary records the attempt day and time from the server clock', async () => {
    await submit(correct(0), at(0));
    const p = (await progressRef().get()).data()!;
    expect(p.quiz).toMatchObject({ attemptDay: '2026-10-29', attemptsToday: 1, lastAttemptAt: T0.toISOString() });
  });
});

describe('concurrency', () => {
  it('parallel submissions cannot bypass the cooldown: exactly one is graded', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => submit(correct(0), at(0))));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    for (const r of refused) expect(r.reason).toMatchObject({ status: 429, code: 'cooldown' });
    expect((await attempts()).length).toBe(1);
    expect((await progressRef().get()).data()!.quiz.attemptCount).toBe(1);
  });

  it('parallel HTTP requests at the daily limit cannot exceed it', async () => {
    await seedSummary(MAX_ATTEMPTS_PER_DAY - 1, MAX_ATTEMPTS_PER_DAY - 1);
    const results = await Promise.all(Array.from({ length: 5 }, () => post(body(correct(1)))));
    // The route uses the real clock; only the first can pass both the cooldown and the remaining slot.
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 429)).toHaveLength(4);
    const p = (await progressRef().get()).data()!;
    expect((await attempts()).length).toBe(1);
    expect(p.quiz).toMatchObject({ attemptCount: MAX_ATTEMPTS_PER_DAY, attemptsToday: MAX_ATTEMPTS_PER_DAY });
  });
});

describe('retakes after completion', () => {
  it('a completed lesson can be retaken without limits and is never downgraded', async () => {
    const first = await submit(ALL_RIGHT, at(0));
    expect(first.lessonCompleted).toBe(true);
    const completedAt = (await progressRef().get()).data()!.completedAt;
    // Immediately, repeatedly, beyond the daily limit, and failing each time.
    for (let i = 1; i <= MAX_ATTEMPTS_PER_DAY + 2; i++) {
      const r = await submit(correct(0), at(i));
      expect(r).toMatchObject({ passed: false, lessonCompleted: true, attemptsRemainingToday: null });
      // Answers stay released once passed.
      expect(r.feedback).toHaveLength(5);
    }
    const p = (await progressRef().get()).data()!;
    expect(p.status).toBe('completed');
    expect(p.completedAt).toBe(completedAt);
    expect(p.quiz).toMatchObject({ passed: true, bestPercent: 100, lastPercent: 0, firstPassedAt: T0.toISOString(), attemptCount: MAX_ATTEMPTS_PER_DAY + 3 });
  });

  it('a lesson completed before C1 (legacy flow) is not downgraded by a failed attempt', async () => {
    await progressRef().set({
      id: 'stu_c_pub_l_quiz', orgId: 'org_a', courseId: 'c_pub', moduleId: 'm1', lessonId: 'l_quiz', studentId: 'stu', batchId: 'bt1',
      status: 'completed', completedAt: '2026-10-01T00:00:00.000Z', timeSpentSeconds: 60,
    });
    const r = await submit(correct(0), at(0));
    expect(r).toMatchObject({ passed: false, lessonCompleted: true });
    // Never passed this quiz on the server: no answers released.
    expect(r.feedback).toBeUndefined();
    expect((await progressRef().get()).data()).toMatchObject({ status: 'completed', completedAt: '2026-10-01T00:00:00.000Z' });
  });
});

describe('attempt history integrity', () => {
  it('an existing attempt is never overwritten; the conflicting submission fails without leaking', async () => {
    await seedSummary(1, 1);
    const planted = { attemptNumber: 2, planted: true };
    await progressRef().collection('quizAttempts').doc('000002').set(planted);
    const res = await post(body(ALL_RIGHT));
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: 'unavailable', message: 'Quiz grading is unavailable right now. Try again later.' });
    expectNoKeyLeak(res.text);
    expect((await progressRef().collection('quizAttempts').doc('000002').get()).data()).toEqual(planted);
    const p = (await progressRef().get()).data()!;
    expect(p.status).toBe('in_progress');
    expect(p.quiz.attemptCount).toBe(1);
  });
});

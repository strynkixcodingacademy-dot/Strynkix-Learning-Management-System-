/**
 * Stage C1 — quiz key split/merge, grading, attempt limits and the server
 * Admin configuration guard (pure functions; no emulator).
 */

import { describe, it, expect } from 'vitest';
import {
  ATTEMPT_COOLDOWN_SECONDS, MAX_ATTEMPTS_PER_DAY, QUIZ_PASS_PERCENT,
  attemptDayKey, checkAttemptLimit, gradeAnswers, hasInlineAnswers, mergeQuizAnswers, secondsUntilNextDay, splitQuizAnswers,
} from '@/lib/livebook/quiz';
import { assertSafeAdminConfig, PRODUCTION_PROJECT_ID } from '@/lib/server/firebase-admin';
import { lessonAnswerKeySchema, lessonBlockSchema, quizAttemptRequestSchema, quizAuthoringSchema } from '@/types/validation';
import { LessonBlock, QuizBlock } from '@/types/domain';

const q = (id: string, correctOptionId?: string, explanation?: string): QuizBlock => ({
  id, type: 'quiz', question: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
  ...(correctOptionId !== undefined ? { correctOptionId } : {}),
  ...(explanation !== undefined ? { explanation } : {}),
});
const text: LessonBlock = { id: 't1', type: 'text', content: 'Hello' };

describe('splitQuizAnswers / mergeQuizAnswers', () => {
  it('strips every answer-bearing field and keeps question order', () => {
    const { blocks, items } = splitQuizAnswers([text, q('q1', 'a', 'Because A.'), q('q2', 'b', 'Because B.')]);
    expect(items).toEqual([
      { blockId: 'q1', correctOptionId: 'a', explanation: 'Because A.' },
      { blockId: 'q2', correctOptionId: 'b', explanation: 'Because B.' },
    ]);
    expect(blocks[0]).toBe(text);
    for (const b of blocks.slice(1)) {
      expect(b).not.toHaveProperty('correctOptionId');
      expect(b).not.toHaveProperty('explanation');
    }
    expect(JSON.stringify(blocks)).not.toContain('Because');
    expect(hasInlineAnswers(blocks)).toBe(false);
  });

  it('strips a stray explanation even without a correct answer', () => {
    const { blocks, items } = splitQuizAnswers([{ ...q('q1'), explanation: 'Leaky' }]);
    expect(items).toEqual([]);
    expect(JSON.stringify(blocks)).not.toContain('Leaky');
  });

  it('refuses more than 20 questions', () => {
    expect(() => splitQuizAnswers(Array.from({ length: 21 }, (_, i) => q(`q${i}`, 'a', 'Because.')))).toThrow();
  });

  it('round-trips for authors', () => {
    const authored = [text, q('q1', 'a', 'Because A.'), q('q2', 'b', 'Because B.')];
    const { blocks, items } = splitQuizAnswers(authored);
    expect(mergeQuizAnswers(blocks, { items })).toEqual(authored);
    expect(mergeQuizAnswers(blocks, null)).toEqual(blocks);
  });

  it('detects legacy inline-answer lessons', () => {
    expect(hasInlineAnswers([text, q('q1', 'a', 'x')])).toBe(true);
    expect(hasInlineAnswers([text, q('q1')])).toBe(false);
    expect(hasInlineAnswers(undefined)).toBe(false);
  });
});

describe('gradeAnswers', () => {
  const key = { items: ['q1', 'q2', 'q3', 'q4', 'q5'].map((blockId) => ({ blockId, correctOptionId: 'a', explanation: 'x' })) };
  it(`passes at exactly ${QUIZ_PASS_PERCENT}% and fails just below`, () => {
    expect(gradeAnswers(key, { q1: 'a', q2: 'a', q3: 'a' })).toEqual({ correct: 3, total: 5, percent: 60, passed: true });
    expect(gradeAnswers(key, { q1: 'a', q2: 'a', q3: 'b' })).toEqual({ correct: 2, total: 5, percent: 40, passed: false });
  });
  it('uses exact integer comparison (2/3 passes, 1/3 fails; rounding never decides)', () => {
    const three = { items: key.items.slice(0, 3) };
    expect(gradeAnswers(three, { q1: 'a', q2: 'a' })).toMatchObject({ percent: 67, passed: true });
    expect(gradeAnswers(three, { q1: 'a' })).toMatchObject({ percent: 33, passed: false });
  });
  it('ignores unknown questions and an empty key never passes', () => {
    expect(gradeAnswers(key, { zz: 'a' })).toMatchObject({ correct: 0, passed: false });
    expect(gradeAnswers({ items: [] }, {})).toEqual({ correct: 0, total: 0, percent: 0, passed: false });
  });
});

describe('attempt limits', () => {
  const now = new Date('2026-10-29T04:30:00.000Z');
  const summary = (secondsAgo: number, attemptsToday: number, attemptDay = '2026-10-29') => ({
    attemptDay, attemptsToday, lastAttemptAt: new Date(now.getTime() - secondsAgo * 1000).toISOString(),
  });

  it('the first attempt is allowed', () => {
    expect(checkAttemptLimit({ summary: undefined, completed: false, now })).toEqual({ allowed: true, attemptsToday: 1 });
  });
  it(`enforces a ${ATTEMPT_COOLDOWN_SECONDS}s cooldown`, () => {
    expect(checkAttemptLimit({ summary: summary(10, 1), completed: false, now, timeZone: 'Asia/Kolkata' }))
      .toEqual({ allowed: false, reason: 'cooldown', retryAfterSeconds: 20 });
    expect(checkAttemptLimit({ summary: summary(30, 1), completed: false, now, timeZone: 'Asia/Kolkata' }).allowed).toBe(true);
  });
  it('a future lastAttemptAt (clock skew or tampering) still means cooldown', () => {
    expect(checkAttemptLimit({ summary: summary(-600, 1), completed: false, now }).allowed).toBe(false);
  });
  it(`allows ${MAX_ATTEMPTS_PER_DAY} attempts per academy day`, () => {
    expect(checkAttemptLimit({ summary: summary(60, MAX_ATTEMPTS_PER_DAY - 1), completed: false, now, timeZone: 'Asia/Kolkata' }))
      .toEqual({ allowed: true, attemptsToday: MAX_ATTEMPTS_PER_DAY });
    const refused = checkAttemptLimit({ summary: summary(60, MAX_ATTEMPTS_PER_DAY), completed: false, now, timeZone: 'Asia/Kolkata' });
    expect(refused).toMatchObject({ allowed: false, reason: 'daily_limit' });
  });
  it('the count resets on a new academy day', () => {
    expect(checkAttemptLimit({ summary: summary(60, MAX_ATTEMPTS_PER_DAY, '2026-10-28'), completed: false, now, timeZone: 'Asia/Kolkata' }))
      .toEqual({ allowed: true, attemptsToday: 1 });
  });
  it('completed lessons are never limited', () => {
    expect(checkAttemptLimit({ summary: summary(0, 99), completed: true, now })).toMatchObject({ allowed: true });
  });
});

describe('academy day boundary', () => {
  it('uses the academy time zone with a UTC fallback', () => {
    const lateUtc = new Date('2026-10-29T18:31:00.000Z');
    expect(attemptDayKey(lateUtc, 'Asia/Kolkata')).toBe('2026-10-30');
    expect(attemptDayKey(lateUtc)).toBe('2026-10-29');
    expect(attemptDayKey(lateUtc, 'Not/AZone')).toBe('2026-10-29');
  });
  it('computes the wait until midnight, including across DST changes', () => {
    expect(secondsUntilNextDay(new Date('2026-10-29T18:00:00.000Z'), 'Asia/Kolkata')).toBe(1800);
    // America/New_York leaves DST on 2026-11-01: that day has 25 hours.
    expect(secondsUntilNextDay(new Date('2026-11-01T04:00:00.000Z'), 'America/New_York')).toBe(25 * 3600);
    expect(secondsUntilNextDay(new Date('2026-10-29T23:59:30.000Z'))).toBe(60);
  });
});

describe('schemas', () => {
  it('student-facing quiz blocks may omit answers; authoring requires them', () => {
    expect(lessonBlockSchema.safeParse(q('q1')).success).toBe(true);
    expect(lessonBlockSchema.safeParse(q('q1', 'z', 'Because.')).success).toBe(false);
    expect(lessonBlockSchema.safeParse(q('q1', 'a')).success).toBe(false);
    expect(quizAuthoringSchema.safeParse(q('q1')).success).toBe(false);
    expect(quizAuthoringSchema.safeParse(q('q1', 'a', 'Because A.')).success).toBe(true);
  });
  it('the attempt request accepts only course, lesson and answers', () => {
    const ok = { courseId: 'c1', lessonId: 'l1', answers: { q1: 'a' } };
    expect(quizAttemptRequestSchema.safeParse(ok).success).toBe(true);
    for (const extra of [{ score: 100 }, { passed: true }, { studentId: 'x' }, { orgId: 'o' }]) {
      expect(quizAttemptRequestSchema.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
    expect(quizAttemptRequestSchema.safeParse({ ...ok, answers: {} }).success).toBe(false);
  });
  it('the answer key is strict and release is after_pass only', () => {
    const k = { orgId: 'o', courseId: 'c', lessonId: 'l', keyVersion: 1, release: 'after_pass', items: [], updatedById: 'u', updatedAt: '2026-10-29T00:00:00.000Z' };
    expect(lessonAnswerKeySchema.safeParse(k).success).toBe(true);
    expect(lessonAnswerKeySchema.safeParse({ ...k, release: 'immediately' }).success).toBe(false);
    expect(lessonAnswerKeySchema.safeParse({ ...k, extra: 1 }).success).toBe(false);
    const dup = { blockId: 'q1', correctOptionId: 'a', explanation: 'Because.' };
    expect(lessonAnswerKeySchema.safeParse({ ...k, items: [dup, dup] }).success).toBe(false);
  });
});

describe('server Admin configuration guard', () => {
  const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
  it('emulator mode needs no credentials but requires the Auth emulator too', () => {
    expect(assertSafeAdminConfig(env({ FIREBASE_ADMIN_PROJECT_ID: 'demo-x', FIRESTORE_EMULATOR_HOST: 'h:1', FIREBASE_AUTH_EMULATOR_HOST: 'h:2' })))
      .toEqual({ projectId: 'demo-x', emulator: true });
    expect(() => assertSafeAdminConfig(env({ FIREBASE_ADMIN_PROJECT_ID: 'demo-x', FIRESTORE_EMULATOR_HOST: 'h:1' }))).toThrow();
  });
  it('refuses the production project unless explicitly enabled', () => {
    const creds = { FIREBASE_ADMIN_CLIENT_EMAIL: 'svc@example.test', FIREBASE_ADMIN_PRIVATE_KEY: 'placeholder' };
    expect(() => assertSafeAdminConfig(env({ FIREBASE_ADMIN_PROJECT_ID: PRODUCTION_PROJECT_ID, ...creds }))).toThrow(/production/);
    expect(() => assertSafeAdminConfig(env({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: PRODUCTION_PROJECT_ID, ...creds }))).toThrow(/production/);
  });
  it('requires staging credentials outside the emulators', () => {
    expect(() => assertSafeAdminConfig(env({ FIREBASE_ADMIN_PROJECT_ID: 'strynkix-live-books-staging' }))).toThrow(/credentials/);
    expect(() => assertSafeAdminConfig(env({}))).toThrow(/project/);
  });
});

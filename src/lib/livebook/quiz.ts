/**
 * Strynkix Live Books — quiz keys, grading and attempt limits (Stage C1).
 * Pure functions shared by the server route, the Block Studio, the seed and the
 * future migration. Only the server ever grades a keyed lesson.
 */

import { AnswerKeyItem, LessonAnswerKey, LessonBlock, QuizBlock, QuizSummary } from '@/types/domain';
import { MAX_QUIZ_QUESTIONS } from '@/types/validation';

export const QUIZ_PASS_PERCENT = 60;
export const ATTEMPT_COOLDOWN_SECONDS = 30;
export const MAX_ATTEMPTS_PER_DAY = 10;

const isQuiz = (b: LessonBlock): b is QuizBlock => b.type === 'quiz';

/** A lesson whose quiz questions still carry their answers inline (pre-C1 format). */
export function hasInlineAnswers(blocks: LessonBlock[] | undefined): boolean {
  return (blocks ?? []).some((b) => isQuiz(b) && (b.correctOptionId !== undefined || b.explanation !== undefined));
}

/**
 * Splits authored blocks into student-safe blocks (questions and options only)
 * and the confidential answer-key items. Order of questions is preserved.
 */
export function splitQuizAnswers(blocks: LessonBlock[]): { blocks: LessonBlock[]; items: AnswerKeyItem[] } {
  const items: AnswerKeyItem[] = [];
  const safe = blocks.map((b) => {
    if (!isQuiz(b)) return b;
    if (b.correctOptionId !== undefined) {
      items.push({ blockId: b.id, correctOptionId: b.correctOptionId, explanation: b.explanation ?? '' });
    }
    // Strip every answer-bearing field, whether or not it was set.
    const { correctOptionId: _c, explanation: _e, ...question } = b;
    void _c;
    void _e;
    return question as QuizBlock;
  });
  if (items.length > MAX_QUIZ_QUESTIONS) throw new Error(`A lesson can have at most ${MAX_QUIZ_QUESTIONS} quiz questions.`);
  return { blocks: safe, items };
}

/**
 * Answer key carried inline by a lesson saved before C1 (Stage C4), or null
 * when the inline answers are missing, partial or invalid. Used only on the
 * server, so legacy lessons are graded there too until they are migrated.
 */
export function inlineAnswerKey(blocks: LessonBlock[] | undefined): AnswerKeyItem[] | null {
  const questions = (blocks ?? []).filter(isQuiz);
  if (questions.length === 0 || questions.length > MAX_QUIZ_QUESTIONS) return null;
  const items: AnswerKeyItem[] = [];
  for (const q of questions) {
    if (typeof q.correctOptionId !== 'string' || typeof q.explanation !== 'string') return null;
    if (!q.options.some((o) => o.id === q.correctOptionId)) return null;
    items.push({ blockId: q.id, correctOptionId: q.correctOptionId, explanation: q.explanation });
  }
  return new Set(items.map((i) => i.blockId)).size === items.length ? items : null;
}

/** Re-attaches answers for authors (Block Studio editing and preview only). */
export function mergeQuizAnswers(blocks: LessonBlock[], key: Pick<LessonAnswerKey, 'items'> | null): LessonBlock[] {
  if (!key) return blocks;
  const byId = new Map(key.items.map((i) => [i.blockId, i]));
  return blocks.map((b) => {
    if (!isQuiz(b) || b.correctOptionId !== undefined) return b;
    const item = byId.get(b.id);
    return item ? { ...b, correctOptionId: item.correctOptionId, explanation: item.explanation } : b;
  });
}

export interface GradeResult {
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
}

/** Grades answers against the key. Unknown question IDs score nothing. */
export function gradeAnswers(key: Pick<LessonAnswerKey, 'items'>, answers: Record<string, string>): GradeResult {
  const total = key.items.length;
  const correct = key.items.filter((i) => answers[i.blockId] === i.correctOptionId).length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, percent, passed: total > 0 && correct * 100 >= QUIZ_PASS_PERCENT * total };
}

/** Calendar day (YYYY-MM-DD) in the academy's time zone; falls back to UTC. */
export function attemptDayKey(now: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export type LimitDecision =
  | { allowed: true; attemptsToday: number }
  | { allowed: false; reason: 'cooldown' | 'daily_limit'; retryAfterSeconds: number };

/**
 * Decides whether a new attempt may be graded, from the server-held summary and
 * the server clock. Completed lessons may be retaken without limits.
 */
export function checkAttemptLimit(params: {
  summary: Pick<QuizSummary, 'attemptDay' | 'attemptsToday' | 'lastAttemptAt'> | undefined;
  completed: boolean;
  now: Date;
  timeZone?: string;
}): LimitDecision {
  const { summary, completed, now, timeZone } = params;
  const today = attemptDayKey(now, timeZone);
  const usedToday = summary && summary.attemptDay === today ? summary.attemptsToday : 0;
  if (completed) return { allowed: true, attemptsToday: usedToday + 1 };
  if (summary?.lastAttemptAt) {
    const elapsed = (now.getTime() - new Date(summary.lastAttemptAt).getTime()) / 1000;
    if (elapsed < ATTEMPT_COOLDOWN_SECONDS) {
      return { allowed: false, reason: 'cooldown', retryAfterSeconds: Math.max(1, Math.ceil(ATTEMPT_COOLDOWN_SECONDS - elapsed)) };
    }
  }
  if (usedToday >= MAX_ATTEMPTS_PER_DAY) {
    return { allowed: false, reason: 'daily_limit', retryAfterSeconds: secondsUntilNextDay(now, timeZone) };
  }
  return { allowed: true, attemptsToday: usedToday + 1 };
}

/** Seconds until the next calendar day starts in the given zone (at least 60). */
export function secondsUntilNextDay(now: Date, timeZone?: string): number {
  const today = attemptDayKey(now, timeZone);
  let lo = now.getTime();
  let hi = lo + 26 * 3600_000;
  // Binary search the first instant whose day key differs (DST-safe, no tz maths).
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (attemptDayKey(new Date(mid), timeZone) === today) lo = mid;
    else hi = mid;
  }
  return Math.max(60, Math.ceil((hi - now.getTime()) / 1000));
}

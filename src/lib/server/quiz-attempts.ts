/**
 * Strynkix LMS — server-side quiz grading (Stage C1).
 *
 * Trusts nothing from the client except the ID token (verified here) and the
 * submitted answers. Identity, role, org, enrollment, publication, the answer
 * key, the score, timestamps and attempt limits are all derived on the server.
 * Everything is read and written in one Firestore transaction, so concurrent
 * or replayed requests serialise and cannot bypass the limits.
 *
 * Answer release (policy 'after_pass'): correct answers and explanations are
 * returned only once the student has passed this lesson's quiz. Before that,
 * a response carries only the score and pass/fail.
 */

import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { LessonAnswerKey, LessonBlock, Progress, QuizAttempt, QuizAttemptResult, QuizBlock, QuizSummary } from '@/types/domain';
import { quizAttemptRequestSchema } from '@/types/validation';
import { MAX_ATTEMPTS_PER_DAY, attemptDayKey, checkAttemptLimit, gradeAnswers, inlineAnswerKey } from '@/lib/livebook/quiz';

export class QuizAttemptError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
  }
}

const deny = () => new QuizAttemptError(403, 'not_allowed', 'You can’t take this quiz.');
const notFound = () => new QuizAttemptError(404, 'not_found', 'This quiz isn’t available.');

/** Extracts the bearer token from an Authorization header. */
export function bearerToken(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

export async function submitQuizAttempt(
  services: { db: Firestore; auth: Auth },
  idToken: string | null,
  body: unknown,
  now: () => Date = () => new Date()
): Promise<QuizAttemptResult> {
  if (!idToken) throw new QuizAttemptError(401, 'unauthenticated', 'Sign in to submit the quiz.');
  let uid: string;
  try {
    // checkRevoked also rejects disabled accounts.
    uid = (await services.auth.verifyIdToken(idToken, true)).uid;
  } catch {
    throw new QuizAttemptError(401, 'unauthenticated', 'Your session has expired. Sign in again.');
  }

  const parsed = quizAttemptRequestSchema.safeParse(body);
  if (!parsed.success) throw new QuizAttemptError(400, 'invalid_request', 'The quiz submission is malformed.');
  const { courseId, lessonId, answers, lessonVersion } = parsed.data;
  const { db } = services;

  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(db.doc(`users/${uid}`));
    const user = userSnap.data();
    if (!user || user.role !== 'student' || (user.status ?? 'active') !== 'active' || typeof user.orgId !== 'string') throw deny();
    const orgId: string = user.orgId;

    const progressId = `${uid}_${courseId}_${lessonId}`;
    const [enrollmentSnap, courseSnap, lessonSnap, keySnap, progressSnap, orgSnap] = await Promise.all([
      tx.get(db.doc(`enrollments/${courseId}_${uid}`)),
      tx.get(db.doc(`courses/${courseId}`)),
      tx.get(db.doc(`lessons/${lessonId}`)),
      tx.get(db.doc(`lessons/${lessonId}/answerKey/current`)),
      tx.get(db.doc(`progress/${progressId}`)),
      tx.get(db.doc(`organizations/${orgId}`)),
    ]);

    const enrollment = enrollmentSnap.data();
    if (
      !enrollment || enrollment.studentId !== uid || enrollment.courseId !== courseId || enrollment.orgId !== orgId ||
      !['active', 'completed'].includes(enrollment.status) || typeof enrollment.batchId !== 'string'
    ) throw deny();

    const course = courseSnap.data();
    const lesson = lessonSnap.data();
    if (!course || course.orgId !== orgId || course.status !== 'published') throw notFound();
    if (!lesson || lesson.orgId !== orgId || lesson.courseId !== courseId || lesson.status !== 'published') throw notFound();
    // The questions answered must be the ones being graded (Stage C3).
    const liveVersion = typeof lesson.publishedVersion === 'number' ? lesson.publishedVersion : null;
    if (lessonVersion !== undefined && lessonVersion !== liveVersion) {
      throw new QuizAttemptError(409, 'lesson_updated', 'This lesson was updated. Reload it to take the latest quiz.');
    }

    const stored = keySnap.data() as LessonAnswerKey | undefined;
    // Lessons not yet migrated (C4) still carry their answers inline; grade
    // them here too (key version 0) so no quiz is ever graded in the browser.
    const legacy = stored ? null : inlineAnswerKey(lesson.blocks as LessonBlock[]);
    const key: Pick<LessonAnswerKey, 'orgId' | 'courseId' | 'lessonId' | 'keyVersion' | 'items'> | undefined = stored
      ?? (legacy ? { orgId, courseId, lessonId, keyVersion: 0, items: legacy } : undefined);
    if (!key || key.orgId !== orgId || key.courseId !== courseId || key.lessonId !== lessonId || !Array.isArray(key.items) || key.items.length === 0) {
      throw notFound();
    }

    // Every answer must name a question of this quiz and one of its options.
    const questions = new Map(
      ((lesson.blocks ?? []) as LessonBlock[]).filter((b): b is QuizBlock => b.type === 'quiz').map((q) => [q.id, q])
    );
    const keyed = new Set(key.items.map((i) => i.blockId));
    for (const [blockId, optionId] of Object.entries(answers)) {
      const q = questions.get(blockId);
      if (!keyed.has(blockId) || !q || !q.options.some((o) => o.id === optionId)) {
        throw new QuizAttemptError(400, 'invalid_request', 'The quiz submission is malformed.');
      }
    }

    const progress = progressSnap.data() as Progress | undefined;
    const completedBefore = progress?.status === 'completed';
    const at = now();
    const timeZone = orgSnap.data()?.settings?.defaultTimezone as string | undefined;
    const limit = checkAttemptLimit({ summary: progress?.quiz, completed: completedBefore, now: at, timeZone });
    if (!limit.allowed) {
      throw limit.reason === 'cooldown'
        ? new QuizAttemptError(429, 'cooldown', `Please wait ${limit.retryAfterSeconds} seconds before trying again.`, limit.retryAfterSeconds)
        : new QuizAttemptError(429, 'daily_limit', `You’ve used all ${MAX_ATTEMPTS_PER_DAY} attempts for today. Try again tomorrow.`, limit.retryAfterSeconds);
    }

    const grade = gradeAnswers(key, answers);
    const attemptNumber = (progress?.quiz?.attemptCount ?? 0) + 1;
    const iso = at.toISOString();
    const completedAfter = completedBefore || grade.passed;
    const everPassed = Boolean(progress?.quiz?.passed) || grade.passed;

    const attempt: QuizAttempt = {
      attemptNumber, studentId: uid, orgId, courseId, lessonId, batchId: enrollment.batchId,
      keyVersion: key.keyVersion, lessonVersion: liveVersion,
      answers, correct: grade.correct, total: grade.total,
      percent: grade.percent, passed: grade.passed, attemptedAt: iso,
    };
    const prev = progress?.quiz;
    const summary: QuizSummary = {
      attemptCount: attemptNumber,
      bestCorrect: Math.max(prev?.bestCorrect ?? 0, grade.correct),
      bestPercent: Math.max(prev?.bestPercent ?? 0, grade.percent),
      lastCorrect: grade.correct,
      lastPercent: grade.percent,
      total: grade.total,
      passed: everPassed,
      keyVersion: key.keyVersion,
      // Same day boundary as checkAttemptLimit: the academy time zone, server clock.
      attemptDay: attemptDayKey(at, timeZone),
      attemptsToday: limit.attemptsToday,
      lastAttemptAt: iso,
      ...(prev?.firstPassedAt ? { firstPassedAt: prev.firstPassedAt } : grade.passed ? { firstPassedAt: iso } : {}),
    };

    // create() fails if the attempt already exists: replays can never overwrite history.
    tx.create(db.doc(`progress/${progressId}/quizAttempts/${String(attemptNumber).padStart(6, '0')}`), attempt);
    const progressRef = db.doc(`progress/${progressId}`);
    if (!progress) {
      const record: Progress = {
        id: progressId, orgId, courseId, moduleId: lesson.moduleId, lessonId, studentId: uid, batchId: enrollment.batchId,
        status: completedAfter ? 'completed' : 'in_progress', timeSpentSeconds: 0, lastAccessedAt: iso,
        quiz: summary, createdAt: iso, updatedAt: iso,
        ...(completedAfter ? { completedAt: iso } : {}),
      };
      tx.create(progressRef, record);
    } else {
      tx.update(progressRef, {
        quiz: summary,
        status: completedAfter ? 'completed' : progress.status === 'not_started' ? 'in_progress' : progress.status,
        lastAccessedAt: iso,
        updatedAt: iso,
        ...(completedAfter && !progress.completedAt ? { completedAt: iso } : {}),
      });
    }

    return {
      attemptNumber,
      ...grade,
      lessonCompleted: completedAfter,
      attemptsRemainingToday: completedAfter ? null : Math.max(0, MAX_ATTEMPTS_PER_DAY - limit.attemptsToday),
      ...(everPassed
        ? {
            feedback: key.items.map((i) => ({
              blockId: i.blockId,
              yourAnswer: answers[i.blockId] ?? null,
              correctOptionId: i.correctOptionId,
              isCorrect: answers[i.blockId] === i.correctOptionId,
              explanation: i.explanation,
            })),
          }
        : {}),
    };
  });
}

/**
 * Strynkix LMS — assessment scoring and result-release rules. Pure functions,
 * shared by the server (which alone holds answer keys) and the browser (which
 * only ever sees released results).
 */

import type {
  Assessment, AssessmentAttempt, AssessmentKeyItem, AssessmentKind, AssessmentQuestion, AttemptResponse, AttemptStatus, QuestionType,
} from '@/types/academy';

export const AUTO_TYPES: QuestionType[] = ['mcq_single', 'mcq_multi'];
export const isAutoQuestion = (q: Pick<AssessmentQuestion, 'type'>) => AUTO_TYPES.includes(q.type);

/** Question types each kind of assessment may contain. Practical assignments have none. */
export const QUESTION_TYPES_FOR: Record<AssessmentKind, QuestionType[]> = {
  quiz: ['mcq_single', 'mcq_multi'],
  short_answer: ['short'],
  long_answer: ['long'],
  practical: [],
  exam: ['mcq_single', 'mcq_multi', 'short', 'long'],
};

export const KIND_LABELS: Record<AssessmentKind, string> = {
  quiz: 'MCQ quiz',
  short_answer: 'Short answer',
  long_answer: 'Long answer',
  practical: 'Practical assignment',
  exam: 'Examination',
};

export const EXAM_TYPE_LABELS = { demo: 'Demo exam', practice: 'Practice exam', final: 'Final exam' } as const;

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus | 'not_started', string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
  under_evaluation: 'Under evaluation',
  evaluated: 'Evaluated',
  returned: 'Returned for correction',
};

/** Marks rounded to two decimals (half marks and negative fractions are common). */
export const roundMarks = (n: number) => Math.round(n * 100) / 100;

export function totalMarksOf(a: Pick<Assessment, 'kind' | 'questions' | 'practicalMarks'>): number {
  if (a.kind === 'practical') return a.practicalMarks ?? 0;
  return roundMarks(a.questions.reduce((sum, q) => sum + q.marks, 0));
}

export const needsManualEvaluation = (a: Pick<Assessment, 'kind' | 'questions'>) =>
  a.kind === 'practical' || a.questions.some((q) => !isAutoQuestion(q));

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export interface AutoScore {
  score: number;
  perQuestion: Record<string, { marks: number; correct: boolean | null }>;
}

/**
 * Scores the MCQ questions. Single-correct: the chosen option must be the key.
 * Multiple-correct: the chosen set must equal the key set exactly (no partial
 * marks). A wrong answer loses `negativeMarks` when negative marking is on; an
 * unanswered question scores 0.
 */
export function autoScore(
  a: Pick<Assessment, 'questions' | 'negativeMarking'>,
  key: AssessmentKeyItem[],
  responses: Record<string, AttemptResponse>
): AutoScore {
  const byId = new Map(key.map((k) => [k.questionId, k]));
  const perQuestion: AutoScore['perQuestion'] = {};
  let score = 0;
  for (const q of a.questions) {
    if (!isAutoQuestion(q)) continue;
    const chosen = (responses[q.id]?.optionIds ?? []).filter(Boolean);
    const correctIds = byId.get(q.id)?.correctOptionIds ?? [];
    if (chosen.length === 0) {
      perQuestion[q.id] = { marks: 0, correct: null };
      continue;
    }
    const correct = correctIds.length > 0 && sameSet(chosen, correctIds);
    const marks = correct ? q.marks : a.negativeMarking ? -(q.negativeMarks ?? 0) : 0;
    perQuestion[q.id] = { marks, correct };
    score += marks;
  }
  return { score: roundMarks(score), perQuestion };
}

/** Final score: auto + manual marks, never below zero; percent and pass. */
export function finalResult(totalMarks: number, passingPercent: number, auto: number, manual: number) {
  const score = roundMarks(Math.max(0, auto + manual));
  const percent = totalMarks > 0 ? Math.round((score / totalMarks) * 1000) / 10 : 0;
  return { score, percent, passed: percent >= passingPercent };
}

/** May the student see the score and feedback of this attempt now? */
export function isResultReleased(
  a: Pick<Assessment, 'resultRelease' | 'closesAt' | 'resultsReleasedAt'>,
  attempt: Pick<AssessmentAttempt, 'status'>,
  now: Date = new Date()
): boolean {
  if (attempt.status !== 'evaluated') return false;
  if (a.resultRelease === 'immediate') return true;
  if (a.resultRelease === 'after_close') return !a.closesAt || now.getTime() >= Date.parse(a.closesAt);
  return Boolean(a.resultsReleasedAt);
}

/**
 * Correct answers are shown only after release and once the student can't use
 * them on another attempt: passed, out of attempts, or the window closed.
 */
export function mayRevealAnswers(
  a: Pick<Assessment, 'resultRelease' | 'closesAt' | 'resultsReleasedAt' | 'maxAttempts'>,
  attempt: Pick<AssessmentAttempt, 'status' | 'passed'>,
  attemptsUsed: number,
  now: Date = new Date()
): boolean {
  if (!isResultReleased(a, attempt, now)) return false;
  if (attempt.passed) return true;
  if (a.maxAttempts > 0 && attemptsUsed >= a.maxAttempts) return true;
  return Boolean(a.closesAt && now.getTime() >= Date.parse(a.closesAt));
}

export type StartDecision = { ok: true; late: boolean; resubmission: boolean } | { ok: false; reason: string };

/** Can the student start a new attempt? `previous` is newest first. */
export function canStartAttempt(
  a: Pick<Assessment, 'status' | 'kind' | 'opensAt' | 'closesAt' | 'allowLate' | 'maxAttempts' | 'allowResubmission'>,
  previous: Pick<AssessmentAttempt, 'status'>[],
  now: Date = new Date()
): StartDecision {
  if (a.status !== 'published') return { ok: false, reason: 'This activity isn’t open.' };
  if (a.opensAt && now.getTime() < Date.parse(a.opensAt)) return { ok: false, reason: 'This hasn’t opened yet.' };
  let late = false;
  if (a.closesAt && now.getTime() > Date.parse(a.closesAt)) {
    if (a.kind === 'exam' || !a.allowLate) return { ok: false, reason: 'The deadline has passed.' };
    late = true;
  }
  const latest = previous[0];
  if (latest && ['in_progress', 'submitted', 'under_evaluation'].includes(latest.status)) {
    return { ok: false, reason: latest.status === 'in_progress' ? 'You already have an attempt in progress.' : 'Your last attempt is waiting for evaluation.' };
  }
  const resubmission = latest?.status === 'returned';
  if (resubmission && a.allowResubmission) return { ok: true, late, resubmission };
  if (a.maxAttempts > 0 && previous.length >= a.maxAttempts) return { ok: false, reason: 'You have used all your attempts.' };
  return { ok: true, late, resubmission };
}

/** Seconds left on a timed attempt, or null when untimed. */
export function secondsLeft(attempt: Pick<AssessmentAttempt, 'deadlineAt'>, now: Date = new Date()): number | null {
  if (!attempt.deadlineAt) return null;
  return Math.max(0, Math.floor((Date.parse(attempt.deadlineAt) - now.getTime()) / 1000));
}

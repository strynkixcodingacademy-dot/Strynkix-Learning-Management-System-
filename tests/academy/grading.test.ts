import { describe, it, expect } from 'vitest';
import { autoScore, canStartAttempt, finalResult, isResultReleased, mayRevealAnswers, totalMarksOf } from '@/lib/assessments/grading';
import type { Assessment, AssessmentQuestion } from '@/types/academy';

const q = (id: string, type: AssessmentQuestion['type'], marks = 2, negativeMarks?: number): AssessmentQuestion =>
  ({ id, type, prompt: id, marks, ...(type.startsWith('mcq') ? { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }] } : {}), ...(negativeMarks ? { negativeMarks } : {}) });
const base = { status: 'published', kind: 'quiz', allowLate: false, maxAttempts: 2, allowResubmission: true } as Pick<Assessment, 'status' | 'kind' | 'opensAt' | 'closesAt' | 'allowLate' | 'maxAttempts' | 'allowResubmission'>;

describe('autoScore', () => {
  const questions = [q('s', 'mcq_single', 2, 0.5), q('m', 'mcq_multi', 3, 1), q('w', 'short', 5)];
  const key = [{ questionId: 's', correctOptionIds: ['b'] }, { questionId: 'm', correctOptionIds: ['a', 'c'] }];

  it('scores single and multiple correct answers; multi needs the exact set', () => {
    expect(autoScore({ questions, negativeMarking: false }, key, { s: { optionIds: ['b'] }, m: { optionIds: ['c', 'a'] } }).score).toBe(5);
    expect(autoScore({ questions, negativeMarking: false }, key, { s: { optionIds: ['b'] }, m: { optionIds: ['a'] } }).score).toBe(2);
    expect(autoScore({ questions, negativeMarking: false }, key, { m: { optionIds: ['a', 'b', 'c'] } }).score).toBe(0);
  });

  it('applies negative marks only when negative marking is on, and never to blank answers', () => {
    const wrong = { s: { optionIds: ['a'] }, m: { optionIds: ['b'] } };
    expect(autoScore({ questions, negativeMarking: true }, key, wrong).score).toBe(-1.5);
    expect(autoScore({ questions, negativeMarking: false }, key, wrong).score).toBe(0);
    expect(autoScore({ questions, negativeMarking: true }, key, {}).score).toBe(0);
    expect(autoScore({ questions, negativeMarking: true }, key, {}).perQuestion.s.correct).toBeNull();
  });

  it('final score never goes below zero; percent and pass use the total', () => {
    expect(finalResult(10, 40, -1.5, 0)).toEqual({ score: 0, percent: 0, passed: false });
    expect(finalResult(10, 40, 2, 2.5)).toEqual({ score: 4.5, percent: 45, passed: true });
    expect(totalMarksOf({ kind: 'exam', questions, practicalMarks: undefined })).toBe(10);
    expect(totalMarksOf({ kind: 'practical', questions: [], practicalMarks: 25 })).toBe(25);
  });
});

describe('result release and answer reveal', () => {
  const evaluated = { status: 'evaluated' as const, passed: false };
  const past = new Date(Date.now() - 3600_000).toISOString();
  const future = new Date(Date.now() + 3600_000).toISOString();
  it('immediate / after close / manual', () => {
    expect(isResultReleased({ resultRelease: 'immediate' }, evaluated)).toBe(true);
    expect(isResultReleased({ resultRelease: 'immediate' }, { status: 'submitted' })).toBe(false);
    expect(isResultReleased({ resultRelease: 'after_close', closesAt: future }, evaluated)).toBe(false);
    expect(isResultReleased({ resultRelease: 'after_close', closesAt: past }, evaluated)).toBe(true);
    expect(isResultReleased({ resultRelease: 'manual' }, evaluated)).toBe(false);
    expect(isResultReleased({ resultRelease: 'manual', resultsReleasedAt: past }, evaluated)).toBe(true);
  });
  it('answers stay hidden while the student could still use them', () => {
    const a = { resultRelease: 'immediate' as const, maxAttempts: 3 };
    expect(mayRevealAnswers(a, evaluated, 1)).toBe(false);
    expect(mayRevealAnswers(a, evaluated, 3)).toBe(true);
    expect(mayRevealAnswers(a, { status: 'evaluated', passed: true }, 1)).toBe(true);
    expect(mayRevealAnswers({ ...a, maxAttempts: 0 }, evaluated, 9)).toBe(false);
  });
});

describe('canStartAttempt', () => {
  it('respects windows, attempts, pending work and resubmission', () => {
    expect(canStartAttempt({ ...base, status: 'draft' }, []).ok).toBe(false);
    expect(canStartAttempt({ ...base, opensAt: new Date(Date.now() + 60_000).toISOString() }, []).ok).toBe(false);
    expect(canStartAttempt({ ...base, closesAt: new Date(Date.now() - 60_000).toISOString() }, []).ok).toBe(false);
    expect(canStartAttempt({ ...base, allowLate: true, closesAt: new Date(Date.now() - 60_000).toISOString() }, [])).toEqual({ ok: true, late: true, resubmission: false });
    expect(canStartAttempt({ ...base, kind: 'exam', allowLate: true, closesAt: new Date(Date.now() - 60_000).toISOString() }, []).ok).toBe(false);
    expect(canStartAttempt(base, [{ status: 'submitted' }]).ok).toBe(false);
    expect(canStartAttempt(base, [{ status: 'evaluated' }, { status: 'evaluated' }]).ok).toBe(false);
    expect(canStartAttempt(base, [{ status: 'returned' }, { status: 'evaluated' }])).toEqual({ ok: true, late: false, resubmission: true });
    expect(canStartAttempt({ ...base, allowResubmission: false }, [{ status: 'returned' }, { status: 'evaluated' }]).ok).toBe(false);
  });
});

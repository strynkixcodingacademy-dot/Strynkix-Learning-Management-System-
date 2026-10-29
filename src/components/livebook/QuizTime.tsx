'use client';

/**
 * Strynkix Live Books — end-of-lesson quiz ("It's Quiz Time").
 *
 * Every quiz is graded on the server (Stages C1 and C4): the student answers
 * every question, then POST /api/quiz/attempt grades the attempt, enforces the
 * attempt limits and completes the lesson on a pass. The browser never sees or
 * uses an answer key; correct answers and explanations appear only when the
 * server releases them (after passing).
 */

import React, { useState } from 'react';
import { QuizAttemptResult, QuizBlock } from '@/types/domain';
import { QUIZ_PASS_PERCENT } from '@/lib/livebook/structure';
import { QuizSubmitError } from '@/lib/livebook/service';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { ArrowRight, Check, Flag, RotateCcw, Timer, Trophy, X } from 'lucide-react';

type Phase = 'intro' | 'question' | 'result';

export function QuizTime({
  questions,
  isCompleted,
  canTrackProgress,
  onSubmit,
  bestPercent,
}: {
  questions: QuizBlock[];
  isCompleted: boolean;
  canTrackProgress: boolean;
  /** Server grading. */
  onSubmit: (answers: Record<string, string>) => Promise<QuizAttemptResult>;
  /** Best server-recorded score. */
  bestPercent?: number | null;
}) {
  return <GradedQuiz questions={questions} isCompleted={isCompleted} canSubmit={canTrackProgress} onSubmit={onSubmit} bestPercent={bestPercent ?? null} />;
}

function QuizIntro({ count, canTrackProgress, isCompleted, best, onStart, note }: {
  count: number;
  canTrackProgress: boolean;
  isCompleted: boolean;
  best: number | null;
  onStart: () => void;
  note?: React.ReactNode;
}) {
  const minutes = Math.max(2, Math.round(count * 1.5));
  return (
    <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:p-9">
      <div className="min-w-0 flex-1 space-y-5">
        <h2 id="quiz-heading" className="flex items-center gap-3 text-[24px] font-extrabold tracking-tight text-ink">
          <span aria-hidden="true" className="text-[28px]">🧠</span> It&apos;s Quiz Time
        </h2>
        <p className="flex gap-3 text-[16px] leading-relaxed text-ink-2">
          <Flag className="mt-1 h-5 w-5 shrink-0 text-ink-3" aria-hidden="true" />
          Let&apos;s lock in what you&apos;ve learned. Take this quiz to review the key ideas{canTrackProgress ? ' and mark this lesson as complete' : ''}.
        </p>
        <ul className="space-y-3 text-[15px] text-ink-2">
          <li className="flex items-center gap-3"><Check className="h-5 w-5 text-ink-3" aria-hidden="true" /> Get {QUIZ_PASS_PERCENT}% or more</li>
          <li className="flex items-center gap-3"><Timer className="h-5 w-5 text-ink-3" aria-hidden="true" /> About {minutes} min · {count} question{count === 1 ? '' : 's'}</li>
        </ul>
        <button type="button" onClick={onStart} className="inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-6 text-sm font-bold text-white hover:bg-ink-2">
          {best === null ? 'Start Quiz' : 'Retake Quiz'} <ArrowRight className="h-4 w-4" />
        </button>
        {isCompleted && <p className="text-sm font-semibold text-success-ink">You&apos;ve completed this lesson.</p>}
        {note}
      </div>
      <div className="flex shrink-0 items-start gap-3 sm:flex-col sm:items-end">
        <div className="text-right">
          <div className="text-xs font-semibold text-ink-3">Best score</div>
          <div className="text-lg font-extrabold text-ink">{best === null ? '–' : `${best}%`}</div>
        </div>
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-highlight-soft"><Trophy className="h-6 w-6 text-warning-ink" aria-hidden="true" /></span>
      </div>
    </div>
  );
}

function GradedQuiz({ questions, isCompleted, canSubmit, onSubmit, bestPercent }: {
  questions: QuizBlock[];
  isCompleted: boolean;
  canSubmit: boolean;
  onSubmit: (answers: Record<string, string>) => Promise<QuizAttemptResult>;
  bestPercent: number | null;
}) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  // Completion before this attempt (the prop updates once progress refreshes).
  const [completedBefore, setCompletedBefore] = useState(isCompleted);

  const q = questions[index];
  const last = index === questions.length - 1;
  const best = result ? Math.max(result.percent, bestPercent ?? 0) : bestPercent;

  const start = () => {
    setAnswers({});
    setIndex(0);
    setSubmitError(null);
    setResult(null);
    setPhase('question');
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    setCompletedBefore(isCompleted);
    try {
      setResult(await onSubmit(answers));
      setPhase('result');
    } catch (err) {
      setSubmitError(err instanceof QuizSubmitError ? err.message : 'Quiz grading is unavailable right now. Try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  const feedback = new Map((result?.feedback ?? []).map((f) => [f.blockId, f]));

  return (
    <section id="quiz" aria-labelledby="quiz-heading" className="scroll-mt-24 overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {phase === 'intro' && (
        <QuizIntro count={questions.length} canTrackProgress={canSubmit} isCompleted={isCompleted} best={best} onStart={start}
          note={!canSubmit ? <p className="text-sm text-ink-3">Preview mode: quizzes are graded only for enrolled students, so you can read the questions but not submit them.</p> : undefined} />
      )}

      {phase === 'question' && q && (
        <div className="p-6 sm:p-9">
          <div className="flex items-center justify-between gap-3">
            <h2 id="quiz-heading" className="text-sm font-bold uppercase tracking-[0.1em] text-ink-3">Question {index + 1} of {questions.length}</h2>
            <div className="flex gap-1" aria-hidden="true">
              {questions.map((x, i) => <span key={x.id} className={cx('h-1.5 w-6 rounded-full', answers[x.id] ? 'bg-brand' : i === index ? 'bg-brand/60' : 'bg-surface-sunken')} />)}
            </div>
          </div>
          <p className="mt-4 text-[18px] font-bold leading-snug text-ink">{q.question}</p>
          <fieldset className="mt-5 space-y-2.5" disabled={submitting}>
            <legend className="sr-only">Choose one answer</legend>
            {q.options.map((o) => {
              const chosen = answers[q.id] === o.id;
              return (
                <label key={o.id} className={cx(
                  'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-[15px] transition-colors',
                  chosen ? 'border-brand bg-brand-soft text-ink' : 'border-line bg-surface text-ink-2 hover:border-silver'
                )}>
                  <input type="radio" name={`quiz-${q.id}`} value={o.id} checked={chosen} onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))} className="h-4 w-4 accent-[var(--color-brand)]" />
                  <span className="flex-1">{o.text}</span>
                </label>
              );
            })}
          </fieldset>
          {submitError && <div className="mt-4"><Notice kind="error">{submitError}</Notice></div>}
          {last && !canSubmit && <p className="mt-4 text-sm text-ink-3">Preview mode: only enrolled students can submit this quiz.</p>}
          <div className="mt-6 flex justify-between gap-3">
            <Button variant="ghost" onClick={() => setIndex((i) => i - 1)} disabled={index === 0 || submitting}>Previous</Button>
            {!last ? (
              <Button onClick={() => setIndex((i) => i + 1)} disabled={!answers[q.id]}>Next question <ArrowRight className="h-4 w-4" /></Button>
            ) : (
              <Button onClick={submit} disabled={!canSubmit || submitting || questions.some((x) => !answers[x.id])}>
                {submitting ? 'Grading…' : 'Submit answers'} <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      {phase === 'result' && result && (
        <div className="p-8 sm:p-10">
          <div className="flex flex-col items-center gap-3 text-center" role="status">
            <span className={cx('flex h-14 w-14 items-center justify-center rounded-full text-white', result.passed ? 'bg-success celebrate animate-pop' : 'bg-coral')}>
              {result.passed ? <Trophy className="h-7 w-7" /> : <RotateCcw className="h-7 w-7" />}
            </span>
            <h2 id="quiz-heading" className="text-[22px] font-extrabold text-ink">You scored {result.percent}%</h2>
            <p className="text-sm text-ink-3">{result.correct} of {result.total} correct · pass mark {QUIZ_PASS_PERCENT}%</p>
            {result.passed ? (
              <p className="text-[15px] font-bold text-success-ink">{completedBefore ? 'Passed — your completion is already recorded.' : 'Lesson complete — nicely done.'}</p>
            ) : (
              <p className="text-[15px] text-ink-2">
                Review the lesson and try again — you need {QUIZ_PASS_PERCENT}% to complete it.
                {result.attemptsRemainingToday !== null && ` ${result.attemptsRemainingToday} attempt${result.attemptsRemainingToday === 1 ? '' : 's'} left today.`}
              </p>
            )}
            {!result.feedback && <p className="text-sm text-ink-3">Correct answers and explanations unlock once you pass.</p>}
            <Button variant="secondary" onClick={start} icon={<RotateCcw className="h-4 w-4" />}>Retake quiz</Button>
          </div>
          {result.feedback && (
            <ol className="mt-8 space-y-4">
              {questions.map((x, i) => {
                const f = feedback.get(x.id);
                if (!f) return null;
                const correctText = x.options.find((o) => o.id === f.correctOptionId)?.text;
                return (
                  <li key={x.id} className={cx('rounded-xl border px-4 py-3 text-sm', f.isCorrect ? 'border-success-line bg-success-soft' : 'border-warning-line bg-warning-soft')}>
                    <p className="font-bold text-ink">{i + 1}. {x.question}</p>
                    <p className="mt-1 flex items-center gap-2 text-ink-2">
                      {f.isCorrect ? <Check className="h-4 w-4 text-success-ink" aria-label="Correct" /> : <X className="h-4 w-4 text-danger-ink" aria-label="Incorrect" />}
                      Correct answer: <strong>{correctText}</strong>
                    </p>
                    <p className="mt-1 text-ink-2">{f.explanation}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

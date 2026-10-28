'use client';

/**
 * Strynkix Live Books — end-of-lesson quiz ("It's Quiz Time").
 * One question at a time with instant feedback; scoring QUIZ_PASS_PERCENT or
 * more completes the lesson for enrolled students. The best score is kept on
 * this device only (it is a convenience, not a grade).
 */

import React, { useState } from 'react';
import { QuizBlock } from '@/types/domain';
import { QUIZ_PASS_PERCENT, quizScore } from '@/lib/livebook/structure';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { ArrowRight, Check, Flag, RotateCcw, Timer, Trophy, X } from 'lucide-react';

type Phase = 'intro' | 'question' | 'result';

function readBest(key: string): number | null {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

export function QuizTime({
  questions,
  storageKey,
  isCompleted,
  canTrackProgress,
  onPassed,
}: {
  questions: QuizBlock[];
  /** Per-user, per-lesson key for the best score on this device. */
  storageKey: string;
  isCompleted: boolean;
  canTrackProgress: boolean;
  onPassed: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  // The quiz only renders client-side after sign-in, so reading storage here is safe.
  const [best, setBest] = useState<number | null>(() => (typeof window === 'undefined' ? null : readBest(storageKey)));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const q = questions[index];
  const minutes = Math.max(2, Math.round(questions.length * 1.5));
  const result = quizScore(questions, answers);

  const start = () => {
    setAnswers({});
    setIndex(0);
    setChecked(false);
    setSaveError(false);
    setPhase('question');
  };

  const next = async () => {
    if (index < questions.length - 1) {
      setIndex((i) => i + 1);
      setChecked(false);
      return;
    }
    setPhase('result');
    const score = quizScore(questions, answers);
    if (best === null || score.percent > best) {
      setBest(score.percent);
      try {
        window.localStorage.setItem(storageKey, String(score.percent));
      } catch {
        /* storage unavailable: best score just isn't remembered */
      }
    }
    if (score.passed && canTrackProgress && !isCompleted) {
      setSaving(true);
      try {
        await onPassed();
      } catch {
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <section id="quiz" aria-labelledby="quiz-heading" className="scroll-mt-24 overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {phase === 'intro' && (
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
              <li className="flex items-center gap-3"><Timer className="h-5 w-5 text-ink-3" aria-hidden="true" /> About {minutes} min · {questions.length} question{questions.length === 1 ? '' : 's'}</li>
            </ul>
            <button type="button" onClick={start} className="inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-6 text-sm font-bold text-white hover:bg-ink-2">
              {best === null ? 'Start Quiz' : 'Retake Quiz'} <ArrowRight className="h-4 w-4" />
            </button>
            {isCompleted && <p className="text-sm font-semibold text-success-ink">You&apos;ve completed this lesson.</p>}
          </div>
          <div className="flex shrink-0 items-start gap-3 sm:flex-col sm:items-end">
            <div className="text-right">
              <div className="text-xs font-semibold text-ink-3">Best score</div>
              <div className="text-lg font-extrabold text-ink">{best === null ? '–' : `${best}%`}</div>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-highlight-soft"><Trophy className="h-6 w-6 text-warning-ink" aria-hidden="true" /></span>
          </div>
        </div>
      )}

      {phase === 'question' && q && (
        <div className="p-6 sm:p-9">
          <div className="flex items-center justify-between gap-3">
            <h2 id="quiz-heading" className="text-sm font-bold uppercase tracking-[0.1em] text-ink-3">Question {index + 1} of {questions.length}</h2>
            <div className="flex gap-1" aria-hidden="true">
              {questions.map((x, i) => <span key={x.id} className={cx('h-1.5 w-6 rounded-full', i < index ? 'bg-brand' : i === index ? 'bg-brand/60' : 'bg-surface-sunken')} />)}
            </div>
          </div>
          <p className="mt-4 text-[18px] font-bold leading-snug text-ink">{q.question}</p>
          <fieldset className="mt-5 space-y-2.5" disabled={checked}>
            <legend className="sr-only">Choose one answer</legend>
            {q.options.map((o) => {
              const chosen = answers[q.id] === o.id;
              const right = checked && o.id === q.correctOptionId;
              const wrong = checked && chosen && o.id !== q.correctOptionId;
              return (
                <label key={o.id} className={cx(
                  'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-[15px] transition-colors',
                  right ? 'border-success-line bg-success-soft text-success-ink' : wrong ? 'border-danger-line bg-danger-soft text-danger-ink' : chosen ? 'border-brand bg-brand-soft text-ink' : 'border-line bg-surface text-ink-2 hover:border-silver'
                )}>
                  <input type="radio" name={`quiz-${q.id}`} value={o.id} checked={chosen} onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))} className="h-4 w-4 accent-[var(--color-brand)]" />
                  <span className="flex-1">{o.text}</span>
                  {right && <Check className="h-4 w-4" aria-label="Correct answer" />}
                  {wrong && <X className="h-4 w-4" aria-label="Your answer" />}
                </label>
              );
            })}
          </fieldset>
          {checked && (
            <div role="status" className={cx('mt-4 rounded-xl border px-4 py-3 text-sm', answers[q.id] === q.correctOptionId ? 'border-success-line bg-success-soft text-ink-2' : 'border-warning-line bg-warning-soft text-ink-2')}>
              <strong>{answers[q.id] === q.correctOptionId ? 'Correct. ' : 'Not quite. '}</strong>{q.explanation}
            </div>
          )}
          <div className="mt-6 flex justify-end">
            {!checked ? (
              <Button onClick={() => setChecked(true)} disabled={!answers[q.id]}>Check answer</Button>
            ) : (
              <Button onClick={next}>{index < questions.length - 1 ? 'Next question' : 'See my score'} <ArrowRight className="h-4 w-4" /></Button>
            )}
          </div>
        </div>
      )}

      {phase === 'result' && (
        <div className="flex flex-col items-center gap-3 p-8 text-center sm:p-10" role="status">
          <span className={cx('flex h-14 w-14 items-center justify-center rounded-full text-white', result.passed ? 'bg-success celebrate animate-pop' : 'bg-coral')}>
            {result.passed ? <Trophy className="h-7 w-7" /> : <RotateCcw className="h-7 w-7" />}
          </span>
          <h2 id="quiz-heading" className="text-[22px] font-extrabold text-ink">You scored {result.percent}%</h2>
          <p className="text-sm text-ink-3">{result.correct} of {result.total} correct · pass mark {QUIZ_PASS_PERCENT}%</p>
          {result.passed ? (
            canTrackProgress ? (
              saving ? <p className="text-sm text-ink-3">Saving your progress…</p>
                : saveError ? <Notice kind="error">We couldn&apos;t save your completion. <button type="button" onClick={() => { setSaveError(false); setSaving(true); onPassed().catch(() => setSaveError(true)).finally(() => setSaving(false)); }} className="font-bold underline">Try again</button></Notice>
                  : <p className="text-[15px] font-bold text-success-ink">Lesson complete — nicely done.</p>
            ) : <p className="text-sm text-ink-3">Preview mode: progress is recorded only for enrolled students.</p>
          ) : (
            <p className="text-[15px] text-ink-2">Review the lesson and try again — you need {QUIZ_PASS_PERCENT}% to complete it.</p>
          )}
          <Button variant="secondary" onClick={start} icon={<RotateCcw className="h-4 w-4" />}>Retake quiz</Button>
        </div>
      )}
    </section>
  );
}

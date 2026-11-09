'use client';

/**
 * Strynkix Live Books — Knowledge check (self-assessed multiple choice).
 * Feedback is local to the page; nothing is recorded or graded. Keyed
 * questions (Stage C1) carry no answer, so they are shown without checking —
 * the server grades them in the end-of-lesson quiz.
 */

import React, { useState } from 'react';
import { BadgeCheck, CircleX, Lightbulb, RotateCcw } from 'lucide-react';
import { QuizBlock } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/tones';

export function QuizBlockView({ block }: { block: QuizBlock }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const isCorrect = selected === block.correctOptionId;
  const canCheck = block.correctOptionId !== undefined;

  return (
    <section className="my-9 rounded-card border border-teal-line bg-surface p-5 sm:p-6" aria-labelledby={`quiz-${block.id}-q`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-teal-ink">Check your understanding</p>
        {block.hint && (
          <button type="button" onClick={() => setShowHint((s) => !s)} aria-expanded={showHint}
            className="inline-flex items-center gap-1 text-xs font-semibold text-ink-3 hover:text-ink">
            <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" /> {showHint ? 'Hide hint' : 'Hint'}
          </button>
        )}
      </div>

      <form
        className="mt-2 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (selected) setChecked(true);
        }}
      >
        <fieldset className="space-y-2">
          <legend id={`quiz-${block.id}-q`} className="mb-3 font-reading text-[1.0625rem] font-medium leading-snug text-ink">{block.question}</legend>
          {showHint && block.hint && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-ink-2"><span className="font-semibold text-warning-ink">Hint:</span> {block.hint}</p>
          )}
          {block.options.map((opt, i) => {
            const isSel = selected === opt.id;
            const correct = checked && opt.id === block.correctOptionId;
            const wrong = checked && isSel && !isCorrect;
            return (
              <label key={opt.id}
                className={cx(
                  'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                  correct ? 'border-success bg-success-soft' : wrong ? 'border-coral bg-coral-soft'
                    : isSel ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-silver hover:bg-surface-muted/50',
                  checked ? 'cursor-default' : 'cursor-pointer'
                )}>
                <input type="radio" name={`quiz_${block.id}`} value={opt.id} disabled={checked} checked={isSel}
                  onChange={() => setSelected(opt.id)} className="sr-only" />
                <span aria-hidden="true" className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                  correct ? 'bg-success text-white' : wrong ? 'bg-coral text-white' : isSel ? 'bg-brand text-white' : 'bg-surface-muted text-ink-2')}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1 text-ink">{opt.text}</span>
                {correct && <BadgeCheck className="w-5 h-5 text-success-ink animate-pop" aria-label="Correct answer" />}
                {wrong && <CircleX className="w-5 h-5 text-coral-ink" aria-label="Your answer (incorrect)" />}
              </label>
            );
          })}
        </fieldset>

        {!canCheck ? (
          <p className="text-sm text-ink-3">This question is graded in the end-of-lesson quiz.</p>
        ) : checked ? (
          <div role="status" className={cx('rounded-lg p-4 animate-rise', isCorrect ? 'bg-success-soft' : 'bg-coral-soft')}>
            <p className={cx('text-sm font-semibold', isCorrect ? 'text-success-ink' : 'text-coral-ink')}>
              {isCorrect ? 'That’s right.' : 'Not quite — the correct answer is highlighted.'}
            </p>
            <p className="mt-1 font-reading text-base leading-relaxed text-ink">{block.explanation}</p>
            <Button variant="ghost" size="sm" className="-ml-2 mt-2" icon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={() => { setSelected(null); setChecked(false); }}>
              Try again
            </Button>
          </div>
        ) : (
          <Button type="submit" disabled={!selected}>Check answer</Button>
        )}
      </form>
    </section>
  );
}

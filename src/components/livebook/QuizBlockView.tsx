'use client';

/**
 * Strynkix Live Books — Knowledge check (self-assessed multiple choice).
 * Feedback is local to the page; nothing is recorded or graded.
 */

import React, { useState } from 'react';
import { BadgeCheck, CircleX, Lightbulb, RotateCcw, Sparkles } from 'lucide-react';
import { QuizBlock } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/tones';

export function QuizBlockView({ block }: { block: QuizBlock }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const isCorrect = selected === block.correctOptionId;

  return (
    <section className="my-8 rounded-xl border border-lavender-line bg-surface" aria-labelledby={`quiz-${block.id}-q`}>
      <header className="flex items-center justify-between gap-3 border-b border-lavender-line bg-lavender-soft px-5 py-3 rounded-t-xl">
        <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-lavender-ink">
          <Sparkles className="w-4 h-4" aria-hidden="true" /> Check your understanding
        </span>
        {block.hint && (
          <button type="button" onClick={() => setShowHint((s) => !s)} aria-expanded={showHint}
            className="inline-flex items-center gap-1 text-xs font-semibold text-lavender-ink hover:underline">
            <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" /> {showHint ? 'Hide hint' : 'Hint'}
          </button>
        )}
      </header>

      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (selected) setChecked(true);
        }}
      >
        <fieldset className="space-y-3">
          <legend id={`quiz-${block.id}-q`} className="mb-3 text-[17px] font-bold leading-snug text-ink">{block.question}</legend>
          {showHint && block.hint && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-ink-2"><strong className="text-warning-ink">Hint:</strong> {block.hint}</p>
          )}
          {block.options.map((opt, i) => {
            const isSel = selected === opt.id;
            const correct = checked && opt.id === block.correctOptionId;
            const wrong = checked && isSel && !isCorrect;
            return (
              <label key={opt.id}
                className={cx(
                  'flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 text-[15px] transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                  correct ? 'border-success bg-success-soft' : wrong ? 'border-danger bg-danger-soft'
                    : isSel ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong hover:bg-canvas',
                  checked && 'cursor-default'
                )}>
                <input type="radio" name={`quiz_${block.id}`} value={opt.id} disabled={checked} checked={isSel}
                  onChange={() => setSelected(opt.id)} className="sr-only" />
                <span aria-hidden="true" className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                  correct ? 'bg-success text-white' : wrong ? 'bg-danger text-white' : isSel ? 'bg-brand text-white' : 'bg-surface-muted text-ink-2')}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1 text-ink">{opt.text}</span>
                {correct && <BadgeCheck className="w-5 h-5 text-success-ink animate-pop" aria-label="Correct answer" />}
                {wrong && <CircleX className="w-5 h-5 text-danger-ink" aria-label="Your answer (incorrect)" />}
              </label>
            );
          })}
        </fieldset>

        {checked ? (
          <div role="status" className={cx('rounded-xl p-4 animate-rise', isCorrect ? 'bg-success-soft' : 'bg-danger-soft')}>
            <p className={cx('text-sm font-bold', isCorrect ? 'text-success-ink' : 'text-danger-ink')}>
              {isCorrect ? 'That’s right.' : 'Not quite — the correct answer is highlighted.'}
            </p>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{block.explanation}</p>
            <Button variant="ghost" size="sm" className="mt-2 -ml-2" icon={<RotateCcw className="w-3.5 h-3.5" />}
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

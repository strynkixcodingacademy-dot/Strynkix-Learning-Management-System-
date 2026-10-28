'use client';

/**
 * Strynkix Live Books — Practice task. Instructions, starter code to copy into
 * your own editor, hints and the expected outcome. Student code is never run here.
 */

import React, { useState } from 'react';
import { CheckSquare, Lightbulb, Square, Target, Wrench } from 'lucide-react';
import { PracticeTaskBlock } from '@/types/domain';
import { CodePanel } from './CodeBlockView';
import { cx } from '@/components/ui/tones';

export function PracticeTaskView({ block }: { block: PracticeTaskBlock }) {
  const [practiced, setPracticed] = useState(false);
  const [showHints, setShowHints] = useState(false);
  // Authors enter hints one per line; blank lines are not hints.
  const hints = (block.hints ?? []).filter((h) => h.trim());

  return (
    <section className="my-8 overflow-hidden rounded-xl border border-coral-line bg-surface" aria-labelledby={`practice-${block.id}`}>
      <header className="flex flex-col gap-3 border-b border-coral-line bg-coral-soft px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-coral-ink" aria-hidden="true"><Wrench className="w-4 h-4" /></span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-coral-ink">Practice</p>
            <h3 id={`practice-${block.id}`} className="text-base font-bold text-ink">{block.title}</h3>
          </div>
        </div>
        <button type="button" onClick={() => setPracticed((p) => !p)} aria-pressed={practiced}
          className={cx('inline-flex items-center gap-2 self-start rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
            practiced ? 'border-success-line bg-success-soft text-success-ink' : 'border-coral-line bg-surface text-ink-2 hover:bg-canvas')}>
          {practiced ? <CheckSquare className="w-4 h-4 animate-pop" aria-hidden="true" /> : <Square className="w-4 h-4" aria-hidden="true" />}
          {practiced ? 'Practiced' : 'Mark as practiced'}
        </button>
      </header>

      <div className="space-y-5 p-5">
        <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{block.instructions}</p>
        {block.starterCode && (
          <div>
            <h4 className="text-sm font-bold text-ink">Starter code</h4>
            <CodePanel code={block.starterCode} language={block.language || 'code'} />
          </div>
        )}
        <div className="flex gap-3 rounded-xl bg-canvas p-4">
          <Target className="mt-0.5 w-5 h-5 shrink-0 text-coral" aria-hidden="true" />
          <div>
            <h4 className="text-sm font-bold text-ink">You’re done when</h4>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{block.expectedOutcome}</p>
          </div>
        </div>
        {hints.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowHints((s) => !s)} aria-expanded={showHints}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-warning-ink hover:underline">
              <Lightbulb className="w-4 h-4" aria-hidden="true" />
              {showHints ? 'Hide hints' : `Stuck? Show ${hints.length} hint${hints.length === 1 ? '' : 's'}`}
            </button>
            {showHints && (
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] text-ink-2 animate-fade">
                {hints.map((hint, i) => <li key={i}>{hint}</li>)}
              </ol>
            )}
          </div>
        )}
        <p className="text-xs text-ink-3">Work in your own editor. Code isn’t run in Live Books.</p>
      </div>
    </section>
  );
}

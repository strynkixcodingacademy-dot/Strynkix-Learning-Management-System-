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
    <section className="my-9 rounded-card border border-line bg-surface p-5 sm:p-6" aria-labelledby={`practice-${block.id}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-ink-3"><Wrench className="h-4 w-4" aria-hidden="true" /> Practice</p>
          <h3 id={`practice-${block.id}`} className="mt-1 font-display text-xl font-[560] leading-snug text-ink">{block.title}</h3>
        </div>
        <button type="button" onClick={() => setPracticed((p) => !p)} aria-pressed={practiced}
          className={cx('inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-md border px-2.5 text-xs font-semibold transition-colors duration-150',
            practiced ? 'border-success-line bg-success-soft text-success-ink' : 'border-line-strong text-ink-2 hover:bg-surface-muted')}>
          {practiced ? <CheckSquare className="h-3.5 w-3.5 animate-pop" aria-hidden="true" /> : <Square className="h-3.5 w-3.5" aria-hidden="true" />}
          {practiced ? 'Practiced' : 'Mark as practiced'}
        </button>
      </div>

      <div className="mt-4 space-y-5">
        <p className="whitespace-pre-line font-reading text-base leading-relaxed text-ink">{block.instructions}</p>
        {block.starterCode && (
          <div>
            <h4 className="text-sm font-semibold text-ink">Starter code</h4>
            <div className="[&>figure]:mb-0 [&>figure]:mt-2"><CodePanel code={block.starterCode} language={block.language || 'code'} /></div>
          </div>
        )}
        <div className="flex gap-3 border-t border-line pt-4">
          <Target className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-3" aria-hidden="true" />
          <div>
            <h4 className="text-sm font-semibold text-ink">You’re done when</h4>
            <p className="mt-1 font-reading text-base leading-relaxed text-ink">{block.expectedOutcome}</p>
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
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-2 animate-fade">
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

'use client';

/**
 * Strynkix Live Books — Worked example: problem, solution (collapsible) and
 * the reasoning behind it.
 */

import React, { useState } from 'react';
import { ChevronDown, Compass } from 'lucide-react';
import { WorkedExampleBlock } from '@/types/domain';
import { CodePanel } from './CodeBlockView';

export function WorkedExampleView({ block }: { block: WorkedExampleBlock }) {
  const [open, setOpen] = useState(true);
  const panelId = `worked-${block.id}`;
  return (
    <section className="my-8 overflow-hidden rounded-xl border border-teal-line bg-surface" aria-labelledby={`${panelId}-title`}>
      <header className="flex items-center gap-3 border-b border-teal-line bg-teal-soft px-5 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-teal-ink" aria-hidden="true"><Compass className="w-4 h-4" /></span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-teal-ink">Worked example</p>
          <h3 id={`${panelId}-title`} className="text-base font-bold text-ink">{block.title}</h3>
        </div>
      </header>
      <div className="space-y-5 p-5">
        <div>
          <h4 className="text-sm font-bold text-ink">The problem</h4>
          <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{block.problem}</p>
        </div>
        {block.solutionCode && (
          <div>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-teal-ink hover:underline">
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
              {open ? 'Hide solution' : 'Show solution'}
            </button>
            {open && <div id={panelId}><CodePanel code={block.solutionCode} language={block.language || 'code'} /></div>}
          </div>
        )}
        <div className="rounded-xl bg-canvas p-4">
          <h4 className="text-sm font-bold text-ink">Why it works</h4>
          <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{block.explanation}</p>
        </div>
      </div>
    </section>
  );
}

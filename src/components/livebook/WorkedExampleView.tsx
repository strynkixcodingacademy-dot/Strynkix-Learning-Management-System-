'use client';

/**
 * Strynkix Live Books — Worked example: problem, solution (collapsible) and
 * the reasoning behind it, read top to bottom.
 */

import React, { useState } from 'react';
import { ChevronDown, Compass } from 'lucide-react';
import { WorkedExampleBlock } from '@/types/domain';
import { CodePanel } from './CodeBlockView';

export function WorkedExampleView({ block }: { block: WorkedExampleBlock }) {
  const [open, setOpen] = useState(true);
  const panelId = `worked-${block.id}`;
  return (
    <section className="my-9 rounded-card border border-line bg-surface p-5 sm:p-6" aria-labelledby={`${panelId}-title`}>
      <p className="flex items-center gap-1.5 text-sm text-ink-3"><Compass className="h-4 w-4" aria-hidden="true" /> Worked example</p>
      <h3 id={`${panelId}-title`} className="mt-1 font-display text-xl font-[560] leading-snug text-ink">{block.title}</h3>
      <div className="mt-4 space-y-5">
        <div>
          <h4 className="text-sm font-semibold text-ink">The problem</h4>
          <p className="mt-1 whitespace-pre-line font-reading text-base leading-relaxed text-ink">{block.problem}</p>
        </div>
        {block.solutionCode && (
          <div>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink hover:underline">
              <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
              {open ? 'Hide solution' : 'Show solution'}
            </button>
            {open && <div id={panelId} className="[&>figure]:mb-0 [&>figure]:mt-3"><CodePanel code={block.solutionCode} language={block.language || 'code'} /></div>}
          </div>
        )}
        <div className="border-t border-line pt-4">
          <h4 className="text-sm font-semibold text-ink">Why it works</h4>
          <p className="mt-1 whitespace-pre-line font-reading text-base leading-relaxed text-ink">{block.explanation}</p>
        </div>
      </div>
    </section>
  );
}

'use client';

/**
 * Strynkix Live Books — Callout block: a margin note set into the page. The
 * variant is conveyed by icon and title as well as colour.
 */

import React from 'react';
import { Info, Lightbulb, TriangleAlert, ShieldAlert } from 'lucide-react';
import { CalloutBlock } from '@/types/domain';

const VARIANTS = {
  info: { box: 'bg-info-soft', icon: Info, iconClass: 'text-info-ink', title: 'Note' },
  tip: { box: 'bg-success-soft', icon: Lightbulb, iconClass: 'text-success-ink', title: 'Tip' },
  warning: { box: 'bg-warning-soft', icon: TriangleAlert, iconClass: 'text-warning-ink', title: 'Watch out' },
  danger: { box: 'bg-coral-soft', icon: ShieldAlert, iconClass: 'text-coral-ink', title: 'Important' },
} as const;

export function CalloutView({ block }: { block: CalloutBlock }) {
  const v = VARIANTS[block.variant] ?? VARIANTS.info;
  const Icon = v.icon;
  return (
    <aside className={`my-7 flex gap-3 rounded-lg px-4 py-3.5 sm:px-5 sm:py-4 ${v.box}`} aria-label={block.title || v.title}>
      <Icon className={`mt-1 h-[18px] w-[18px] shrink-0 ${v.iconClass}`} aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className={`text-sm font-semibold ${v.iconClass}`}>{block.title || v.title}</p>
        <div className="whitespace-pre-line font-reading text-base leading-relaxed text-ink">{block.content}</div>
      </div>
    </aside>
  );
}

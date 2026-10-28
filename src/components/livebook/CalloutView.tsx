'use client';

/**
 * Strynkix Live Books — Callout block. Tinted note with a strong left rule;
 * variant is conveyed by icon and title as well as colour.
 */

import React from 'react';
import { Info, Lightbulb, TriangleAlert, ShieldAlert } from 'lucide-react';
import { CalloutBlock } from '@/types/domain';

const VARIANTS = {
  info: { box: 'bg-brand-soft border-brand', icon: Info, iconClass: 'text-brand-ink', title: 'Note' },
  tip: { box: 'bg-success-soft border-success', icon: Lightbulb, iconClass: 'text-success-ink', title: 'Tip' },
  warning: { box: 'bg-warning-soft border-warning', icon: TriangleAlert, iconClass: 'text-warning-ink', title: 'Watch out' },
  danger: { box: 'bg-danger-soft border-danger', icon: ShieldAlert, iconClass: 'text-danger-ink', title: 'Important' },
} as const;

export function CalloutView({ block }: { block: CalloutBlock }) {
  const v = VARIANTS[block.variant] ?? VARIANTS.info;
  const Icon = v.icon;
  return (
    <aside className={`my-6 flex gap-3 rounded-r-xl border-l-4 px-4 py-3.5 ${v.box}`} aria-label={block.title || v.title}>
      <Icon className={`mt-0.5 w-5 h-5 shrink-0 ${v.iconClass}`} aria-hidden="true" />
      <div className="space-y-1">
        <p className={`text-sm font-bold ${v.iconClass}`}>{block.title || v.title}</p>
        <div className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{block.content}</div>
      </div>
    </aside>
  );
}

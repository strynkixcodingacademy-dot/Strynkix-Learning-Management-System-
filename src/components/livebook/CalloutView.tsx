'use client';

/**
 * Strynkix LMS — Live Books Callout Block
 * High-contrast, accessible callouts for Tips, Info, Warnings, and Danger notes.
 */

import React from 'react';
import { Info, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { CalloutBlock } from '@/types/domain';

interface CalloutViewProps {
  block: CalloutBlock;
}

export function CalloutView({ block }: CalloutViewProps) {
  const getVariantStyles = () => {
    switch (block.variant) {
      case 'tip':
        return {
          container: 'bg-emerald-950/20 border-emerald-800/50 text-emerald-200',
          title: 'text-emerald-300',
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />,
          defaultTitle: 'Pro-Tip',
        };
      case 'warning':
        return {
          container: 'bg-amber-950/20 border-amber-800/50 text-amber-200',
          title: 'text-amber-300',
          icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />,
          defaultTitle: 'Warning',
        };
      case 'danger':
        return {
          container: 'bg-rose-950/20 border-rose-800/50 text-rose-200',
          title: 'text-rose-300',
          icon: <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />,
          defaultTitle: 'Security Critical',
        };
      case 'info':
      default:
        return {
          container: 'bg-indigo-950/20 border-indigo-800/50 text-indigo-200',
          title: 'text-indigo-300',
          icon: <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />,
          defaultTitle: 'Important Note',
        };
    }
  };

  const style = getVariantStyles();

  return (
    <div className={`my-6 p-4 rounded-xl border flex gap-3.5 shadow-md ${style.container}`}>
      {style.icon}
      <div className="space-y-1 text-xs sm:text-sm leading-relaxed">
        <h4 className={`font-bold text-xs uppercase tracking-wider ${style.title}`}>
          {block.title || style.defaultTitle}
        </h4>
        <div className="text-slate-300 whitespace-pre-line">{block.content}</div>
      </div>
    </div>
  );
}

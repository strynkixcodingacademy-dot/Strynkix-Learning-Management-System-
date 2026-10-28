'use client';

/**
 * Strynkix Live Books — shared page frame: the "Live Books" title row and the
 * large white working surface every Live Books screen sits on.
 */

import React from 'react';
import { AppArt } from '@/components/home/AppArt';
import { cx } from '@/components/ui/tones';

export function LiveBooksFrame({ children, className, actions }: { children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 lg:h-full lg:min-h-0">
      <div className="flex items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 text-[28px] font-extrabold tracking-tight text-ink sm:text-[32px]">
          <AppArt name="preview" size={40} /> Live Books
        </h1>
        {actions}
      </div>
      <div className={cx('paper-dots overflow-hidden rounded-card border border-line bg-surface shadow-card lg:min-h-0 lg:flex-1', className)}>
        {children}
      </div>
    </div>
  );
}

'use client';

/**
 * Shared frame for print-ready documents (receipts, admission forms, reports):
 * a toolbar that disappears when printing and an A4 page. "Save as PDF" is the
 * browser's print dialog, so no PDF library is needed.
 */

import React from 'react';
import Link from 'next/link';
import { Button, buttonClasses } from '@/components/ui/Button';

export function PrintFrame({ back, title, children, landscape = false }: { back: string; title: string; children: React.ReactNode; landscape?: boolean }) {
  return (
    <div className="min-h-screen bg-surface-muted p-4 print:bg-white print:p-0">
      <style>{`@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 14mm; }`}</style>
      <div className="mx-auto mb-4 flex max-w-[820px] flex-wrap items-center gap-2 print:hidden">
        <Link href={back} className={buttonClasses('ghost')}>← Back</Link>
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
        <span className="text-xs text-ink-3">In the print dialog choose “Save as PDF” to download.</span>
      </div>
      <article aria-label={title} className="mx-auto max-w-[820px] bg-white p-8 text-[13px] leading-relaxed text-[#1d1d1f] shadow-lift print:max-w-none print:p-0 print:shadow-none">
        {children}
      </article>
    </div>
  );
}

export function DocHeader({ academy, branch, title, meta }: { academy: string; branch?: string; title: string; meta?: React.ReactNode }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-6 border-b-2 border-[#1d1d1f] pb-4">
      <div>
        <div className="text-lg font-extrabold">{academy}</div>
        {branch && <div className="text-xs text-[#6e6e73]">{branch}</div>}
      </div>
      <div className="text-right">
        <div className="text-base font-bold uppercase tracking-wide">{title}</div>
        {meta && <div className="text-xs text-[#6e6e73]">{meta}</div>}
      </div>
    </header>
  );
}

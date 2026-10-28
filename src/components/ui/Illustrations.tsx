/**
 * Strynkix Live Books — original spot illustrations (authored for this project).
 * Flat shapes in the token palette; decorative only (aria-hidden).
 */

import React from 'react';

export type IllustrationName = 'book' | 'calendar' | 'inbox' | 'sprout' | 'lock' | 'compass';

const INK = 'var(--color-ink)';
const PAPER = 'var(--color-surface)';

function Book() {
  return (
    <>
      <ellipse cx="60" cy="98" rx="40" ry="5" fill="var(--color-surface-sunken)" />
      <path d="M18 30c14-6 28-6 42 2v60c-14-8-28-8-42-2z" fill="var(--color-brand-soft)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M102 30c-14-6-28-6-42 2v60c14-8 28-8 42-2z" fill={PAPER} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M70 46h22M70 56h22M70 66h14" stroke="var(--color-ink-4)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M28 46h22M28 56h18" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M84 24v20l5-4 5 4V24z" fill="var(--color-warning)" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    </>
  );
}

function Calendar() {
  return (
    <>
      <ellipse cx="60" cy="100" rx="38" ry="5" fill="var(--color-surface-sunken)" />
      <rect x="22" y="26" width="76" height="66" rx="10" fill={PAPER} stroke={INK} strokeWidth="2.5" />
      <path d="M22 44h76" stroke={INK} strokeWidth="2.5" />
      <rect x="22" y="26" width="76" height="18" rx="10" fill="var(--color-coral-soft)" />
      <path d="M40 20v14M80 20v14" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="42" cy="60" r="4" fill="var(--color-ink-4)" />
      <circle cx="60" cy="60" r="4" fill="var(--color-ink-4)" />
      <circle cx="78" cy="60" r="4" fill="var(--color-warning)" />
      <circle cx="42" cy="76" r="4" fill="var(--color-ink-4)" />
      <circle cx="60" cy="76" r="4" fill="var(--color-ink-4)" />
    </>
  );
}

function Inbox() {
  return (
    <>
      <ellipse cx="60" cy="100" rx="40" ry="5" fill="var(--color-surface-sunken)" />
      <path d="M20 60l14-30h52l14 30v28a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6z" fill={PAPER} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M20 60h24l6 10h20l6-10h24" fill="var(--color-teal-soft)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M48 42h24M52 50h16" stroke="var(--color-teal)" strokeWidth="2.5" strokeLinecap="round" />
    </>
  );
}

function Sprout() {
  return (
    <>
      <ellipse cx="60" cy="100" rx="34" ry="5" fill="var(--color-surface-sunken)" />
      <path d="M40 78h40l-5 20H45z" fill="var(--color-coral-soft)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M60 78V46" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M60 56c-2-14-14-20-26-18 2 14 12 20 26 18z" fill="var(--color-success-soft)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M60 50c2-14 14-22 28-20-2 16-14 22-28 20z" fill="var(--color-success)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
    </>
  );
}

function Lock() {
  return (
    <>
      <ellipse cx="60" cy="100" rx="30" ry="5" fill="var(--color-surface-sunken)" />
      <path d="M42 50V40a18 18 0 0 1 36 0v10" fill="none" stroke={INK} strokeWidth="2.5" />
      <rect x="32" y="50" width="56" height="42" rx="10" fill="var(--color-warning-soft)" stroke={INK} strokeWidth="2.5" />
      <circle cx="60" cy="68" r="5" fill={INK} />
      <path d="M60 72v8" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
    </>
  );
}

function Compass() {
  return (
    <>
      <ellipse cx="60" cy="100" rx="34" ry="5" fill="var(--color-surface-sunken)" />
      <circle cx="60" cy="58" r="34" fill={PAPER} stroke={INK} strokeWidth="2.5" />
      <path d="M60 36l9 22-9 22-9-22z" fill="var(--color-lavender-soft)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M60 36l9 22H51z" fill="var(--color-coral)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="60" cy="58" r="3" fill={INK} />
    </>
  );
}

const ART: Record<IllustrationName, () => React.ReactElement> = {
  book: Book,
  calendar: Calendar,
  inbox: Inbox,
  sprout: Sprout,
  lock: Lock,
  compass: Compass,
};

export function Illustration({ name, size = 120, className }: { name: IllustrationName; size?: number; className?: string }) {
  const Art = ART[name];
  return (
    <svg viewBox="0 0 120 110" width={size} height={(size * 110) / 120} aria-hidden="true" className={className}>
      <Art />
    </svg>
  );
}

/** The Strynkix Live Books mark: an open book with the "today" ribbon. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--color-brand)" />
      <path d="M7 10.5c3-1.4 6-1.4 9 .5v12c-3-1.9-6-1.9-9-.5z" fill="#fff" />
      <path d="M25 10.5c-3-1.4-6-1.4-9 .5v12c3-1.9 6-1.9 9-.5z" fill="#dfe7fb" />
      <path d="M20 8.5v6l1.6-1.2 1.6 1.2v-6z" fill="var(--color-warning)" />
    </svg>
  );
}

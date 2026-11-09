/**
 * Strynkix — the brand mark and the small line glyphs used in empty and blocked
 * states. Glyphs come from the one icon set the product uses; no spot art.
 */

import React from 'react';
import { BookOpen, CalendarDays, Compass, Inbox, Lock, Sprout, type LucideIcon } from 'lucide-react';

export type IllustrationName = 'book' | 'calendar' | 'inbox' | 'sprout' | 'lock' | 'compass';

const GLYPHS: Record<IllustrationName, LucideIcon> = {
  book: BookOpen,
  calendar: CalendarDays,
  inbox: Inbox,
  sprout: Sprout,
  lock: Lock,
  compass: Compass,
};

export function Illustration({ name, size = 32, className }: { name: IllustrationName; size?: number; className?: string }) {
  const Glyph = GLYPHS[name];
  return <Glyph width={size} height={size} strokeWidth={1.5} aria-hidden="true" className={className} />;
}

/** The Strynkix mark: a cloth-bound volume with its ribbon. `foil` is for use on cobalt cloth. */
export function BrandMark({ size = 32, foil = false }: { size?: number; foil?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="6" fill={foil ? 'var(--color-foil)' : 'var(--color-cloth-cobalt)'} />
      <rect x="0" width="5" height="32" rx="2" fill="#000" opacity={foil ? 0.1 : 0.18} />
      <path d="M20.6 11.4c-.9-1.5-2.5-2.3-4.4-2.3-2.7 0-4.7 1.5-4.7 3.8 0 2.2 1.6 3.2 4 3.9 2 .6 3 1 3 2.2 0 1.1-1 1.9-2.5 1.9-1.7 0-2.9-.8-3.6-2.3l-1.6 1c.9 2 2.8 3.1 5.2 3.1 2.8 0 4.7-1.6 4.7-3.9 0-2.2-1.5-3.2-4.1-4-1.9-.6-2.9-1-2.9-2.1 0-1 .9-1.7 2.4-1.7 1.3 0 2.3.6 2.9 1.6z" fill={foil ? 'var(--color-cloth-cobalt)' : 'var(--color-foil)'} />
      <path d="M24 0h4v9l-2-1.5L24 9z" fill="var(--color-highlight)" />
    </svg>
  );
}

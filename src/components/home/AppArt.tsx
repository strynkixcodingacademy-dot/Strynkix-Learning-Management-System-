/**
 * Strynkix Live Books — illustrated app icons for the home "My Apps" grid.
 * Original flat illustrations in the design-system palette: ink outlines, one
 * or two fills each, so the grid reads as a calm, colourful set.
 */

import React from 'react';

export type AppArtName =
  | 'books' | 'calendar' | 'clipboard' | 'chart' | 'guide' | 'profile'
  | 'people' | 'branch' | 'pen' | 'building' | 'preview' | 'review' | 'help';

const S = { stroke: 'var(--color-ink)', strokeWidth: 2.2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

const ART: Record<AppArtName, React.ReactNode> = {
  books: (
    <>
      <rect x="10" y="14" width="13" height="38" rx="2" fill="var(--color-brand)" {...S} />
      <rect x="23" y="10" width="13" height="42" rx="2" fill="var(--color-highlight)" {...S} />
      <path d="M38 16l11-3 9 36-11 3z" fill="var(--color-coral)" {...S} />
      <path d="M14 22h5M27 18h5M27 44h5" {...S} />
      <path d="M6 54h52" {...S} />
    </>
  ),
  calendar: (
    <>
      <rect x="8" y="12" width="48" height="42" rx="5" fill="var(--color-surface)" {...S} />
      <path d="M8 22h48" {...S} />
      <rect x="8" y="12" width="48" height="10" rx="5" fill="var(--color-coral)" {...S} />
      <path d="M20 8v8M44 8v8" {...S} />
      {[0, 1, 2, 3].map((c) => [0, 1, 2].map((r) => (
        <rect key={`${c}${r}`} x={15 + c * 10} y={28 + r * 8} width="6" height="5" rx="1" fill={c === 2 && r === 1 ? 'var(--color-brand)' : 'var(--color-silver)'} />
      )))}
    </>
  ),
  clipboard: (
    <>
      <rect x="12" y="10" width="40" height="46" rx="5" fill="var(--color-highlight-soft)" {...S} />
      <rect x="23" y="6" width="18" height="9" rx="3" fill="var(--color-teal)" {...S} />
      <path d="M20 26l4 4 7-8M35 27h11M20 40l4 4 7-8M35 41h11" {...S} />
    </>
  ),
  chart: (
    <>
      <rect x="8" y="10" width="48" height="44" rx="5" fill="var(--color-surface)" {...S} />
      <rect x="16" y="34" width="7" height="12" rx="1.5" fill="var(--color-teal)" {...S} />
      <rect x="28" y="26" width="7" height="20" rx="1.5" fill="var(--color-brand)" {...S} />
      <rect x="40" y="18" width="7" height="28" rx="1.5" fill="var(--color-lavender)" {...S} />
      <path d="M14 46h36" {...S} />
    </>
  ),
  guide: (
    <>
      <circle cx="32" cy="32" r="22" fill="var(--color-surface)" {...S} />
      <circle cx="32" cy="32" r="10" fill="var(--color-surface)" {...S} />
      <path d="M17 17l8 8M47 17l-8 8M17 47l8-8M47 47l-8-8" stroke="var(--color-coral)" strokeWidth="7" />
      <circle cx="32" cy="32" r="22" fill="none" {...S} />
      <circle cx="32" cy="32" r="10" fill="none" {...S} />
    </>
  ),
  profile: (
    <>
      <rect x="10" y="14" width="44" height="38" rx="5" fill="var(--color-surface)" {...S} />
      <rect x="27" y="8" width="10" height="9" rx="2" fill="var(--color-silver)" {...S} />
      <circle cx="24" cy="31" r="6" fill="var(--color-highlight)" {...S} />
      <path d="M15 46c1-6 5-8 9-8s8 2 9 8" fill="var(--color-brand)" {...S} />
      <path d="M38 28h10M38 35h10M38 42h7" {...S} />
    </>
  ),
  people: (
    <>
      <circle cx="22" cy="24" r="7" fill="var(--color-highlight)" {...S} />
      <circle cx="42" cy="22" r="8" fill="var(--color-coral)" {...S} />
      <path d="M8 50c1-9 7-13 14-13s12 3 13 9" fill="var(--color-teal)" {...S} />
      <path d="M28 50c1-10 7-15 14-15s13 5 14 15z" fill="var(--color-brand)" {...S} />
    </>
  ),
  branch: (
    <>
      <path d="M8 18l14-6 20 6 14-6v34l-14 6-20-6-14 6z" fill="var(--color-surface)" {...S} />
      <path d="M22 12v34M42 18v34" {...S} />
      <path d="M32 44s-9-9-9-15a9 9 0 0118 0c0 6-9 15-9 15z" fill="var(--color-coral)" {...S} />
      <circle cx="32" cy="29" r="3" fill="var(--color-surface)" {...S} />
    </>
  ),
  pen: (
    <>
      <rect x="8" y="12" width="36" height="42" rx="4" fill="var(--color-surface)" {...S} />
      <path d="M15 22h20M15 30h16M15 38h12" {...S} />
      <path d="M50 14l6 6-20 20-8 2 2-8z" fill="var(--color-highlight)" {...S} />
      <path d="M46 18l6 6" {...S} />
    </>
  ),
  building: (
    <>
      <path d="M12 54V22l20-12 20 12v32" fill="var(--color-lavender-soft)" {...S} />
      <path d="M8 54h48" {...S} />
      <rect x="27" y="40" width="10" height="14" fill="var(--color-brand)" {...S} />
      <path d="M20 28h4M40 28h4M20 36h4M40 36h4" {...S} />
      <circle cx="32" cy="24" r="3" fill="var(--color-highlight)" {...S} />
    </>
  ),
  preview: (
    <>
      <rect x="8" y="12" width="48" height="36" rx="5" fill="var(--color-surface)" {...S} />
      <path d="M8 20h48" {...S} />
      <circle cx="13" cy="16" r="1" fill="var(--color-ink)" /><circle cx="17" cy="16" r="1" fill="var(--color-ink)" />
      <path d="M26 34c3-6 9-8 12 0-3 6-9 6-12 0z" fill="var(--color-teal)" {...S} />
      <circle cx="32" cy="34" r="2" fill="var(--color-ink)" />
      <path d="M24 54h16M32 48v6" {...S} />
    </>
  ),
  review: (
    <>
      <path d="M14 8h26l10 10v38H14z" fill="var(--color-surface)" {...S} />
      <path d="M40 8v10h10" {...S} />
      <path d="M21 26h18M21 33h14" {...S} />
      <circle cx="40" cy="44" r="9" fill="var(--color-success)" {...S} />
      <path d="M36 44l3 3 5-6" stroke="var(--color-surface)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  help: (
    <>
      <path d="M10 14h44v30H30l-10 9v-9H10z" fill="var(--color-brand-soft)" {...S} />
      <path d="M27 24a5 5 0 119 3c-2 1-4 2-4 5" {...S} />
      <circle cx="32" cy="37" r="1.6" fill="var(--color-ink)" />
    </>
  ),
};

export function AppArt({ name, size = 56 }: { name: AppArtName; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {ART[name]}
    </svg>
  );
}

/** "Nothing planned" scene: a resting book on a hill under the sun. */
export function RestDayArt({ size = 180 }: { size?: number }) {
  return (
    <svg viewBox="0 0 200 120" width={size} height={(size * 120) / 200} aria-hidden="true">
      <circle cx="150" cy="30" r="14" fill="var(--color-highlight)" />
      <path d="M40 34h28a8 8 0 000-16 12 12 0 00-22-2 9 9 0 00-6 18z" fill="var(--color-surface)" stroke="var(--color-silver)" strokeWidth="2" />
      <ellipse cx="100" cy="100" rx="78" ry="12" fill="var(--color-brand-soft)" />
      <path d="M38 98c14-26 46-34 62-34s48 8 62 34z" fill="var(--color-teal-soft)" stroke="var(--color-teal)" strokeWidth="2" />
      <path d="M78 78c8-6 15-6 22-2 7-4 14-4 22 2v8c-8-6-15-6-22-2-7-4-14-4-22 2z" fill="var(--color-surface)" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M100 76v8" stroke="var(--color-ink)" strokeWidth="2" />
      <path d="M118 66l4-12 4 12M120 62h4" stroke="var(--color-coral)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

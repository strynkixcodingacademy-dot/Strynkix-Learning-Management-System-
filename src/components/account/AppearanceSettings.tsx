'use client';

/**
 * Strynkix Live Books — Profile → Appearance: colour theme (Light / Dark /
 * Auto / System) as picture cards, and celebration effects on/off. Both are
 * kept in this browser.
 */

import React, { useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';
import { getThemePreference, setThemePreference, subscribeThemePreference, ThemePreference } from '@/lib/theme';
import { getCelebrationsEnabled, setCelebrationsEnabled, subscribeCelebrations } from '@/lib/celebrate';
import { cx } from '@/components/ui/tones';

// The previews show each theme as it looks, whatever theme is active now.
const LIGHT = { bg: '#f5f6fb', card: '#ffffff', line: '#e3e5ef', bar: '#cdd0de', accent: '#3b3fe4' };
const DARK = { bg: '#111113', card: '#18191b', line: '#2e3135', bar: '#43484e', accent: '#5b5bd6' };

function Mock({ p }: { p: typeof LIGHT }) {
  return (
    <div className="flex h-full w-full gap-1.5 p-2" style={{ background: p.bg }}>
      <div className="w-3 rounded-sm" style={{ background: p.card, boxShadow: `inset 0 0 0 1px ${p.line}` }} />
      <div className="flex flex-1 flex-col gap-1.5 rounded-sm p-1.5" style={{ background: p.card, boxShadow: `inset 0 0 0 1px ${p.line}` }}>
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: p.accent }} />
        <div className="h-1.5 w-4/5 rounded-full" style={{ background: p.bar }} />
        <div className="h-1.5 w-3/5 rounded-full" style={{ background: p.bar }} />
      </div>
    </div>
  );
}

function Preview({ value }: { value: ThemePreference }) {
  if (value === 'light') return <Mock p={LIGHT} />;
  if (value === 'dark') return <Mock p={DARK} />;
  return (
    <div className="relative h-full w-full">
      <Mock p={LIGHT} />
      <div className="absolute inset-0" style={{ clipPath: 'polygon(55% 0, 100% 0, 100% 100%, 45% 100%)' }}><Mock p={DARK} /></div>
    </div>
  );
}

const THEMES: Array<{ value: ThemePreference; label: string; hint: string }> = [
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'auto', label: 'Auto', hint: 'Light by day, dark 7 PM – 7 AM' },
  { value: 'system', label: 'System', hint: 'Match this device' },
];

export function AppearanceSettings() {
  const theme = useSyncExternalStore(subscribeThemePreference, getThemePreference, () => 'light' as ThemePreference);
  const celebrations = useSyncExternalStore(subscribeCelebrations, getCelebrationsEnabled, () => true);

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-sm font-bold text-ink">Theme</legend>
        <p className="mt-0.5 text-[13px] text-ink-3">Saved on this device. Receipts and certificates always print light.</p>
        <div role="radiogroup" aria-label="Colour theme" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {THEMES.map((t) => {
            const on = theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setThemePreference(t.value)}
                className={cx(
                  'group rounded-xl border p-1.5 text-left transition-colors',
                  on ? 'border-brand ring-2 ring-brand/30' : 'border-line hover:border-line-strong'
                )}
              >
                <span className="block h-16 overflow-hidden rounded-lg" aria-hidden="true"><Preview value={t.value} /></span>
                <span className="mt-2 flex items-center justify-between gap-2 px-1">
                  <span className="text-[13px] font-bold text-ink">{t.label}</span>
                  {on && <Check className="h-4 w-4 text-brand-ink" aria-hidden="true" />}
                </span>
                <span className="block px-1 pb-1 text-[11.5px] leading-snug text-ink-3">{t.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex items-start justify-between gap-4 border-t border-line pt-5">
        <div>
          <div id="celebrations-label" className="text-sm font-bold text-ink">Celebration effects</div>
          <p className="mt-0.5 text-[13px] text-ink-3">Confetti when you complete a lesson or pass a quiz. Always off if your device asks for reduced motion.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={celebrations}
          aria-labelledby="celebrations-label"
          onClick={() => setCelebrationsEnabled(!celebrations)}
          className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', celebrations ? 'bg-brand' : 'bg-surface-sunken')}
        >
          <span className={cx('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-transform', celebrations && 'translate-x-5')} />
        </button>
      </div>
    </div>
  );
}

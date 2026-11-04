'use client';

import React, { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { getThemePreference, setThemePreference, subscribeThemePreference, ThemePreference } from '@/lib/theme';
import { cx } from './tones';

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/** Light / Dark / System, as a small segmented control. */
export function ThemeSwitch({ className }: { className?: string }) {
  const pref = useSyncExternalStore(subscribeThemePreference, getThemePreference, () => 'light' as ThemePreference);
  return (
    <div role="radiogroup" aria-label="Colour theme" className={cx('grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1', className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const on = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setThemePreference(value)}
            className={cx(
              'flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-colors',
              on ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
          </button>
        );
      })}
    </div>
  );
}

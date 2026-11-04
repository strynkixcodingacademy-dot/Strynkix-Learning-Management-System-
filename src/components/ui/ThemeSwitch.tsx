'use client';

import React, { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun, SunMoon } from 'lucide-react';
import { getThemePreference, setThemePreference, subscribeThemePreference, ThemePreference } from '@/lib/theme';
import { cx } from './tones';

const OPTIONS: Array<{ value: ThemePreference; label: string; title: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', title: 'Always light', Icon: Sun },
  { value: 'dark', label: 'Dark', title: 'Always dark', Icon: Moon },
  { value: 'auto', label: 'Auto', title: 'Light by day, dark from 7 PM to 7 AM', Icon: SunMoon },
  { value: 'system', label: 'System', title: 'Follow this device’s setting', Icon: Monitor },
];

/** Light / Dark / Auto / System, as a small segmented control. */
export function ThemeSwitch({ className }: { className?: string }) {
  const pref = useSyncExternalStore(subscribeThemePreference, getThemePreference, () => 'light' as ThemePreference);
  return (
    <div role="radiogroup" aria-label="Colour theme" className={cx('grid grid-cols-4 gap-1 rounded-xl bg-surface-muted p-1', className)}>
      {OPTIONS.map(({ value, label, title, Icon }) => {
        const on = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            title={title}
            onClick={() => setThemePreference(value)}
            className={cx(
              'flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-semibold transition-colors',
              on ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

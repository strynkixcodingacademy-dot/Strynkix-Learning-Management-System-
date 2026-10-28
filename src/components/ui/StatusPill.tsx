import React from 'react';
import { TONE_CLASSES, Tone, cx } from './tones';

/** Status is always shown as icon + words, never colour alone. */
export function StatusPill({
  tone = 'neutral',
  icon: Icon,
  children,
  size = 'md',
  className,
}: {
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  children: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        t.soft,
        t.ink,
        t.line,
        className
      )}
    >
      {Icon && <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden />}
      {children}
    </span>
  );
}

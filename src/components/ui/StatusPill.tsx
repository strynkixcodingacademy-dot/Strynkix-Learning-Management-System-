import React from 'react';
import { TONE_CLASSES, Tone, cx } from './tones';

/**
 * Status as words with a small mark in its colour. No chip: a page full of
 * tinted pills reads as noise, and the words carry the meaning anyway.
 */
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
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap font-medium leading-none', size === 'sm' ? 'text-xs' : 'text-sm', tone === 'neutral' ? 'text-ink-3' : t.ink, className)}>
      {Icon
        ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
        : <span aria-hidden="true" className={cx('h-1.5 w-1.5 shrink-0 rounded-full', tone === 'neutral' ? 'bg-silver' : t.solid)} />}
      {children}
    </span>
  );
}

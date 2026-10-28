import React from 'react';
import { TONE_CLASSES, Tone, cx } from './tones';

export function ProgressBar({
  value,
  tone = 'success',
  label,
  size = 'md',
  className,
}: {
  /** 0–100, or null when there is nothing to measure yet */
  value: number | null;
  tone?: Tone;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? 'Nothing to measure yet' : `${value}%`}
      className={cx('w-full overflow-hidden rounded-full bg-surface-sunken', size === 'sm' ? 'h-1.5' : 'h-2', className)}
    >
      <div
        className={cx('h-full rounded-full transition-[width] duration-500 ease-out', TONE_CLASSES[tone].solid)}
        style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
      />
    </div>
  );
}

/** Compact ring for a single ratio; the number in the centre is always visible text. */
export function ProgressRing({
  value,
  tone = 'success',
  size = 56,
  label,
  children,
}: {
  value: number | null;
  tone?: Tone;
  size?: number;
  label: string;
  children?: React.ReactNode;
}) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}
      role="img" aria-label={`${label}: ${value === null ? 'nothing to measure yet' : `${value}%`}`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-sunken" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
          className={cx(TONE_CLASSES[tone].ring, 'transition-[stroke-dashoffset] duration-700 ease-out')} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-ink">{children}</span>
    </div>
  );
}

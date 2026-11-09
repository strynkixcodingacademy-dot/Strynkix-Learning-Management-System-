import React from 'react';
import { TONE_CLASSES, Tone, cx } from './tones';

/** Initials avatar. A person is not a status, so it stays neutral. */
export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const clean = name.trim() || '?';
  const initials = clean.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-surface-sunken font-semibold text-ink-2', className)}
    >
      {initials}
    </span>
  );
}

const ATTENTION_FIGURE: Partial<Record<Tone, string>> = {
  coral: 'text-coral-ink',
  danger: 'text-danger-ink',
  warning: 'text-warning-ink',
};

/**
 * A figure: a number, what it counts, and (optionally) its definition, so a
 * metric is never shown without saying how it is calculated. It sits on a rule
 * rather than in a card; only figures that ask for attention take a colour.
 */
export function KpiTile({
  label,
  value,
  suffix,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  hint?: React.ReactNode;
  tone?: Tone;
  /** Accepted for older call sites; figures are carried by their label. */
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="min-w-0 border-t border-line-strong pt-3">
      <div className="text-sm text-ink-3">{label}</div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1">
        <span className={cx('type-figure text-[1.625rem] [overflow-wrap:anywhere]', (value !== 0 && ATTENTION_FIGURE[tone]) || 'text-ink')}>{value}</span>
        {suffix && <span className="text-sm text-ink-3">{suffix}</span>}
      </div>
      {hint && <div className="mt-1.5 text-xs leading-relaxed text-ink-3">{hint}</div>}
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  /** Short label for the axis (e.g. "Mon"). */
  short: string;
  value: number;
}

const COLUMN_FILL = { brand: 'bg-brand', teal: 'bg-teal', success: 'bg-success', info: 'bg-info' };

/**
 * Column chart in plain HTML: thin columns on one baseline, values on hover and
 * focus, and a visually hidden table with the exact values.
 */
export function ColumnChart({
  data,
  label,
  tone = 'brand',
  height = 160,
  unit = '',
}: {
  data: SeriesPoint[];
  label: string;
  tone?: 'brand' | 'teal' | 'success' | 'info';
  height?: number;
  unit?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <figure className="space-y-1.5">
      <div role="img" aria-label={`${label}: ${total}${unit} in total`} className="relative flex items-end gap-0.5 border-b border-line-strong" style={{ height }}>
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full min-w-0 flex-1 items-end justify-center hover:bg-surface-muted/70">
            <div className={cx('w-full max-w-6 rounded-t-[4px]', COLUMN_FILL[tone])} style={{ height: d.value === 0 ? 0 : `${Math.max(2, (d.value / max) * 100)}%` }} />
            <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white shadow-lift group-hover:block">
              {d.label}: {d.value}{unit}
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex gap-0.5">
        {data.map((d) => (
          <div key={d.label} className="min-w-0 flex-1 truncate text-center text-xs text-ink-3">{d.short}</div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>{data.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>{d.value}{unit}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Horizontal meter with a numeric label; null renders an em dash, never a fake 0%. */
export function Meter({ value, tone = 'brand', label }: { value: number | null; tone?: Tone; label?: string }) {
  const t = TONE_CLASSES[tone];
  return (
    <div className="flex items-center gap-2.5" aria-label={label}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
        {value !== null && <div className={cx('h-full rounded-full', t.solid)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />}
      </div>
      <span className="w-10 text-right text-xs font-semibold tabular-nums text-ink-2">{value === null ? '—' : `${value}%`}</span>
    </div>
  );
}

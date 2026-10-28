import React from 'react';
import { TONE_CLASSES, Tone, cx } from './tones';

/** Initials avatar. Colour is derived from the name so it is stable per person. */
const AVATAR_TONES: Tone[] = ['brand', 'teal', 'lavender', 'coral', 'success', 'warning'];

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const clean = name.trim() || '?';
  const initials = clean.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  const hash = [...clean].reduce((n, c) => n + c.charCodeAt(0), 0);
  const t = TONE_CLASSES[AVATAR_TONES[hash % AVATAR_TONES.length]];
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full border font-bold', t.soft, t.ink, t.line, className)}
    >
      {initials}
    </span>
  );
}

/**
 * KPI tile: a number, what it counts, and (optionally) its definition, so a
 * metric is never shown without saying how it is calculated.
 */
export function KpiTile({
  label,
  value,
  suffix,
  hint,
  tone = 'brand',
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  hint?: React.ReactNode;
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
      <span aria-hidden="true" className={cx('absolute inset-x-0 top-0 h-[3px]', t.solid)} />
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">{label}</div>
        {Icon && (
          <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', t.soft, t.ink)}>
            <Icon className="w-4 h-4" />
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-[30px] font-extrabold leading-none tracking-tight text-ink tabular-nums">{value}</span>
        {suffix && <span className="text-sm font-bold text-ink-3">{suffix}</span>}
      </div>
      {hint && <div className="mt-2 text-xs leading-relaxed text-ink-3">{hint}</div>}
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  /** Short label for the axis (e.g. "Mon"). */
  short: string;
  value: number;
}

/**
 * Accessible column chart in plain SVG. Values are also exposed as a visually
 * hidden table, and each column has a title tooltip.
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
  tone?: 'brand' | 'teal' | 'success' | 'lavender';
  height?: number;
  unit?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const fill = { brand: 'fill-brand', teal: 'fill-teal', success: 'fill-success', lavender: 'fill-lavender' }[tone];
  const w = 100 / Math.max(1, data.length);
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <figure className="space-y-2">
      <div className="relative" style={{ height }}>
        {/* silver gridlines */}
        <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => <div key={i} className="border-t border-dashed border-line" />)}
        </div>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="relative h-full w-full" role="img" aria-label={`${label}: ${total}${unit} in total`}>
          {data.map((d, i) => {
            const h = d.value === 0 ? 0 : Math.max(3, (d.value / max) * (height - 8));
            return (
              <rect key={d.label} x={i * w + w * 0.18} y={height - h} width={w * 0.64} height={h} rx={1.2} className={cx(fill, 'opacity-90 transition-opacity hover:opacity-100')}>
                <title>{`${d.label}: ${d.value}${unit}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div aria-hidden="true" className="flex">
        {data.map((d) => (
          <div key={d.label} className="flex-1 truncate text-center text-[10px] font-semibold text-ink-4">{d.short}</div>
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
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
        {value !== null && <div className={cx('h-full rounded-full', t.solid)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />}
      </div>
      <span className="w-10 text-right text-xs font-bold tabular-nums text-ink-2">{value === null ? '—' : `${value}%`}</span>
    </div>
  );
}

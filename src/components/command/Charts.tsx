'use client';

/**
 * Small, accessible charts for the Command Centre: horizontal bars (ranked
 * values) and paired columns (two series per period). Each also renders a
 * visually hidden table with the exact values.
 */

import React from 'react';
import { cx } from '@/components/ui/tones';

export function BarList({ title, rows, format = (n) => String(n), tone = 'bg-brand', empty = 'No data for this selection.' }: {
  title: string; rows: { id?: string; label: string; value: number; href?: string }[]; format?: (n: number) => string; tone?: string; empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-bold text-ink">{title}</figcaption>
      {rows.length === 0 ? <p className="text-sm text-ink-3">{empty}</p> : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id ?? r.label} className="grid grid-cols-[minmax(90px,38%)_1fr_auto] items-center gap-2 text-[13px]">
              {r.href ? <a href={r.href} className="truncate text-brand-ink hover:underline">{r.label}</a> : <span className="truncate text-ink-2">{r.label}</span>}
              <span aria-hidden="true" className="h-2.5 rounded-full bg-surface-sunken"><span className={cx('block h-full rounded-full', tone)} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></span>
              <span className="tabular-nums font-semibold text-ink">{format(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

export function PairedColumns({ title, rows, aLabel, bLabel, format = (n) => String(n) }: {
  title: string; rows: { label: string; a: number; b: number }[]; aLabel: string; bLabel: string; format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-center gap-3 text-sm font-bold text-ink">{title}
        <span className="flex items-center gap-1 text-xs font-semibold text-ink-3"><span className="h-2.5 w-2.5 rounded-sm bg-success" />{aLabel}</span>
        <span className="flex items-center gap-1 text-xs font-semibold text-ink-3"><span className="h-2.5 w-2.5 rounded-sm bg-coral" />{bLabel}</span>
      </figcaption>
      {rows.length === 0 ? <p className="text-sm text-ink-3">No data for this period.</p> : (
        <div aria-hidden="true" className="flex h-40 items-end gap-2 overflow-x-auto border-b border-line pb-1">
          {rows.map((r) => (
            <div key={r.label} className="flex min-w-[36px] flex-1 flex-col items-center gap-1">
              <div className="flex h-32 w-full items-end justify-center gap-0.5">
                <span title={`${aLabel}: ${format(r.a)}`} className="w-1/2 max-w-[14px] rounded-t bg-success" style={{ height: `${(r.a / max) * 100}%` }} />
                <span title={`${bLabel}: ${format(r.b)}`} className="w-1/2 max-w-[14px] rounded-t bg-coral" style={{ height: `${(r.b / max) * 100}%` }} />
              </div>
              <span className="text-[10px] text-ink-3">{r.label.slice(5) || r.label}</span>
            </div>
          ))}
        </div>
      )}
      <table className="sr-only"><caption>{title}</caption><thead><tr><th>Period</th><th>{aLabel}</th><th>{bLabel}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td>{format(r.a)}</td><td>{format(r.b)}</td></tr>)}</tbody></table>
    </figure>
  );
}

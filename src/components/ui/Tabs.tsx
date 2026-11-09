'use client';

import React, { useRef } from 'react';
import { cx } from './tones';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
}

/** Accessible tab bar (arrow keys move between tabs, roving tabindex). */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  idPrefix: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].id);
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-5 overflow-x-auto border-b border-line [scrollbar-width:none]">
      {items.map((item, i) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${idPrefix}-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              'relative inline-flex items-center gap-1.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 -outline-offset-2',
              selected ? 'text-ink' : 'text-ink-3 hover:text-ink'
            )}
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span className={cx('rounded-full px-1.5 text-xs tabular-nums', selected ? 'bg-brand-soft text-brand-ink' : 'bg-surface-muted text-ink-3')}>
                {item.count}
              </span>
            )}
            <span aria-hidden="true" className={cx('absolute inset-x-0 -bottom-px h-0.5 bg-brand transition-opacity duration-150', selected ? 'opacity-100' : 'opacity-0')} />
          </button>
        );
      })}
    </div>
  );
}

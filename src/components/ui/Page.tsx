import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cx } from './tones';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-3">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="inline-flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-ink-4 shrink-0" aria-hidden="true" />}
            {c.href ? (
              <Link href={c.href} className="hover:text-brand-ink truncate max-w-[16rem]">{c.label}</Link>
            ) : (
              <span aria-current="page" className="text-ink-2 font-medium truncate max-w-[16rem]">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: Crumb[];
  className?: string;
}) {
  return (
    <header className={cx('space-y-3 animate-rise', className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1 min-w-0">
          {eyebrow && <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">{eyebrow}</div>}
          <h1 className="text-[26px] sm:text-[30px] leading-[1.15] font-extrabold tracking-tight text-ink">{title}</h1>
          {description && <p className="text-[15px] text-ink-3 max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled section with an optional trailing action; not a card. */
export function Section({
  title,
  icon: Icon,
  action,
  children,
  id,
  className,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section aria-labelledby={headingId} className={cx('space-y-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2.5 text-[17px] font-extrabold text-ink tracking-tight">
          {Icon && <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon className="w-4 h-4" /></span>}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Surface for objects the user acts on. */
export function Card({ children, className, as: As = 'div', interactive = false }: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section' | 'li';
  interactive?: boolean;
}) {
  return (
    <As className={cx(
      'rounded-card border border-line bg-surface shadow-card',
      interactive && 'transition-[box-shadow,transform,border-color] duration-200 hover:shadow-lift hover:-translate-y-0.5 hover:border-silver',
      className
    )}>
      {children}
    </As>
  );
}

export const fieldClasses =
  'w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder-ink-4 transition-colors focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15 disabled:bg-surface-muted disabled:text-ink-3';

export function Field({ label, htmlFor, hint, error, children, required }: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink-2">
        {label} {required && <span className="text-danger-ink" aria-hidden="true">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-danger-ink" role="alert">{error}</p> : hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

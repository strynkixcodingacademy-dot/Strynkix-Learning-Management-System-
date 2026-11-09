import React from 'react';
import Link from 'next/link';
import { ChevronRight, Search } from 'lucide-react';
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
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-silver shrink-0" aria-hidden="true" />}
            {c.href ? (
              <Link href={c.href} className="truncate max-w-[16rem] rounded-sm transition-colors hover:text-brand-ink hover:underline">{c.label}</Link>
            ) : (
              <span aria-current="page" className="text-ink-2 truncate max-w-[16rem]">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The top of a page: the title in the display face, what the page is for, and
 * its actions. `eyebrow` is context that belongs to this record (a code, a date,
 * a role); it reads under the title, never as a label above it.
 */
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
    <header className={cx('space-y-3 border-b border-line pb-6', className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="type-page text-ink">{title}</h1>
          {eyebrow && <div className="text-sm font-medium text-ink-3">{eyebrow}</div>}
          {description && <p className="max-w-[62ch] text-body text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled section with an optional trailing action; not a card. */
export function Section({
  title,
  description,
  action,
  children,
  id,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Accepted for older call sites; sections are carried by their title, not an icon. */
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section aria-labelledby={headingId} className={cx('space-y-4', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={headingId} className="type-section text-ink">{title}</h2>
          {description && <p className="mt-1 max-w-[62ch] text-sm text-ink-3">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Quiet link used as a section action ("See all"). */
export function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-sm font-semibold text-brand-ink hover:underline">{children}</Link>;
}

/** Surface for objects the user acts on. Lists and figures do not need one. */
export function Card({ children, className, as: As = 'div', interactive = false }: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section' | 'li';
  interactive?: boolean;
}) {
  return (
    <As className={cx(
      'rounded-card border border-line bg-surface',
      interactive && 'transition-[box-shadow,border-color] duration-200 ease-out hover:shadow-lift hover:border-line-strong',
      className
    )}>
      {children}
    </As>
  );
}

/** Scroll frame for a data table: never pushes the page sideways on small screens. */
export function TableFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-hidden rounded-card border border-line bg-surface', className)}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

/** Label and value pairs: the record details on a detail page. */
export function Facts({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cx('grid gap-x-8 gap-y-4 sm:grid-cols-2', className)}>
      {items.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-xs text-ink-3">{f.label}</dt>
          <dd className="mt-0.5 break-words text-sm font-medium text-ink">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const fieldClasses =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-silver focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15 disabled:bg-surface-muted disabled:text-ink-3 aria-[invalid=true]:border-danger';

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
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-2">
        {label} {required && <span className="text-danger-ink" aria-hidden="true">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-danger-ink" role="alert">{error}</p> : hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

/** Search box with a real label. */
export function SearchInput({ id, label, value, onChange, placeholder, className }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx('relative', className)}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden="true" />
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={cx(fieldClasses, 'h-10 pl-9')} />
    </div>
  );
}

/** One-of-many filter. Arrow keys work because each option is a native radio. */
export function Segmented<T extends string>({ label, options, value, onChange, className }: {
  label: string;
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const name = React.useId();
  return (
    <fieldset className={cx('inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-surface-muted p-0.5', className)}>
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className={cx(
          'cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-brand',
          value === o.value ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink'
        )}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

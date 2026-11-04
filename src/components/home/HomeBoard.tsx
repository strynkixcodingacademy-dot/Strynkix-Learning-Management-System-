'use client';

/**
 * Strynkix Live Books — home layout. Left: greeting card, then "My Day" filling
 * the rest of the screen. Right: "Your workspace", one tile per category of the
 * role (each opens its hub), with the apps' badge counts gathered onto their
 * category, and "Quick open" for sections shown in a side sheet. On desktop the
 * home page itself never scrolls.
 */

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { cx, TONE_CLASSES } from '@/components/ui/tones';
import { categoriesFor, categoryOfHref, type CategoryGroup } from '@/lib/navigation/catalog';
import { AppArt, AppArtName } from './AppArt';
import type { AppTile } from './HomeBlocks';
import { ArrowRight, X } from 'lucide-react';

export interface HomeApp extends AppTile {
  /** Opens this content in a side sheet instead of navigating. */
  sheet?: React.ReactNode;
}

/** Side sheet showing one section in full. Esc, the close button and the backdrop close it. */
function Sheet({ title, art, children, onClose }: { title: string; art: AppArtName; children: React.ReactNode; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20 backdrop-blur-[3px] animate-fade" />
      <section role="dialog" aria-modal="true" aria-label={title} className="relative flex h-full w-full max-w-[880px] flex-col bg-canvas shadow-float animate-rise">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-5 py-4 sm:px-7">
          <AppArt name={art} size={34} />
          <h2 className="flex-1 text-[19px] font-extrabold tracking-tight text-ink">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-3 hover:bg-surface-muted hover:text-ink" aria-label={`Close ${title}`}>
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7">{children}</div>
      </section>
    </div>
  );
}

function Badge({ count, label }: { count: number; label?: string }) {
  return (
    <span className="absolute -right-2 -top-2 z-10 flex h-7 min-w-7 items-center justify-center rounded-full bg-coral-ink px-1.5 text-xs font-extrabold text-white ring-[3px] ring-canvas">
      {count > 99 ? '99+' : count}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

function CategoryTile({ group, badge, badgeLabel }: { group: CategoryGroup; badge: number; badgeLabel: string }) {
  const { category, features, href } = group;
  const tone = TONE_CLASSES[category.tone];
  const Icon = category.icon;
  return (
    <Link
      href={href}
      className="group relative flex h-full min-h-[132px] flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-silver hover:shadow-lift"
    >
      <span className={cx('flex h-11 w-11 items-center justify-center rounded-xl', tone.soft, tone.ink)}>
        <Icon className="h-[22px] w-[22px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15.5px] font-bold text-ink">{category.name}</span>
        <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-ink-3">{category.description}</span>
      </span>
      <span className="mt-auto flex items-center gap-1 text-[12px] font-semibold text-ink-3 group-hover:text-brand-ink">
        {features.length === 1 ? 'Open' : `${features.length} tools`} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
      {badge > 0 && <Badge count={badge} label={badgeLabel} />}
    </Link>
  );
}

export function HomeBoard({
  hero,
  day,
  apps,
  openKey,
  onOpenChange,
}: {
  hero: React.ReactNode;
  /** The "My Day" block; it fills the remaining height on desktop. */
  day: React.ReactNode;
  apps: HomeApp[];
  openKey: string | null;
  onOpenChange: (key: string | null) => void;
}) {
  const { tenant } = useAuth();
  const open = apps.find((a) => a.label === openKey && a.sheet);
  const groups = categoriesFor(tenant?.role);
  // Each app's badge (e.g. "batches without a plan") is shown on the category its page belongs to.
  const badges = new Map<string, { count: number; labels: string[] }>();
  for (const a of apps) {
    const id = a.href && !a.sheet ? categoryOfHref(a.href, tenant?.role) : undefined;
    if (!id || !a.badge) continue;
    const b = badges.get(id) ?? { count: 0, labels: [] };
    b.count += a.badge;
    if (a.badgeLabel) b.labels.push(a.badgeLabel);
    badges.set(id, b);
  }
  const quick = apps.filter((a) => a.sheet);
  return (
    <div className="grid gap-x-12 gap-y-8 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(400px,452px)]">
      <div className="flex min-w-0 flex-col gap-7 lg:min-h-0">
        {hero}
        <div className="flex flex-col lg:min-h-0 lg:flex-1">{day}</div>
      </div>

      <aside aria-labelledby="workspace-heading" className="flex flex-col gap-4 lg:min-h-0">
        <h2 id="workspace-heading" className="text-[18px] font-extrabold tracking-tight text-ink">Your workspace</h2>
        {/* Extra rows scroll inside the column; the page itself stays put. */}
        <div className="flex flex-col gap-6 pt-2 pr-2 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
          <ul className="grid grid-cols-2 gap-3 sm:gap-4">
            {groups.map((g) => (
              <li key={g.category.id}>
                <CategoryTile group={g} badge={badges.get(g.category.id)?.count ?? 0} badgeLabel={badges.get(g.category.id)?.labels.join(', ') ?? ''} />
              </li>
            ))}
          </ul>
          {quick.length > 0 && (
            <section aria-labelledby="quick-heading" className="space-y-2.5">
              <h3 id="quick-heading" className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-4">Quick open</h3>
              <ul className="flex flex-wrap gap-2">
                {quick.map((a) => (
                  <li key={a.label} className="relative">
                    <button
                      type="button"
                      onClick={() => onOpenChange(a.label)}
                      aria-haspopup="dialog"
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface pl-2 pr-3.5 text-[13.5px] font-semibold text-ink-2 shadow-card transition-colors hover:border-silver hover:text-ink"
                    >
                      <AppArt name={a.art} size={24} />
                      {a.label}
                      {!!a.badge && (
                        <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-coral-ink px-1 text-[11px] font-extrabold text-white">
                          {a.badge > 99 ? '99+' : a.badge}
                          <span className="sr-only"> {a.badgeLabel}</span>
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>

      {open && (
        <Sheet title={open.label} art={open.art} onClose={() => onOpenChange(null)}>{open.sheet}</Sheet>
      )}
    </div>
  );
}

'use client';

/**
 * Strynkix Live Books — home layout. Left: greeting card, then "My Day" filling
 * the rest of the screen. Right: "My Apps", a 3-column grid of tall tiles. Tiles
 * either open a page or open a section in a side sheet, so on desktop the home
 * page itself never scrolls.
 */

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { cx } from '@/components/ui/tones';
import { AppArt, AppArtName } from './AppArt';
import type { AppTile } from './HomeBlocks';
import { X } from 'lucide-react';

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

const TILE = 'group relative flex h-[150px] w-full flex-col rounded-2xl border border-line bg-surface shadow-card transition-[box-shadow,border-color] duration-200 hover:border-silver hover:shadow-lift';

function Tile({ app, onOpen }: { app: HomeApp; onOpen: () => void }) {
  const inner = (
    <>
      <span className="flex flex-1 items-center justify-center transition-transform duration-200 group-hover:-translate-y-0.5">
        <AppArt name={app.art} size={56} />
      </span>
      <span className="border-t border-line px-2 py-3 text-center text-[14.5px] font-semibold leading-tight text-ink">{app.label}</span>
      {/* After the label so the tile reads "Assignments, 2 …" */}
      {!!app.badge && (
        <span className="absolute -right-2 -top-2 z-10 flex h-7 min-w-7 items-center justify-center rounded-full bg-coral-ink px-1.5 text-xs font-extrabold text-white ring-[3px] ring-canvas">
          {app.badge > 99 ? '99+' : app.badge}
          <span className="sr-only"> {app.badgeLabel}</span>
        </span>
      )}
    </>
  );
  if (app.href && !app.sheet) return <Link href={app.href} className={TILE}>{inner}</Link>;
  return (
    <button type="button" onClick={app.sheet ? onOpen : app.onClick} aria-haspopup={app.sheet ? 'dialog' : undefined} className={TILE}>
      {inner}
    </button>
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
  const open = apps.find((a) => a.label === openKey && a.sheet);
  return (
    <div className="grid gap-x-12 gap-y-8 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(400px,452px)]">
      <div className="flex min-w-0 flex-col gap-7 lg:min-h-0">
        {hero}
        <div className="flex flex-col lg:min-h-0 lg:flex-1">{day}</div>
      </div>

      <aside aria-labelledby="my-apps-heading" className="flex flex-col gap-4 lg:min-h-0">
        <h2 id="my-apps-heading" className="text-[18px] font-extrabold tracking-tight text-ink">My Apps</h2>
        {/* Extra rows scroll inside the column; the page itself stays put. */}
        <ul className={cx('grid grid-cols-2 gap-4 pt-2 pr-2 sm:grid-cols-3 lg:min-h-0 lg:overflow-y-auto lg:pb-2')}>
          {apps.map((a) => (
            <li key={a.label}><Tile app={a} onOpen={() => onOpenChange(a.label)} /></li>
          ))}
        </ul>
      </aside>

      {open && (
        <Sheet title={open.label} art={open.art} onClose={() => onOpenChange(null)}>{open.sheet}</Sheet>
      )}
    </div>
  );
}

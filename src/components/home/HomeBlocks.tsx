'use client';

/**
 * Strynkix Live Books — home building blocks: the greeting card ("hero") and
 * the "My Apps" tile grid. Every tile opens a real page; badges show real counts.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/context/AuthContext';
import { BrandMark } from '@/components/ui/Illustrations';
import { cx } from '@/components/ui/tones';
import { openHelpAssistant } from '@/components/help/HelpAssistant';
import { AppArt, AppArtName } from './AppArt';

/** Display names of the caller's organization and branch (members may read both). */
export function useScopeNames() {
  const { tenant } = useAuth();
  const [names, setNames] = useState<{ org?: string; branch?: string }>({});
  useEffect(() => {
    let alive = true;
    if (!tenant) return;
    Promise.all([
      getDoc(doc(db, 'organizations', tenant.orgId)).catch(() => null),
      tenant.branchId ? getDoc(doc(db, 'branches', tenant.branchId)).catch(() => null) : Promise.resolve(null),
    ]).then(([org, branch]) => {
      if (!alive) return;
      setNames({
        org: org?.exists() ? (org.data().name as string) : undefined,
        branch: branch?.exists() ? (branch.data().name as string) : undefined,
      });
    });
    return () => {
      alive = false;
    };
  }, [tenant]);
  return names;
}

export interface HeroFact {
  icon: React.ComponentType<{ className?: string }>;
  text: React.ReactNode;
}

/** Greeting card on a light grid-paper background with the academy badge. */
export function HomeHero({ name, facts, academy }: { name: string; facts: HeroFact[]; academy?: string }) {
  return (
    <section
      aria-label="Welcome"
      className="relative overflow-hidden rounded-card border border-brand-line border-b-[3px] border-b-brand bg-brand-soft/50 animate-rise"
      style={{
        backgroundImage:
          'linear-gradient(rgb(43 89 240 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(43 89 240 / 0.06) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div className="flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-center">
        <div className="min-w-0 flex-1 space-y-4">
          <h1 className="text-[26px] font-extrabold tracking-tight text-ink sm:text-[30px]">
            Hi {name} <span aria-hidden="true">👋</span>
          </h1>
          <ul className="space-y-2.5">
            {facts.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[15px] text-ink-2">
                <f.icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-3" />
                <span className="min-w-0">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Academy badge in concentric rings */}
        <div aria-hidden="true" className="relative mx-auto hidden h-48 w-56 shrink-0 items-center justify-center sm:flex md:mx-0">
          <span className="absolute h-52 w-52 rounded-full bg-brand/[0.05]" />
          <span className="absolute h-40 w-40 rounded-full bg-brand/[0.07]" />
          <span className="absolute left-3 top-8 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-coral" />
          <span className="absolute right-4 top-10 h-2.5 w-2.5 rotate-45 border-2 border-ink-3" />
          <span className="absolute bottom-10 left-6 h-2.5 w-2.5 rounded-full border-2 border-ink-4" />
          <div className="relative flex h-32 w-36 flex-col items-center justify-center gap-2 rounded-lg border border-line bg-surface shadow-lift">
            <BrandMark size={44} />
            <span className="px-2 text-center text-[11px] font-extrabold uppercase leading-tight tracking-[0.08em] text-ink-2">{academy || 'Strynkix Academy'}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export interface AppTile {
  label: string;
  art: AppArtName;
  href?: string;
  onClick?: () => void;
  badge?: number;
  /** Accessible description of what the badge counts. */
  badgeLabel?: string;
}

function TileInner({ tile }: { tile: AppTile }) {
  return (
    <>
      {!!tile.badge && (
        <span className="absolute -right-2 -top-2 z-10 flex h-7 min-w-7 items-center justify-center rounded-full bg-coral-ink px-1.5 text-xs font-extrabold text-white ring-[3px] ring-canvas">
          {tile.badge > 99 ? '99+' : tile.badge}
          <span className="sr-only"> {tile.badgeLabel}</span>
        </span>
      )}
      <span className="flex flex-1 items-center justify-center py-5 transition-transform duration-200 group-hover:-translate-y-0.5">
        <AppArt name={tile.art} size={54} />
      </span>
      <span className="border-t border-line px-2 py-3 text-center text-[14px] font-semibold leading-tight text-ink">{tile.label}</span>
    </>
  );
}

const TILE = 'group relative flex h-full min-h-[150px] flex-col rounded-2xl border border-line bg-surface shadow-card transition-[box-shadow,border-color] duration-200 hover:border-silver hover:shadow-lift focus-visible:outline-2';

export function AppGrid({ title = 'My Apps', tiles }: { title?: string; tiles: AppTile[] }) {
  return (
    <section aria-labelledby="my-apps-heading" className="space-y-4">
      <h2 id="my-apps-heading" className="text-[18px] font-extrabold tracking-tight text-ink">{title}</h2>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.label}>
            {t.href ? (
              <Link href={t.href} className={TILE}><TileInner tile={t} /></Link>
            ) : (
              <button type="button" onClick={t.onClick} className={cx(TILE, 'w-full')}><TileInner tile={t} /></button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Tile shared by every role: open the help assistant. */
export const helpTile: AppTile = { label: 'Help', art: 'help', onClick: openHelpAssistant };

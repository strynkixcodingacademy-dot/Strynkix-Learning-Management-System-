'use client';

/**
 * Strynkix Live Books — shared by the role homes: the caller's academy and
 * branch names, and the quiet row of places to go from home.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/context/AuthContext';
import { ChevronRight, type LucideIcon } from 'lucide-react';

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

export interface HomeLink {
  label: string;
  href: string;
  icon: LucideIcon;
  /** A real count of what is waiting there. */
  count?: number;
  countLabel?: string;
}

/** Destinations with a real count beside them, as an index rather than a tile grid. */
export function HomeIndex({ links }: { links: HomeLink[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {links.map((l) => (
        <li key={l.href + l.label}>
          <Link href={l.href} className="group flex items-center gap-3 py-2.5 text-sm text-ink-2 transition-colors hover:text-ink">
            <l.icon className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{l.label}</span>
            {!!l.count && (
              <span className="rounded-full bg-coral-soft px-2 text-xs font-medium tabular-nums text-coral-ink">
                {l.count}<span className="sr-only"> {l.countLabel}</span>
              </span>
            )}
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-silver transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

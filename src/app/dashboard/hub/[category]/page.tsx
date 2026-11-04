'use client';

/**
 * Strynkix Live Books — a category hub: the pages of one category (Teaching,
 * Money, …) as tiles, each with a one-line description. Only the categories
 * and pages the signed-in role can open are shown; every page still
 * authorizes on its own.
 */

import React, { Suspense, use } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { categoriesFor } from '@/lib/navigation/catalog';
import { buttonClasses } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/Page';
import { EmptyState, LoadingState } from '@/components/ui/States';
import { cx, TONE_CLASSES, TONE_GRADIENTS } from '@/components/ui/tones';
import { StaggerItem, StaggerList } from '@/components/ui/Motion';
import { ArrowRight } from 'lucide-react';

interface HubPageProps {
  params: Promise<{ category: string }>;
}

function Hub({ params }: HubPageProps) {
  const { category: id } = use(params);
  const { tenant } = useAuth();
  if (!tenant) return null;
  const group = categoriesFor(tenant.role).find((g) => g.category.id === id);
  if (!group) {
    return (
      <EmptyState title="This section isn’t available" action={<Link href="/dashboard" className={buttonClasses('primary', 'sm')}>Back to Home</Link>}>
        It doesn’t exist or isn’t part of your role. Use search to find what you need.
      </EmptyState>
    );
  }
  const { category, features } = group;
  const tone = TONE_CLASSES[category.tone];
  const Icon = category.icon;

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-4">
        <span className={cx('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-lift', TONE_GRADIENTS[category.tone])}>
          <Icon className="h-7 w-7" />
        </span>
        <PageHeader title={category.name} description={category.description} className="flex-1" />
      </div>
      <StaggerList className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {features.map((f) => {
          const FIcon = f.icon;
          return (
            <StaggerItem key={f.href}>
              <Link
                href={f.href}
                className="group flex h-full items-start gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-silver hover:shadow-lift"
              >
                <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105', tone.soft, tone.ink)}>
                  <FIcon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15.5px] font-bold text-ink">{f.name}</span>
                  <span className="mt-0.5 block text-[13.5px] leading-snug text-ink-3">{f.description}</span>
                </span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </Link>
            </StaggerItem>
          );
        })}
      </StaggerList>
    </div>
  );
}

export default function HubPage({ params }: HubPageProps) {
  return (
    <Suspense fallback={<LoadingState label="Loading…" />}>
      <AppShell><Hub params={params} /></AppShell>
    </Suspense>
  );
}

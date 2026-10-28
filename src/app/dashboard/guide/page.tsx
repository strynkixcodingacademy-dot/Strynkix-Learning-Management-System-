'use client';

/**
 * Strynkix Live Books — User Guide.
 * Step-by-step instructions for every task, filtered to the reader's role, with
 * search. The same content powers the help assistant (src/lib/help/guide.ts).
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell, ROLE_LABELS } from '@/components/dashboard/AppShell';
import { openHelpAssistant } from '@/components/help/HelpAssistant';
import { PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { GuideTopic, topicsForRole } from '@/lib/help/guide';
import { scoreTopic, tokenize } from '@/lib/help/assistant';
import { ArrowRight, BookOpen, Compass, GraduationCap, Info, LifeBuoy, MessageCircleQuestion, Search, Settings2, Store, Wrench, type LucideIcon } from 'lucide-react';

const CATEGORY_ICON: Record<GuideTopic['category'], LucideIcon> = {
  'Getting started': Compass,
  Learning: GraduationCap,
  Teaching: BookOpen,
  'Branch operations': Store,
  'Academy administration': Settings2,
  Troubleshooting: Wrench,
};

const CATEGORY_ORDER: GuideTopic['category'][] = ['Getting started', 'Learning', 'Teaching', 'Branch operations', 'Academy administration', 'Troubleshooting'];

function TopicCard({ topic, index }: { topic: GuideTopic; index: number }) {
  return (
    <article id={topic.id} className="scroll-mt-24 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6 target:ring-2 target:ring-highlight">
      <div className="flex items-start gap-3">
        <span className="font-display text-[22px] font-semibold leading-none text-ink-4 tabular-nums">{String(index).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="text-[16px] font-extrabold tracking-tight text-ink">{topic.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-3">{topic.summary}</p>
          </div>
          <ol className="space-y-2">
            {topic.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand-line bg-brand-soft text-[11px] font-bold text-brand-ink">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {topic.tips && topic.tips.length > 0 && (
            <ul className="space-y-1.5 rounded-xl border border-warning-line bg-highlight-soft px-3.5 py-2.5">
              {topic.tips.map((tip) => (
                <li key={tip} className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" aria-hidden="true" /> {tip}
                </li>
              ))}
            </ul>
          )}
          {topic.link && (
            <Link href={topic.link.href} className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-ink hover:underline">
              Go to {topic.link.label} <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export default function GuidePage() {
  const { tenant } = useAuth();
  const [q, setQ] = useState('');
  const all = useMemo(() => topicsForRole(tenant?.role), [tenant?.role]);

  const visible = useMemo(() => {
    const tokens = tokenize(q);
    if (!tokens.length) return all;
    return all
      .map((t) => ({ t, s: scoreTopic(t, tokens, tenant?.role) }))
      .filter((r) => r.s >= 2.5)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.t);
  }, [all, q, tenant?.role]);

  const searching = q.trim().length > 0;
  const categories = CATEGORY_ORDER.filter((c) => visible.some((t) => t.category === c));
  const ordered = searching ? visible : categories.flatMap((c) => visible.filter((t) => t.category === c));
  const number = (t: GuideTopic) => ordered.indexOf(t) + 1;

  return (
    <AppShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow={tenant ? `${ROLE_LABELS[tenant.role]} guide` : 'User guide'}
          title="User Guide"
          description="Step-by-step instructions for everything you can do in Strynkix Live Books. Only the tasks for your role are shown."
        />

        <div className="relative overflow-hidden rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
          <div aria-hidden="true" className="paper-dots absolute inset-0 opacity-60" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <label htmlFor="guide-search" className="sr-only">Search the guide</label>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden="true" />
              <input id="guide-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: enroll a student, grade, reset password…" className={cx(fieldClasses, 'h-12 pl-10 text-[15px]')} />
            </div>
            <button type="button" onClick={openHelpAssistant} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-card hover:bg-brand-strong">
              <MessageCircleQuestion className="h-4 w-4" /> Ask the assistant
            </button>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Guide sections" className="hidden lg:block">
            <div className="sticky top-24 space-y-4">
              {categories.map((c) => (
                <div key={c} className="space-y-1">
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-4">{c}</div>
                  {visible.filter((t) => t.category === c).map((t) => (
                    <a key={t.id} href={`#${t.id}`} className="block rounded-lg px-2 py-1 text-[13px] font-semibold leading-snug text-ink-3 hover:bg-surface hover:text-ink">{t.title}</a>
                  ))}
                </div>
              ))}
            </div>
          </nav>

          <div className="space-y-10">
            {visible.length === 0 ? (
              <EmptyState illustration="compass" title="Nothing matches that search" action={
                <button type="button" onClick={openHelpAssistant} className="text-sm font-bold text-brand-ink hover:underline">Ask the assistant instead</button>
              }>
                Try simpler words such as “student”, “plan” or “password”.
              </EmptyState>
            ) : searching ? (
              <section className="space-y-4">
                <h2 className="text-sm font-bold text-ink-3">{visible.length} result{visible.length === 1 ? '' : 's'} for “{q.trim()}”</h2>
                {visible.map((t) => <TopicCard key={t.id} topic={t} index={number(t)} />)}
              </section>
            ) : (
              categories.map((c) => {
                const Icon = CATEGORY_ICON[c];
                return (
                  <section key={c} aria-labelledby={`cat-${c}`} className="space-y-4">
                    <h2 id={`cat-${c}`} className="flex items-center gap-2.5 text-[17px] font-extrabold tracking-tight text-ink">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon className="h-4 w-4" /></span>
                      {c}
                    </h2>
                    {visible.filter((t) => t.category === c).map((t) => <TopicCard key={t.id} topic={t} index={number(t)} />)}
                  </section>
                );
              })
            )}

            <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-line-strong bg-surface p-5 sm:flex-row sm:items-center">
              <LifeBuoy className="h-6 w-6 text-brand" aria-hidden="true" />
              <p className="flex-1 text-sm text-ink-3">
                Still stuck? Students and instructors can contact their branch manager; branch managers can contact the academy’s Super Admin.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

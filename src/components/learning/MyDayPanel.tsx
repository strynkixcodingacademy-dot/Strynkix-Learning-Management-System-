'use client';

/**
 * Strynkix Live Books — "Today's learning": the day's plan as a numbered rail,
 * in the order the instructor set it. The next open step is marked with the
 * ribbon. When nothing is planned, a calm note points to what's next.
 */

import React from 'react';
import Link from 'next/link';
import { Course, DailyPlan } from '@/types/domain';
import { buttonClasses } from '@/components/ui/Button';
import { SectionLink } from '@/components/ui/Page';
import { cx } from '@/components/ui/tones';
import { formatPlanDate, formatTime } from './LearningBits';
import { ArrowRight, Check, ClipboardList, Flag } from 'lucide-react';

export interface MyDayStep {
  key: string;
  kind: 'lesson' | 'assignment';
  title: string;
  detail: string;
  href: string;
  done: boolean;
  needsAction: boolean;
  status: React.ReactNode;
  actionLabel: string;
  /** Lesson: the plan's "lessons due by"; assignment: its deadline. */
  due?: string;
}

export interface MyDayGroup {
  course: Course;
  plan: DailyPlan;
  steps: MyDayStep[];
}

function StepRow({ step, number, isNext, due }: { step: MyDayStep; number: number; isNext: boolean; due?: string }) {
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-8 w-px bg-line-strong [li:last-child>&]:hidden" />
      <span aria-hidden="true" className={cx(
        'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium tabular-nums',
        step.done ? 'bg-success text-white' : isNext ? 'bg-brand text-white' : 'border border-line-strong bg-surface text-ink-2'
      )}>
        {step.done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : step.kind === 'assignment' ? <ClipboardList className="h-3.5 w-3.5" /> : number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href={step.href} className={cx('text-body font-medium leading-snug hover:text-brand-ink hover:underline', step.done ? 'text-ink-3' : 'text-ink')}>{step.title}</Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            {step.status}
            <span>{step.detail}{due && step.kind === 'lesson' ? `, by ${formatTime(due)}` : ''}</span>
          </div>
        </div>
        {!step.done && (
          <Link href={step.href} aria-label={`${step.actionLabel}: ${step.title}`} className={buttonClasses(isNext ? 'primary' : 'secondary', 'sm', 'self-start')}>
            {step.actionLabel}
          </Link>
        )}
      </div>
    </li>
  );
}

export function MyDayPanel({
  groups,
  nextPlan,
  fallback,
  today,
}: {
  groups: MyDayGroup[];
  nextPlan?: { plan: DailyPlan; course: Course };
  fallback?: { href: string; label: string };
  today: string;
}) {
  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id="my-day-heading" className="type-section text-ink">Today&apos;s plan</h2>
      {groups[0] && <SectionLink href={`/courses/${groups[0].course.id}?tab=schedule`}>Full schedule</SectionLink>}
    </div>
  );

  if (groups.length === 0) {
    return (
      <section aria-labelledby="my-day-heading" className="space-y-4">
        {header}
        <div className="rounded-card border border-line bg-surface p-5 sm:p-6">
          <p className="text-body font-medium text-ink">No plan for {formatPlanDate(today)}.</p>
          <p className="mt-1 max-w-[52ch] text-sm text-ink-3">
            {nextPlan
              ? <>Next up is <span className="font-medium text-ink-2">{nextPlan.plan.title}</span> ({nextPlan.course.title}) on {formatPlanDate(nextPlan.plan.date)}.</>
              : 'Your instructor hasn’t published the next plan yet. A good time to read ahead.'}
          </p>
          {fallback && (
            <Link href={fallback.href} className={buttonClasses('secondary', 'sm', 'mt-4')}>
              {fallback.label} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </section>
    );
  }

  const firstOpen = groups.flatMap((g) => g.steps).find((s) => s.needsAction)?.key;

  return (
    <section aria-labelledby="my-day-heading" className="space-y-4">
      {header}
      <div className="space-y-4">
        {groups.map((group) => {
          const done = group.steps.filter((s) => s.done).length;
          return (
            <article key={group.plan.id} className="rounded-card border border-line bg-surface p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold leading-snug text-ink">{group.plan.title}</h3>
                  <p className="mt-0.5 text-sm text-ink-3">{group.course.title}</p>
                </div>
                <p className="shrink-0 text-sm tabular-nums text-ink-3">{done}/{group.steps.length}</p>
              </div>

              {group.plan.objectives.length > 0 && (
                <div className="mt-4 rounded-lg bg-warning-soft px-4 py-3">
                  <p className="text-sm font-medium text-warning-ink">By the end of today you should be able to</p>
                  <ul className="mt-1.5 space-y-1">
                    {group.plan.objectives.map((o, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-ink-2">
                        <Flag className="mt-[3px] h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" /> {o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <ol aria-label={`Steps for ${group.plan.title}`} className="mt-5">
                {group.steps.map((s, i) => (
                  <StepRow key={`${group.plan.id}-${s.key}`} step={s} number={i + 1} isNext={s.key === firstOpen}
                    due={s.due ?? (s.kind === 'lesson' ? group.plan.learningDueAt : undefined)} />
                ))}
              </ol>
            </article>
          );
        })}
      </div>
    </section>
  );
}

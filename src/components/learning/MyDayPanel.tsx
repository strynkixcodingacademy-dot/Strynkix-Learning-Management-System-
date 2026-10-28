'use client';

/**
 * Strynkix Live Books — "My Day" for students: today's steps as time slots on
 * the left, the selected step (with its plan's targets and the action) on the
 * right. When nothing is planned, a calm empty state points to what's next.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Course, DailyPlan } from '@/types/domain';
import { buttonClasses } from '@/components/ui/Button';
import { ProgressRing } from '@/components/ui/Progress';
import { cx } from '@/components/ui/tones';
import { RestDayArt } from '@/components/home/AppArt';
import { formatPlanDate, formatTime } from './LearningBits';
import { ArrowRight, BookOpen, Check, ClipboardList, Flag, RefreshCw } from 'lucide-react';

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

interface Slot {
  step: MyDayStep;
  group: MyDayGroup;
}

export function MyDayPanel({
  groups,
  nextPlan,
  fallback,
  onRefresh,
}: {
  groups: MyDayGroup[];
  nextPlan?: { plan: DailyPlan; course: Course };
  fallback?: { href: string; label: string };
  onRefresh: () => void;
}) {
  const slots: Slot[] = groups.flatMap((group) => group.steps.map((step) => ({ step, group })));
  const firstOpen = slots.find((s) => s.step.needsAction) ?? slots[0];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = slots.find((s) => s.step.key === selectedKey) ?? firstOpen;

  const header = (
    <div className="flex items-center justify-between gap-3">
      <h2 id="my-day-heading" className="text-[18px] font-extrabold tracking-tight text-ink">My Day</h2>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-3 hover:text-ink">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
        {groups[0] && (
          <Link href={`/courses/${groups[0].course.id}?tab=schedule`} className="inline-flex items-center gap-1 text-sm font-semibold text-ink-3 hover:text-ink">
            View schedule <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );

  if (!selected) {
    return (
      <section aria-labelledby="my-day-heading" className="space-y-4">
        {header}
        <div className="paper-dots flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-card border border-line bg-surface px-6 py-10 text-center">
          <RestDayArt />
          <p className="text-[15px] font-semibold text-ink-2">Looks like nothing is planned today</p>
          <p className="max-w-sm text-sm text-ink-3">
            {nextPlan
              ? <>Next up is <strong className="text-ink-2">{nextPlan.plan.title}</strong> ({nextPlan.course.title}) on {formatPlanDate(nextPlan.plan.date)}.</>
              : 'Your instructor hasn’t published the next plan yet. A good time to read ahead.'}
          </p>
          {fallback && <Link href={fallback.href} className={buttonClasses('secondary', 'sm', 'mt-1')}>{fallback.label}</Link>}
        </div>
      </section>
    );
  }

  const { step, group } = selected;
  const done = group.steps.filter((s) => s.done).length;
  const pct = group.steps.length ? Math.round((done / group.steps.length) * 100) : null;

  return (
    <section aria-labelledby="my-day-heading" className="space-y-4">
      {header}
      <div className="grid grid-cols-1 overflow-hidden rounded-card border border-line bg-surface shadow-card md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        {/* Time slots */}
        <ol aria-label="Today's steps" className="min-w-0 divide-y divide-line border-b border-line md:border-b-0 md:border-r">
          {slots.map(({ step: s, group: g }) => {
            const active = s.key === step.key;
            const due = s.due ?? (s.kind === 'lesson' ? g.plan.learningDueAt : undefined);
            return (
              <li key={`${g.plan.id}-${s.key}`}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(s.key)}
                  aria-pressed={active}
                  className={cx(
                    'flex w-full items-start gap-3 border-l-[3px] px-4 py-3.5 text-left transition-colors',
                    active ? 'border-l-brand bg-brand-soft/60' : 'border-l-transparent hover:bg-canvas'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold text-ink-3">
                      {s.kind === 'assignment' ? 'Assignment' : 'Lesson'}{due ? ` · by ${formatTime(due)}` : ''}
                    </span>
                    <span className={cx('mt-0.5 block truncate text-[14px] font-bold', s.done ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>{s.title}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">{s.status}</span>
                  </span>
                  <span aria-hidden="true" className={cx(
                    'mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                    s.done ? 'border-success bg-success text-white' : 'border-line-strong text-ink-3'
                  )}>
                    {s.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : s.kind === 'assignment' ? <ClipboardList className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Selected step */}
        <div className="paper-dots flex min-w-0 flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-ink-3">{group.course.title}</div>
              <h3 className="text-[17px] font-extrabold leading-snug text-ink">{group.plan.title}</h3>
            </div>
            <ProgressRing value={pct} tone={pct === 100 ? 'success' : 'brand'} label={`${group.plan.title} progress`} size={48}>
              {done}/{group.steps.length}
            </ProgressRing>
          </div>

          {group.plan.objectives.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">Today&apos;s targets</div>
              <ul className="flex flex-wrap gap-2">
                {group.plan.objectives.map((o, i) => (
                  <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-2">
                    <Flag className="h-3 w-3 text-coral" aria-hidden="true" /> {o}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-auto rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-brand-ink">{step.done ? 'Done' : step.needsAction ? 'Up next' : step.kind}</div>
            <div className="mt-1 text-[16px] font-extrabold text-ink">{step.title}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">{step.status}<span>{step.detail}</span></div>
            <Link href={step.href} className={buttonClasses(step.done ? 'secondary' : 'primary', 'md', 'mt-4')} aria-label={`${step.actionLabel}: ${step.title}`}>
              {step.actionLabel} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

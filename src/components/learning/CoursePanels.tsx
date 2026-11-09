'use client';

/**
 * Strynkix Live Books — course page panels: Schedule, Assignments, About.
 * Students see their own batch's published plans and assignments; staff see a
 * pointer to batch management, since plans are per batch.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Assignment, Batch, Course, DailyPlan, Lesson, Progress, Submission } from '@/types/domain';
import { getDeadlineState } from '@/lib/learning/submission-state';
import { DeadlineBadge, formatDue, formatPlanDate, formatTime, LESSON_STATE_LOOK } from './LearningBits';
import { Card } from '@/components/ui/Page';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { buttonClasses } from '@/components/ui/Button';
import { cx } from '@/components/ui/tones';
import { ArrowRight, ClipboardList, Flag } from 'lucide-react';

export interface StudentCourseLearningData {
  plans: DailyPlan[];
  assignments: Assignment[];
  submissions: Submission[];
}

function StaffNotice() {
  return (
    <EmptyState compact illustration="calendar" title="Plans live on each batch"
      action={<Link href="/dashboard/batches" className={buttonClasses('secondary', 'sm')}>Open batches</Link>}>
      Daily plans and assignments are scheduled per batch, so they appear for students in that batch.
    </EmptyState>
  );
}

function PanelLoading() {
  return <div className="space-y-3" role="status"><span className="sr-only">Loading…</span><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
}

export function CourseSchedulePanel({
  courseId,
  data,
  lessons,
  progress,
  today,
  isStudent,
  error,
}: {
  courseId: string;
  data: StudentCourseLearningData | null;
  lessons: Lesson[];
  progress: Progress[];
  today: string;
  isStudent: boolean;
  error: string | null;
}) {
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  if (!isStudent) return <StaffNotice />;
  if (error) return <ErrorState title="Schedule unavailable">{error}</ErrorState>;
  if (!data) return <PanelLoading />;
  if (data.plans.length === 0) {
    return <EmptyState illustration="calendar" title="No sessions planned yet">Your instructor hasn&apos;t published a daily plan for this course. Check back soon.</EmptyState>;
  }

  const lessonsById = new Map(lessons.map((l) => [l.id, l]));
  const statusByLesson = new Map(progress.map((p) => [p.lessonId, p.status]));
  const upcoming = data.plans.filter((p) => p.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = data.plans.filter((p) => p.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const list = view === 'upcoming' ? upcoming : past;

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Which sessions" className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-surface-muted p-0.5">
        {(['upcoming', 'past'] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}
            className={cx('rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150', view === v ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}>
            {v === 'upcoming' ? `Today & upcoming (${upcoming.length})` : `Past (${past.length})`}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState compact illustration="calendar" title={view === 'upcoming' ? 'Nothing scheduled ahead' : 'No past sessions'}>
          {view === 'upcoming' ? 'Upcoming plans appear here as soon as your instructor publishes them.' : 'Sessions move here after their day.'}
        </EmptyState>
      ) : (
        <ol className="space-y-3">
          {list.map((plan) => {
            const isToday = plan.date === today;
            const lessonsDone = plan.lessonIds.filter((id) => statusByLesson.get(id) === 'completed').length;
            return (
              <Card as="li" key={plan.id} className="relative p-5">
                {isToday && <span aria-hidden="true" className="ribbon absolute right-5 top-0" />}
                <div className="flex flex-col gap-4 sm:flex-row">
                  <div className={cx('flex w-14 shrink-0 flex-col sm:items-center', isToday ? 'text-warning-ink' : 'text-ink-3')}>
                    <span className="text-xs">{formatPlanDate(plan.date).split(',')[0]}</span>
                    <span className="type-figure mt-0.5 text-[1.75rem]">{Number(plan.date.slice(8, 10))}</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-ink">{plan.title}</h3>
                      {isToday && <span className="rounded-full bg-warning-soft px-2 text-xs font-medium text-warning-ink">Today</span>}
                    </div>
                    <p className="text-xs text-ink-3">{plan.lessonIds.length ? `${lessonsDone} of ${plan.lessonIds.length} lessons done, ` : ''}lessons due {formatTime(plan.learningDueAt)}</p>
                    {plan.objectives.length > 0 && (
                      <ul className="space-y-1">
                        {plan.objectives.map((o, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-ink-2">
                            <Flag className="mt-[3px] h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" /> {o}
                          </li>
                        ))}
                      </ul>
                    )}
                    {plan.lessonIds.length > 0 && (
                      <ul className="divide-y divide-line border-y border-line">
                        {plan.lessonIds.map((id) => {
                          const lesson = lessonsById.get(id);
                          const s = statusByLesson.get(id);
                          const look = LESSON_STATE_LOOK[s === 'completed' ? 'completed' : s === 'in_progress' ? 'in_progress' : 'pending'];
                          return (
                            <li key={id}>
                              {lesson ? (
                                <Link href={`/courses/${courseId}/lessons/${id}`} className="flex items-center gap-3 py-2 text-sm transition-colors hover:text-brand-ink">
                                  <look.icon className={cx('w-4 h-4 shrink-0', s === 'completed' ? 'text-success' : s === 'in_progress' ? 'text-warning-ink' : 'text-ink-4')} aria-hidden="true" />
                                  <span className="min-w-0 flex-1 truncate text-ink-2">{lesson.title}</span>
                                  <span className="text-xs text-ink-3">{look.label}</span>
                                </Link>
                              ) : (
                                <span className="block py-2 text-sm text-ink-3">Lesson not available</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {plan.assignmentId && (
                      <Link href={`/courses/${courseId}/assignments/${plan.assignmentId}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink hover:underline">
                        <ClipboardList className="w-4 h-4" aria-hidden="true" /> Daily assignment <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function CourseAssignmentsPanel({
  courseId,
  data,
  now,
  isStudent,
  error,
}: {
  courseId: string;
  data: StudentCourseLearningData | null;
  now: Date;
  isStudent: boolean;
  error: string | null;
}) {
  if (!isStudent) return <StaffNotice />;
  if (error) return <ErrorState title="Assignments unavailable">{error}</ErrorState>;
  if (!data) return <PanelLoading />;
  if (data.assignments.length === 0) {
    return <EmptyState illustration="inbox" title="No assignments yet">Assignments your instructor publishes for your batch will appear here.</EmptyState>;
  }

  const byAssignment = new Map(data.submissions.map((s) => [s.assignmentId, s]));
  return (
    <Card as="section" className="overflow-hidden">
      <ul className="divide-y divide-line">
        {data.assignments.map((a) => {
          const submission = byAssignment.get(a.id) ?? null;
          const state = getDeadlineState(a.deadline, submission, now);
          const action = submission?.status === 'resubmit_requested' ? 'Fix & resubmit' : submission ? 'View' : 'Submit';
          return (
            <li key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5">
                            <div className="min-w-0 flex-1">
                <Link href={`/courses/${courseId}/assignments/${a.id}`} className="text-body font-medium text-ink hover:text-brand-ink">{a.title}</Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <DeadlineBadge state={state} size="sm" />
                  <span>{formatDue(a.deadline, now)}</span>
                                    <span>{submission?.status === 'graded' && typeof submission.score === 'number' ? <strong className="text-ink-2">{submission.score}/{a.totalPoints} marks</strong> : `${a.totalPoints} marks`}</span>
                </div>
              </div>
              <Link href={`/courses/${courseId}/assignments/${a.id}`} className={buttonClasses(action === 'View' ? 'secondary' : 'primary', 'sm', 'self-start sm:self-center')}>
                {action}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function CourseAboutPanel({ course, batch, lessonCount }: { course: Course; batch: Batch | null; lessonCount: number }) {
  const facts = [
    { label: 'Level', value: course.level.charAt(0).toUpperCase() + course.level.slice(1) },
    { label: 'Duration', value: `${course.estimatedWeeks} weeks, ${lessonCount} lessons` },
    ...(batch ? [{ label: 'Your batch', value: `${batch.name}, ${batch.startDate.slice(0, 10)} to ${batch.endDate?.slice(0, 10) ?? 'open'}` }] : []),
    // Display names only (D5); private staff profile fields are never shown.
    ...(batch?.instructorNames?.length
      ? [{ label: batch.instructorNames.length === 1 ? 'Your instructor' : 'Your instructors', value: batch.instructorNames.join(', ') }]
      : []),
  ];
  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div>
        <h2 className="type-section text-ink">About this course</h2>
        <p className="mt-3 max-w-[64ch] whitespace-pre-line font-reading text-[1.0625rem] leading-relaxed text-ink">{course.description || course.tagline}</p>
        {course.tags?.length > 0 && (
          <>
            <h3 className="mt-6 text-sm font-semibold text-ink-2">Topics you&apos;ll work with</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {course.tags.map((t) => (
                <li key={t} className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs text-ink-2">{t}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div>
        <dl className="divide-y divide-line border-y border-line">
          {facts.map((f) => (
            <div key={f.label} className="py-3">
              <dt className="text-xs text-ink-3">{f.label}</dt><dd className="mt-0.5 text-sm font-medium text-ink">{f.value}</dd>
            </div>
          ))}
          {course.prerequisites?.length > 0 && (
            <div className="py-3">
              <dt className="text-xs text-ink-3">Before you start</dt><dd className="mt-0.5 text-sm text-ink-2">{course.prerequisites.join(', ')}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

/** Short plain-text description for a lesson, taken from its first text block. */
export function lessonExcerpt(lesson: Lesson, max = 160): string | null {
  const block = lesson.blocks?.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return null;
  const plain = block.content.replace(/[#*_`>[\]()-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!plain) return null;
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

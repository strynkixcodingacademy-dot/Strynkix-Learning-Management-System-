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
import { ArrowRight, Bookmark, ClipboardList, Flag, GraduationCap, Tag, Timer, UserRoundCheck, Users } from 'lucide-react';

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
      <div role="radiogroup" aria-label="Which sessions" className="inline-flex rounded-xl border border-line bg-surface p-1">
        {(['upcoming', 'past'] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}
            className={cx('rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors', view === v ? 'bg-brand-soft text-brand-ink' : 'text-ink-3 hover:text-ink')}>
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
              <Card as="li" key={plan.id} className={cx('p-5', isToday && 'border-warning-line ring-2 ring-warning-soft')}>
                <div className="flex flex-col gap-4 sm:flex-row">
                  <div className={cx('flex w-16 shrink-0 flex-col items-center justify-center rounded-xl py-2 text-center', isToday ? 'bg-warning-soft text-warning-ink' : 'bg-surface-muted text-ink-2')}>
                    <span className="text-[11px] font-bold uppercase">{formatPlanDate(plan.date).split(',')[0]}</span>
                    <span className="text-xl font-extrabold leading-none">{Number(plan.date.slice(8, 10))}</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-ink">{plan.title}</h3>
                      {isToday && <span className="inline-flex items-center gap-1 rounded-md bg-warning px-1.5 py-0.5 text-[11px] font-bold text-ink"><Bookmark className="w-3 h-3 fill-current" aria-hidden="true" /> Today</span>}
                    </div>
                    <p className="text-xs text-ink-3">{plan.lessonIds.length ? `${lessonsDone} of ${plan.lessonIds.length} lessons done · ` : ''}Lessons due {formatTime(plan.learningDueAt)}</p>
                    {plan.objectives.length > 0 && (
                      <ul className="flex flex-wrap gap-2">
                        {plan.objectives.map((o, i) => (
                          <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-2">
                            <Flag className="w-3 h-3 text-coral" aria-hidden="true" /> {o}
                          </li>
                        ))}
                      </ul>
                    )}
                    {plan.lessonIds.length > 0 && (
                      <ul className="divide-y divide-line rounded-xl border border-line">
                        {plan.lessonIds.map((id) => {
                          const lesson = lessonsById.get(id);
                          const s = statusByLesson.get(id);
                          const look = LESSON_STATE_LOOK[s === 'completed' ? 'completed' : s === 'in_progress' ? 'in_progress' : 'pending'];
                          return (
                            <li key={id}>
                              {lesson ? (
                                <Link href={`/courses/${courseId}/lessons/${id}`} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-canvas">
                                  <look.icon className={cx('w-4 h-4 shrink-0', s === 'completed' ? 'text-success' : s === 'in_progress' ? 'text-warning-ink' : 'text-ink-4')} aria-hidden="true" />
                                  <span className="min-w-0 flex-1 truncate text-ink-2">{lesson.title}</span>
                                  <span className="text-xs text-ink-3">{look.label}</span>
                                </Link>
                              ) : (
                                <span className="block px-3 py-2.5 text-sm text-ink-3">Lesson not available</span>
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
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-soft text-teal-ink" aria-hidden="true"><ClipboardList className="w-5 h-5" /></span>
              <div className="min-w-0 flex-1">
                <Link href={`/courses/${courseId}/assignments/${a.id}`} className="text-[15px] font-semibold text-ink hover:text-brand-ink">{a.title}</Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <DeadlineBadge state={state} size="sm" />
                  <span>{formatDue(a.deadline, now)}</span>
                  <span>·</span>
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
    { icon: GraduationCap, label: 'Level', value: course.level.charAt(0).toUpperCase() + course.level.slice(1) },
    { icon: Timer, label: 'Duration', value: `${course.estimatedWeeks} weeks · ${lessonCount} lessons` },
    ...(batch ? [{ icon: Users, label: 'Your batch', value: `${batch.name} · ${batch.startDate.slice(0, 10)} → ${batch.endDate?.slice(0, 10) ?? 'open'}` }] : []),
    // Display names only (D5); private staff profile fields are never shown.
    ...(batch?.instructorNames?.length
      ? [{ icon: UserRoundCheck, label: batch.instructorNames.length === 1 ? 'Your instructor' : 'Your instructors', value: batch.instructorNames.join(', ') }]
      : []),
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="p-6 lg:col-span-2">
        <h2 className="text-lg font-bold text-ink">About this course</h2>
        <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{course.description || course.tagline}</p>
        {course.tags?.length > 0 && (
          <>
            <h3 className="mt-6 text-sm font-semibold text-ink-2">Topics you&apos;ll work with</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {course.tags.map((t) => (
                <li key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-2"><Tag className="w-3 h-3" aria-hidden="true" /> {t}</li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Card className="p-6">
        <dl className="space-y-4">
          {facts.map((f) => (
            <div key={f.label} className="flex gap-3">
              <f.icon className="mt-0.5 w-5 h-5 shrink-0 text-brand" aria-hidden="true" />
              <div><dt className="text-xs text-ink-3">{f.label}</dt><dd className="text-sm font-semibold text-ink">{f.value}</dd></div>
            </div>
          ))}
          {course.prerequisites?.length > 0 && (
            <div className="flex gap-3">
              <Flag className="mt-0.5 w-5 h-5 shrink-0 text-coral" aria-hidden="true" />
              <div><dt className="text-xs text-ink-3">Before you start</dt><dd className="text-sm text-ink-2">{course.prerequisites.join(', ')}</dd></div>
            </div>
          )}
        </dl>
      </Card>
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

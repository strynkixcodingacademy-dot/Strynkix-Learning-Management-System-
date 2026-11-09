'use client';

/**
 * Strynkix Live Books — Student home: a personal study desk.
 * Answers, in order: what to do next, what's planned today, what needs attention
 * and what's coming up, then the student's shelf of courses and how it's going.
 * Every figure is computed from the student's own records.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { getStudentEnrollments } from '@/lib/batches/service';
import { grantsContentAccess } from '@/lib/batches/scope';
import { getStudentSubmissions, loadStudentCourseOverview, StudentCourseOverview } from '@/lib/learning/service';
import { combineMetrics, toLocalDateKey } from '@/lib/learning/metrics';
import { getDeadlineState } from '@/lib/learning/submission-state';
import { getResumeLesson } from '@/lib/livebook/curriculum';
import { studentApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import type { StudentOverview } from '@/components/student/types';
import { Assignment, Course, DailyPlan, Lesson, Submission } from '@/types/domain';
import {
  DeadlineBadge,
  formatDue,
  formatPlanDate,
  LESSON_STATE_LOOK,
  LessonState,
  MetricRow,
} from './LearningBits';
import { buttonClasses } from '@/components/ui/Button';
import { CourseCover } from '@/components/ui/CourseIcon';
import { Section, SectionLink } from '@/components/ui/Page';
import { EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/States';
import { ProgressBar } from '@/components/ui/Progress';
import { StatusPill } from '@/components/ui/StatusPill';
import { cx } from '@/components/ui/tones';
import { MyDayPanel, MyDayStep } from './MyDayPanel';
import { ArrowRight, BookOpen, ClipboardList, MessageSquareWarning, Star } from 'lucide-react';

type Step = MyDayStep;

interface DayGroup {
  overview: StudentCourseOverview;
  plan: DailyPlan;
  steps: Step[];
}

function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function lessonStep(courseId: string, lesson: Lesson | undefined, lessonId: string, state: LessonState): Step {
  const look = LESSON_STATE_LOOK[state];
  return {
    key: lessonId,
    kind: 'lesson',
    title: lesson?.title ?? 'Lesson unavailable',
    detail: lesson ? `${lesson.estimatedMinutes ?? 15} min lesson` : 'This lesson is not published right now',
    href: lesson ? `/courses/${courseId}/lessons/${lessonId}` : `/courses/${courseId}`,
    done: state === 'completed',
    needsAction: state !== 'completed' && Boolean(lesson),
    status: <StatusPill tone={look.tone} icon={look.icon} size="sm">{look.label}</StatusPill>,
    actionLabel: state === 'completed' ? 'Review' : state === 'in_progress' ? 'Continue' : 'Start',
  };
}

function assignmentStep(courseId: string, assignment: Assignment, submission: Submission | null, now: Date): Step {
  const state = getDeadlineState(assignment.deadline, submission, now);
  const correction = submission?.status === 'resubmit_requested';
  const done = Boolean(submission) && !correction;
  return {
    key: assignment.id,
    kind: 'assignment',
    title: assignment.title,
    detail: `${formatDue(assignment.deadline, now)}, ${assignment.totalPoints} marks`,
    href: `/courses/${courseId}/assignments/${assignment.id}`,
    done,
    needsAction: !done,
    status: <DeadlineBadge state={state} size="sm" />,
    actionLabel: correction ? 'Fix & resubmit' : submission ? 'View' : 'Submit',
    due: assignment.deadline,
  };
}

/** One volume on the student's shelf: the cover, the title, and how far along it is. */
function ShelfBook({ overview }: { overview: StudentCourseOverview }) {
  const { course, courseCompletion, modules, lessons, progress } = overview;
  const resume = getResumeLesson(modules, lessons, progress);
  const complete = courseCompletion.total > 0 && courseCompletion.completed === courseCompletion.total;
  return (
    <li className="min-w-0">
      <Link href={`/courses/${course.id}`} className="group block rounded-md">
        <CourseCover course={course} level={course.level} className="shadow-[0_14px_24px_-16px_rgb(10_14_40/0.5)] transition-transform duration-200 ease-out group-hover:-translate-y-0.5" />
        <span className="mt-3 block text-sm font-medium leading-snug text-ink group-hover:text-brand-ink">{course.title}</span>
      </Link>
      <div className="mt-2 space-y-1">
        <ProgressBar value={courseCompletion.percentage} tone={complete ? 'success' : 'brand'} label={`${course.title} progress`} size="sm" />
        <p className="text-xs text-ink-3">
          {courseCompletion.total ? `${courseCompletion.completed} of ${courseCompletion.total} lessons` : 'No lessons published yet'}
        </p>
        {resume && !complete && <p className="line-clamp-1 text-xs text-ink-3">Next: {resume.title}</p>}
      </div>
    </li>
  );
}

/** The one thing to do next, set large. */
function NextUp({ course, title, detail, href, actionLabel, isToday, progress }: {
  course: Course;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  isToday: boolean;
  progress: { percentage: number | null; completed: number; total: number };
}) {
  return (
    <section aria-label="What to do next" className="relative flex gap-5 rounded-card border border-line bg-surface p-5 sm:gap-7 sm:p-7">
      {isToday && <span aria-hidden="true" className="ribbon absolute right-6 top-0" />}
      <Link href={`/courses/${course.id}`} tabIndex={-1} aria-hidden="true" className="hidden w-28 shrink-0 sm:block md:w-32">
        <CourseCover course={course} level={course.level} className="shadow-[0_14px_24px_-16px_rgb(10_14_40/0.55)]" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-5">
        <div className="pr-6">
          <p className="text-sm text-ink-3">{course.title}</p>
          <h2 className="mt-1 font-display text-[clamp(1.5rem,1.25rem+1vw,2rem)] font-[560] leading-[1.15] tracking-[-0.02em] text-ink">{title}</h2>
          <p className="mt-2 text-sm text-ink-3">{detail}</p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <Link href={href} className={buttonClasses('primary', 'lg', 'group self-start')}>
            {actionLabel} <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          {progress.total > 0 && (
            <div className="min-w-0 flex-1 sm:max-w-64">
              <ProgressBar value={progress.percentage} tone="brand" label={`${course.title} progress`} />
              <p className="mt-1.5 text-xs text-ink-3">{progress.completed} of {progress.total} lessons in this course</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface AttentionItem {
  key: string;
  kind: 'correction' | 'graded';
  title: string;
  courseTitle: string;
  detail: string;
  href: string;
}

const RECENT_GRADE_MS = 7 * 24 * 60 * 60 * 1000;

/** Correction requests (any date) and work graded in the last 7 days. */
function getAttentionItems(overviews: StudentCourseOverview[], now: Date): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const o of overviews) {
    for (const sub of o.submissions) {
      const assignment = o.assignments.find((a) => a.id === sub.assignmentId);
      if (!assignment) continue;
      const href = `/courses/${o.course.id}/assignments/${assignment.id}`;
      if (sub.status === 'resubmit_requested') {
        items.push({ key: sub.id, kind: 'correction', title: assignment.title, courseTitle: o.course.title,
          detail: sub.feedback ? `“${sub.feedback.slice(0, 90)}${sub.feedback.length > 90 ? '…' : ''}”` : 'Your instructor asked for changes.', href });
      } else if (sub.status === 'graded' && sub.gradedAt && now.getTime() - new Date(sub.gradedAt).getTime() < RECENT_GRADE_MS) {
        items.push({ key: sub.id, kind: 'graded', title: assignment.title, courseTitle: o.course.title,
          detail: `${typeof sub.score === 'number' ? `${sub.score}/${assignment.totalPoints} marks` : 'Graded'}${sub.feedback ? ', feedback available' : ''}`, href });
      }
    }
  }
  // Corrections first: they need action.
  return items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'correction' ? -1 : 1));
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-live="polite">
      <span className="sr-only">Loading your Live Books…</span>
      <div className="space-y-3"><Skeleton className="h-10 w-80 max-w-full" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <Skeleton className="h-52" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
    </div>
  );
}

/** A side list: quiet rows on rules, no boxes. */
function SideList({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SideRow({ href, icon: Icon, iconClass, title, detail, trailing }: {
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  title: string;
  detail: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="group flex items-start gap-3 py-3 transition-colors">
        {Icon && <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', iconClass)} aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-snug text-ink group-hover:text-brand-ink group-hover:underline">{title}</span>
          <span className="mt-0.5 block text-xs text-ink-3">{detail}</span>
        </span>
        {trailing}
      </Link>
    </li>
  );
}

export function StudentDashboard() {
  const { user, profile, tenant } = useAuth();
  const [overviews, setOverviews] = useState<StudentCourseOverview[]>([]);
  const [failedCount, setFailedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => new Date());

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Refresh when the student returns to the tab (e.g. after submitting).
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!tenant?.orgId || !user?.uid) {
        setIsLoading(false);
        return;
      }
      setError(null);
      try {
        const loadedAt = new Date();
        const enrollments = [
          ...new Map(
            (await getStudentEnrollments(tenant.orgId, user.uid))
              .filter((e) => grantsContentAccess(e.status))
              .map((e) => [e.courseId, e])
          ).values(),
        ];
        const submissions = await getStudentSubmissions(tenant.orgId, user.uid);
        const results = await Promise.allSettled(enrollments.map((e) => loadStudentCourseOverview(e, user.uid, submissions, loadedAt)));
        if (!isMounted) return;
        const loaded: StudentCourseOverview[] = [];
        let failed = 0;
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value && r.value.course.status === 'published') loaded.push(r.value);
          else if (r.status === 'rejected') {
            console.error('Failed to load course overview', r.reason);
            failed += 1;
          }
        }
        setOverviews(loaded.sort((a, b) => a.course.title.localeCompare(b.course.title)));
        setFailedCount(failed);
        setNow(loadedAt);
      } catch (err) {
        console.error('Failed to load dashboard', err);
        if (isMounted) setError('We couldn’t load your Live Books. Check your connection and try again.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [tenant?.orgId, user?.uid, reloadKey]);

  // Assessments and released results come from the server. They enrich the page;
  // if the route is unavailable the rest of the desk still works.
  const { data: records } = useApiData<StudentOverview>(user?.uid ? 'home-records' : null, () => studentApi<StudentOverview>({ action: 'overview' }));

  const today = toLocalDateKey(now);
  const metrics = useMemo(() => combineMetrics(overviews.map((o) => o.metrics)), [overviews]);

  const dayGroups: DayGroup[] = useMemo(() => overviews.flatMap((o) => {
    const plan = o.plans.find((p) => p.date === today);
    if (!plan) return [];
    const lessonsById = new Map(o.lessons.map((l) => [l.id, l]));
    const statusByLesson = new Map(o.progress.map((p) => [p.lessonId, p.status]));
    const steps = plan.lessonIds.map((id) => {
      const s = statusByLesson.get(id);
      return lessonStep(o.course.id, lessonsById.get(id), id, s === 'completed' ? 'completed' : s === 'in_progress' ? 'in_progress' : 'pending');
    });
    const assignment = plan.assignmentId ? o.assignments.find((a) => a.id === plan.assignmentId) : undefined;
    if (assignment) {
      steps.push(assignmentStep(o.course.id, assignment, o.submissions.find((s) => s.assignmentId === assignment.id) ?? null, now));
    }
    return [{ overview: o, plan, steps }];
  }), [overviews, today, now]);

  const nextPlan = useMemo(() => overviews
    .flatMap((o) => o.plans.filter((p) => p.date > today).map((p) => ({ plan: p, course: o.course })))
    .sort((a, b) => a.plan.date.localeCompare(b.plan.date))[0], [overviews, today]);

  if (isLoading) return <DashboardSkeleton />;
  if (error) return <ErrorState title="Your home page didn’t load" onRetry={reload}>{error}</ErrorState>;

  const firstName = (profile?.displayName || '').split(' ')[0] || 'there';
  const allSteps = dayGroups.flatMap((g) => g.steps);
  const doneSteps = allSteps.filter((s) => s.done).length;
  const planNames = [...new Set(dayGroups.map((g) => g.overview.course.title))].join(' and ');
  const statusLine = dayGroups.length === 0
    ? 'No plan today. Pick up a course where you left it.'
    : doneSteps === allSteps.length && allSteps.length > 0 ? 'Today’s plan is done.'
      : doneSteps === 0 ? `${allSteps.length} thing${allSteps.length === 1 ? '' : 's'} on today’s plan for ${planNames}.`
        : `${doneSteps} of ${allSteps.length} done on today’s plan.`;

  const attention = getAttentionItems(overviews, now);
  const assignmentTitle = (id: string) => overviews.flatMap((o) => o.assignments.map((a) => ({ a, courseId: o.course.id }))).find((x) => x.a.id === id);
  const lessonInfo = (id: string) => overviews.flatMap((o) => o.lessons.map((l) => ({ l, courseId: o.course.id }))).find((x) => x.l.id === id);

  // The single most useful next action: today's next open step, else the next unfinished lesson.
  const nextGroup = dayGroups.find((g) => g.steps.some((s) => s.needsAction));
  const nextStep = nextGroup?.steps.find((s) => s.needsAction);
  const resumeCourse = overviews.find((o) => o.progress.length > 0 && o.courseCompletion.completed < o.courseCompletion.total) ?? overviews.find((o) => o.courseCompletion.completed < o.courseCompletion.total);
  const resumeLesson = resumeCourse ? getResumeLesson(resumeCourse.modules, resumeCourse.lessons, resumeCourse.progress) : null;

  // Work with a date ahead: unsubmitted assignments and open assessments, soonest first.
  const nowMs = now.getTime();
  const comingUp = [
    ...overviews.flatMap((o) => o.assignments
      .filter((a) => a.deadline && new Date(a.deadline).getTime() >= nowMs && !o.submissions.some((s) => s.assignmentId === a.id))
      .map((a) => ({ key: a.id, title: a.title, course: o.course.title, at: a.deadline as string, href: `/courses/${o.course.id}/assignments/${a.id}` }))),
    ...(records?.upcoming ?? [])
      .filter((u) => u.closesAt && new Date(u.closesAt).getTime() >= nowMs)
      .map((u) => ({ key: u.id, title: u.title, course: u.courseTitle, at: u.closesAt as string, href: `/courses/${u.courseId}/activities/${u.id}` })),
  ].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 5);

  const attentionCount = attention.length + metrics.overdueAssignments.length + metrics.overdueLessons.length;
  const results = records?.recentScores ?? [];

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <p className="text-sm font-medium text-ink-3">{formatPlanDate(today, 'long')}</p>
        <h1 className="type-page text-ink">{greeting(now)}, {firstName}.</h1>
        <p className="max-w-[60ch] text-body text-ink-2">{statusLine}</p>
      </header>

      {failedCount > 0 && (
        <Notice kind="warning" action={<button onClick={reload} className="text-sm font-semibold text-warning-ink hover:underline">Retry</button>}>
          {failedCount} of your courses couldn&apos;t be loaded, so it&apos;s missing from this page.
        </Notice>
      )}

      {overviews.length === 0 && failedCount === 0 ? (
        <EmptyState illustration="sprout" title="Your Live Books will appear here"
          action={<Link href="/courses" className={buttonClasses('secondary')}>Browse my courses</Link>}>
          You&apos;re not enrolled in a batch yet. Once your academy adds you, your courses, daily plan and assignments show up here automatically.
        </EmptyState>
      ) : (
        <>
          {nextStep && nextGroup ? (
            <NextUp course={nextGroup.overview.course} title={nextStep.title} detail={nextStep.detail} href={nextStep.href}
              actionLabel={nextStep.actionLabel} isToday
              progress={{ percentage: nextGroup.overview.courseCompletion.percentage, completed: nextGroup.overview.courseCompletion.completed, total: nextGroup.overview.courseCompletion.total }} />
          ) : resumeCourse && resumeLesson ? (
            <NextUp course={resumeCourse.course} title={resumeLesson.title} detail={`${resumeLesson.estimatedMinutes ?? 15} min lesson`}
              href={`/courses/${resumeCourse.course.id}/lessons/${resumeLesson.id}`} actionLabel={resumeCourse.progress.length ? 'Continue learning' : 'Start learning'} isToday={false}
              progress={{ percentage: resumeCourse.courseCompletion.percentage, completed: resumeCourse.courseCompletion.completed, total: resumeCourse.courseCompletion.total }} />
          ) : null}

          <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-10">
              <MyDayPanel
                groups={dayGroups.map((g) => ({ course: g.overview.course, plan: g.plan, steps: g.steps }))}
                nextPlan={nextPlan}
                fallback={overviews[0] ? { href: `/courses/${overviews[0].course.id}`, label: `Continue ${overviews[0].course.title}` } : undefined}
                today={today}
              />
              <Section title="Your courses" action={<SectionLink href="/courses">All Live Books</SectionLink>}>
                <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 xl:grid-cols-4">
                  {overviews.map((o) => <ShelfBook key={o.course.id} overview={o} />)}
                </ul>
              </Section>
            </div>

            <aside className="space-y-8">
              {attentionCount > 0 && (
                <SideList title="Needs attention">
                  <ul className="divide-y divide-line border-t border-line">
                    {attention.map((item) => (
                      <SideRow key={item.key} href={item.href} title={item.title}
                        icon={item.kind === 'correction' ? MessageSquareWarning : Star}
                        iconClass={item.kind === 'correction' ? 'text-warning' : 'text-success'}
                        detail={<>{item.kind === 'correction' ? 'Correction requested' : 'Graded'}. {item.detail}</>} />
                    ))}
                    {metrics.overdueAssignments.map((o) => {
                      const found = assignmentTitle(o.assignmentId);
                      return (
                        <SideRow key={o.assignmentId} href={found ? `/courses/${found.courseId}/assignments/${o.assignmentId}` : '/courses'}
                          icon={ClipboardList} iconClass="text-coral" title={found?.a.title ?? 'Assignment'}
                          detail={<span className="text-coral-ink">Past deadline, not submitted. Late work still counts.</span>} />
                      );
                    })}
                    {metrics.overdueLessons.map((o) => {
                      const found = lessonInfo(o.lessonId);
                      return (
                        <SideRow key={o.lessonId} href={found ? `/courses/${found.courseId}/lessons/${o.lessonId}` : '/courses'}
                          icon={BookOpen} iconClass="text-coral" title={found?.l.title ?? 'Lesson'}
                          detail={<span className="text-coral-ink">Lesson overdue</span>} />
                      );
                    })}
                  </ul>
                </SideList>
              )}

              <SideList title="Coming up" action={<SectionLink href="/dashboard/assessments">All work</SectionLink>}>
                {comingUp.length === 0 ? (
                  <p className="border-t border-line pt-3 text-sm text-ink-3">Nothing due. New assignments and exams will show up here.</p>
                ) : (
                  <ul className="divide-y divide-line border-t border-line">
                    {comingUp.map((c) => (
                      <SideRow key={c.key} href={c.href} title={c.title} detail={`Due ${formatWhen(c.at)}, ${c.course}`} />
                    ))}
                  </ul>
                )}
              </SideList>

              <SideList title="Recent results" action={<SectionLink href="/dashboard/achievements">Achievements</SectionLink>}>
                {results.length === 0 ? (
                  <p className="border-t border-line pt-3 text-sm text-ink-3">No marks yet. They appear once your instructor releases them.</p>
                ) : (
                  <ul className="divide-y divide-line border-t border-line">
                    {results.slice(0, 3).map((r) => (
                      <SideRow key={r.id} href="/dashboard/scores" title={r.title} detail={formatWhen(r.evaluatedAt)}
                        trailing={<span className={cx('text-sm font-medium tabular-nums', r.passed ? 'text-success-ink' : 'text-coral-ink')}>{r.score}/{r.totalMarks}</span>} />
                    ))}
                  </ul>
                )}
              </SideList>
            </aside>
          </div>

          <Section title="Progress" action={<SectionLink href="/dashboard/analytics">Full report</SectionLink>}>
            <div className="grid gap-8 border-t border-line-strong pt-4 md:grid-cols-3">
              <MetricRow title="Learning completion" ratio={metrics.learningCompletion} unit="lessons" tone="success"
                emptyText="Nothing assigned yet" explanation="Assigned lessons you’ve marked complete, up to today." />
              <MetricRow title="Assignments submitted" ratio={metrics.submissionRate} unit="due" tone="teal"
                emptyText="Nothing due yet" explanation={`Counts assignments whose deadline has passed.${metrics.upcomingAssignments ? ` ${metrics.upcomingAssignments} upcoming not counted.` : ''}${metrics.lateSubmissions ? ` ${metrics.lateSubmissions} submitted late.` : ''}`} />
              <MetricRow title="Assessment" ratio={metrics.assessment} unit="marks" tone="brand"
                emptyText="Nothing graded yet" explanation={`Marks from ${metrics.assessment.gradedCount} graded submission${metrics.assessment.gradedCount === 1 ? '' : 's'}. Work awaiting review isn’t counted.`} />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

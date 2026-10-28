'use client';

/**
 * Strynkix Live Books — Student home.
 * Answers, in order: what to learn today, what to submit, what to do next, how
 * I'm progressing, what's overdue, and which course to continue. Every figure is
 * computed from the student's own records.
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
import { Assignment, DailyPlan, Lesson, Submission } from '@/types/domain';
import {
  DeadlineBadge,
  formatDue,
  formatPlanDate,
  LESSON_STATE_LOOK,
  LessonState,
  MetricRow,
} from './LearningBits';
import { buttonClasses } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Page';
import { CourseIcon, courseIdentity, SPINE } from '@/components/ui/CourseIcon';
import { EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/States';
import { ProgressBar, ProgressRing } from '@/components/ui/Progress';
import { StatusPill } from '@/components/ui/StatusPill';
import { cx } from '@/components/ui/tones';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  CircleDashed,
  CircleDot,
  ClipboardList,
  Flag,
  MessageSquareWarning,
  Star,
  PartyPopper,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';

interface Step {
  key: string;
  kind: 'lesson' | 'assignment';
  title: string;
  detail: string;
  href: string;
  done: boolean;
  needsAction: boolean;
  status: React.ReactNode;
  actionLabel: string;
}

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
    detail: `${formatDue(assignment.deadline, now)} · ${assignment.totalPoints} marks`,
    href: `/courses/${courseId}/assignments/${assignment.id}`,
    done,
    needsAction: !done,
    status: <DeadlineBadge state={state} size="sm" />,
    actionLabel: correction ? 'Fix & resubmit' : submission ? 'View' : 'Submit',
  };
}

function MyDayGroup({ group, isFocus }: { group: DayGroup; isFocus: boolean }) {
  const { overview, plan, steps } = group;
  const done = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : null;
  const next = steps.find((s) => s.needsAction);
  const allDone = steps.length > 0 && done === steps.length;
  const { tone } = courseIdentity(overview.course);

  return (
    <Card as="article" className="overflow-hidden">
      <div className="flex items-start gap-4 border-b border-line p-5">
        <CourseIcon course={overview.course} size="md" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-ink-3">{overview.course.title}</div>
          <h3 className="text-lg font-bold leading-snug text-ink">{plan.title}</h3>
          <p className="mt-0.5 text-xs text-ink-3">Lessons {formatDue(plan.learningDueAt, new Date())}</p>
        </div>
        <ProgressRing value={pct} tone={allDone ? 'success' : tone} label={`${plan.title} progress`} size={52}>
          {done}/{steps.length}
        </ProgressRing>
      </div>

      {plan.objectives.length > 0 && (
        <div className="border-b border-line bg-canvas px-5 py-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Today&apos;s targets</div>
          <ul className="flex flex-wrap gap-2">
            {plan.objectives.map((o, i) => (
              <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-2">
                <Flag className="w-3 h-3 text-coral" aria-hidden="true" /> {o}
              </li>
            ))}
          </ul>
        </div>
      )}

      {steps.length === 0 ? (
        <p className="p-5 text-sm text-ink-3">Your instructor hasn&apos;t added lessons or an assignment to this day yet.</p>
      ) : (
        <ol className="relative px-5 py-4">
          {steps.map((step, i) => {
            const isNext = isFocus && next?.key === step.key;
            return (
              <li key={step.key} className="relative flex gap-4 pb-4 last:pb-0">
                {i < steps.length - 1 && (
                  <span aria-hidden="true" className={cx('absolute left-[15px] top-8 bottom-0 w-0.5', step.done ? 'bg-success-line' : 'bg-line')} />
                )}
                <span
                  aria-hidden="true"
                  className={cx(
                    'relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors',
                    step.done ? 'border-success bg-success text-white animate-pop' : isNext ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface text-ink-3'
                  )}
                >
                  {step.done ? <Check className="w-4 h-4" strokeWidth={3} /> : step.kind === 'assignment' ? <ClipboardList className="w-4 h-4" /> : i + 1}
                </span>
                <div className={cx('flex min-w-0 flex-1 flex-col gap-2 rounded-xl p-3 -m-1 sm:flex-row sm:items-center', isNext && 'bg-brand-soft/60')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cx('text-sm font-semibold', step.done ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>{step.title}</span>
                      {isNext && <span className="text-[11px] font-bold uppercase tracking-wider text-brand-ink">Up next</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                      {step.status}
                      <span>{step.detail}</span>
                    </div>
                  </div>
                  <Link
                    href={step.href}
                    className={buttonClasses(isNext ? 'primary' : 'secondary', 'sm', 'self-start sm:self-center')}
                    aria-label={`${step.actionLabel}: ${step.title}`}
                  >
                    {step.actionLabel} <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {allDone && (
        <div className="flex items-center gap-3 border-t border-success-line bg-success-soft px-5 py-3 text-sm text-success-ink animate-rise">
          <span className="celebrate inline-flex"><PartyPopper className="w-5 h-5" aria-hidden="true" /></span>
          <span><strong>Today&apos;s plan is complete.</strong> Nice work — your instructor can see it.</span>
        </div>
      )}
    </Card>
  );
}

function CourseTile({ overview }: { overview: StudentCourseOverview }) {
  const { course, courseCompletion, modules, lessons, progress } = overview;
  const { tone } = courseIdentity(course);
  const resume = getResumeLesson(modules, lessons, progress);
  const state = courseCompletion.total > 0 && courseCompletion.completed === courseCompletion.total
    ? 'completed' : progress.length > 0 ? 'in_progress' : 'not_started';
  const label = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' }[state];
  const Icon = { not_started: CircleDashed, in_progress: CircleDot, completed: CheckCheck }[state];
  const pillTone = state === 'completed' ? 'success' : state === 'in_progress' ? 'brand' : 'neutral';
  const href = resume && state !== 'completed' ? `/courses/${course.id}/lessons/${resume.id}` : `/courses/${course.id}`;

  return (
    <Card as="article" interactive className="group relative flex overflow-hidden">
      <span aria-hidden="true" className={cx('w-1.5 shrink-0', SPINE[tone])} />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <CourseIcon course={course} size="lg" />
          <StatusPill tone={pillTone} icon={Icon} size="sm">{label}</StatusPill>
        </div>
        <div className="flex-1">
          <h3 className="text-base font-bold leading-snug text-ink">
            <Link href={`/courses/${course.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
              {course.title}
            </Link>
          </h3>
          {course.tagline && <p className="mt-1 line-clamp-2 text-sm text-ink-3">{course.tagline}</p>}
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-ink-3">
            <span>{courseCompletion.total ? `${courseCompletion.completed} of ${courseCompletion.total} lessons` : 'No lessons published yet'}</span>
            {courseCompletion.percentage !== null && <span className="font-semibold text-ink-2">{courseCompletion.percentage}%</span>}
          </div>
          <ProgressBar value={courseCompletion.percentage} tone={state === 'completed' ? 'success' : tone} label={`${course.title} progress`} size="sm" />
        </div>
        {resume && state !== 'completed' && (
          <div className="rounded-lg bg-canvas px-3 py-2 text-xs text-ink-3">
            <span className="font-semibold text-ink-2">Up next:</span> {resume.title}
          </div>
        )}
        <Link href={href} className={buttonClasses('secondary', 'sm', 'relative z-10 self-start group-hover:border-brand-line group-hover:text-brand-ink')}>
          {state === 'completed' ? 'Review course' : state === 'in_progress' ? 'Continue learning' : 'Start course'}
          <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </Card>
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
          detail: `${typeof sub.score === 'number' ? `${sub.score}/${assignment.totalPoints} marks` : 'Graded'}${sub.feedback ? ' · feedback available' : ''}`, href });
      }
    }
  }
  // Corrections first: they need action.
  return items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'correction' ? -1 : 1));
}

/** The single most useful next action: today's next step, else the next unfinished lesson. */
function getPrimaryResume(dayGroups: DayGroup[], overviews: StudentCourseOverview[]) {
    // If today's plan has an active next step:
    const todayNext = dayGroups.flatMap((g) => g.steps).find((s) => s.needsAction);
    if (todayNext) {
      return {
        title: todayNext.title,
        detail: todayNext.detail,
        href: todayNext.href,
        kind: todayNext.kind,
        actionLabel: todayNext.actionLabel,
        context: 'Today’s schedule',
      };
    }
    // Otherwise look across enrolled courses for the next unfinished lesson:
    for (const o of overviews) {
      const resume = getResumeLesson(o.modules, o.lessons, o.progress);
      if (resume) {
        return {
          title: resume.title,
          detail: `${o.course.title} · ${resume.estimatedMinutes ?? 15} min`,
          href: `/courses/${o.course.id}/lessons/${resume.id}`,
          kind: 'lesson' as const,
          actionLabel: 'Continue learning',
          context: o.course.title,
        };
      }
    }
    return null;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-live="polite">
      <span className="sr-only">Loading your Live Books…</span>
      <div className="flex items-center gap-4"><Skeleton className="h-14 w-14 rounded-full" /><div className="space-y-2"><Skeleton className="h-7 w-64" /><Skeleton className="h-4 w-80" /></div></div>
      <div className="grid gap-6 lg:grid-cols-3"><Skeleton className="h-80 lg:col-span-2" /><Skeleton className="h-80" /></div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
    </div>
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
  const overdueCount = metrics.overdueLessons.length + metrics.overdueAssignments.length;
  const statusLine = dayGroups.length === 0
    ? nextPlan ? `Nothing is planned for today. Next up: ${nextPlan.plan.title} on ${formatPlanDate(nextPlan.plan.date)}.` : 'Nothing is planned for today — a good time to continue a course at your own pace.'
    : doneSteps === allSteps.length && allSteps.length > 0 ? 'You’ve finished everything planned for today.'
      : doneSteps === 0 ? `You have ${allSteps.length} step${allSteps.length === 1 ? '' : 's'} planned today. Start with the first one below.`
        : `You’re ${doneSteps} of ${allSteps.length} steps through today.`;

  // When today's plan has a next step, My Day already leads with it; the banner
  // is the "pick up where you left off" fallback, so it never duplicates My Day.
  const hasPlannedNextStep = dayGroups.some((g) => g.steps.some((s) => s.needsAction));
  const primaryResume = hasPlannedNextStep ? null : getPrimaryResume(dayGroups, overviews);
  const attention = getAttentionItems(overviews, now);
  const assignmentTitle = (id: string) => overviews.flatMap((o) => o.assignments.map((a) => ({ a, courseId: o.course.id }))).find((x) => x.a.id === id);
  const lessonInfo = (id: string) => overviews.flatMap((o) => o.lessons.map((l) => ({ l, courseId: o.course.id }))).find((x) => x.l.id === id);


  return (
    <div className="space-y-8">
      {/* Welcome */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-rise">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-warning-soft text-xl font-extrabold text-warning-ink">
            {firstName.charAt(0).toUpperCase()}
          </span>
          <div>
            <p className="text-sm font-medium text-ink-3">{formatPlanDate(today, 'long')}</p>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">{greeting(now)}, {firstName}</h1>
            <p className="mt-1 text-sm text-ink-2">{statusLine}</p>
          </div>
        </div>
        <button type="button" onClick={reload} className={buttonClasses('ghost', 'sm', 'self-start sm:self-center')}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </header>

      {/* Prominent Continue Learning Action Banner */}
      {primaryResume && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-2xl bg-brand-soft/70 border border-brand-line shadow-sm">
          <div className="flex items-center gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
              <BookOpen className="w-5 h-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-ink">Up next</span>
                <span className="text-xs text-ink-3">·</span>
                <span className="text-xs font-medium text-ink-3">{primaryResume.context}</span>
              </div>
              <h2 className="text-base font-bold text-ink truncate">{primaryResume.title}</h2>
              <p className="text-xs text-ink-3">{primaryResume.detail}</p>
            </div>
          </div>
          <Link
            href={primaryResume.href}
            className={buttonClasses('primary', 'md', 'self-start sm:self-center shrink-0 shadow-sm')}
          >
            {primaryResume.actionLabel} <ArrowRight className="w-4 h-4 ml-1" aria-hidden="true" />
          </Link>
        </div>
      )}

      {attention.length > 0 && (
        <Section id="attention" title="Needs your attention" icon={MessageSquareWarning}>
          <Card as="section" className="divide-y divide-line">
            {attention.map((item) => (
              <Link key={item.key} href={item.href} className="group flex items-start gap-3 p-4 transition-colors hover:bg-canvas sm:items-center">
                <span aria-hidden="true" className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  item.kind === 'correction' ? 'bg-warning-soft text-warning-ink' : 'bg-success-soft text-success-ink')}>
                  {item.kind === 'correction' ? <MessageSquareWarning className="w-4.5 h-4.5" /> : <Star className="w-4.5 h-4.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={item.kind === 'correction' ? 'warning' : 'success'} size="sm">
                      {item.kind === 'correction' ? 'Correction requested' : 'Graded'}
                    </StatusPill>
                    <span className="text-sm font-semibold text-ink">{item.title}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-3">{item.courseTitle} · {item.detail}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-ink">
                  {item.kind === 'correction' ? 'Fix & resubmit' : 'View feedback'}
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </Card>
        </Section>
      )}

      {failedCount > 0 && (
        <Notice kind="warning" action={<button onClick={reload} className="text-sm font-semibold text-warning-ink hover:underline">Retry</button>}>
          {failedCount} of your courses couldn&apos;t be loaded, so it&apos;s missing from the figures below.
        </Notice>
      )}

      {overviews.length === 0 && failedCount === 0 ? (
        <EmptyState illustration="sprout" title="Your Live Books will appear here"
          action={<Link href="/courses" className={buttonClasses('secondary')}>Browse my courses</Link>}>
          You&apos;re not enrolled in a batch yet. Once your academy adds you, your courses, daily plan and assignments show up here automatically.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            {/* My Day */}
            <Section id="my-day" title="My Day" icon={CalendarDays} className="lg:col-span-2">
              {dayGroups.length === 0 ? (
                <EmptyState compact illustration="calendar" title="No plan for today"
                  action={overviews[0] && <Link href={`/courses/${overviews[0].course.id}`} className={buttonClasses('secondary', 'sm')}>Continue {overviews[0].course.title}</Link>}>
                  {nextPlan ? <>Next up is <strong className="text-ink-2">{nextPlan.plan.title}</strong> ({nextPlan.course.title}) on {formatPlanDate(nextPlan.plan.date)}.</> : 'Your instructor hasn’t published the next plan yet.'}
                </EmptyState>
              ) : (
                <div className="space-y-5">
                  {dayGroups.map((g, i) => <MyDayGroup key={g.plan.id} group={g} isFocus={i === dayGroups.findIndex((x) => x.steps.some((s) => s.needsAction))} />)}
                </div>
              )}
            </Section>

            {/* Progress */}
            <Section id="progress" title="My progress" icon={TrendingUp}>
              <Card className="divide-y divide-line">
                <div className="p-5"><MetricRow title="Learning completion" ratio={metrics.learningCompletion} unit="lessons" tone="success"
                  emptyText="Nothing assigned yet" explanation="Assigned lessons you’ve marked complete, up to today." /></div>
                <div className="p-5"><MetricRow title="Assignments submitted" ratio={metrics.submissionRate} unit="due" tone="teal"
                  emptyText="Nothing due yet" explanation={`Counts assignments whose deadline has passed.${metrics.upcomingAssignments ? ` ${metrics.upcomingAssignments} upcoming not counted.` : ''}${metrics.lateSubmissions ? ` ${metrics.lateSubmissions} submitted late.` : ''}`} /></div>
                <div className="p-5"><MetricRow title="Assessment" ratio={metrics.assessment} unit="marks" tone="brand"
                  emptyText="Nothing graded yet" explanation={`Marks from ${metrics.assessment.gradedCount} graded submission${metrics.assessment.gradedCount === 1 ? '' : 's'}. Work awaiting review isn’t counted.`} /></div>
                {overdueCount > 0 && (
                  <div className="p-5 space-y-2 bg-coral-soft/30 border-t border-coral-line">
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-sm font-bold text-coral-ink flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 text-coral" aria-hidden="true" /> Overdue Work
                      </h3>
                      <span className="text-xl font-extrabold text-coral-ink">{overdueCount}</span>
                    </div>
                    <ul className="space-y-1.5 text-sm">
                      {metrics.overdueAssignments.slice(0, 3).map((o) => {
                        const found = assignmentTitle(o.assignmentId);
                        return (
                          <li key={o.assignmentId} className="flex items-start gap-2">
                            <ClipboardList className="mt-0.5 w-4 h-4 shrink-0 text-coral" aria-hidden="true" />
                            {found ? <Link href={`/courses/${found.courseId}/assignments/${o.assignmentId}`} className="text-ink font-medium hover:text-brand-ink hover:underline">{found.a.title}</Link> : o.assignmentId}
                          </li>
                        );
                      })}
                      {metrics.overdueLessons.slice(0, 3).map((o) => {
                        const found = lessonInfo(o.lessonId);
                        return (
                          <li key={o.lessonId} className="flex items-start gap-2">
                            <BookOpen className="mt-0.5 w-4 h-4 shrink-0 text-coral" aria-hidden="true" />
                            {found ? <Link href={`/courses/${found.courseId}/lessons/${o.lessonId}`} className="text-ink font-medium hover:text-brand-ink hover:underline">{found.l.title}</Link> : 'Lesson'}
                          </li>
                        );
                      })}
                      <li className="text-xs text-coral-ink font-medium">Catch up when you can — late work still counts.</li>
                    </ul>
                  </div>
                )}
              </Card>
            </Section>
          </div>

          {/* Courses */}
          <Section id="my-courses" title="My courses" icon={BookOpen}
            action={<Link href="/courses" className="text-sm font-semibold text-brand-ink hover:underline">View all</Link>}>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {overviews.map((o) => <CourseTile key={o.course.id} overview={o} />)}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

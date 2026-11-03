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
import { Card } from '@/components/ui/Page';
import { CourseIcon, courseIdentity, SPINE } from '@/components/ui/CourseIcon';
import { EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/States';
import { ProgressBar } from '@/components/ui/Progress';
import { StatusPill } from '@/components/ui/StatusPill';
import { cx } from '@/components/ui/tones';
import { getBatchById } from '@/lib/batches/service';
import { helpTile, HomeHero, useScopeNames } from '@/components/home/HomeBlocks';
import { HomeApp, HomeBoard } from '@/components/home/HomeBoard';
import { MyDayPanel, MyDayStep } from './MyDayPanel';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCheck,
  CircleDashed,
  CircleDot,
  ClipboardList,
  GraduationCap,
  MessageSquareWarning,
  Star,
  Users,
} from 'lucide-react';

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
    detail: `${formatDue(assignment.deadline, now)} · ${assignment.totalPoints} marks`,
    href: `/courses/${courseId}/assignments/${assignment.id}`,
    done,
    needsAction: !done,
    status: <DeadlineBadge state={state} size="sm" />,
    actionLabel: correction ? 'Fix & resubmit' : submission ? 'View' : 'Submit',
    due: assignment.deadline,
  };
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
  const [openSection, setOpenSection] = useState<string | null>(null);

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

  // Batch names (and their instructors) for the greeting card; students may read their own batches.
  const scopeNames = useScopeNames();
  const [batchInfo, setBatchInfo] = useState<{ name: string; instructors: string[] }[]>([]);
  const batchIds = overviews.map((o) => o.enrollment.batchId).join(',');
  useEffect(() => {
    let alive = true;
    if (!batchIds) return;
    Promise.all(batchIds.split(',').map((id) => getBatchById(id).catch(() => null))).then((batches) => {
      if (alive) setBatchInfo(batches.flatMap((b) => (b ? [{ name: b.name, instructors: b.instructorNames ?? [] }] : [])));
    });
    return () => {
      alive = false;
    };
  }, [batchIds]);

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

  const attention = getAttentionItems(overviews, now);
  const assignmentTitle = (id: string) => overviews.flatMap((o) => o.assignments.map((a) => ({ a, courseId: o.course.id }))).find((x) => x.a.id === id);
  const lessonInfo = (id: string) => overviews.flatMap((o) => o.lessons.map((l) => ({ l, courseId: o.course.id }))).find((x) => x.l.id === id);


  const firstCourse = overviews[0]?.course;
  const corrections = attention.filter((a) => a.kind === 'correction').length;
  const openAssignments = metrics.overdueAssignments.length + corrections +
    allSteps.filter((st) => st.kind === 'assignment' && st.needsAction).length;
  const instructors = [...new Set(batchInfo.flatMap((b) => b.instructors))];

  const myDayContent = overviews.length === 0 && failedCount === 0 ? (
    <EmptyState illustration="sprout" title="Your Live Books will appear here"
      action={<Link href="/courses" className={buttonClasses('secondary')}>Browse my courses</Link>}>
      You&apos;re not enrolled in a batch yet. Once your academy adds you, your courses, daily plan and assignments show up here automatically.
    </EmptyState>
  ) : (
    <MyDayPanel
      groups={dayGroups.map((g) => ({ course: g.overview.course, plan: g.plan, steps: g.steps }))}
      nextPlan={nextPlan}
      fallback={overviews[0] ? { href: `/courses/${overviews[0].course.id}`, label: `Continue ${overviews[0].course.title}` } : undefined}
    />
  );

  const attentionContent = (
    <div className="space-y-4">
      {failedCount > 0 && (
        <Notice kind="warning" action={<button onClick={reload} className="text-sm font-semibold text-warning-ink hover:underline">Retry</button>}>
          {failedCount} of your courses couldn&apos;t be loaded, so it&apos;s missing from these figures.
        </Notice>
      )}
      {attention.length === 0 && overdueCount === 0 ? (
        <EmptyState compact illustration="sprout" title="You’re all caught up">No corrections requested and no new marks this week.</EmptyState>
      ) : (
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
          {metrics.overdueAssignments.map((o) => {
            const found = assignmentTitle(o.assignmentId);
            return (
              <Link key={o.assignmentId} href={found ? `/courses/${found.courseId}/assignments/${o.assignmentId}` : '/courses'} className="flex items-center gap-3 p-4 hover:bg-canvas">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-coral-soft text-coral-ink"><ClipboardList className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{found?.a.title ?? 'Assignment'}</span><span className="text-xs text-coral-ink">Past deadline, not submitted — late work still counts</span></span>
              </Link>
            );
          })}
          {metrics.overdueLessons.map((o) => {
            const found = lessonInfo(o.lessonId);
            return (
              <Link key={o.lessonId} href={found ? `/courses/${found.courseId}/lessons/${o.lessonId}` : '/courses'} className="flex items-center gap-3 p-4 hover:bg-canvas">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-coral-soft text-coral-ink"><BookOpen className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{found?.l.title ?? 'Lesson'}</span><span className="text-xs text-coral-ink">Lesson overdue</span></span>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );

  const progressContent = (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5"><MetricRow title="Learning completion" ratio={metrics.learningCompletion} unit="lessons" tone="success"
          emptyText="Nothing assigned yet" explanation="Assigned lessons you’ve marked complete, up to today." /></Card>
        <Card className="p-5"><MetricRow title="Assignments submitted" ratio={metrics.submissionRate} unit="due" tone="teal"
          emptyText="Nothing due yet" explanation={`Counts assignments whose deadline has passed.${metrics.upcomingAssignments ? ` ${metrics.upcomingAssignments} upcoming not counted.` : ''}${metrics.lateSubmissions ? ` ${metrics.lateSubmissions} submitted late.` : ''}`} /></Card>
        <Card className="p-5"><MetricRow title="Assessment" ratio={metrics.assessment} unit="marks" tone="brand"
          emptyText="Nothing graded yet" explanation={`Marks from ${metrics.assessment.gradedCount} graded submission${metrics.assessment.gradedCount === 1 ? '' : 's'}. Work awaiting review isn’t counted.`} /></Card>
      </div>
      <Link href="/dashboard/analytics" className={buttonClasses('secondary')}>Open full progress report <ArrowRight className="h-4 w-4" /></Link>
    </div>
  );

  const coursesContent = overviews.length ? (
    <div className="grid gap-5 sm:grid-cols-2">
      {overviews.map((o) => <CourseTile key={o.course.id} overview={o} />)}
    </div>
  ) : (
    <EmptyState compact illustration="book" title="No courses yet" action={<Link href="/courses" className={buttonClasses('secondary', 'sm')}>Open Live Books</Link>}>
      Courses appear once you’re enrolled in a batch.
    </EmptyState>
  );

  const attentionCount = attention.length + overdueCount;
  const apps: HomeApp[] = [
    { label: 'Live Books', art: 'books', href: '/courses' },
    { label: 'Schedule', art: 'calendar', href: firstCourse ? `/courses/${firstCourse.id}?tab=schedule` : '/courses' },
    { label: 'Assignments', art: 'clipboard', href: firstCourse ? `/courses/${firstCourse.id}?tab=assignments` : '/courses', badge: openAssignments, badgeLabel: 'assignments need your attention' },
    { label: 'Needs Attention', art: 'review', sheet: attentionContent, badge: attentionCount, badgeLabel: 'items need your attention' },
    { label: 'My Progress', art: 'chart', sheet: progressContent },
    { label: 'My Courses', art: 'pen', sheet: coursesContent },
    { label: 'User Guide', art: 'guide', href: '/dashboard/guide' },
    { label: 'My Profile', art: 'profile', href: '/dashboard/profile' },
    helpTile,
  ];

  return (
    <HomeBoard
      hero={
        <HomeHero
          name={profile?.displayName || firstName}
          academy={scopeNames.org}
          facts={[
            { icon: GraduationCap, text: <>Student{scopeNames.branch ? <> · {scopeNames.branch}</> : null}</> },
            ...(batchInfo.length ? [{ icon: Users, text: <>{batchInfo.map((b) => b.name).join(', ')}{instructors.length ? <> · with {instructors.join(', ')}</> : null}</> }] : []),
            ...(overviews.length ? [{ icon: BookOpen, text: overviews.map((o) => o.course.title).join(', ') }] : []),
            { icon: CalendarDays, text: <>{greeting(now)}, {firstName}. {statusLine}</> },
          ]}
        />
      }
      day={myDayContent}
      apps={apps}
      openKey={openSection}
      onOpenChange={setOpenSection}
    />
  );
}

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { getStudentEnrollments } from '@/lib/batches/service';
import { grantsContentAccess } from '@/lib/batches/scope';
import { getStudentSubmissions, loadStudentCourseOverview, StudentCourseOverview } from '@/lib/learning/service';
import { combineMetrics } from '@/lib/learning/metrics';
import { lastNDays, ratioHint } from '@/lib/analytics/metrics';
import { toLocalDateKey } from '@/lib/learning/metrics';
import { buttonClasses } from '@/components/ui/Button';
import { ColumnChart, KpiTile, Meter } from '@/components/ui/DataViz';
import { Card, PageHeader, Section } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { CourseIcon } from '@/components/ui/CourseIcon';
import { formatDateTime, formatPlanDate } from '@/components/learning/LearningBits';
import { Activity, BookCheck, CircleCheck, ClipboardCheck, Clock3, MessageSquareWarning, Trophy } from 'lucide-react';

const pct = (n: number | null) => (n === null ? '—' : `${n}`);

export function StudentAnalytics() {
  const { user, tenant } = useAuth();
  const [overviews, setOverviews] = useState<StudentCourseOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!tenant || !user) return;
      try {
        const loadedAt = new Date();
        const enrollments = [...new Map((await getStudentEnrollments(tenant.orgId, user.uid)).filter((e) => grantsContentAccess(e.status)).map((e) => [e.courseId, e])).values()];
        const submissions = await getStudentSubmissions(tenant.orgId, user.uid);
        const settled = await Promise.allSettled(enrollments.map((e) => loadStudentCourseOverview(e, user.uid, submissions, loadedAt)));
        if (!alive) return;
        setOverviews(settled.flatMap((r) => (r.status === 'fulfilled' && r.value && r.value.course.status === 'published' ? [r.value] : [])));
        setNow(loadedAt);
        setError(null);
      } catch (err) {
        console.error('Failed to load progress', err);
        if (alive) setError('We couldn’t load your progress. Check your connection and try again.');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [tenant, user, reloadKey]);

  const metrics = useMemo(() => combineMetrics(overviews.map((o) => o.metrics)), [overviews]);
  const days = useMemo(() => {
    const window = lastNDays(now, 14);
    const count = (dates: Array<string | undefined>) => window.map((d) => dates.filter((x) => x && toLocalDateKey(new Date(x)) === d).length);
    const lessons = count(overviews.flatMap((o) => o.progress.filter((p) => p.status === 'completed').map((p) => p.completedAt)));
    const subs = count(overviews.flatMap((o) => o.submissions.map((s) => s.submittedAt)));
    return window.map((d, i) => ({ label: formatPlanDate(d, 'long'), short: String(Number(d.slice(8))), value: lessons[i] + subs[i] }));
  }, [overviews, now]);

  const graded = overviews.flatMap((o) => o.submissions.map((s) => ({ s, a: o.assignments.find((a) => a.id === s.assignmentId), course: o.course })))
    .filter((x) => x.a)
    .sort((x, y) => (y.s.submittedAt || '').localeCompare(x.s.submittedAt || ''));

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Your learning" title="My Progress" description="How you’re doing across your courses. Each number says exactly what it counts." />

      {loading ? (
        <LoadingState label="Loading your progress…" rows={4} />
      ) : error ? (
        <ErrorState onRetry={() => { setLoading(true); setReloadKey((k) => k + 1); }}>{error}</ErrorState>
      ) : overviews.length === 0 ? (
        <EmptyState illustration="sprout" title="No courses yet" action={<Link href="/dashboard/guide#trouble-course-missing" className={buttonClasses('secondary', 'sm')}>Why can’t I see a course?</Link>}>
          Your progress appears here once you’re enrolled in a batch. Ask your branch manager if you expected to see a course.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile label="Learning completion" value={pct(metrics.learningCompletion.percentage)} suffix={metrics.learningCompletion.percentage === null ? undefined : '%'} icon={BookCheck} tone="success"
              hint={ratioHint(metrics.learningCompletion, 'lessons planned up to today.', 'No lessons planned for you yet.')} />
            <KpiTile label="Assignments submitted" value={pct(metrics.submissionRate.percentage)} suffix={metrics.submissionRate.percentage === null ? undefined : '%'} icon={ClipboardCheck} tone="teal"
              hint={`${ratioHint(metrics.submissionRate, 'with a passed deadline.', 'No deadline has passed yet.')} ${metrics.upcomingAssignments} upcoming.`} />
            <KpiTile label="Average mark" value={pct(metrics.assessment.percentage)} suffix={metrics.assessment.percentage === null ? undefined : '%'} icon={Trophy} tone="lavender"
              hint={`From ${metrics.assessment.gradedCount} graded piece${metrics.assessment.gradedCount === 1 ? '' : 's'} of work.`} />
            <KpiTile label="Overdue" value={metrics.overdueLessons.length + metrics.overdueAssignments.length} icon={Clock3} tone="coral"
              hint={`${metrics.overdueLessons.length} lesson${metrics.overdueLessons.length === 1 ? '' : 's'}, ${metrics.overdueAssignments.length} assignment${metrics.overdueAssignments.length === 1 ? '' : 's'} past due.`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card className="p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-[16px] font-extrabold text-ink"><Activity className="h-4 w-4 text-brand" /> Your activity, last 14 days</h2>
              <p className="text-xs text-ink-3">Lessons completed plus assignments submitted, per day.</p>
              <div className="mt-5"><ColumnChart label="Learning activity per day" data={days} /></div>
            </Card>
            <Card className="p-5 sm:p-6">
              <h2 className="text-[16px] font-extrabold text-ink">Course completion</h2>
              <ul className="mt-4 space-y-4">
                {overviews.map((o) => (
                  <li key={o.course.id}>
                    <Link href={`/courses/${o.course.id}`} className="group flex items-center gap-3">
                      <CourseIcon course={o.course} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-ink group-hover:text-brand-ink">{o.course.title}</span>
                        <span className="block text-xs text-ink-3">{o.courseCompletion.completed} of {o.courseCompletion.total} lessons</span>
                      </span>
                    </Link>
                    <div className="mt-2"><Meter value={o.courseCompletion.percentage} tone="success" label={`${o.course.title} completion`} /></div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Section id="work" title="Assignments and marks" icon={ClipboardCheck}>
            {graded.length === 0 ? (
              <EmptyState compact illustration="inbox" title="Nothing submitted yet">Your submitted assignments and marks will be listed here.</EmptyState>
            ) : (
              <Card className="divide-y divide-line">
                {graded.map(({ s, a, course }) => (
                  <Link key={s.id} href={`/courses/${course.id}/assignments/${a!.id}`} className="flex flex-col gap-2 px-4 py-3.5 hover:bg-canvas sm:flex-row sm:items-center sm:px-5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-ink">{a!.title}</div>
                      <div className="text-xs text-ink-3">{course.title} · submitted {formatDateTime(s.submittedAt)}</div>
                    </div>
                    {s.status === 'graded' ? (
                      <span className="flex items-center gap-2">
                        <StatusPill tone="success" icon={CircleCheck} size="sm">Graded</StatusPill>
                        <span className="text-sm font-extrabold tabular-nums text-ink">{s.score}<span className="text-ink-3">/{a!.totalPoints}</span></span>
                      </span>
                    ) : s.status === 'resubmit_requested' ? (
                      <StatusPill tone="coral" icon={MessageSquareWarning} size="sm">Correction requested</StatusPill>
                    ) : (
                      <StatusPill tone="teal" icon={Clock3} size="sm">Awaiting review</StatusPill>
                    )}
                  </Link>
                ))}
              </Card>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

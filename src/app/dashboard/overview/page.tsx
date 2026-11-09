'use client';

/**
 * Strynkix LMS — the student's learning dashboard: current course, progress,
 * upcoming and pending work, recent results, attendance, certificates and
 * announcements, with quick links to every student section. All figures come
 * from the student's own records (POST /api/student).
 */

import React from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { studentApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { MyCourseCard } from '@/components/student/MyCourseCard';
import { EngagementPanel } from '@/components/engagement/EngagementPanel';
import type { StudentOverview } from '@/components/student/types';
import { EXAM_TYPE_LABELS, KIND_LABELS } from '@/lib/assessments/grading';
import type { AssessmentKind, ExamType } from '@/types/academy';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import { formatDate } from '@/lib/academy/format';
import { KpiTile } from '@/components/ui/DataViz';
import { PageHeader, Section } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Award, BookOpen, CalendarCheck, ClipboardList, Bell, Trophy } from 'lucide-react';

function Overview() {
  const { data, error, reload } = useApiData('overview', () => studentApi<StudentOverview>({ action: 'overview' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading your dashboard…" rows={4} />;
  const label = (kind: string, exam: string | null) => (kind === 'exam' && exam ? EXAM_TYPE_LABELS[exam as ExamType] : KIND_LABELS[kind as AssessmentKind]);
  return (
    <div className="space-y-8">
      <PageHeader
        title={`Hello, ${data.profile.name.split(' ')[0] || 'there'}`}
        description={`${data.profile.email}${data.profile.studentId ? ` · Student ID ${data.profile.studentId}` : ''}`}
      />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <KpiTile label="Course completion" value={data.lessons.percent} suffix="%" icon={BookOpen} hint={`${data.lessons.completed} lessons done, ${data.lessons.remaining} to go`} />
        <KpiTile label="Attendance" value={data.attendance.percent ?? '—'} suffix={data.attendance.percent === null ? undefined : '%'} tone="teal" icon={CalendarCheck} hint={data.attendance.classes ? `Across ${data.attendance.classes} classes` : 'No classes recorded yet'} />
        <KpiTile label="Work to do" value={data.pendingCount} tone="coral" icon={ClipboardList} hint="Activities and exams open for you" />
        <KpiTile label="Certificates" value={data.certificates.filter((c) => c.status === 'issued').length} tone="info" icon={Award} hint="Issued to you" />
      </div>

      <EngagementPanel />

            {data.current && (
        <Section title="Continue your current course" icon={BookOpen}>
          <MyCourseCard course={data.current} />
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Upcoming and pending work" icon={ClipboardList} action={<Link href="/dashboard/assessments" className="text-sm font-semibold text-brand-ink">See all</Link>}>
          {data.upcoming.length === 0 ? <EmptyState title="Nothing due">You’re up to date with your activities and exams.</EmptyState> : (
            <ul className="divide-y divide-line border-y border-line">
              {data.upcoming.map((u) => (
                <li key={u.id}>
                  <Link href={`/courses/${u.courseId}/activities/${u.id}`} className="group flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink group-hover:text-brand-ink">{u.title}</div>
                      <div className="text-xs text-ink-3">{label(u.kind, u.examType)} · {u.courseTitle}{u.closesAt ? ` · due ${formatWhen(u.closesAt)}` : ''}</div>
                    </div>
                    {u.status === 'returned' ? <StatusPill size="sm" tone="coral">Correct and resubmit</StatusPill> : u.status === 'in_progress' ? <StatusPill size="sm" tone="brand">In progress</StatusPill> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Recent results" icon={Trophy} action={<Link href="/dashboard/scores" className="text-sm font-semibold text-brand-ink">My Scores</Link>}>
          {data.recentScores.length === 0 ? <EmptyState title="No results yet">Evaluated results appear here once they are released.</EmptyState> : (
            <ul className="divide-y divide-line border-y border-line">
              {data.recentScores.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-ink">{r.title}</div><div className="text-xs text-ink-3">{KIND_LABELS[r.kind as AssessmentKind]} · {formatWhen(r.evaluatedAt)}</div></div>
                    <span className="text-sm font-medium tabular-nums text-ink">{r.score}/{r.totalMarks}</span>
                    <StatusPill size="sm" tone={r.passed ? 'success' : 'coral'}>{r.passed ? 'Passed' : 'Not passed'}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Announcements and notifications" icon={Bell}>
          {data.notifications.length === 0 ? <EmptyState title="No notifications">Instructor updates, grades and certificates will appear here.</EmptyState> : (
            <ul className="divide-y divide-line border-y border-line">
              {data.notifications.map((n) => (
                <li key={n.id} className="py-3">
                  {n.link ? <Link href={n.link} className="text-sm font-medium text-ink hover:text-brand-ink">{n.title}</Link> : <div className="text-sm font-semibold text-ink">{n.title}</div>}
                  <div className="text-xs text-ink-3">{n.body}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Certificates" icon={Award} action={<Link href="/dashboard/certificates" className="text-sm font-semibold text-brand-ink">Open</Link>}>
          {data.certificates.length === 0 ? <EmptyState title="No certificates yet">Finish a course and meet its requirements to receive a certificate.</EmptyState> : (
            <ul className="divide-y divide-line border-y border-line">
              {data.certificates.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-ink">{c.courseTitle}</div><div className="text-xs text-ink-3">{c.certificateNumber} · {formatDate(c.completedOn)}</div></div>
                  <StatusPill size="sm" tone={c.status === 'issued' ? 'success' : 'danger'}>{c.status === 'issued' ? 'Issued' : 'Revoked'}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {data.courses.length > 1 && (
        <Section title="All my courses" icon={BookOpen}>
          <div className="grid gap-4 xl:grid-cols-2">{data.courses.map((c) => <MyCourseCard key={c.courseId} course={c} />)}</div>
        </Section>
      )}
    </div>
  );
}

export default function StudentOverviewPage() {
  return <RequireRole allowedRoles={['student']}><AppShell><Overview /></AppShell></RequireRole>;
}

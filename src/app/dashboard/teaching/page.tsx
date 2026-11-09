'use client';

/**
 * Strynkix LMS — the instructor's engagement dashboard: their batches with
 * active learners, completion and attendance, open doubts, work awaiting
 * review, unread feedback, upcoming activities and recent student milestones.
 * All recorded facts — no ratings or scores are invented.
 */

import React from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { engagementApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import { DOUBT_STATUS_LABEL } from '@/components/engagement/types';
import { buttonClasses } from '@/components/ui/Button';
import { KpiTile } from '@/components/ui/DataViz';
import { Card, PageHeader, Section } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Award, CalendarDays, ClipboardList, HelpCircle, MessageSquareText, Users } from 'lucide-react';

interface Dash {
  students: number; feedbackToRead: number; awaitingReview: number;
  batches: { id: string; name: string; status: string; students: number; activeLast7Days: number; completion: number | null; attendance30d: number | null; classes30d: number }[];
  pendingDoubts: { id: string; title: string; status: string; studentName: string; priority: string; lastActivityAt: string }[];
  upcomingActivities: { id: string; title: string; startsAt: string }[];
  milestones: { studentId: string; studentName: string; title: string; awardedAt: string }[];
}

function Teaching() {
  const { data, error, reload } = useApiData('teaching', () => engagementApi<Dash>({ action: 'instructor_dashboard' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading your teaching dashboard…" rows={4} />;
  return (
    <div className="space-y-8">
      <PageHeader title="My teaching" description="How your batches are doing and what needs you today. Activity means lessons completed, work submitted or classes attended." />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <KpiTile label="Students" value={data.students} icon={Users} hint={`${data.batches.length} batches`} />
        <KpiTile label="Open doubts" value={data.pendingDoubts.length} icon={HelpCircle} tone="coral" />
        <KpiTile label="Awaiting your review" value={data.awaitingReview} icon={ClipboardList} tone="warning" hint="Submissions to mark" />
        <KpiTile label="New feedback" value={data.feedbackToRead} icon={MessageSquareText} tone="info" hint="On your batches and courses" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/assessments" className={buttonClasses('primary', 'md')}>Evaluate submissions</Link>
        <Link href="/dashboard/attendance" className={buttonClasses('secondary', 'md')}>Take attendance</Link>
        <Link href="/dashboard/doubts" className={buttonClasses('secondary', 'md')}>Answer doubts</Link>
        <Link href="/dashboard/projects/review" className={buttonClasses('ghost', 'md')}>Review projects</Link>
        <Link href="/dashboard/feedback" className={buttonClasses('ghost', 'md')}>Read feedback</Link>
      </div>
      <Section title="Your batches" icon={Users}>
        {data.batches.length === 0 ? <EmptyState title="No batches assigned">Batches you teach appear here.</EmptyState> : (
          <Card className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-line text-left text-xs text-ink-3"><th className="p-2.5">Batch</th><th className="p-2.5">Students</th><th className="p-2.5">Active in last 7 days</th><th className="p-2.5">Course completion</th><th className="p-2.5">Attendance (30 days)</th></tr></thead>
            <tbody>{data.batches.map((b) => <tr key={b.id} className="border-b border-line last:border-0"><td className="p-2.5"><Link href={`/dashboard/batches/${b.id}`} className="font-medium text-ink hover:text-brand-ink hover:underline hover:underline">{b.name}</Link></td><td className="p-2.5">{b.students}</td><td className="p-2.5">{b.activeLast7Days} of {b.students}</td><td className="p-2.5">{b.completion === null ? '—' : `${b.completion}%`}</td><td className="p-2.5">{b.attendance30d === null ? '—' : `${b.attendance30d}% (${b.classes30d} classes)`}</td></tr>)}</tbody></table></Card>
        )}
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Doubts waiting" icon={HelpCircle}>
          {data.pendingDoubts.length === 0 ? <p className="text-sm text-ink-3">No open doubts.</p> : <ul className="divide-y divide-line border-y border-line">{data.pendingDoubts.map((d) => <li key={d.id}><Link href={`/dashboard/doubts/${d.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-sm hover:border-silver"><span><span className="font-semibold text-ink">{d.title}</span><span className="block text-xs text-ink-3">{d.studentName} · {formatWhen(d.lastActivityAt)}</span></span><span className="flex gap-1">{d.priority === 'high' && <StatusPill size="sm" tone="danger">Urgent</StatusPill>}<StatusPill size="sm">{DOUBT_STATUS_LABEL[d.status]}</StatusPill></span></Link></li>)}</ul>}
        </Section>
        <Section title="Student milestones (30 days)" icon={Award}>
          {data.milestones.length === 0 ? <p className="text-sm text-ink-3">No new achievements in your batches recently.</p> : <ul className="space-y-1 text-sm">{data.milestones.map((m, i) => <li key={i} className="flex justify-between gap-2"><span><strong>{m.studentName}</strong> · {m.title}</span><span className="text-ink-3">{formatWhen(m.awardedAt)}</span></li>)}</ul>}
        </Section>
        <Section title="Upcoming activities" icon={CalendarDays}>
          {data.upcomingActivities.length === 0 ? <p className="text-sm text-ink-3">Nothing scheduled for your branch.</p> : <ul className="space-y-1 text-sm">{data.upcomingActivities.map((a) => <li key={a.id} className="flex justify-between gap-2"><span>{a.title}</span><span className="text-ink-3">{formatWhen(a.startsAt)}</span></li>)}</ul>}
        </Section>
      </div>
    </div>
  );
}

export default function TeachingPage() {
  return <RequireRole allowedRoles={['instructor']}><AppShell><Teaching /></AppShell></RequireRole>;
}

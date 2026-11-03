'use client';

/**
 * Strynkix LMS — My achievements and learning history: earned achievements
 * (with the recorded evidence), what is next, weekly learning days and the
 * monthly summary. Calculated on the server from recorded learning.
 */

import React from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { ACHIEVEMENTS } from '@/lib/engagement/streaks';
import { formatDate } from '@/lib/academy/format';
import { useMyEngagement, WeeklyGoal } from '@/components/engagement/EngagementPanel';
import type { MonthSummary } from '@/components/engagement/types';
import { ColumnChart, KpiTile } from '@/components/ui/DataViz';
import { Card, PageHeader, Section } from '@/components/ui/Page';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { Award, Flame, Lock } from 'lucide-react';

const METRIC_LABEL: Record<string, string> = { lessonsCompleted: 'lessons completed', assignmentsSubmitted: 'assignments submitted', assessmentsCompleted: 'assessments completed', projectsApproved: 'projects approved', coursesCompleted: 'courses completed', longestStreak: 'days in a row', perfectAttendanceMonth: 'perfect month' };

function Month({ m, label }: { m: MonthSummary; label: string }) {
  return (
    <Card className="p-4 text-sm">
      <div className="font-bold text-ink">{label}</div>
      <dl className="mt-2 grid grid-cols-2 gap-1">
        <dt className="text-ink-3">Learning days</dt><dd className="font-semibold">{m.learningDays}</dd>
        <dt className="text-ink-3">Lessons</dt><dd className="font-semibold">{m.lessons}</dd>
        <dt className="text-ink-3">Assessments</dt><dd className="font-semibold">{m.assessments}</dd>
        <dt className="text-ink-3">Assignments</dt><dd className="font-semibold">{m.assignments}</dd>
        <dt className="text-ink-3">Classes attended</dt><dd className="font-semibold">{m.classesAttended}</dd>
      </dl>
    </Card>
  );
}

function Achievements() {
  const { data, error, reload } = useMyEngagement();
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading achievements…" />;
  const earned = new Set(data.achievements.map((a) => a.key.replace(/_\d{4}-\d{2}$/, '')));
  const current = (metric: string) => (metric === 'perfectAttendanceMonth' ? data.stats.perfectAttendanceMonths.length : (data.stats as unknown as Record<string, number>)[metric] ?? 0);
  return (
    <div className="space-y-8">
      <PageHeader title="Achievements" description="Earned from what you actually do: lessons completed, work submitted, classes attended and projects your instructors approve." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Current streak" value={data.streak.current} suffix="days" icon={Flame} tone="coral" />
        <KpiTile label="Longest streak" value={data.streak.longest} suffix="days" tone="warning" />
        <KpiTile label="Total learning days" value={data.streak.totalDays} tone="teal" />
        <KpiTile label="Achievements" value={data.achievements.length} icon={Award} tone="lavender" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3"><WeeklyGoal data={data} onChanged={reload} /><Month m={data.thisMonth} label="This month" /><Month m={data.lastMonth} label="Last month" /></div>
      <Card className="p-5"><h2 className="mb-3 text-sm font-bold text-ink">Learning days per week (last 12 weeks)</h2><ColumnChart data={data.history.map((w) => ({ label: `Week of ${formatDate(w.weekStart)}: ${w.days} days`, short: w.weekStart.slice(5), value: w.days }))} label="Learning days per week" tone="teal" /></Card>
      <Section title="Earned" icon={Award}>
        {data.achievements.length === 0 ? <p className="text-sm text-ink-3">Nothing yet — complete your first lesson to start.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.achievements.map((a) => (
            <li key={a.id}><Card className="h-full space-y-1 p-4"><div className="flex items-center gap-2 font-bold text-ink"><Award className="h-5 w-5 text-warning-ink" /> {a.title}</div><p className="text-sm text-ink-2">{a.description}</p><p className="text-xs text-ink-3">Earned {formatDate(a.awardedAt)} · {a.evidence.period ? `month ${a.evidence.period}` : `${a.evidence.value} ${METRIC_LABEL[a.evidence.metric] ?? ''}`}</p></Card></li>
          ))}</ul>
        )}
      </Section>
      <Section title="Still to earn" icon={Lock}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{ACHIEVEMENTS.filter((d) => !earned.has(d.id)).map((d) => (
          <li key={d.id}><Card className="h-full space-y-1 p-4 opacity-80"><div className="font-semibold text-ink">{d.title}</div><p className="text-sm text-ink-3">{d.description}</p><p className="text-xs text-ink-3">Progress: {Math.min(current(d.metric), d.threshold)} / {d.threshold} {METRIC_LABEL[d.metric]}</p></Card></li>
        ))}</ul>
        <p className="text-xs text-ink-3">Your academy may adjust some targets. Achievements are awarded once and can’t be granted by hand.</p>
      </Section>
    </div>
  );
}

export default function AchievementsPage() {
  return <RequireRole allowedRoles={['student']}><AppShell><Achievements /></AppShell></RequireRole>;
}

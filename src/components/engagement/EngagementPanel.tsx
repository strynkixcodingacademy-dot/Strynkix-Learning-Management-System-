'use client';

/**
 * Strynkix LMS — the student's engagement summary on their dashboard: streak,
 * weekly goal, what was done, what is due, feedback, achievements, activities
 * and open doubts, each with the next action. Every number is calculated by
 * the server from recorded learning (lessons, submissions, attendance).
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { engagementApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import { DOUBT_STATUS_LABEL, type MyEngagement } from './types';
import { Button, buttonClasses } from '@/components/ui/Button';
import { KpiTile } from '@/components/ui/DataViz';
import { Card, Section } from '@/components/ui/Page';
import { ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Award, CalendarDays, Flame, HelpCircle, MessageSquareText, Target } from 'lucide-react';

export function useMyEngagement() {
  return useApiData('my-engagement', () => engagementApi<MyEngagement>({ action: 'my_engagement' }));
}

export function WeeklyGoal({ data, onChanged }: { data: MyEngagement; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(data.weekly.goal);
  const pct = Math.min(100, Math.round((data.weekly.done / data.weekly.goal) * 100));
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-ink"><Target className="h-4 w-4 text-brand" /> This week’s goal</span>
        {!editing && <button type="button" className="text-xs font-semibold text-brand-ink" onClick={() => setEditing(true)}>Change</button>}
      </div>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="goal">Learn on</label>
          <select id="goal" value={goal} onChange={(e) => setGoal(Number(e.target.value))} className="rounded-lg border border-line-strong px-2 py-1">{[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          <span>days a week</span>
          <Button size="sm" onClick={async () => { await engagementApi({ action: 'set_goal', goal }); setEditing(false); onChanged(); }}>Save</Button>
        </div>
      ) : (
        <>
          <div className="text-2xl font-extrabold text-ink">{data.weekly.done} <span className="text-base font-semibold text-ink-3">of {data.weekly.goal} learning days</span></div>
          <div className="h-2 rounded-full bg-surface-sunken" role="progressbar" aria-valuenow={data.weekly.done} aria-valuemax={data.weekly.goal} aria-label="Weekly goal progress"><div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} /></div>
          <p className="text-xs text-ink-3">{data.weekly.met ? 'Goal reached — great consistency.' : 'A learning day counts when you complete a lesson, submit work or attend a class.'}</p>
        </>
      )}
    </Card>
  );
}

export function EngagementPanel() {
  const { data, error, reload } = useMyEngagement();
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading your progress…" rows={2} />;
  return (
    <div className="space-y-6">
      {data.newlyAwarded.length > 0 && <Notice kind="success">New achievement{data.newlyAwarded.length > 1 ? 's' : ''}: {data.achievements.filter((a) => data.newlyAwarded.includes(a.key)).map((a) => a.title).join(', ')}. <Link href="/dashboard/achievements" className="underline">View achievements</Link></Notice>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Learning streak" value={data.streak.current} suffix={data.streak.current === 1 ? 'day' : 'days'} icon={Flame} tone="coral" hint={data.streak.learnedToday ? 'You learned today' : data.streak.current ? 'Learn today to keep it going' : `Longest: ${data.streak.longest} days`} />
        <KpiTile label="Learning days" value={data.streak.totalDays} icon={CalendarDays} tone="teal" hint={`${data.thisMonth.learningDays} this month`} />
        <KpiTile label="Lessons completed" value={data.stats.lessonsCompleted} tone="brand" hint={`${data.stats.assignmentsSubmitted} assignments · ${data.stats.assessmentsCompleted} assessments`} />
        <KpiTile label="Achievements" value={data.achievements.length} icon={Award} tone="lavender" hint={`of ${data.available} kinds · earned from your recorded progress`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <WeeklyGoal data={data} onChanged={reload} />
        <Card className="space-y-2 p-4 lg:col-span-2">
          <div className="text-sm font-bold text-ink">What to do next</div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/my-courses" className={buttonClasses('primary', 'sm')}>Continue learning</Link>
            {data.deadlines[0] && <Link href={`/courses/${data.deadlines[0].courseId}/activities/${data.deadlines[0].id}`} className={buttonClasses('secondary', 'sm')}>Complete “{data.deadlines[0].title}”</Link>}
            {data.feedback[0] && <Link href={data.feedback[0].link} className={buttonClasses('secondary', 'sm')}>Review feedback</Link>}
            <Link href="/dashboard/doubts" className={buttonClasses('ghost', 'sm')}>Ask a doubt</Link>
            <Link href="/dashboard/achievements" className={buttonClasses('ghost', 'sm')}>View achievements</Link>
          </div>
          {data.deadlines.length > 0 && <ul className="mt-2 space-y-1 text-sm">{data.deadlines.slice(0, 4).map((d) => <li key={d.id} className="flex justify-between gap-3"><Link className="text-brand-ink hover:underline" href={`/courses/${d.courseId}/activities/${d.id}`}>{d.title}</Link><span className="text-ink-3">due {formatWhen(d.closesAt)}</span></li>)}</ul>}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Recent instructor feedback" icon={MessageSquareText}>
          {data.feedback.length === 0 ? <p className="text-sm text-ink-3">Feedback on your evaluated work appears here once results are released.</p> : (
            <ul className="space-y-2">{data.feedback.map((f, i) => <li key={i} className="rounded-xl border border-line bg-surface p-3 text-sm"><Link href={f.link} className="font-semibold text-ink hover:text-brand-ink">{f.title}</Link><p className="mt-0.5 text-ink-2">“{f.feedback}”</p></li>)}</ul>
          )}
        </Section>
        <Section title="Achievements" icon={Award} action={<Link href="/dashboard/achievements" className="text-sm font-semibold text-brand-ink">All achievements</Link>}>
          {data.achievements.length === 0 ? <p className="text-sm text-ink-3">Complete your first lesson to earn your first achievement.</p> : (
            <ul className="flex flex-wrap gap-2">{data.achievements.slice(0, 6).map((a) => <li key={a.id}><StatusPill tone="warning" icon={Award}>{a.title}</StatusPill></li>)}</ul>
          )}
        </Section>
        <Section title="Your doubts" icon={HelpCircle} action={<Link href="/dashboard/doubts" className="text-sm font-semibold text-brand-ink">Open doubts</Link>}>
          {data.doubts.length === 0 ? <p className="text-sm text-ink-3">No open questions. Stuck on something? Ask your instructors.</p> : (
            <ul className="space-y-1 text-sm">{data.doubts.map((d) => <li key={d.id} className="flex justify-between gap-2"><Link className="text-brand-ink hover:underline" href={`/dashboard/doubts/${d.id}`}>{d.title}</Link><StatusPill size="sm" tone={d.status === 'waiting_for_student' ? 'warning' : 'brand'}>{DOUBT_STATUS_LABEL[d.status]}</StatusPill></li>)}</ul>
          )}
        </Section>
        <Section title="Upcoming activities" icon={CalendarDays} action={<Link href="/dashboard/activities" className="text-sm font-semibold text-brand-ink">Browse activities</Link>}>
          {data.activities.length === 0 ? <p className="text-sm text-ink-3">You haven’t registered for any upcoming workshops or events.</p> : (
            <ul className="space-y-1 text-sm">{data.activities.map((a) => <li key={a.activityId} className="flex justify-between gap-2"><span>{a.title}</span><span className="text-ink-3">{formatWhen(a.startsAt)}</span></li>)}</ul>
          )}
        </Section>
      </div>
    </div>
  );
}

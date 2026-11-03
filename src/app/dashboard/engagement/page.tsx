'use client';

/**
 * Strynkix LMS — academy engagement for administrators: participation,
 * streaks, achievements, doubt resolution, activity registrations, feedback
 * and projects, for their branch or academy (Super Admin: any academy), with
 * course, batch, student and date filters. Achievement settings for academy
 * administrators.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { engagementApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { getBatchesForTenant } from '@/lib/batches/service';
import { ScopePicker, scopeParams, useFinanceScope } from '@/components/finance/ScopePicker';
import { BarList } from '@/components/command/Charts';
import { REVIEW_LABEL } from '@/components/career/ProjectReview';
import { formatDate } from '@/lib/academy/format';
import type { Batch } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { ColumnChart, KpiTile } from '@/components/ui/DataViz';
import { Card, Field, PageHeader, Section, fieldClasses } from '@/components/ui/Page';
import { ErrorState, LoadingState, Notice } from '@/components/ui/States';

interface Summary {
  period: { from: string; to: string }; students: number; participation: { activeStudents: number; percent: number | null };
  weeklyActive: { weekStart: string; students: number }[]; streakDistribution: { label: string; count: number }[]; achievements: { id: string; title: string; awarded: number }[];
  doubts: { asked: number; resolved: number; open: number; avgFirstResponseHours: number | null; avgResolutionHours: number | null };
  activities: { id: string; title: string; registered: number; attended: number; cancelled: number }[];
  feedback: { responses: number; byType: { type: string; responses: number; average: number | null }[] };
  projects: { status: string; count: number }[];
}
interface Settings { definitions: { id: string; title: string; threshold: number; configurable: boolean }[]; settings: { disabled: string[]; thresholds: Record<string, number> } }

function AchievementSettingsEditor({ orgId }: { orgId: string }) {
  const { data, error } = useApiData(`ach-settings|${orgId}`, () => engagementApi<Settings>({ action: 'achievement_settings', orgId }));
  const [draft, setDraft] = useState<Settings['settings'] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading achievement settings…" />;
  const s = draft ?? data.settings;
  return (
    <Card className="space-y-3 p-5">
      <p className="text-sm text-ink-3">Turn achievements off, or change the targets of the adjustable ones. Achievements already earned are kept. They are always awarded automatically from recorded progress, never by hand.</p>
      <ul className="divide-y divide-line">{data.definitions.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
          <label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={!s.disabled.includes(d.id)} onChange={(e) => setDraft({ ...s, disabled: e.target.checked ? s.disabled.filter((x) => x !== d.id) : [...s.disabled, d.id] })} /> {d.title}</label>
          {d.configurable ? <label className="flex items-center gap-1 text-xs">Target <input type="number" min={1} max={1000} value={s.thresholds[d.id] ?? d.threshold} onChange={(e) => setDraft({ ...s, thresholds: { ...s.thresholds, [d.id]: Math.max(1, Number(e.target.value)) } })} className="w-20 rounded border border-line-strong px-2 py-1" /></label> : <span className="text-xs text-ink-3">Fixed</span>}
        </li>
      ))}</ul>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Button size="sm" disabled={!draft} onClick={async () => { try { await engagementApi({ action: 'save_achievement_settings', orgId, ...s }); setMsg({ kind: 'success', text: 'Saved.' }); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } }}>Save settings</Button>
    </Card>
  );
}

function Engagement() {
  const { tenant, user } = useAuth();
  const { scope, setScope } = useFinanceScope();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState('');
  const [studentId, setStudentId] = useState('');
  useEffect(() => { if (tenant && user) getBatchesForTenant(tenant, user.uid).then(setBatches).catch(() => setBatches([])); }, [tenant, user]);
  const params = { ...scopeParams(scope, { dates: true }), ...(batchId ? { batchId } : {}), ...(studentId ? { studentId } : {}) };
  const { data, error, reload } = useApiData(JSON.stringify(params), () => engagementApi<Summary>({ action: 'academy_engagement', ...params }));
  const academyAdmin = tenant && ['super_admin', 'university_admin'].includes(tenant.role);
  return (
    <div className="space-y-8">
      <PageHeader title="Student engagement" description="Participation, streaks, achievements, doubts, activities, feedback and projects for your scope. Activity means lessons completed, work submitted or classes attended." />
      <div className="flex flex-wrap items-end gap-3">
        <ScopePicker scope={scope} onChange={setScope} dates />
        <Field label="Batch" htmlFor="en-batch"><select id="en-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={fieldClasses}><option value="">All batches</option>{batches.filter((b) => !scope.branchId || b.branchId === scope.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Student ID (optional)" htmlFor="en-stu"><input id="en-stu" value={studentId} onChange={(e) => setStudentId(e.target.value.trim())} className={`${fieldClasses} w-40`} /></Field>
      </div>
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Calculating engagement…" rows={4} /> : (
        <>
          <p className="text-sm text-ink-3">{formatDate(data.period.from)} – {formatDate(data.period.to)} (defaults to the last 30 days).</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Active students" value={data.participation.activeStudents} hint={`of ${data.students} enrolled${data.participation.percent !== null ? ` · ${data.participation.percent}%` : ''}`} />
            <KpiTile label="Doubts asked" value={data.doubts.asked} tone="coral" hint={`${data.doubts.resolved} resolved · ${data.doubts.open} open`} />
            <KpiTile label="First response" value={data.doubts.avgFirstResponseHours ?? '—'} suffix={data.doubts.avgFirstResponseHours === null ? undefined : 'h avg'} tone="teal" hint={data.doubts.avgResolutionHours !== null ? `Resolved in ${data.doubts.avgResolutionHours}h on average` : undefined} />
            <KpiTile label="Feedback responses" value={data.feedback.responses} tone="lavender" />
          </div>
          {data.weeklyActive.length > 0 && <Card className="p-5"><h2 className="mb-3 text-sm font-bold text-ink">Students active per week</h2><ColumnChart data={data.weeklyActive.map((w) => ({ label: `Week of ${formatDate(w.weekStart)}: ${w.students}`, short: w.weekStart.slice(5), value: w.students }))} label="Active students per week" tone="teal" /></Card>}
          <Card className="grid gap-6 p-5 lg:grid-cols-2">
            <BarList title="Current learning streaks" rows={data.streakDistribution.map((s) => ({ label: s.label, value: s.count }))} />
            <BarList title="Achievements awarded in the period" tone="bg-warning" rows={data.achievements.filter((a) => a.awarded).map((a) => ({ id: a.id, label: a.title, value: a.awarded }))} empty="No achievements awarded in this period." />
            <BarList title="Projects by review status" tone="bg-lavender" rows={data.projects.map((p) => ({ label: REVIEW_LABEL[p.status], value: p.count }))} />
            <div><h3 className="mb-2 text-sm font-bold text-ink">Feedback by topic</h3>{data.feedback.byType.length === 0 ? <p className="text-sm text-ink-3">No rated feedback in this period.</p> : <ul className="space-y-1 text-sm">{data.feedback.byType.map((f) => <li key={f.type} className="flex justify-between"><span>{f.type}</span><span>{f.average !== null ? `${f.average} / 5` : 'too few for an average'} · {f.responses}</span></li>)}</ul>}</div>
          </Card>
          <Section title="Activity registrations">
            {data.activities.length === 0 ? <p className="text-sm text-ink-3">No registrations from these students.</p> : <Card className="divide-y divide-line">{data.activities.map((a) => <div key={a.id} className="flex justify-between gap-2 p-3 text-sm"><span>{a.title}</span><span className="text-ink-3">{a.registered} registered · {a.attended} attended · {a.cancelled} cancelled</span></div>)}</Card>}
          </Section>
        </>
      )}
      {academyAdmin && <Section title="Achievement settings"><AchievementSettingsEditor orgId={scope.orgId} /></Section>}
    </div>
  );
}

export default function EngagementPage() {
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><AppShell><Engagement /></AppShell></RequireRole>;
}

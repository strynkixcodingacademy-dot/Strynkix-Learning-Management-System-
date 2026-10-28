'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABELS } from '@/components/dashboard/AppShell';
import { buttonClasses } from '@/components/ui/Button';
import { Avatar, ColumnChart, KpiTile, Meter } from '@/components/ui/DataViz';
import { Card, PageHeader, Section, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { cx } from '@/components/ui/tones';
import { buildAnalytics, ratioHint } from '@/lib/analytics/metrics';
import { loadAnalyticsData } from '@/lib/analytics/service';
import { getBranches } from '@/lib/admin/service';
import { BatchData } from '@/lib/analytics/metrics';
import { Branch } from '@/types/domain';
import { formatPlanDate } from '@/components/learning/LearningBits';
import { Activity, AlertTriangle, BookCheck, CalendarCheck, ClipboardCheck, Download, GraduationCap, Inbox, Layers, Trophy } from 'lucide-react';

const pct = (n: number | null) => (n === null ? '—' : `${n}`);

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function StaffAnalytics() {
  const { user, tenant } = useAuth();
  const [data, setData] = useState<BatchData[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!tenant || !user) return;
      try {
        const [result, br] = await Promise.all([
          loadAnalyticsData(tenant, user.uid),
          tenant.role === 'super_admin' || tenant.role === 'university_admin' ? getBranches(tenant.orgId).catch(() => []) : Promise.resolve([]),
        ]);
        if (!alive) return;
        setData(result.data);
        setFailed(result.failed);
        setTruncated(result.truncated);
        setBranches(br);
        setNow(new Date());
        setError(null);
      } catch (err) {
        console.error('Failed to load analytics', err);
        if (alive) setError('We couldn’t load analytics. Check your connection and try again.');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [tenant, user, reloadKey]);

  const scoped = useMemo(
    () => data.filter((d) => (branchFilter === 'all' || d.batch.branchId === branchFilter) && (batchFilter === 'all' || d.batch.id === batchFilter)),
    [data, branchFilter, batchFilter]
  );
  const report = useMemo(() => buildAnalytics(scoped, now), [scoped, now]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  if (!tenant) return null;

  const exportCsv = () => {
    const rows = [
      ['Student', 'Email', 'Batch', 'Lessons completed', 'Lessons planned', 'Assignments submitted', 'Assignments due', 'Average mark %', 'Late submissions', 'Needs attention'],
      ...report.students.map((s) => [
        s.name, s.email ?? '', s.batchName,
        String(s.metrics.learningCompletion.numerator), String(s.metrics.learningCompletion.denominator),
        String(s.metrics.submissionRate.numerator), String(s.metrics.submissionRate.denominator),
        s.metrics.assessment.percentage === null ? '' : String(s.metrics.assessment.percentage),
        String(s.metrics.lateSubmissions), s.flags.join('; '),
      ]),
    ];
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `strynkix-analytics-${now.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const m = report.metrics;
  const series = report.days.map((d) => ({ label: formatPlanDate(d.date, 'long'), short: String(Number(d.date.slice(8))), date: d.date, d }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`${ROLE_LABELS[tenant.role]} · analytics`}
        title="Analytics"
        description={tenant.role === 'instructor' ? 'How your batches are learning, submitting and scoring.' : tenant.role === 'branch_admin' ? 'How your branch is performing, batch by batch and student by student.' : 'Academy performance across every branch and batch.'}
        actions={!loading && !error && report.students.length > 0 ? (
          <button type="button" onClick={exportCsv} className={buttonClasses('secondary')}><Download className="h-4 w-4" /> Export CSV</button>
        ) : undefined}
      />

      {loading ? (
        <LoadingState label="Loading analytics…" rows={4} />
      ) : error ? (
        <ErrorState onRetry={() => { setLoading(true); setReloadKey((k) => k + 1); }}>{error}</ErrorState>
      ) : data.length === 0 ? (
        <EmptyState illustration="sprout" title="No running batches yet"
          action={tenant.role !== 'instructor' ? <Link href="/dashboard/batches" className={buttonClasses('primary', 'sm')}>Create a batch</Link> : undefined}>
          Analytics appear once a batch is running with enrolled students and daily plans.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            {branches.length > 1 && (
              <div className="sm:w-60">
                <label htmlFor="branch-filter" className="mb-1 block text-xs font-bold text-ink-3">Branch</label>
                <select id="branch-filter" value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setBatchFilter('all'); }} className={fieldClasses}>
                  <option value="all">All branches</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div className="sm:w-72">
              <label htmlFor="batch-filter" className="mb-1 block text-xs font-bold text-ink-3">Batch</label>
              <select id="batch-filter" value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} className={fieldClasses}>
                <option value="all">All batches ({data.filter((d) => branchFilter === 'all' || d.batch.branchId === branchFilter).length})</option>
                {data.filter((d) => branchFilter === 'all' || d.batch.branchId === branchFilter).map((d) => <option key={d.batch.id} value={d.batch.id}>{d.batch.name}</option>)}
              </select>
            </div>
          </div>

          {(failed.length > 0 || truncated) && (
            <Notice kind="warning">
              {failed.length > 0 && <>Couldn’t load: {failed.join(', ')}. </>}
              {truncated && 'Showing the 20 most recent batches; use the filters above to focus.'}
            </Notice>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile label="Active students" value={report.totals.activeStudents} icon={GraduationCap} hint={`Across ${report.totals.batches} batch${report.totals.batches === 1 ? '' : 'es'}; withdrawn students excluded.`} />
            <KpiTile label="Learning completion" value={pct(m.learningCompletion.percentage)} suffix={m.learningCompletion.percentage === null ? undefined : '%'} icon={BookCheck} tone="success"
              hint={ratioHint(m.learningCompletion, 'planned lessons finished (plans up to today).', 'No lessons have been planned up to today yet.')} />
            <KpiTile label="Submission rate" value={pct(m.submissionRate.percentage)} suffix={m.submissionRate.percentage === null ? undefined : '%'} icon={ClipboardCheck} tone="teal"
              hint={ratioHint(m.submissionRate, 'due assignments submitted (past deadlines only).', 'No assignment deadline has passed yet.')} />
            <KpiTile label="Average mark" value={pct(m.assessment.percentage)} suffix={m.assessment.percentage === null ? undefined : '%'} icon={Trophy} tone="lavender"
              hint={`${m.assessment.gradedCount} graded submission${m.assessment.gradedCount === 1 ? '' : 's'}; ungraded work isn’t counted.`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card className="p-5 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-[16px] font-extrabold text-ink"><Activity className="h-4 w-4 text-brand" /> Activity, last 14 days</h2>
                  <p className="text-xs text-ink-3">Lessons marked complete and assignments submitted, per day.</p>
                </div>
                <div className="flex gap-3 text-xs font-semibold text-ink-3">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> Lessons {report.days.reduce((n, d) => n + d.completions, 0)}</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand" /> Submissions {report.days.reduce((n, d) => n + d.submissions, 0)}</span>
                </div>
              </div>
              <div className="mt-5 grid gap-6 sm:grid-cols-2">
                <ColumnChart label="Lessons completed per day" tone="success" data={series.map((s) => ({ label: s.label, short: s.short, value: s.d.completions }))} />
                <ColumnChart label="Submissions per day" tone="brand" data={series.map((s) => ({ label: s.label, short: s.short, value: s.d.submissions }))} />
              </div>
            </Card>

            <Card className="p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-[16px] font-extrabold text-ink"><Inbox className="h-4 w-4 text-brand" /> Workload</h2>
              <ul className="mt-4 space-y-3">
                {[
                  { icon: ClipboardCheck, label: 'Waiting for review', value: report.totals.reviewBacklog, tone: report.totals.reviewBacklog ? 'text-coral-ink' : 'text-ink' },
                  { icon: Layers, label: 'Awaiting student corrections', value: report.totals.awaitingCorrection, tone: 'text-ink' },
                  { icon: CalendarCheck, label: 'Daily plans published to date', value: report.totals.plansPublished, tone: 'text-ink' },
                  { icon: AlertTriangle, label: 'Late submissions', value: m.lateSubmissions, tone: 'text-ink' },
                ].map((r) => (
                  <li key={r.label} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-3.5 py-3">
                    <span className="flex items-center gap-2.5 text-sm font-semibold text-ink-2"><r.icon className="h-4 w-4 text-ink-4" /> {r.label}</span>
                    <span className={cx('text-lg font-extrabold tabular-nums', r.tone)}>{r.value}</span>
                  </li>
                ))}
              </ul>
              {report.totals.reviewBacklog > 0 && (
                <Link href="/dashboard" className="mt-4 inline-block text-sm font-bold text-brand-ink hover:underline">Open today’s plans to review →</Link>
              )}
            </Card>
          </div>

          <Section id="attention" title={`Needs attention (${report.totals.atRisk})`} icon={AlertTriangle}>
            {report.totals.atRisk === 0 ? (
              <Card className="flex items-center gap-3 p-5 text-sm text-ink-2"><StatusPill tone="success" icon={BookCheck}>All on track</StatusPill> No student has missed a deadline, fallen two lessons behind, or averaged under 50%.</Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {report.students.filter((s) => s.flags.length).slice(0, 8).map((s) => (
                  <Card key={`${s.batchId}-${s.studentId}`} className="flex items-start gap-3 p-4">
                    <Avatar name={s.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold text-ink">{s.name}</span>
                        <Link href={`/dashboard/batches/${s.batchId}`} className="truncate text-xs font-bold text-brand-ink hover:underline">{s.batchName}</Link>
                      </div>
                      <ul className="mt-1.5 space-y-1">
                        {s.flags.map((f) => <li key={f} className="flex items-center gap-1.5 text-xs font-semibold text-coral-ink"><span className="h-1.5 w-1.5 rounded-full bg-coral" />{f}</li>)}
                      </ul>
                    </div>
                  </Card>
                ))}
              </div>
            )}
            <p className="text-xs text-ink-3">A student is listed after missing an assignment deadline, falling 2+ lessons behind, or averaging under 50% across 2+ graded pieces of work.</p>
          </Section>

          <Section id="batches" title="Batches compared" icon={Layers}>
            {/* Phones: one card per batch instead of a sideways-scrolling table. */}
            <ul className="space-y-3 md:hidden">
              {report.batches.map((r) => (
                <Card as="li" key={r.batch.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/dashboard/batches/${r.batch.id}`} className="block truncate font-bold text-ink hover:text-brand-ink">{r.batch.name}</Link>
                      <div className="text-xs text-ink-3">{branchName.get(r.batch.branchId) ?? r.batch.code} · {r.activeStudents} students</div>
                    </div>
                    <span className={cx('shrink-0 text-xs font-bold', r.reviewBacklog ? 'text-coral-ink' : 'text-ink-3')}>{r.reviewBacklog} to review</span>
                  </div>
                  <div className="space-y-2 text-xs font-semibold text-ink-3">
                    <div>Lessons<Meter value={r.metrics.learningCompletion.percentage} tone="success" label="Lesson completion" /></div>
                    <div>Submissions<Meter value={r.metrics.submissionRate.percentage} tone="teal" label="Submission rate" /></div>
                    <div>Average mark<Meter value={r.metrics.assessment.percentage} tone="lavender" label="Average mark" /></div>
                  </div>
                </Card>
              ))}
            </ul>
            <Card className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-left text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">
                    <th scope="col" className="px-4 py-3">Batch</th>
                    <th scope="col" className="px-4 py-3 text-right">Students</th>
                    <th scope="col" className="w-[18%] px-4 py-3">Lessons</th>
                    <th scope="col" className="w-[18%] px-4 py-3">Submissions</th>
                    <th scope="col" className="w-[18%] px-4 py-3">Avg. mark</th>
                    <th scope="col" className="px-4 py-3 text-right">To review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.batches.map((r) => (
                    <tr key={r.batch.id} className="hover:bg-canvas">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/batches/${r.batch.id}`} className="font-bold text-ink hover:text-brand-ink">{r.batch.name}</Link>
                        <div className="text-xs text-ink-3">{branchName.get(r.batch.branchId) ?? r.batch.code}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{r.activeStudents}</td>
                      <td className="px-4 py-3"><Meter value={r.metrics.learningCompletion.percentage} tone="success" label="Lesson completion" /></td>
                      <td className="px-4 py-3"><Meter value={r.metrics.submissionRate.percentage} tone="teal" label="Submission rate" /></td>
                      <td className="px-4 py-3"><Meter value={r.metrics.assessment.percentage} tone="lavender" label="Average mark" /></td>
                      <td className={cx('px-4 py-3 text-right font-bold tabular-nums', r.reviewBacklog ? 'text-coral-ink' : 'text-ink-3')}>{r.reviewBacklog}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </Section>
        </>
      )}
    </div>
  );
}

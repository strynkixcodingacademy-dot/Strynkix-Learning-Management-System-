'use client';

/**
 * Strynkix LMS — Attendance.
 * Students: their attendance per batch with the date-wise history (read-only).
 * Instructors and branch managers: take or correct a day’s attendance for a
 * batch, and see the batch report with CSV export.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { attendanceApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { getBatchesForTenant } from '@/lib/batches/service';
import { downloadCsv } from '@/lib/export/csv';
import { formatDate, todayLocal } from '@/lib/academy/format';
import type { AttendanceSession, AttendanceStatus } from '@/types/academy';
import type { Batch } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { KpiTile } from '@/components/ui/DataViz';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs } from '@/components/ui/Tabs';
import { cx } from '@/components/ui/tones';

const STATUS: { id: AttendanceStatus; label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }[] = [
  { id: 'present', label: 'Present', tone: 'success' }, { id: 'absent', label: 'Absent', tone: 'danger' },
  { id: 'late', label: 'Late', tone: 'warning' }, { id: 'excused', label: 'Excused', tone: 'neutral' },
];
const toneOf = (s: AttendanceStatus) => STATUS.find((x) => x.id === s)!.tone;

interface Stats { scheduled: number; present: number; late: number; absent: number; excused: number; percent: number }
interface MyBatch { batchId: string; batchName: string; courseTitle: string; enrollmentStatus: string; stats: Stats; history: { date: string; topic: string | null; status: AttendanceStatus }[] }

function MyAttendance() {
  const { data, error, reload } = useApiData('mine', () => attendanceApi<{ batches: MyBatch[] }>({ action: 'my_attendance' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading your attendance…" />;
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" description="Recorded by your instructors. Present and late count as attended; excused classes don’t count against you." />
      {data.batches.length === 0 ? <EmptyState title="No batches yet">Attendance appears once you are enrolled in a batch.</EmptyState> : data.batches.map((b) => (
        <section key={b.batchId} className="space-y-3">
          <h2 className="text-lg font-extrabold text-ink">{b.courseTitle} <span className="text-sm font-semibold text-ink-3">· {b.batchName}</span></h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiTile label="Attendance" value={b.stats.scheduled ? b.stats.percent : '—'} suffix={b.stats.scheduled ? '%' : undefined} />
            <KpiTile label="Classes held" value={b.stats.scheduled} tone="neutral" />
            <KpiTile label="Attended" value={b.stats.present + b.stats.late} tone="success" hint={b.stats.late ? `${b.stats.late} late` : undefined} />
            <KpiTile label="Absent" value={b.stats.absent} tone="danger" />
            <KpiTile label="Excused" value={b.stats.excused} tone="lavender" />
          </div>
          {b.history.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Date</th><th className="p-3">Topic</th><th className="p-3">Status</th></tr></thead>
                <tbody>{b.history.map((h) => <tr key={h.date} className="border-b border-line last:border-0"><td className="p-3">{formatDate(h.date)}</td><td className="p-3 text-ink-2">{h.topic ?? ''}</td><td className="p-3"><StatusPill size="sm" tone={toneOf(h.status)}>{STATUS.find((s) => s.id === h.status)!.label}</StatusPill></td></tr>)}</tbody>
              </table>
            </Card>
          )}
        </section>
      ))}
    </div>
  );
}

interface Sheet { batch: { id: string; name: string }; students: { studentId: string; name: string }[]; session: AttendanceSession | null }

function TakeAttendance({ batch }: { batch: Batch }) {
  const [date, setDate] = useState(todayLocal());
  const { data, error, reload } = useApiData(`${batch.id}|${date}`, () => attendanceApi<Sheet>({ action: 'batch_sheet', batchId: batch.id, date }));
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [topic, setTopic] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const sheetKey = data ? `${data.batch.id}|${data.session?.date ?? date}|${data.session?.updatedAt ?? ''}` : null;
  if (data && sheetKey !== loadedFor) {
    setLoadedFor(sheetKey);
    setMarks(data.session?.records ?? {});
    setTopic(data.session?.topic ?? '');
  }
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading the class list…" />;
  const unmarked = data.students.filter((s) => !marks[s.studentId]).length;
  return (
    <Card className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <Field label="Date" htmlFor="att-date"><input id="att-date" type="date" max={todayLocal()} value={date} onChange={(e) => { setMsg(null); setDate(e.target.value); }} className={fieldClasses} /></Field>
        <Field label="Topic covered (optional)" htmlFor="att-topic"><input id="att-topic" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} className={fieldClasses} /></Field>
      </div>
      {data.session && <Notice kind="info">Attendance for this date was already recorded. Changes are saved as a correction in the audit log.</Notice>}
      {data.students.length === 0 ? <EmptyState title="No students">No active students are enrolled in this batch.</EmptyState> : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMarks(Object.fromEntries(data.students.map((s) => [s.studentId, 'present' as const])))}>Mark everyone present</Button>
            {unmarked > 0 && <span className="self-center text-xs text-ink-3">{unmarked} not marked yet</span>}
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {data.students.map((s) => (
              <li key={s.studentId} className="flex flex-wrap items-center gap-2 p-3">
                <span className="min-w-[160px] flex-1 text-sm font-semibold text-ink">{s.name}</span>
                <div role="radiogroup" aria-label={`Attendance for ${s.name}`} className="flex flex-wrap gap-1">
                  {STATUS.map((st) => (
                    <button key={st.id} type="button" role="radio" aria-checked={marks[s.studentId] === st.id} onClick={() => setMarks((m) => ({ ...m, [s.studentId]: st.id }))}
                      className={cx('rounded-lg border px-2.5 py-1 text-xs font-semibold', marks[s.studentId] === st.id ? 'border-brand bg-brand text-white' : 'border-line text-ink-2 hover:bg-surface-muted')}>{st.label}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <Button loading={busy} disabled={!Object.keys(marks).length} onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await attendanceApi<{ changed: number }>({ action: 'save_session', batchId: batch.id, date, records: marks, ...(topic.trim() ? { topic: topic.trim() } : {}) });
              setMsg({ kind: 'success', text: `Attendance saved for ${formatDate(date)}${data.session ? ` (${r.changed} corrected)` : ''}.` });
              reload();
            } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
          }}>Save attendance</Button>
        </>
      )}
    </Card>
  );
}

interface Report { batch: { name: string }; sessionCount: number; sessions: { date: string; topic: string | null; records: Record<string, AttendanceStatus> }[]; students: ({ studentId: string; name: string } & Stats)[] }

function BatchReport({ batch }: { batch: Batch }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, error, reload } = useApiData(`${batch.id}|${from}|${to}`, () => attendanceApi<Report>({ action: 'batch_report', batchId: batch.id, ...(from ? { from } : {}), ...(to ? { to } : {}) }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" htmlFor="r-from"><input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClasses} /></Field>
        <Field label="To" htmlFor="r-to"><input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClasses} /></Field>
        <Button variant="secondary" disabled={!data} onClick={() => data && downloadCsv(`attendance-${batch.code || batch.name}-${from || 'start'}-${to || 'today'}.csv`, data.students, [
          { header: 'Student', value: (r) => r.name }, { header: 'Classes', value: (r) => r.scheduled }, { header: 'Present', value: (r) => r.present },
          { header: 'Late', value: (r) => r.late }, { header: 'Absent', value: (r) => r.absent }, { header: 'Excused', value: (r) => r.excused }, { header: 'Attendance %', value: (r) => r.percent },
        ], [['Batch', batch.name], ['Branch', batch.branchId], ['Academy', batch.orgId], ['From', from || 'start'], ['To', to || 'today']])}>Export CSV</Button>
        <Button variant="ghost" onClick={() => window.print()}>Print</Button>
      </div>
      {!data ? <LoadingState label="Loading the report…" /> : data.students.length === 0 ? <EmptyState title="No students">No students in this batch.</EmptyState> : (
        <div className="overflow-x-auto">
          <p className="mb-2 text-sm text-ink-3">{data.sessionCount} classes recorded{from || to ? ' in this period' : ''}.</p>
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-2">Student</th><th className="p-2 text-right">Classes</th><th className="p-2 text-right">Present</th><th className="p-2 text-right">Late</th><th className="p-2 text-right">Absent</th><th className="p-2 text-right">Excused</th><th className="p-2 text-right">%</th></tr></thead>
            <tbody>{data.students.map((s) => <tr key={s.studentId} className="border-b border-line last:border-0"><td className="p-2 font-semibold text-ink">{s.name}</td><td className="p-2 text-right">{s.scheduled}</td><td className="p-2 text-right">{s.present}</td><td className="p-2 text-right">{s.late}</td><td className="p-2 text-right">{s.absent}</td><td className="p-2 text-right">{s.excused}</td><td className={cx('p-2 text-right font-bold', s.scheduled && s.percent < 75 ? 'text-danger-ink' : 'text-ink')}>{s.scheduled ? `${s.percent}%` : '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function StaffAttendance() {
  const { tenant, user } = useAuth();
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [batchId, setBatchId] = useState('');
  const [tab, setTab] = useState<'take' | 'report'>('take');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!tenant || !user) return;
    getBatchesForTenant(tenant, user.uid).then((b) => {
      const running = b.filter((x) => !['cancelled', 'archived'].includes(x.status));
      setBatches(running);
      setBatchId((cur) => cur || running[0]?.id || '');
    }).catch((e) => setError((e as Error).message));
  }, [tenant, user]);
  const batch = useMemo(() => batches?.find((b) => b.id === batchId) ?? null, [batches, batchId]);
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!batches) return <LoadingState label="Loading your batches…" />;
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" description="Take the day’s attendance for a batch, correct earlier days, and see the batch report." />
      {batches.length === 0 ? <EmptyState title="No running batches">Attendance is taken for batches that are upcoming or in progress.</EmptyState> : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Batch" htmlFor="att-batch">
              <select id="att-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={`${fieldClasses} min-w-[240px]`}>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
            </Field>
            <Tabs<'take' | 'report'> idPrefix="att" label="View" value={tab} onChange={setTab} items={[{ id: 'take', label: 'Take attendance' }, { id: 'report', label: 'Batch report' }]} />
          </div>
          {batch && (tab === 'take' ? <TakeAttendance key={batch.id} batch={batch} /> : <BatchReport key={batch.id} batch={batch} />)}
        </>
      )}
    </div>
  );
}

export default function AttendancePage() {
  const { tenant } = useAuth();
  return (
    <RequireAuth>
      <AppShell pageTitle="Attendance">
        {!tenant ? <LoadingState label="Loading…" /> : tenant.role === 'student' ? <MyAttendance />
          : ['super_admin', 'university_admin', 'branch_admin', 'instructor'].includes(tenant.role) ? <StaffAttendance />
            : <EmptyState title="Not available">Attendance is recorded by instructors and branch managers.</EmptyState>}
      </AppShell>
    </RequireAuth>
  );
}

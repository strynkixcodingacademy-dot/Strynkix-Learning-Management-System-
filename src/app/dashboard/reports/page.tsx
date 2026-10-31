'use client';

/**
 * Strynkix LMS — Reports. Financial report (collections, expenses, outstanding
 * and the cash-basis net position by branch, course, month and category),
 * academic summary, course analytics, and CSV exports. All data comes from the
 * server for your scope and selected dates; Print gives a PDF.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { financeApi, reportsApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { downloadCsv } from '@/lib/export/csv';
import { formatDate, formatMoney, moneyPlain, todayLocal } from '@/lib/academy/format';
import { ScopePicker, scopeParams, useFinanceScope, type FinanceScope } from '@/components/finance/ScopePicker';
import type { FinanceSummary } from '@/app/dashboard/finance/page';
import { Button } from '@/components/ui/Button';
import { KpiTile } from '@/components/ui/DataViz';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';

type Tab = 'finance' | 'academic' | 'course' | 'exports';
const MONEY_KEYS = new Set(['gross', 'discount', 'adjustments', 'due', 'collected', 'balance', 'amount', 'paid', 'remaining']);

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">{head.map((h, i) => <th key={h} className={i ? 'p-2.5 text-right' : 'p-2.5'}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className={j ? 'p-2.5 text-right tabular-nums' : 'p-2.5 font-semibold text-ink'}>{c}</td>)}</tr>)}</tbody>
      </table>
    </Card>
  );
}

function FinanceReport({ scope }: { scope: FinanceScope }) {
  const { data, error, reload } = useApiData(JSON.stringify(scope), () => reportsApi<FinanceSummary>({ action: 'finance_summary', ...scopeParams(scope, { dates: true }) }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Building the report…" rows={4} />;
  const t = data.totals;
  return (
    <div className="space-y-5">
      <div className="hidden print:block"><h1 className="text-xl font-extrabold">Financial report</h1><p>{scope.orgId === '*' ? 'All academies' : scope.orgId}{scope.branchId ? ` · branch ${scope.branchId}` : ''} · {formatDate(data.period.from)} – {formatDate(data.period.to)}</p></div>
      <p className="text-sm text-ink-3 print:hidden">{formatDate(data.period.from)} – {formatDate(data.period.to)}. “Collected” is cash received; “expected” is agreed fees. The net position is collections minus expenses — not audited or statutory profit.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Collected" value={formatMoney(t.collected)} tone="success" />
        <KpiTile label="Expenses" value={formatMoney(t.expenses)} tone="coral" />
        <KpiTile label="Net operating position" value={formatMoney(t.net)} tone={t.net >= 0 ? 'teal' : 'danger'} />
        <KpiTile label="Outstanding (today)" value={formatMoney(t.outstanding)} tone="warning" hint={`${formatMoney(t.overdue)} overdue`} />
      </div>
      <Button variant="secondary" className="print:hidden" onClick={() => downloadCsv(`financial-report-${data.period.from}-${data.period.to}.csv`, [
        ...data.byMonth.map((m) => ({ section: 'Month', name: m.month, collected: m.collected, expenses: m.expenses, outstanding: null as number | null, net: m.net })),
        ...data.byBranch.map((b) => ({ section: 'Branch', name: b.name, collected: b.collected, expenses: b.expenses, outstanding: b.outstanding, net: b.net })),
        ...data.byCourse.map((c) => ({ section: 'Course', name: c.name, collected: c.collected, expenses: null, outstanding: c.outstanding, net: null })),
        ...data.byCategory.map((c) => ({ section: 'Expense category', name: c.name, collected: null, expenses: c.amount, outstanding: null, net: null })),
      ], [
        { header: 'Section', value: (r) => r.section }, { header: 'Name', value: (r) => r.name }, { header: 'Collected (INR)', value: (r) => moneyPlain(r.collected) },
        { header: 'Expenses (INR)', value: (r) => moneyPlain(r.expenses) }, { header: 'Outstanding (INR)', value: (r) => moneyPlain(r.outstanding) }, { header: 'Net (INR)', value: (r) => moneyPlain(r.net) },
      ], [['Academy', scope.orgId === '*' ? 'All academies' : scope.orgId], ['Branch', scope.branchId || 'All branches'], ['From', data.period.from], ['To', data.period.to], ['Net position', 'Collections minus expenses (cash basis, not audited profit)']])}>Export this report (CSV)</Button>
      {data.byAcademy.length > 0 && <><h2 className="font-bold text-ink">By academy</h2><Table head={['Academy', 'Students', 'Collected', 'Outstanding', 'Expenses', 'Net']} rows={data.byAcademy.map((a) => [a.name, a.students, formatMoney(a.collected), formatMoney(a.outstanding), formatMoney(a.expenses), formatMoney(a.net)])} /></>}
      <h2 className="font-bold text-ink">By month</h2>
      {data.byMonth.length ? <Table head={['Month', 'Collected', 'Expenses', 'Net']} rows={data.byMonth.map((m) => [m.month, formatMoney(m.collected), formatMoney(m.expenses), formatMoney(m.net)])} /> : <EmptyState title="No activity">Nothing was collected or spent in this period.</EmptyState>}
      {data.byBranch.length > 0 && <><h2 className="font-bold text-ink">By branch</h2><Table head={['Branch', 'Students', 'Expected', 'Collected', 'Outstanding', 'Expenses', 'Net']} rows={data.byBranch.map((b) => [b.name, b.students, formatMoney(b.expected), formatMoney(b.collected), formatMoney(b.outstanding), formatMoney(b.expenses), formatMoney(b.net)])} /></>}
      {data.byCourse.length > 0 && <><h2 className="font-bold text-ink">Course-wise revenue</h2><Table head={['Course', 'Students', 'Expected', 'Collected', 'Outstanding', 'Discounts']} rows={data.byCourse.map((c) => [c.name, c.students, formatMoney(c.expected), formatMoney(c.collected), formatMoney(c.outstanding), formatMoney(c.discounts)])} /></>}
      {data.byCategory.length > 0 && <><h2 className="font-bold text-ink">Expenses by category</h2><Table head={['Category', 'Amount']} rows={data.byCategory.map((c) => [c.name, formatMoney(c.amount)])} /></>}
    </div>
  );
}

interface Academic { totals: { admissions: number; activeStudents: number; completed: number; runningBatches: number }; admissionsByMonth: { month: string; count: number }[]; courses: { id: string; title: string; enrolled: number; active: number; completed: number }[]; batches: { id: string; name: string; branch: string; courseTitle: string; status: string; students: number; classes: number; attendance: number | null }[] }

function AcademicReport({ scope }: { scope: FinanceScope }) {
  const { data, error, reload } = useApiData(JSON.stringify(scope), () => reportsApi<Academic>({ action: 'academic_summary', ...scopeParams(scope, { dates: true }) }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Building the report…" />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Admissions" value={data.totals.admissions} hint="Confirmed in the period" />
        <KpiTile label="Active students" value={data.totals.activeStudents} tone="teal" />
        <KpiTile label="Completed" value={data.totals.completed} tone="success" />
        <KpiTile label="Running batches" value={data.totals.runningBatches} tone="lavender" />
      </div>
      {data.admissionsByMonth.length > 0 && <><h2 className="font-bold text-ink">Admissions trend</h2><Table head={['Month', 'Admissions']} rows={data.admissionsByMonth.map((m) => [m.month, m.count])} /></>}
      <h2 className="font-bold text-ink">Course popularity</h2>
      {data.courses.length ? <Table head={['Course', 'Enrolled', 'Active', 'Completed']} rows={data.courses.map((c) => [c.title, c.enrolled, c.active, c.completed])} /> : <EmptyState title="No enrollments">No enrollments in this scope.</EmptyState>}
      {data.batches.length > 0 && <><h2 className="font-bold text-ink">Batch performance</h2><Table head={['Batch', 'Branch', 'Course', 'Students', 'Classes', 'Attendance']} rows={data.batches.map((b) => [b.name, b.branch, b.courseTitle, b.students, b.classes, b.attendance === null ? '—' : `${b.attendance}%`])} /></>}
    </div>
  );
}

interface CourseData { course: { title: string }; totalLessons: number; students: { enrolled: number; active: number; completed: number; dropped: number }; averages: { completion: number | null; attendance: number | null; assessments: number | null }; exams: Record<'demo' | 'practice' | 'final', { attempts: number; average: number | null; passRate: number | null }>; fees: { expected: number; collected: number; outstanding: number; discounts: number; refunds: number }; batches: { id: string; name: string; students: number }[] }

function CourseReport({ scope }: { scope: FinanceScope }) {
  const { tenant } = useAuth();
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  const [courseId, setCourseId] = useState('');
  const [batchId, setBatchId] = useState('');
  useEffect(() => {
    if (!tenant || scope.orgId === '*') return;
    financeApi<{ courses: { id: string; title: string }[] }>({ action: 'list_pricing', orgId: scope.orgId }).then((r) => { setCourses(r.courses); setCourseId((c) => c || r.courses[0]?.id || ''); }).catch(() => setCourses([]));
  }, [tenant, scope.orgId]);
  const { data, error, reload } = useApiData(courseId ? `${courseId}|${batchId}|${JSON.stringify(scope)}` : null, () => reportsApi<CourseData>({ action: 'course_analytics', courseId, ...(scope.branchId ? { branchId: scope.branchId } : {}), ...(batchId ? { batchId } : {}), ...(scope.from ? { from: scope.from } : {}), ...(scope.to ? { to: scope.to } : {}) }));
  if (scope.orgId === '*') return <Notice kind="info">Choose an academy to see course analytics.</Notice>;
  const pctOr = (v: number | null) => (v === null ? '—' : `${v}%`);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label="Course" htmlFor="ca-course"><select id="ca-course" value={courseId} onChange={(e) => { setCourseId(e.target.value); setBatchId(''); }} className={`${fieldClasses} min-w-[240px]`}>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
        {data && data.batches.length > 1 && <Field label="Batch" htmlFor="ca-batch"><select id="ca-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={fieldClasses}><option value="">All batches</option>{data.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
      </div>
      {!courseId ? <EmptyState title="No courses">No courses in this academy.</EmptyState> : error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Analysing the course…" /> : (
        <>
          <h2 className="text-lg font-extrabold text-ink">{data.course.title}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Enrolled" value={data.students.enrolled} hint={`${data.students.active} active · ${data.students.completed} completed · ${data.students.dropped} dropped or paused`} />
            <KpiTile label="Average completion" value={pctOr(data.averages.completion)} tone="teal" hint={`${data.totalLessons} published lessons`} />
            <KpiTile label="Average attendance" value={pctOr(data.averages.attendance)} tone="lavender" />
            <KpiTile label="Average assessment score" value={pctOr(data.averages.assessments)} tone="brand" />
          </div>
          <Table head={['Examination', 'Attempts evaluated', 'Average', 'Pass rate']} rows={(['demo', 'practice', 'final'] as const).map((k) => [`${k[0].toUpperCase()}${k.slice(1)} exams`, data.exams[k].attempts, pctOr(data.exams[k].average), pctOr(data.exams[k].passRate)])} />
          <Table head={['Fees', 'Amount']} rows={[['Expected', formatMoney(data.fees.expected)], ['Collected', formatMoney(data.fees.collected)], ['Outstanding', formatMoney(data.fees.outstanding)], ['Discounts given', formatMoney(data.fees.discounts)], ['Refunds', formatMoney(data.fees.refunds)]]} />
        </>
      )}
    </div>
  );
}

const DATASETS: { id: string; label: string; file: string }[] = [
  { id: 'students', label: 'Student list (enrollments)', file: 'students' }, { id: 'admissions', label: 'Admissions', file: 'admissions' },
  { id: 'fee_accounts', label: 'Fee records', file: 'fee-records' }, { id: 'installments', label: 'Installment records', file: 'installments' },
  { id: 'transactions', label: 'Payment history (all ledger entries)', file: 'payments' }, { id: 'expenses', label: 'Expense records', file: 'expenses' },
];

function Exports({ scope }: { scope: FinanceScope }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  return (
    <div className="space-y-3">
      <Notice kind="info">Exports use the academy, branch and dates chosen above and contain only records you are allowed to see. Amounts are in rupees. Attendance exports are on the Attendance page (per batch).</Notice>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        {DATASETS.map((d) => (
          <Card key={d.id} className="flex items-center justify-between gap-3 p-4">
            <span className="font-semibold text-ink">{d.label}</span>
            <Button size="sm" variant="secondary" loading={busy === d.id} onClick={async () => {
              setBusy(d.id);
              setMsg(null);
              try {
                const r = await reportsApi<{ rows: Record<string, string | number>[] }>({ action: 'export', dataset: d.id, ...scopeParams(scope, { dates: true }) });
                if (!r.rows.length) { setMsg({ kind: 'error', text: `No ${d.label.toLowerCase()} for this selection.` }); return; }
                const cols = Object.keys(r.rows[0]).map((k) => ({ header: MONEY_KEYS.has(k) ? `${k} (INR)` : k, value: (row: Record<string, string | number>) => (MONEY_KEYS.has(k) && typeof row[k] === 'number' ? moneyPlain(row[k] as number) : row[k]) }));
                downloadCsv(`${d.file}-${scope.branchId || (scope.orgId === '*' ? 'all-academies' : 'academy')}-${todayLocal()}.csv`, r.rows, cols, [['Academy', scope.orgId === '*' ? 'All academies' : scope.orgId], ['Branch', scope.branchId || 'All branches'], ['From', scope.from || 'start'], ['To', scope.to || 'today']]);
                setMsg({ kind: 'success', text: `Exported ${r.rows.length} rows.` });
              } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(null); }
            }}>Download CSV</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Reports() {
  const { scope, setScope } = useFinanceScope({ from: `${todayLocal().slice(0, 4)}-01-01`, to: todayLocal() });
  const [tab, setTab] = useState<Tab>('finance');
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Financial and academic reports for your branch or academy. Print any report to save it as a PDF." actions={<Button variant="secondary" className="print:hidden" onClick={() => window.print()}>Print / Save as PDF</Button>} />
      <ScopePicker scope={scope} onChange={setScope} allowAll={tab !== 'course'} dates />
      <div className="print:hidden"><Tabs<Tab> idPrefix="rep" label="Report" value={tab} onChange={setTab} items={[{ id: 'finance', label: 'Financial' }, { id: 'academic', label: 'Academic' }, { id: 'course', label: 'Course analytics' }, { id: 'exports', label: 'CSV exports' }]} /></div>
      {tab === 'finance' ? <FinanceReport scope={scope} /> : tab === 'academic' ? <AcademicReport scope={scope} /> : tab === 'course' ? <CourseReport scope={scope} /> : <Exports scope={scope} />}
    </div>
  );
}

export default function ReportsPage() {
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><AppShell pageTitle="Reports"><Reports /></AppShell></RequireRole>;
}

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
import { commandApi, financeApi, reportsApi } from '@/lib/academy/api';
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

type Tab = 'organization' | 'finance' | 'academic' | 'course' | 'exports';
const MONEY_KEYS = new Set(['gross', 'discount', 'adjustments', 'due', 'collected', 'balance', 'amount', 'paid', 'remaining', 'expected', 'outstanding', 'expenses']);

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

interface OrgRow { id: string; name: string; status: string; stats: { branches: number; students: number; instructors: number; admissions: number; collected: number; outstanding: number; expenses: number } }
function OrganizationReport() {
  const academies = useApiData('org-report', () => commandApi<{ academies: OrgRow[]; total: number }>({ action: 'academies', sort: 'name' }));
  const branches = useApiData('branch-report', () => commandApi<{ branches: (OrgRow & { academy: string })[]; total: number }>({ action: 'branches' }));
  const people = useApiData('people-report', () => commandApi<{ stats: Record<string, number> }>({ action: 'overview' }));
  if (academies.error || branches.error) return <ErrorState onRetry={() => { academies.reload(); branches.reload(); }}>{academies.error ?? branches.error}</ErrorState>;
  if (!academies.data || !branches.data) return <LoadingState label="Building the organization report…" />;
  return (
    <div className="space-y-5">
      <div className="hidden print:block"><h1 className="text-xl font-extrabold">Organization report</h1><p>Generated {new Date().toLocaleString('en-IN')}</p></div>
      <h2 className="font-bold text-ink">Academy summary{academies.data.total > academies.data.academies.length ? ` (first ${academies.data.academies.length} of ${academies.data.total}; export CSV for all)` : ''}</h2>
      <Table head={['Academy', 'Status', 'Branches', 'Students', 'Instructors', 'Admissions', 'Collected', 'Outstanding', 'Expenses']} rows={academies.data.academies.map((a) => [a.name, a.status, a.stats.branches, a.stats.students, a.stats.instructors, a.stats.admissions, formatMoney(a.stats.collected), formatMoney(a.stats.outstanding), formatMoney(a.stats.expenses)])} />
      <h2 className="font-bold text-ink">Branch summary{branches.data.total > branches.data.branches.length ? ` (first ${branches.data.branches.length} of ${branches.data.total}; export CSV for all)` : ''}</h2>
      <Table head={['Branch', 'Academy', 'Students', 'Instructors', 'Admissions', 'Collected', 'Outstanding', 'Expenses']} rows={branches.data.branches.map((b) => [b.name, b.academy, b.stats.students, b.stats.instructors, b.stats.admissions, formatMoney(b.stats.collected), formatMoney(b.stats.outstanding), formatMoney(b.stats.expenses)])} />
      {people.data && <><h2 className="font-bold text-ink">User distribution</h2><Table head={['Role', 'Accounts']} rows={[['Students', people.data.stats.students], ['Instructors', people.data.stats.instructors], ['Branch managers', people.data.stats.branchManagers], ['University admins', people.data.stats.universityAdmins], ['Course designers', people.data.stats.courseDesigners]]} /></>}
      <p className="text-xs text-ink-3">Growth trends (admissions by month) are in the Academic tab and the Command Centre.</p>
    </div>
  );
}

interface HistoryRow { month: string; source: 'snapshot' | 'live'; note: string; collected: number; payments: number; paymentReversals: number; refunds: number; charges: number; waivers: number; discounts: number; expenses: number; net: number; expectedAtEnd: number; outstandingAtEnd: number }
/** Month by month: completed months come from reconciled snapshots when available, otherwise live from the ledger (labelled). */
function MonthlyHistory({ scope }: { scope: FinanceScope }) {
  const from = scope.from || `${todayLocal().slice(0, 4)}-01-01`;
  const to = scope.to || todayLocal();
  const { data, error, reload } = useApiData(`hist|${JSON.stringify(scope)}`, () => reportsApi<{ rows: HistoryRow[]; snapshotMonths: number }>({ action: 'monthly_history', ...scopeParams(scope), from, to }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading month-by-month figures…" />;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-ink">Month by month</h2>
        <Button size="sm" variant="secondary" className="print:hidden" onClick={() => downloadCsv(`monthly-history-${from}-${to}.csv`, data.rows, [
          { header: 'Month', value: (r) => r.month }, { header: 'Source', value: (r) => (r.source === 'snapshot' ? 'Reconciled snapshot' : 'Live calculation') }, { header: 'Note', value: (r) => r.note },
          { header: 'Collected (INR)', value: (r) => moneyPlain(r.collected) }, { header: 'Payments (INR)', value: (r) => moneyPlain(r.payments) }, { header: 'Payment reversals (INR)', value: (r) => moneyPlain(r.paymentReversals) },
          { header: 'Refunds (INR)', value: (r) => moneyPlain(r.refunds) }, { header: 'Extra charges (INR)', value: (r) => moneyPlain(r.charges) }, { header: 'Waivers (INR)', value: (r) => moneyPlain(r.waivers) },
          { header: 'Discounts (INR)', value: (r) => moneyPlain(r.discounts) }, { header: 'Expenses (INR)', value: (r) => moneyPlain(r.expenses) }, { header: 'Net (INR)', value: (r) => moneyPlain(r.net) },
          { header: 'Fees expected at month end (INR)', value: (r) => moneyPlain(r.expectedAtEnd) }, { header: 'Outstanding at month end (INR)', value: (r) => moneyPlain(r.outstandingAtEnd) },
        ], [['Academy', scope.orgId === '*' ? 'All academies' : scope.orgId], ['Branch', scope.branchId || 'All branches'], ['From', from], ['To', to], ['Generated', new Date().toLocaleString('en-IN')]])}>Export CSV</Button>
      </div>
      <p className="text-xs text-ink-3">Whole calendar months. {data.snapshotMonths} of {data.rows.length} months come from reconciled snapshots; the rest are calculated live from the ledger (the current month always is). Both use the same calculation.</p>
      <Table head={['Month', 'Source', 'Collected', 'Refunds', 'Reversals', 'Expenses', 'Net', 'Outstanding at end']} rows={data.rows.map((r) => [r.month, r.source === 'snapshot' ? '✓ Reconciled snapshot' : r.note, formatMoney(r.collected), formatMoney(r.refunds), formatMoney(r.paymentReversals), formatMoney(r.expenses), formatMoney(r.net), formatMoney(r.outstandingAtEnd)])} />
    </div>
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
      <MonthlyHistory scope={scope} />
      <h2 className="font-bold text-ink">By month (selected dates)</h2>
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

const DATASETS: { id: string; label: string; file: string; group: string; superOnly?: boolean; role?: string }[] = [
  { id: 'academies', label: 'Academy summary', file: 'academies', group: 'Organization', superOnly: true }, { id: 'branches', label: 'Branch summary', file: 'branches', group: 'Organization' },
  { id: 'admissions', label: 'Admissions (date, branch, course)', file: 'admissions', group: 'Admissions' }, { id: 'students', label: 'Student list (enrollments)', file: 'students', group: 'Admissions' },
  { id: 'fee_accounts', label: 'Fee collection and outstanding', file: 'fee-records', group: 'Financial' }, { id: 'installments', label: 'Installment status', file: 'installments', group: 'Financial' },
  { id: 'transactions', label: 'Payment history (all ledger entries)', file: 'payments', group: 'Financial' }, { id: 'discounts', label: 'Discounts', file: 'discounts', group: 'Financial' },
  { id: 'refunds', label: 'Refunds', file: 'refunds', group: 'Financial' }, { id: 'reversals', label: 'Payment reversals', file: 'reversals', group: 'Financial' },
  { id: 'expenses', label: 'Expense records', file: 'expenses', group: 'Financial' },
  { id: 'people', label: 'Student directory', file: 'student-directory', group: 'People', role: 'student' }, { id: 'people', label: 'Instructor directory', file: 'instructor-directory', group: 'People', role: 'instructor' },
  { id: 'people', label: 'Staff directory (managers)', file: 'staff-directory', group: 'People', role: 'branch_admin' },
];

function Exports({ scope }: { scope: FinanceScope }) {
  const { tenant } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  return (
    <div className="space-y-3">
      <Notice kind="info">Exports use the academy, branch and dates chosen above and contain only records you are allowed to see. Amounts are in rupees. Attendance exports are on the Attendance page (per batch).</Notice>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        {DATASETS.filter((d) => !d.superOnly || tenant?.role === 'super_admin').map((d) => (
          <Card key={d.file} className="flex items-center justify-between gap-3 p-4">
            <span><span className="block text-[11px] font-bold uppercase tracking-wide text-ink-3">{d.group}</span><span className="font-semibold text-ink">{d.label}</span></span>
            <Button size="sm" variant="secondary" loading={busy === d.file} onClick={async () => {
              setBusy(d.file);
              setMsg(null);
              try {
                const r = await reportsApi<{ rows: Record<string, string | number>[] }>({ action: 'export', dataset: d.id, ...(d.role ? { role: d.role } : {}), ...scopeParams(scope, { dates: true }) });
                if (!r.rows.length) { setMsg({ kind: 'error', text: `No ${d.label.toLowerCase()} for this selection.` }); return; }
                const cols = Object.keys(r.rows[0]).map((k) => ({ header: MONEY_KEYS.has(k) ? `${k} (INR)` : k, value: (row: Record<string, string | number>) => (MONEY_KEYS.has(k) && typeof row[k] === 'number' ? moneyPlain(row[k] as number) : row[k]) }));
                downloadCsv(`${d.file}-${scope.branchId || (scope.orgId === '*' ? 'all-academies' : 'academy')}-${todayLocal()}.csv`, r.rows, cols, [['Report', d.label], ['Academy', scope.orgId === '*' ? 'All academies' : scope.orgId], ['Branch', scope.branchId || 'All branches'], ['From', scope.from || 'start'], ['To', scope.to || 'today'], ['Generated', new Date().toLocaleString('en-IN')]]);
                setMsg({ kind: 'success', text: `Exported ${r.rows.length} rows.` });
              } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(null); }
            }}>Download CSV</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Reports({ initialOrgId, initialBranchId }: { initialOrgId?: string; initialBranchId?: string }) {
  const { tenant } = useAuth();
  const { scope, setScope } = useFinanceScope({ from: `${todayLocal().slice(0, 4)}-01-01`, to: todayLocal(), orgId: initialOrgId, branchId: initialBranchId });
  const [tab, setTab] = useState<Tab>('finance');
  const isSuper = tenant?.role === 'super_admin';
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Financial and academic reports for your branch or academy. Print any report to save it as a PDF." actions={<Button variant="secondary" className="print:hidden" onClick={() => window.print()}>Print / Save as PDF</Button>} />
      <ScopePicker scope={scope} onChange={setScope} allowAll={tab !== 'course'} dates />
      <div className="print:hidden"><Tabs<Tab> idPrefix="rep" label="Report" value={tab} onChange={setTab} items={[...(isSuper ? [{ id: 'organization' as Tab, label: 'Organization' }] : []), { id: 'finance', label: 'Financial' }, { id: 'academic', label: 'Admissions & academic' }, { id: 'course', label: 'Course analytics' }, { id: 'exports', label: 'CSV exports' }]} /></div>
      {tab === 'organization' && isSuper ? <OrganizationReport /> : tab === 'finance' ? <FinanceReport scope={scope} /> : tab === 'academic' ? <AcademicReport scope={scope} /> : tab === 'course' ? <CourseReport scope={scope} /> : <Exports scope={scope} />}
    </div>
  );
}

function Content({ searchParams }: { searchParams: Promise<{ orgId?: string; branchId?: string }> }) {
  const sp = React.use(searchParams);
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><AppShell><Reports initialOrgId={sp.orgId} initialBranchId={sp.branchId} /></AppShell></RequireRole>;
}

export default function ReportsPage(props: Parameters<typeof Content>[0]) {
  return <React.Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}><Content {...props} /></React.Suspense>;
}

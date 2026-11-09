'use client';

/**
 * Strynkix LMS — Finance intelligence (Super Admin): consolidated figures from
 * the one fee ledger, academy / branch / course comparisons and review
 * indicators. Indicators never change records; open a ledger to act.
 */

import React, { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { commandApi, financeApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatDate, formatMoney } from '@/lib/academy/format';
import { CommandNav } from '@/components/command/CommandNav';
import { BarList, PairedColumns } from '@/components/command/Charts';
import { Metric, useCommandFilters } from '@/components/command/Shared';
import type { FinanceSummary } from '@/app/dashboard/finance/page';
import { PaymentStatusPill } from '@/components/finance/FinanceBits';
import { Card, Field, PageHeader, Section, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { AlertTriangle } from 'lucide-react';

interface Flag { feeAccountId: string; studentName: string; admissionNumber: string; courseTitle: string; orgId: string; branchId: string; [k: string]: unknown }
interface IntelData {
  summary: FinanceSummary;
  anomalies: { overdue: Flag[]; overdueCount: number; largeBalances: Flag[]; largeBalanceCount: number; highDiscounts: Flag[]; frequentReversals: Flag[]; reversalsByStaff: { name: string; count: number }[]; repeatedRefunds: Flag[]; unusualExpenses: { id: string; title: string; category: string; amount: number; date: string; branchId: string; median: number }[]; inconsistentAccounts: Flag[] };
  names: { academies: Record<string, string>; branches: Record<string, string> };
  admissionsByAcademy: { id: string; count: number }[];
}
const th = 'p-2.5 text-left text-xs font-semibold text-ink-3';

function FlagTable({ title, rows, detail, names }: { title: string; rows: Flag[]; detail: (f: Flag) => React.ReactNode; names: IntelData['names'] }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><AlertTriangle className="h-4 w-4 text-warning-ink" /> {title} ({rows.length})</h3>
      <Card className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-line"><th className={th}>Student</th><th className={th}>Academy · branch</th><th className={th}>Course</th><th className={th}>Why it’s flagged</th></tr></thead>
        <tbody>{rows.map((f) => <tr key={`${title}-${f.feeAccountId}`} className="border-b border-line last:border-0"><td className="p-2.5"><Link href={`/dashboard/finance/accounts/${f.feeAccountId}`} className="font-semibold text-brand-ink hover:underline">{f.studentName}</Link><div className="text-xs text-ink-3">{f.admissionNumber}</div></td><td className="p-2.5">{names.academies[f.orgId] ?? f.orgId} · {names.branches[f.branchId] ?? f.branchId}</td><td className="p-2.5">{f.courseTitle}</td><td className="p-2.5">{detail(f)}</td></tr>)}</tbody></table></Card>
    </div>
  );
}

interface AccountRow { id: string; studentName: string; admissionNumber: string; courseTitle: string; due: number; collected: number; balance: number; paymentStatus: 'paid' | 'overdue' | 'partial' | 'pending' | 'cancelled'; nextDue: { dueDate: string; amount: number } | null }

function Accounts({ orgId, branchId, courseId, status }: { orgId: string; branchId: string; courseId: string; status: string }) {
  const { data, error } = useApiData(`${orgId}|${branchId}|${courseId}|${status}`, () => financeApi<{ accounts: AccountRow[] }>({ action: 'accounts', orgId, ...(branchId ? { branchId } : {}), ...(courseId ? { courseId } : {}), status }));
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading fee accounts…" />;
  if (!data.accounts.length) return <EmptyState title="No fee accounts">Nothing matches these filters.</EmptyState>;
  return (
    <Card className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-line">{['Student', 'Course', 'Due', 'Paid', 'Balance', 'Next due', 'Status'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody>{data.accounts.map((a) => <tr key={a.id} className="border-b border-line last:border-0"><td className="p-2.5"><Link href={`/dashboard/finance/accounts/${a.id}`} className="font-semibold text-brand-ink hover:underline">{a.studentName}</Link><div className="text-xs text-ink-3">{a.admissionNumber}</div></td><td className="p-2.5">{a.courseTitle}</td><td className="p-2.5 tabular-nums">{formatMoney(a.due)}</td><td className="p-2.5 tabular-nums">{formatMoney(a.collected)}</td><td className="p-2.5 font-semibold tabular-nums">{formatMoney(a.balance)}</td><td className="p-2.5">{a.nextDue ? `${formatMoney(a.nextDue.amount)} on ${formatDate(a.nextDue.dueDate)}` : '—'}</td><td className="p-2.5"><PaymentStatusPill status={a.paymentStatus} /></td></tr>)}</tbody></table></Card>
  );
}

function FinanceIntel({ initialOrgId, initialBranchId }: { initialOrgId?: string; initialBranchId?: string }) {
  const f = useCommandFilters({ orgId: initialOrgId, branchId: initialBranchId });
  const [courseId, setCourseId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [status, setStatus] = useState('all');
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (!f.orgId) return;
    let live = true;
    financeApi<{ courses: { id: string; title: string }[] }>({ action: 'list_pricing', orgId: f.orgId }).then((r) => live && setCourses(r.courses)).catch(() => live && setCourses([]));
    return () => { live = false; };
  }, [f.orgId]);
  const params = { ...f.params, ...(f.orgId && courseId ? { courseId } : {}), ...(f.orgId && batchId ? { batchId } : {}) };
  const { data, error, reload } = useApiData(JSON.stringify(params), () => commandApi<IntelData>({ action: 'finance_intel', ...params }));
  const s = data?.summary;
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: 'Command Centre', href: '/dashboard/command' }, { label: 'Finance' }]} title="Finance intelligence" description="Consolidated from the fee ledger and expense records. Indicators point to records worth a look; nothing is changed automatically." />
      <CommandNav />
      <div className="flex flex-wrap items-end gap-3">
        {f.controls()}
        {f.orgId && <Field label="Course" htmlFor="fi-course"><select id="fi-course" value={courseId} onChange={(e) => { setCourseId(e.target.value); setBatchId(''); }} className={fieldClasses}><option value="">All courses</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>}
        {f.orgId && courseId && <Field label="Batch ID (optional)" htmlFor="fi-batch"><input id="fi-batch" value={batchId} onChange={(e) => setBatchId(e.target.value.trim())} className={fieldClasses} /></Field>}
      </div>
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !s || !data ? <LoadingState label="Consolidating the ledger…" rows={5} /> : (
        <>
          <p className="text-sm text-ink-3">{formatDate(s.period.from)} – {formatDate(s.period.to)}. Obligations and balances are as of today. {courseId ? 'Expenses aren’t tied to courses, so they are left out when a course is selected.' : ''}</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-5">
            <Metric label="Fee obligations" value={formatMoney(s.totals.expected)} hint={`${s.totals.students} fee accounts`} />
            <Metric label="Payments received (to date)" value={formatMoney(s.totals.collectedToDate)} />
            <Metric label="Outstanding balances" value={formatMoney(s.totals.outstanding)} />
            <Metric label="Overdue installments" value={formatMoney(s.totals.overdue)} hint={`${s.totals.overdueAccounts} students`} />
            <Metric label="Collected in period" value={formatMoney(s.totals.collected)} />
            <Metric label="Discounts (period)" value={formatMoney(s.totals.discounts)} />
            <Metric label="Refunds (period)" value={formatMoney(s.totals.refunds)} />
            <Metric label="Expenses (period)" value={formatMoney(s.totals.expenses)} />
            <Metric label="This month" value={formatMoney(s.totals.thisMonthCollected)} hint={`collected · ${formatMoney(s.totals.thisMonthExpenses)} spent`} />
            <Metric label="Net operating position" value={formatMoney(s.totals.net)} hint="Collected − expenses (not audited profit)" />
          </div>
          <Card className="grid gap-6 p-5 lg:grid-cols-2">
            <PairedColumns title="Monthly collections vs expenses" aLabel="Collected" bLabel="Expenses" format={formatMoney} rows={s.byMonth.map((m) => ({ label: m.month, a: m.collected, b: m.expenses }))} />
            {s.byAcademy.length > 0 ? <BarList title="Collections by academy" tone="bg-success" format={formatMoney} rows={s.byAcademy.map((a) => ({ id: a.id, label: a.name, value: a.collected, href: `/dashboard/command/academies/${a.id}?tab=finance` }))} />
              : <BarList title="Collections by branch" tone="bg-success" format={formatMoney} rows={s.byBranch.map((b) => ({ id: b.id, label: b.name, value: b.collected, href: `/dashboard/command/branches/${b.id}?tab=finance` }))} />}
            {s.byAcademy.length > 0 && <BarList title="Expenses by academy" tone="bg-coral" format={formatMoney} rows={s.byAcademy.map((a) => ({ id: a.id, label: a.name, value: a.expenses }))} />}
            <BarList title="Expenses by branch" tone="bg-coral" format={formatMoney} rows={s.byBranch.map((b) => ({ id: b.id, label: b.name, value: b.expenses }))} />
            <BarList title="Outstanding by branch" tone="bg-warning" format={formatMoney} rows={s.byBranch.map((b) => ({ id: b.id, label: b.name, value: b.outstanding }))} />
            <BarList title="Course-wise revenue (collected in period)" tone="bg-teal" format={formatMoney} rows={s.byCourse.map((c) => ({ id: c.id, label: c.name, value: c.collected }))} />
            {data.admissionsByAcademy.length > 0 && <BarList title="Admission volume by academy" tone="bg-info" rows={data.admissionsByAcademy.map((a) => ({ id: a.id, label: s.byAcademy.find((x) => x.id === a.id)?.name ?? a.id, value: a.count }))} />}
          </Card>
          <Section title="Needs review" icon={AlertTriangle}>
            <p className="text-sm text-ink-3">These are prompts to check, not findings of wrongdoing. Thresholds: overdue installments; balance still ≥ 75% after 60 days; discount ≥ 25% (approved or pending); 2+ reversals or refunds on one account; staff with 3+ reversals; an expense over 3× its category’s median; stored totals that don’t match the ledger.</p>
            <FlagTable title="Overdue installments" rows={data.anomalies.overdue} names={data.names} detail={(x) => `${formatMoney(x.overdue as number)} overdue`} />
            <FlagTable title="Large outstanding balances" rows={data.anomalies.largeBalances} names={data.names} detail={(x) => `${formatMoney(x.balance as number)} of ${formatMoney(x.due as number)} unpaid`} />
            <FlagTable title="High discounts" rows={data.anomalies.highDiscounts} names={data.names} detail={(x) => <>{x.percent as number}% ({formatMoney(x.discount as number)}) — {String(x.reason ?? 'no reason')} <StatusPill size="sm" tone={x.status === 'pending' ? 'warning' : 'neutral'}>{String(x.status)}</StatusPill></>} />
            <FlagTable title="Frequent payment reversals" rows={data.anomalies.frequentReversals} names={data.names} detail={(x) => `${x.count as number} reversals`} />
            <FlagTable title="Repeated refunds" rows={data.anomalies.repeatedRefunds} names={data.names} detail={(x) => `${x.count as number} refunds`} />
            <FlagTable title="Stored totals don’t match the ledger" rows={data.anomalies.inconsistentAccounts} names={data.names} detail={() => 'Open the ledger; the account page shows the mismatch.'} />
            {data.anomalies.reversalsByStaff.length > 0 && <p className="text-sm">Staff with 3+ reversals in scope: {data.anomalies.reversalsByStaff.map((r) => `${r.name} (${r.count})`).join(', ')}.</p>}
            {data.anomalies.unusualExpenses.length > 0 && (
              <Card className="overflow-x-auto p-3"><h3 className="mb-2 text-sm font-semibold text-ink">Unusual expenses</h3><ul className="space-y-1 text-sm">{data.anomalies.unusualExpenses.map((e) => <li key={e.id}>{formatDate(e.date)} · {e.title} ({e.category}) · {formatMoney(e.amount)} vs median {formatMoney(e.median)} · {data.names.branches[e.branchId] ?? e.branchId}</li>)}</ul></Card>
            )}
            {Object.values(data.anomalies).every((v) => (Array.isArray(v) ? v.length === 0 : !v)) && <EmptyState title="Nothing to review">No record in this selection meets the review thresholds.</EmptyState>}
          </Section>
          <Section title="Student fee accounts">
            {!f.orgId ? <p className="text-sm text-ink-3">Choose an academy to list its fee accounts (with payment-status filter) and open any student’s ledger.</p> : (
              <>
                <Field label="Payment status" htmlFor="fi-status"><select id="fi-status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${fieldClasses} max-w-xs`}><option value="all">All</option><option value="overdue">Overdue</option><option value="partial">Partly paid</option><option value="pending">Not paid yet</option><option value="paid">Paid</option></select></Field>
                <Accounts orgId={f.orgId} branchId={f.branchId} courseId={courseId} status={status} />
              </>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Content({ searchParams }: { searchParams: Promise<{ orgId?: string; branchId?: string }> }) {
  const sp = use(searchParams);
  return <RequireRole allowedRoles={['super_admin']}><AppShell><FinanceIntel initialOrgId={sp.orgId} initialBranchId={sp.branchId} /></AppShell></RequireRole>;
}

export default function FinanceIntelPage(props: Parameters<typeof Content>[0]) {
  return <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}><Content {...props} /></Suspense>;
}

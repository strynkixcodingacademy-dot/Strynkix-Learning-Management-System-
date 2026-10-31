'use client';

/**
 * Strynkix LMS — Finance. Overview (collections, outstanding, overdue,
 * discounts, refunds, expenses, net position, recent transactions, upcoming
 * dues), student fee accounts, and course pricing. Every figure is computed on
 * the server from the ledger for your scope.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { financeApi, reportsApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { downloadCsv } from '@/lib/export/csv';
import { formatDate, formatMoney, moneyPlain, toPaise } from '@/lib/academy/format';
import type { CoursePricing } from '@/types/academy';
import { ScopePicker, scopeParams, useFinanceScope } from '@/components/finance/ScopePicker';
import { PaymentStatusPill } from '@/components/finance/FinanceBits';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ColumnChart, KpiTile } from '@/components/ui/DataViz';
import { Card, Field, PageHeader, Section, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { AlertTriangle, CalendarClock, History, IndianRupee, Wallet } from 'lucide-react';

export interface FinanceSummary {
  period: { from: string; to: string };
  totals: { expected: number; collectedToDate: number; outstanding: number; overdue: number; overdueAccounts: number; collected: number; refunds: number; expenses: number; net: number; discounts: number; thisMonthCollected: number; thisMonthExpenses: number; pendingDiscounts: number; students: number };
  byBranch: { id: string; name: string; expected: number; collected: number; outstanding: number; discounts: number; expenses: number; net: number; students: number }[];
  byCourse: { id: string; name: string; expected: number; collected: number; outstanding: number; discounts: number; students: number }[];
  byAcademy: { id: string; name: string; expected: number; collected: number; outstanding: number; expenses: number; net: number; students: number }[];
  byMonth: { month: string; collected: number; expenses: number; net: number }[];
  byCategory: { name: string; amount: number }[];
  recent: { id: string; type: string; amount: number; date: string; studentName: string; receiptNumber: string | null; feeAccountId: string }[];
  upcoming: { feeAccountId: string; studentName: string; admissionNumber: string; courseTitle: string; dueDate: string; amount: number }[];
}

type Tab = 'overview' | 'fees' | 'pricing';

function Overview() {
  const { scope, setScope } = useFinanceScope();
  const key = JSON.stringify(scope);
  const { data, error, reload } = useApiData(key, () => reportsApi<FinanceSummary>({ action: 'finance_summary', ...scopeParams(scope, { dates: true }) }));
  return (
    <div className="space-y-6">
      <ScopePicker scope={scope} onChange={setScope} allowAll dates />
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Calculating…" rows={4} /> : (
        <>
          <p className="text-sm text-ink-3">Period {formatDate(data.period.from)} – {formatDate(data.period.to)} (defaults to this month). Outstanding and expected are as of today.</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Collected in period" value={formatMoney(data.totals.collected)} icon={Wallet} tone="success" hint="Payments received, less refunds and reversals" />
            <KpiTile label="Outstanding fees" value={formatMoney(data.totals.outstanding)} icon={IndianRupee} tone="warning" hint={`Of ${formatMoney(data.totals.expected)} expected from ${data.totals.students} students`} />
            <KpiTile label="Overdue installments" value={formatMoney(data.totals.overdue)} icon={AlertTriangle} tone="danger" hint={`${data.totals.overdueAccounts} students behind schedule`} />
            <KpiTile label="Net operating position" value={formatMoney(data.totals.net)} tone={data.totals.net >= 0 ? 'teal' : 'danger'} hint="Collections minus expenses in the period (cash basis, not audited profit)" />
            <KpiTile label="Expenses in period" value={formatMoney(data.totals.expenses)} tone="coral" />
            <KpiTile label="Refunds in period" value={formatMoney(data.totals.refunds)} tone="neutral" />
            <KpiTile label="Discounts given" value={formatMoney(data.totals.discounts)} tone="lavender" hint={data.totals.pendingDiscounts ? `${data.totals.pendingDiscounts} waiting for approval` : 'Approved, on admissions in the period'} />
            <KpiTile label="This month" value={formatMoney(data.totals.thisMonthCollected)} tone="brand" hint={`Collected; ${formatMoney(data.totals.thisMonthExpenses)} spent`} />
          </div>
          {data.byMonth.length > 1 && <Card className="p-5"><h2 className="mb-3 text-sm font-bold text-ink">Collections by month (₹)</h2><ColumnChart data={data.byMonth.map((m) => ({ label: `${m.month}: ${formatMoney(m.collected)}`, short: m.month.slice(5), value: Math.round(m.collected / 100) }))} label="Collections by month" unit="₹" /></Card>}
          {data.byAcademy.length > 0 && (
            <Section title="By academy" icon={IndianRupee}>
              <Card className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Academy</th><th className="p-3 text-right">Students</th><th className="p-3 text-right">Collected</th><th className="p-3 text-right">Outstanding</th><th className="p-3 text-right">Expenses</th><th className="p-3 text-right">Net</th></tr></thead>
                <tbody>{data.byAcademy.map((a) => <tr key={a.id} className="border-b border-line last:border-0"><td className="p-3 font-semibold"><button type="button" className="text-brand-ink underline" onClick={() => setScope({ ...scope, orgId: a.id, branchId: '' })}>{a.name}</button></td><td className="p-3 text-right">{a.students}</td><td className="p-3 text-right">{formatMoney(a.collected)}</td><td className="p-3 text-right">{formatMoney(a.outstanding)}</td><td className="p-3 text-right">{formatMoney(a.expenses)}</td><td className="p-3 text-right font-bold">{formatMoney(a.net)}</td></tr>)}</tbody></table></Card>
            </Section>
          )}
          {data.byBranch.length > 1 && (
            <Section title="By branch" icon={IndianRupee}>
              <Card className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Branch</th><th className="p-3 text-right">Students</th><th className="p-3 text-right">Collected</th><th className="p-3 text-right">Outstanding</th><th className="p-3 text-right">Expenses</th><th className="p-3 text-right">Net</th></tr></thead>
                <tbody>{data.byBranch.map((b) => <tr key={b.id} className="border-b border-line last:border-0"><td className="p-3 font-semibold"><button type="button" className="text-brand-ink underline" onClick={() => setScope({ ...scope, branchId: b.id })}>{b.name}</button></td><td className="p-3 text-right">{b.students}</td><td className="p-3 text-right">{formatMoney(b.collected)}</td><td className="p-3 text-right">{formatMoney(b.outstanding)}</td><td className="p-3 text-right">{formatMoney(b.expenses)}</td><td className="p-3 text-right font-bold">{formatMoney(b.net)}</td></tr>)}</tbody></table></Card>
            </Section>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Upcoming dues (next 30 days)" icon={CalendarClock}>
              {data.upcoming.length === 0 ? <EmptyState title="Nothing due soon">No installments fall due in the next 30 days.</EmptyState> : (
                <ul className="space-y-1.5">{data.upcoming.map((u) => <li key={`${u.feeAccountId}-${u.dueDate}`}><Link href={`/dashboard/finance/accounts/${u.feeAccountId}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 text-sm hover:border-silver"><span><span className="font-semibold text-ink">{u.studentName}</span><span className="block text-xs text-ink-3">{u.courseTitle} · due {formatDate(u.dueDate)}</span></span><span className="font-bold">{formatMoney(u.amount)}</span></Link></li>)}</ul>
              )}
            </Section>
            <Section title="Recent transactions" icon={History}>
              {data.recent.length === 0 ? <EmptyState title="No transactions yet">Payments and refunds appear here.</EmptyState> : (
                <ul className="space-y-1.5">{data.recent.map((t) => <li key={t.id}><Link href={`/dashboard/finance/accounts/${t.feeAccountId}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 text-sm hover:border-silver"><span><span className="font-semibold text-ink">{t.studentName}</span><span className="block text-xs text-ink-3">{t.type}{t.receiptNumber ? ` · ${t.receiptNumber}` : ''} · {formatDate(t.date)}</span></span><span className={t.type === 'payment' ? 'font-bold text-success-ink' : 'font-bold text-ink-2'}>{t.type === 'payment' ? '+' : t.type === 'adjustment' ? '' : '−'}{formatMoney(t.amount)}</span></Link></li>)}</ul>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

interface AccountRow { id: string; studentName: string; admissionNumber: string; courseTitle: string; branchId: string; due: number; collected: number; balance: number; overdue: number; paymentStatus: 'paid' | 'overdue' | 'partial' | 'pending' | 'cancelled'; nextDue: { dueDate: string; amount: number } | null; discount: { status: string } }

function StudentFees() {
  const { scope, setScope } = useFinanceScope();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const key = `${JSON.stringify(scope)}|${status}`;
  const { data, error, reload } = useApiData(key, () => financeApi<{ accounts: AccountRow[] }>({ action: 'accounts', ...scopeParams(scope), status }));
  const rows = (data?.accounts ?? []).filter((r) => !q || `${r.studentName} ${r.admissionNumber}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <ScopePicker scope={scope} onChange={setScope} />
        <Field label="Status" htmlFor="fs-status"><select id="fs-status" value={status} onChange={(e) => setStatus(e.target.value)} className={fieldClasses}><option value="all">All</option><option value="overdue">Overdue</option><option value="partial">Partly paid</option><option value="pending">Not paid yet</option><option value="paid">Paid</option></select></Field>
        <Field label="Find" htmlFor="fs-q"><input id="fs-q" value={q} placeholder="Name or admission no." onChange={(e) => setQ(e.target.value)} className={fieldClasses} /></Field>
        <Button variant="secondary" disabled={!rows.length} onClick={() => downloadCsv(`fee-accounts-${scope.branchId || 'all'}.csv`, rows, [
          { header: 'Admission no.', value: (r) => r.admissionNumber }, { header: 'Student', value: (r) => r.studentName }, { header: 'Course', value: (r) => r.courseTitle },
          { header: 'Due (INR)', value: (r) => moneyPlain(r.due) }, { header: 'Paid (INR)', value: (r) => moneyPlain(r.collected) }, { header: 'Balance (INR)', value: (r) => moneyPlain(r.balance) },
          { header: 'Overdue (INR)', value: (r) => moneyPlain(r.overdue) }, { header: 'Next due', value: (r) => r.nextDue?.dueDate ?? '' }, { header: 'Status', value: (r) => r.paymentStatus },
        ], [['Academy', scope.orgId], ['Branch', scope.branchId || 'All branches'], ['Exported', new Date().toISOString().slice(0, 10)]])}>Export CSV</Button>
      </div>
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Loading fee accounts…" /> : rows.length === 0 ? <EmptyState title="No fee accounts">Fee accounts are opened when an admission is confirmed.</EmptyState> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Student</th><th className="p-3">Course</th><th className="p-3 text-right">Due</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Balance</th><th className="p-3">Next due</th><th className="p-3">Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="p-3"><Link href={`/dashboard/finance/accounts/${r.id}`} className="font-semibold text-ink hover:text-brand-ink">{r.studentName}</Link><div className="text-xs text-ink-3">{r.admissionNumber}</div></td>
                <td className="p-3 text-ink-2">{r.courseTitle}</td>
                <td className="p-3 text-right tabular-nums">{formatMoney(r.due)}</td><td className="p-3 text-right tabular-nums">{formatMoney(r.collected)}</td>
                <td className="p-3 text-right font-bold tabular-nums">{formatMoney(r.balance)}</td>
                <td className="p-3">{r.nextDue ? `${formatMoney(r.nextDue.amount)} on ${formatDate(r.nextDue.dueDate)}` : '—'}</td>
                <td className="p-3"><PaymentStatusPill status={r.paymentStatus} />{r.discount.status === 'pending' && <div className="mt-1 text-[11px] text-warning-ink">Discount awaiting approval</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

interface PricingRow { id: string; title: string; status: string; pricing: CoursePricing | null; gross: number | null }

const EXAM_FEE = 'Examination / material fee';

function PricingEditor({ course, onSaved }: { course: PricingRow; onSaved: () => void }) {
  const p = course.pricing;
  const [f, setF] = useState({ standard: p ? String(p.standardFee / 100) : '', registration: p ? String(p.registrationFee / 100) : '0', exam: ((x) => (x ? String(x.amount / 100) : ''))(p?.otherFees.find((o) => o.label === EXAM_FEE)), options: p?.installmentOptions.join(', ') ?? '1, 2, 3', ba: p ? String(p.discountLimits.branch_admin / 100) : '10', ua: p ? String(p.discountLimits.university_admin / 100) : '25', available: p?.available ?? true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const standard = toPaise(f.standard), registration = toPaise(f.registration || '0'), exam = f.exam ? toPaise(f.exam) : 0;
      if (standard === null || registration === null || exam === null) throw new Error('Enter fees as amounts in rupees.');
      const r = await financeApi<{ version: number; gross: number }>({ action: 'save_pricing', courseId: course.id, pricing: {
        standardFee: standard, registrationFee: registration, // Other fee lines (set elsewhere) are kept; only the examination / material line is edited here.
        otherFees: [...(p?.otherFees ?? []).filter((o) => o.label !== EXAM_FEE), ...(exam ? [{ label: EXAM_FEE, amount: exam }] : [])],
        installmentOptions: [...new Set(f.options.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 24))].sort((a, b) => a - b),
        discountLimits: { branch_admin: Math.round(Number(f.ba) * 100), university_admin: Math.round(Number(f.ua) * 100) }, available: f.available,
      } });
      setMsg({ kind: 'success', text: `Saved as version ${r.version}. Total ${formatMoney(r.gross)}. Students already admitted keep their agreed fee.` });
      onSaved();
    } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const I = (k: keyof typeof f, label: string, hint?: string) => <Field label={label} htmlFor={`pr-${course.id}-${k}`} hint={hint}><input id={`pr-${course.id}-${k}`} value={f[k] as string} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} className={fieldClasses} /></Field>;
  return (
    <div className="space-y-3 border-t border-line p-4">
      <div className="grid gap-3 sm:grid-cols-3">{I('standard', 'Course fee (₹)')}{I('registration', 'Registration fee (₹)')}{I('exam', 'Examination / material fee (₹)')}</div>
      <div className="grid gap-3 sm:grid-cols-3">{I('options', 'Installment options', 'e.g. 1, 2, 3')}{I('ba', 'Branch Manager discount limit (%)')}{I('ua', 'University Admin discount limit (%)')}</div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.available} onChange={(e) => setF((x) => ({ ...x, available: e.target.checked }))} /> Open for admissions</label>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Button size="sm" onClick={save} loading={busy}>Save pricing</Button>
    </div>
  );
}

function Pricing() {
  const { tenant } = useAuth();
  const { data, error, reload } = useApiData('pricing', () => financeApi<{ canEdit: boolean; courses: PricingRow[] }>({ action: 'list_pricing' }));
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading course pricing…" />;
  return (
    <div className="space-y-3">
      <Notice kind="info">{data.canEdit ? 'You set the approved price for each course. Changes apply to new admissions only and are versioned in the audit log.' : `Prices are set by the Super Admin. ${tenant?.role === 'branch_admin' ? 'You can offer discounts up to your limit; larger discounts are sent for approval.' : ''}`}</Notice>
      {data.courses.map((c) => (
        <Card key={c.id}>
          <div className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1"><div className="font-bold text-ink">{c.title}</div><div className="text-xs text-ink-3">{c.pricing ? `Version ${c.pricing.version} · installments ${c.pricing.installmentOptions.join(', ')} · discount limits ${c.pricing.discountLimits.branch_admin / 100}% / ${c.pricing.discountLimits.university_admin / 100}%${c.pricing.available ? '' : ' · closed for admissions'}` : 'No price set yet'}</div></div>
            <span className="font-extrabold text-ink">{c.gross === null ? '—' : formatMoney(c.gross)}</span>
            {data.canEdit && <Button size="sm" variant="secondary" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Close' : c.pricing ? 'Edit' : 'Set price'}</Button>}
          </div>
          {open === c.id && <PricingEditor course={c} onSaved={reload} />}
        </Card>
      ))}
    </div>
  );
}

function Finance() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="space-y-6">
      <PageHeader title="Finance" description="Fees expected and collected, dues, discounts and refunds, from the fee ledger." actions={<Link href="/dashboard/reports" className={buttonClasses('secondary')}>Reports and exports</Link>} />
      <Tabs<Tab> idPrefix="fin" label="Finance" value={tab} onChange={setTab} items={[{ id: 'overview', label: 'Overview' }, { id: 'fees', label: 'Student fees' }, { id: 'pricing', label: 'Course pricing' }]} />
      {tab === 'overview' ? <Overview /> : tab === 'fees' ? <StudentFees /> : <Pricing />}
    </div>
  );
}

export default function FinancePage() {
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><AppShell pageTitle="Finance"><Finance /></AppShell></RequireRole>;
}

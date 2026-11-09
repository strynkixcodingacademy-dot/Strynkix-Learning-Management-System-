'use client';

/**
 * Strynkix LMS — My fees: the signed-in student's own fee accounts, read-only:
 * what is due, what has been paid, the installment schedule and receipts.
 * Payments are recorded by the branch office.
 */

import React from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { financeApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatDate, formatMoney } from '@/lib/academy/format';
import { InstallmentPill, PaymentStatusPill } from '@/components/finance/FinanceBits';
import { KpiTile } from '@/components/ui/DataViz';
import { Card, PageHeader } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';

interface MyFeeAccount {
  id: string;
  courseTitle: string;
  admissionNumber: string;
  grossFee: number;
  discount: number;
  due: number;
  collected: number;
  balance: number;
  overdue: number;
  nextDue: { dueDate: string; amount: number } | null;
  paymentStatus: 'paid' | 'overdue' | 'partial' | 'pending' | 'cancelled';
  installments: { dueDate: string; amount: number; paid: number; remaining: number; state: 'paid' | 'partial' | 'overdue' | 'due_today' | 'upcoming' }[];
  entries: { id: string; type: 'payment' | 'refund'; date: string; amount: number; method: string; receiptNumber: string | null; reversed: boolean }[];
}

function Account({ a }: { a: MyFeeAccount }) {
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="type-section text-ink">{a.courseTitle}</h2>
        <PaymentStatusPill status={a.paymentStatus} />
        <span className="ml-auto text-xs text-ink-3">Admission {a.admissionNumber}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <KpiTile label="Total fee" value={formatMoney(a.due)} tone="teal" />
        <KpiTile label="Paid" value={formatMoney(a.collected)} tone="success" />
        <KpiTile label="Balance" value={formatMoney(a.balance)} tone={a.overdue > 0 ? 'coral' : 'info'} />
        <KpiTile label="Next payment" value={a.nextDue ? formatMoney(a.nextDue.amount) : '—'} hint={a.nextDue ? `due ${formatDate(a.nextDue.dueDate)}` : 'nothing due'} tone="warning" />
      </div>
      {a.discount > 0 && <p className="text-sm text-ink-2">Includes an approved discount of {formatMoney(a.discount)} on {formatMoney(a.grossFee)}.</p>}
      {a.overdue > 0 && <p className="text-sm font-medium text-coral-ink">{formatMoney(a.overdue)} is overdue. Please contact your branch office.</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <caption className="pb-2 text-left text-sm font-semibold text-ink">Installments</caption>
          <thead><tr className="border-b border-line text-left text-xs text-ink-3"><th className="p-2">Due date</th><th className="p-2 text-right">Amount</th><th className="p-2 text-right">Paid</th><th className="p-2">Status</th></tr></thead>
          <tbody>{a.installments.map((it, i) => (
            <tr key={i} className="border-b border-line last:border-0"><td className="p-2">{formatDate(it.dueDate)}</td><td className="p-2 text-right tabular-nums">{formatMoney(it.amount)}</td><td className="p-2 text-right tabular-nums">{formatMoney(it.paid)}</td><td className="p-2"><InstallmentPill state={it.state} /></td></tr>
          ))}</tbody>
        </table>
      </div>
      <div>
        <h3 className="pb-2 text-sm font-semibold text-ink">Payments and receipts</h3>
        {a.entries.length === 0 ? <p className="text-sm text-ink-3">No payments recorded yet.</p> : (
          <ul className="divide-y divide-line text-sm">{a.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className={e.reversed ? 'text-ink-4 line-through' : 'font-semibold text-ink'}>{e.type === 'refund' ? 'Refund' : 'Payment'} {formatMoney(e.amount)}</span>
              <span className="text-ink-3">{formatDate(e.date)} · {e.method}{e.reversed ? ' · reversed' : ''}</span>
              {e.type === 'payment' && !e.reversed && e.receiptNumber && <Link href={`/receipts/${e.id}`} className="ml-auto text-sm font-semibold text-brand-ink underline">Receipt {e.receiptNumber}</Link>}
            </li>
          ))}</ul>
        )}
      </div>
    </Card>
  );
}

function MyFees() {
  const { data, error, reload } = useApiData('my-fees', () => financeApi<{ accounts: MyFeeAccount[] }>({ action: 'my_fees' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading your fees…" />;
  return (
    <div className="space-y-6">
      <PageHeader title="My fees" description="Your course fees, installments and receipts. Payments are recorded by your branch office; ask them if something looks wrong." />
      {data.accounts.length === 0 ? <EmptyState title="No fee accounts">Fees appear here once your admission is recorded.</EmptyState> : data.accounts.map((a) => <Account key={a.id} a={a} />)}
    </div>
  );
}

export default function MyFeesPage() {
  return <RequireRole allowedRoles={['student']}><AppShell><MyFees /></AppShell></RequireRole>;
}

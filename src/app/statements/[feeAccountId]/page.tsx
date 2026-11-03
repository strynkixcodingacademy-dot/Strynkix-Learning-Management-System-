'use client';

/** Strynkix LMS — printable fee ledger and installment statement for one student. */

import React, { Suspense, use } from 'react';
import { RequireRole } from '@/components/auth/RouteGuards';
import { financeApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatDate, formatMoney } from '@/lib/academy/format';
import type { FeeAccount, FeeTransaction, InstallmentPlanItem } from '@/types/academy';
import { DocHeader, PrintFrame } from '@/components/print/PrintFrame';
import { ErrorState, LoadingState } from '@/components/ui/States';

type View = { account: FeeAccount & { due: number; collected: number; balance: number; allocation: (InstallmentPlanItem & { paid: number; remaining: number; state: string })[] }; transactions: (FeeTransaction & { reversed: boolean })[] };

function Statement({ id }: { id: string }) {
  const { data, error } = useApiData(id, () => financeApi<View>({ action: 'account', feeAccountId: id }));
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading…" />;
  const a = data.account;
  const th = 'border-b border-[#1d1d1f] p-1.5 text-left';
  const td = 'border-b border-[#e5e5ea] p-1.5';
  return (
    <PrintFrame back={`/dashboard/finance/accounts/${a.id}`} title="Fee statement">
      <DocHeader academy="Strynkix Coding Academy" branch={`Branch ${a.branchId}`} title="Fee statement" meta={<>{a.admissionNumber}<br />As of {formatDate(new Date().toISOString())}</>} />
      <p><strong>{a.studentName}</strong> · {a.courseTitle}</p>
      <p className="mt-1">Standard fee {formatMoney(a.grossFee)}{a.discount.status === 'approved' && a.discount.amount ? ` · discount ${formatMoney(a.discount.amount)}` : ''}{a.totals.adjustments ? ` · adjustments ${formatMoney(a.totals.adjustments)}` : ''} · <strong>amount due {formatMoney(a.due)}</strong> · paid {formatMoney(a.collected)} · <strong>balance {formatMoney(a.balance)}</strong></p>
      <h2 className="mb-1 mt-5 font-bold">Installments</h2>
      <table className="w-full border-collapse"><thead><tr><th className={th}>#</th><th className={th}>Due</th><th className={th}>Amount</th><th className={th}>Paid</th><th className={th}>Remaining</th><th className={th}>Status</th></tr></thead>
        <tbody>{a.allocation.map((i) => <tr key={i.number}><td className={td}>{i.number}</td><td className={td}>{formatDate(i.dueDate)}</td><td className={td}>{formatMoney(i.amount)}</td><td className={td}>{formatMoney(i.paid)}</td><td className={td}>{formatMoney(i.remaining)}</td><td className={td}>{i.state.replace('_', ' ')}</td></tr>)}</tbody></table>
      <h2 className="mb-1 mt-5 font-bold">Transactions</h2>
      <table className="w-full border-collapse"><thead><tr><th className={th}>Date</th><th className={th}>Entry</th><th className={th}>Receipt</th><th className={th}>Amount</th><th className={th}>Details</th></tr></thead>
        <tbody>{data.transactions.map((t) => <tr key={t.id}><td className={td}>{formatDate(t.date)}</td><td className={td}>{t.type}{t.reversed ? ' (reversed)' : ''}</td><td className={td}>{t.receiptNumber ?? ''}</td><td className={td}>{formatMoney(t.amount)}</td><td className={td}>{[t.method, t.reference, t.reason].filter(Boolean).join(' · ')}</td></tr>)}</tbody></table>
    </PrintFrame>
  );
}

function StatementPageContent({ params }: { params: Promise<{ feeAccountId: string }> }) {
  const { feeAccountId } = use(params);
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><Statement id={feeAccountId} /></RequireRole>;
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function StatementPage(props: Parameters<typeof StatementPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <StatementPageContent {...props} />
    </Suspense>
  );
}

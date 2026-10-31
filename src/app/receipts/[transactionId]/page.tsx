'use client';

/** Strynkix LMS — printable payment receipt (one per payment; the number is unique and never reissued). */

import React, { Suspense, use } from 'react';
import { RequireRole } from '@/components/auth/RouteGuards';
import { financeApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatDate, formatMoney } from '@/lib/academy/format';
import { DocHeader, PrintFrame } from '@/components/print/PrintFrame';
import { ErrorState, LoadingState } from '@/components/ui/States';

interface Receipt {
  receiptNumber: string; date: string; amount: number; method: string; reference: string | null; balanceAfter: number | null; receivedBy: string; recordedAt: string; reversed: boolean;
  academy: { name: string; website: string | null }; branch: { name: string; code: string; city: string };
  student: { name: string; admissionNumber: string; mobile: string | null; email: string | null }; course: string; agreedFee: number;
}

function ReceiptView({ id }: { id: string }) {
  const { data, error } = useApiData(id, () => financeApi<{ receipt: Receipt }>({ action: 'receipt', transactionId: id }));
  if (error) return <div className="mx-auto max-w-md p-8"><ErrorState title="Receipt unavailable">{error}</ErrorState></div>;
  if (!data) return <LoadingState label="Loading receipt…" />;
  const r = data.receipt;
  const row = (label: string, value: React.ReactNode) => <div className="flex justify-between gap-4 border-b border-[#e5e5ea] py-2"><dt className="text-[#6e6e73]">{label}</dt><dd className="text-right font-medium">{value}</dd></div>;
  return (
    <PrintFrame back="/dashboard/finance" title="Payment receipt">
      {r.reversed && <p className="mb-4 rounded border-2 border-red-600 p-2 text-center font-bold uppercase text-red-600">This payment was reversed. The receipt is void.</p>}
      <DocHeader academy={r.academy.name} branch={`${r.branch.name}${r.branch.city ? `, ${r.branch.city}` : ''} (${r.branch.code})`} title="Payment receipt" meta={<>No. <strong>{r.receiptNumber}</strong><br />{formatDate(r.date)}</>} />
      <dl>
        {row('Received from', `${r.student.name} (${r.student.admissionNumber})`)}
        {r.student.mobile && row('Mobile', r.student.mobile)}
        {row('Course', r.course)}
        {row('Payment method', r.method)}
        {r.reference && row('Transaction reference', r.reference)}
      </dl>
      <div className="my-6 flex items-center justify-between rounded-lg border-2 border-[#1d1d1f] p-4">
        <span className="text-sm font-semibold">Amount received</span>
        <span className="text-2xl font-extrabold">{formatMoney(r.amount)}</span>
      </div>
      <dl>
        {row('Total course fee (after discounts)', formatMoney(r.agreedFee))}
        {row('Balance outstanding after this payment', r.balanceAfter === null ? '—' : formatMoney(r.balanceAfter))}
        {row('Received by', r.receivedBy)}
      </dl>
      <p className="mt-10 text-xs text-[#6e6e73]">This is a computer-generated receipt recorded on {new Date(r.recordedAt).toLocaleString('en-IN')}. Corrections are made by a separate reversal entry; receipts are never edited.</p>
      <div className="mt-12 text-right text-xs"><div className="inline-block border-t border-[#1d1d1f] px-8 pt-1">Authorized signatory</div></div>
    </PrintFrame>
  );
}

function ReceiptPageContent({ params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = use(params);
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><ReceiptView id={transactionId} /></RequireRole>;
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function ReceiptPage(props: Parameters<typeof ReceiptPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <ReceiptPageContent {...props} />
    </Suspense>
  );
}

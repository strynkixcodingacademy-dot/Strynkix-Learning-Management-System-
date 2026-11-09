'use client';

/**
 * Strynkix LMS — one student's fee account: agreed fee, installments (status
 * derived from payments), the full ledger, and the actions a manager may take.
 * Nothing here edits or deletes a past entry: corrections are reversals or
 * adjustments, each with a reason, recorded by the server.
 */

import React, { Suspense, use, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { financeApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { downloadCsv } from '@/lib/export/csv';
import { formatDate, formatMoney, moneyPlain, toPaise, todayLocal } from '@/lib/academy/format';
import { fitSchedule } from '@/lib/finance/fees';
import type { FeeAccount, FeeTransaction, InstallmentPlanItem, PaymentMethod } from '@/types/academy';
import { InstallmentPill, PaymentStatusPill, newRequestId } from '@/components/finance/FinanceBits';
import { Button, buttonClasses } from '@/components/ui/Button';
import { KpiTile } from '@/components/ui/DataViz';
import { Card, Field, PageHeader, Section, fieldClasses } from '@/components/ui/Page';
import { ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { cx } from '@/components/ui/tones';
import { useConfirm } from '@/components/ui/ConfirmDialog';

type Alloc = InstallmentPlanItem & { paid: number; remaining: number; state: 'paid' | 'partial' | 'overdue' | 'due_today' | 'upcoming' };
interface AccountView {
  account: FeeAccount & { due: number; collected: number; balance: number; overdue: number; nextDue: { dueDate: string; amount: number } | null; paymentStatus: 'paid' | 'overdue' | 'partial' | 'pending' | 'cancelled'; allocation: Alloc[] };
  transactions: (FeeTransaction & { reversed: boolean; balanceAfter?: number })[];
  canApproveDiscount: boolean;
  canWaive: boolean;
  context?: { academyName: string; branchName: string; admittedOn: string };
  reconciled?: boolean;
}
type Action = 'payment' | 'refund' | 'charge' | 'waiver' | 'reschedule' | null;
const METHODS: { id: PaymentMethod; label: string }[] = [{ id: 'cash', label: 'Cash' }, { id: 'upi', label: 'UPI' }, { id: 'bank_transfer', label: 'Bank transfer' }, { id: 'card', label: 'Card' }, { id: 'cheque', label: 'Cheque' }, { id: 'other', label: 'Other' }];

function ActionForm({ action, view, onDone, onCancel }: { action: Exclude<Action, null>; view: AccountView; onDone: (msg: string, receiptTx?: string) => void; onCancel: () => void }) {
  const a = view.account;
  const [amount, setAmount] = useState(action === 'payment' && a.nextDue ? (a.nextDue.amount / 100).toFixed(2) : '');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [reason, setReason] = useState('');
  const [schedule, setSchedule] = useState<InstallmentPlanItem[]>(a.installments);
  const [requestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountPaise = toPaise(amount || '');
  const signed = action === 'waiver' ? -(amountPaise ?? 0) : amountPaise ?? 0;
  const newDue = a.due + (action === 'charge' || action === 'waiver' ? signed : 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (action !== 'reschedule' && !amountPaise) throw new Error('Enter an amount in rupees, like 5000 or 5000.50.');
      if (action === 'payment') {
        if (method !== 'cash' && !reference.trim()) throw new Error('Add the transaction reference for non-cash payments.');
        const r = await financeApi<{ transactionId: string; receiptNumber: string; duplicate?: boolean }>({ action: 'record_payment', feeAccountId: a.id, requestId, amount: amountPaise, method, date, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(reason.trim() ? { note: reason.trim() } : {}) });
        onDone(r.duplicate ? `This payment was already recorded (receipt ${r.receiptNumber}).` : `Payment recorded. Receipt ${r.receiptNumber}.`, r.transactionId);
      } else if (action === 'refund') {
        await financeApi({ action: 'record_refund', feeAccountId: a.id, requestId, amount: amountPaise, method, date, reason: reason.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) });
        onDone('Refund recorded.');
      } else if (action === 'charge' || action === 'waiver') {
        const fitted = fitSchedule(schedule, newDue);
        await financeApi({ action: 'add_adjustment', feeAccountId: a.id, requestId, amount: signed, reason: reason.trim(), installments: fitted });
        onDone(action === 'charge' ? 'Extra charge added and the schedule updated.' : 'Waiver recorded and the schedule updated.');
      } else {
        await financeApi({ action: 'reschedule', feeAccountId: a.id, installments: schedule.map((s, i) => ({ ...s, number: i + 1 })), reason: reason.trim() });
        onDone('Installment schedule updated.');
      }
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  const title = { payment: 'Record a payment', refund: 'Record a refund', charge: 'Add an extra charge', waiver: 'Waive part of the fee', reschedule: 'Change the installment schedule' }[action];
  return (
    <Card className="space-y-4 border-brand-line p-5">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {action !== 'reschedule' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Amount (₹)" htmlFor="ac-amount" required hint={action === 'payment' ? `Balance ${formatMoney(a.balance)}` : action === 'refund' ? `Collected ${formatMoney(a.collected)}` : undefined}><input id="ac-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldClasses} /></Field>
          {(action === 'payment' || action === 'refund') && <>
            <Field label="Method" htmlFor="ac-method"><select id="ac-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={fieldClasses}>{METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
            <Field label="Date" htmlFor="ac-date"><input id="ac-date" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} className={fieldClasses} /></Field>
            <div className="sm:col-span-3"><Field label="Transaction reference" htmlFor="ac-ref" hint="UPI / bank / cheque reference. Never enter card numbers or PINs."><input id="ac-ref" value={reference} onChange={(e) => setReference(e.target.value)} className={fieldClasses} /></Field></div>
          </>}
        </div>
      )}
      {action === 'reschedule' && (
        <div className="space-y-2">
          <p className="text-sm text-ink-3">The installments must add up to the amount due, {formatMoney(a.due)}.</p>
          {schedule.map((it, i) => (
            <div key={i} className="grid grid-cols-[40px_1fr_1fr_40px] items-center gap-2">
              <span className="text-sm text-ink-3">#{i + 1}</span>
              <input aria-label={`Installment ${i + 1} due date`} type="date" value={it.dueDate} onChange={(e) => setSchedule((s) => s.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} className={fieldClasses} />
              <input aria-label={`Installment ${i + 1} amount`} inputMode="decimal" defaultValue={(it.amount / 100).toFixed(2)} onBlur={(e) => { const v = toPaise(e.target.value); if (v !== null) setSchedule((s) => s.map((x, j) => (j === i ? { ...x, amount: v } : x))); }} className={fieldClasses} />
              <button type="button" aria-label={`Remove installment ${i + 1}`} disabled={schedule.length <= 1} onClick={() => setSchedule((s) => s.filter((_, j) => j !== i))} className="text-danger-ink disabled:opacity-30">×</button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSchedule((s) => [...s, { number: s.length + 1, dueDate: todayLocal(), amount: 100 }])}>+ Add installment</Button>
          <p className="text-xs text-ink-3">Total: {formatMoney(schedule.reduce((s, i) => s + i.amount, 0))}</p>
        </div>
      )}
      {(action === 'charge' || action === 'waiver') && amountPaise ? <p className="text-sm text-ink-3">New amount due: {formatMoney(newDue)}. The schedule is adjusted from the last installment.</p> : null}
      <Field label={action === 'payment' ? 'Note (optional)' : 'Reason'} htmlFor="ac-reason" required={action !== 'payment'}><input id="ac-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClasses} /></Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex gap-2"><Button onClick={submit} loading={busy} disabled={action !== 'payment' && reason.trim().length < 5}>Save</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </Card>
  );
}

function Account({ id }: { id: string }) {
  const { data, error, reload } = useApiData(id, () => financeApi<AccountView>({ action: 'account', feeAccountId: id }));
  const [action, setAction] = useState<Action>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string; receipt?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { prompt, dialog } = useConfirm();
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading the fee account…" />;
  const a = data.account;

  const reverse = async (t: FeeTransaction) => {
    const reason = await prompt({ title: `Reverse this ${t.type} of ${formatMoney(t.amount)}?`, body: 'A reversing entry is added; the original stays in the ledger. This is audited.', label: 'Why are you reversing it?', confirmLabel: 'Record reversal', tone: 'danger' });
    if (!reason) return;
    setBusy(true);
    try { await financeApi({ action: 'reverse', transactionId: t.id, reason }); setMsg({ kind: 'success', text: 'Reversal recorded. The original entry stays in the ledger.' }); reload(); }
    catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const decide = async (approve: boolean) => {
    setBusy(true);
    try { await financeApi({ action: 'decide_discount', feeAccountId: a.id, approve }); setMsg({ kind: 'success', text: approve ? 'Discount approved; the schedule was reduced from the last installment.' : 'Discount rejected; the full fee applies.' }); reload(); }
    catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader breadcrumbs={[{ label: 'Finance', href: '/dashboard/finance' }, { label: a.studentName }]} eyebrow={`Fee account · ${a.admissionNumber}`} title={a.studentName} description={`${a.courseTitle} · ${data.context ? `${data.context.academyName} · ${data.context.branchName} · admitted ${formatDate(data.context.admittedOn)} · ` : ''}pricing version ${a.pricingVersion}`}
        actions={<><PaymentStatusPill status={a.paymentStatus} /><Link href={`/dashboard/people/${a.studentId}`} className={buttonClasses('ghost', 'sm')}>Student profile</Link></>} />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <KpiTile label="Amount due" value={formatMoney(a.due)} hint={`Standard ${formatMoney(a.grossFee)}${a.discount.amount ? ` − discount ${formatMoney(a.discount.status === 'approved' ? a.discount.amount : 0)}` : ''}${a.totals.adjustments ? ` ${a.totals.adjustments > 0 ? '+' : '−'} adjustments ${formatMoney(Math.abs(a.totals.adjustments))}` : ''}`} />
        <KpiTile label="Paid" value={formatMoney(a.collected)} tone="success" hint={a.totals.refunded ? `After ${formatMoney(a.totals.refunded)} refunded` : undefined} />
        <KpiTile label="Balance" value={formatMoney(a.balance)} tone={a.balance ? 'warning' : 'success'} />
        <KpiTile label="Next due" value={a.nextDue ? formatMoney(a.nextDue.amount) : '—'} tone={a.overdue ? 'danger' : 'brand'} hint={a.nextDue ? `${formatDate(a.nextDue.dueDate)}${a.overdue ? ` · ${formatMoney(a.overdue)} overdue` : ''}` : 'Nothing left to pay'} />
      </div>
      {data.reconciled === false && <Notice kind="warning">The stored totals for this account don’t match its ledger entries. Please review; nothing has been changed automatically.</Notice>}
      {a.discount.status === 'pending' && (
        <Notice kind="warning">
          A {a.discount.type === 'percent' ? `${a.discount.value / 100}%` : 'fixed'} discount of {formatMoney(a.discount.amount)} ({a.discount.reason}) is waiting for approval.{' '}
          {data.canApproveDiscount ? <span className="ml-2 inline-flex gap-2"><Button size="sm" variant="success" disabled={busy} onClick={() => decide(true)}>Approve</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(false)}>Reject</Button></span> : 'Someone with a higher discount limit must decide.'}
        </Notice>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text} {msg.receipt && <Link className="underline" href={`/receipts/${msg.receipt}`}>Print receipt</Link>}</Notice>}
      {a.status !== 'cancelled' && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAction('payment')} disabled={a.balance === 0}>Record payment</Button>
          <Button variant="secondary" onClick={() => setAction('refund')} disabled={a.collected === 0}>Refund</Button>
          <Button variant="secondary" onClick={() => setAction('reschedule')}>Change schedule</Button>
          <Button variant="ghost" onClick={() => setAction('charge')}>Extra charge</Button>
          {data.canWaive && <Button variant="ghost" onClick={() => setAction('waiver')}>Waive fee</Button>}
        </div>
      )}
      {action && <ActionForm key={action} action={action} view={data} onCancel={() => setAction(null)} onDone={(text, receipt) => { setAction(null); setMsg({ kind: 'success', text, receipt }); reload(); }} />}

      <Section title="Installments">
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-3"><th className="p-3">#</th><th className="p-3">Due date</th><th className="p-3 text-right">Amount</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Remaining</th><th className="p-3">Status</th></tr></thead>
            <tbody>{a.allocation.map((i) => <tr key={i.number} className="border-b border-line last:border-0"><td className="p-3">{i.number}</td><td className="p-3">{formatDate(i.dueDate)}</td><td className="p-3 text-right">{formatMoney(i.amount)}</td><td className="p-3 text-right">{formatMoney(i.paid)}</td><td className="p-3 text-right font-semibold">{formatMoney(i.remaining)}</td><td className="p-3"><InstallmentPill state={i.state} /></td></tr>)}</tbody>
          </table>
        </Card>
      </Section>

      <Section title="Ledger" action={<div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => downloadCsv(`ledger-${a.admissionNumber}.csv`, data.transactions, [
          { header: 'Date', value: (t) => t.date }, { header: 'Type', value: (t) => t.type }, { header: 'Receipt', value: (t) => t.receiptNumber ?? '' },
          { header: 'Amount (INR)', value: (t) => moneyPlain(t.amount) }, { header: 'Method', value: (t) => t.method ?? '' }, { header: 'Reference', value: (t) => t.reference ?? '' },
          { header: 'Reason', value: (t) => t.reason ?? '' }, { header: 'Balance after (INR)', value: (t) => moneyPlain(t.balanceAfter) }, { header: 'Recorded by', value: (t) => t.createdByName },
        ], [['Student', a.studentName], ['Admission no.', a.admissionNumber], ['Course', a.courseTitle], ['Branch', a.branchId], ['Academy', a.orgId]])}>Export CSV</Button>
        <Link href={`/statements/${a.id}`} className={buttonClasses('ghost', 'sm')}>Print statement</Link>
      </div>}>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-3"><th className="p-3">Date</th><th className="p-3">Entry</th><th className="p-3 text-right">Amount</th><th className="p-3">Details</th><th className="p-3 text-right">Balance after</th><th className="p-3" /></tr></thead>
            <tbody>{data.transactions.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ink-3">No entries yet.</td></tr> : data.transactions.map((t) => (
              <tr key={t.id} className={cx('border-b border-line align-top last:border-0', t.reversed && 'text-ink-4 line-through')}>
                <td className="p-3">{formatDate(t.date)}</td>
                <td className="p-3"><StatusPill size="sm" tone={t.type === 'payment' ? 'success' : t.type === 'refund' ? 'coral' : t.type === 'reversal' ? 'danger' : 'info'}>{t.type}</StatusPill>{t.receiptNumber && <div className="mt-1 text-xs">{t.receiptNumber}</div>}</td>
                <td className="p-3 text-right tabular-nums">{t.type === 'adjustment' && t.amount < 0 ? '−' : ''}{formatMoney(Math.abs(t.amount))}</td>
                <td className="p-3 text-xs text-ink-2">{[t.method, t.reference, t.reason].filter(Boolean).join(' · ')}<div className="text-ink-3">by {t.createdByName}</div></td>
                <td className="p-3 text-right tabular-nums">{t.balanceAfter === undefined ? '—' : formatMoney(t.balanceAfter)}</td>
                <td className="p-3 text-right no-underline">
                  {t.type === 'payment' && !t.reversed && <Link href={`/receipts/${t.id}`} className="mr-2 text-xs font-semibold text-brand-ink">Receipt</Link>}
                  {(t.type === 'payment' || t.type === 'refund') && !t.reversed && <button type="button" disabled={busy} onClick={() => reverse(t)} className="text-xs font-semibold text-danger-ink">Reverse</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      </Section>
    </div>
  );
}

function FeeAccountPageContent({ params }: { params: Promise<{ feeAccountId: string }> }) {
  const { feeAccountId } = use(params);
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><AppShell><Account id={feeAccountId} /></AppShell></RequireRole>;
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function FeeAccountPage(props: Parameters<typeof FeeAccountPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <FeeAccountPageContent {...props} />
    </Suspense>
  );
}

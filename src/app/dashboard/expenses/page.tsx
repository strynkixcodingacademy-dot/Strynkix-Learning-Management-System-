'use client';

/**
 * Strynkix LMS — Expenses: quick add, history with filters and CSV, recurring
 * schedules (pay or cancel each occurrence; nothing is paid automatically),
 * categories, and spending analysis. Voided expenses stay in the history.
 */

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { expensesApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { downloadCsv } from '@/lib/export/csv';
import { formatDate, formatMoney, moneyPlain, toPaise, todayLocal } from '@/lib/academy/format';
import type { Expense, ExpenseCategory, PaymentMethod, RecurringExpense } from '@/types/academy';
import { ScopePicker, scopeParams, useFinanceScope, type FinanceScope } from '@/components/finance/ScopePicker';
import { newRequestId } from '@/components/finance/FinanceBits';
import { Button } from '@/components/ui/Button';
import { KpiTile } from '@/components/ui/DataViz';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs } from '@/components/ui/Tabs';
import { cx } from '@/components/ui/tones';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { firestoreErrorMessage } from '@/lib/firebase/errors';

const METHODS: { id: PaymentMethod; label: string }[] = [{ id: 'cash', label: 'Cash' }, { id: 'upi', label: 'UPI' }, { id: 'bank_transfer', label: 'Bank transfer' }, { id: 'card', label: 'Card' }, { id: 'cheque', label: 'Cheque' }, { id: 'other', label: 'Other' }];
type Tab = 'history' | 'recurring' | 'analysis' | 'categories';
const monthStart = () => `${todayLocal().slice(0, 7)}-01`;

function useCategories() {
  return useApiData('cats', () => expensesApi<{ categories: ExpenseCategory[]; canManage: boolean }>({ action: 'categories' }));
}

function QuickAdd({ branchId, categories, onSaved }: { branchId: string; categories: ExpenseCategory[]; onSaved: () => void }) {
  const [f, setF] = useState({ title: '', categoryId: '', amount: '', date: todayLocal(), method: 'cash' as PaymentMethod, paidTo: '', reference: '', notes: '', documentUrl: '' });
  const [more, setMore] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Card className="space-y-3 p-4 print:hidden">
      <h2 className="text-sm font-bold text-ink">Add an expense</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="What for" htmlFor="qa-title"><input id="qa-title" value={f.title} placeholder="e.g. October rent" onChange={set('title')} className={fieldClasses} /></Field>
        <Field label="Category" htmlFor="qa-cat"><select id="qa-cat" value={f.categoryId} onChange={set('categoryId')} className={fieldClasses}><option value="">Choose</option>{categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Amount (₹)" htmlFor="qa-amt"><input id="qa-amt" inputMode="decimal" value={f.amount} onChange={set('amount')} className={fieldClasses} /></Field>
        <Field label="Date" htmlFor="qa-date"><input id="qa-date" type="date" max={todayLocal()} value={f.date} onChange={set('date')} className={fieldClasses} /></Field>
        <Field label="Paid by" htmlFor="qa-m"><select id="qa-m" value={f.method} onChange={set('method')} className={fieldClasses}>{METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
      </div>
      {more && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Paid to / vendor" htmlFor="qa-to"><input id="qa-to" value={f.paidTo} onChange={set('paidTo')} className={fieldClasses} /></Field>
          <Field label="Transaction reference" htmlFor="qa-ref"><input id="qa-ref" value={f.reference} onChange={set('reference')} className={fieldClasses} /></Field>
          <Field label="Notes" htmlFor="qa-notes"><input id="qa-notes" value={f.notes} onChange={set('notes')} className={fieldClasses} /></Field>
          <Field label="Invoice link (https)" htmlFor="qa-doc" hint="File upload isn’t available yet."><input id="qa-doc" value={f.documentUrl} onChange={set('documentUrl')} className={fieldClasses} /></Field>
        </div>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} disabled={!branchId} onClick={async () => {
          const amount = toPaise(f.amount);
          if (!f.title.trim() || !f.categoryId || !amount) { setMsg({ kind: 'error', text: 'Enter what it was for, a category and an amount.' }); return; }
          setBusy(true);
          setMsg(null);
          try {
            await expensesApi({ action: 'add_expense', requestId, branchId, title: f.title.trim(), categoryId: f.categoryId, amount, date: f.date, method: f.method,
              ...Object.fromEntries((['paidTo', 'reference', 'notes', 'documentUrl'] as const).filter((k) => f[k].trim()).map((k) => [k, f[k].trim()])) });
            setMsg({ kind: 'success', text: `Saved ${formatMoney(amount)} for “${f.title.trim()}”.` });
            setF((x) => ({ ...x, title: '', amount: '', paidTo: '', reference: '', notes: '', documentUrl: '' }));
            setRequestId(newRequestId());
            onSaved();
          } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
        }}>Save expense</Button>
        <Button variant="ghost" onClick={() => setMore((m) => !m)}>{more ? 'Fewer details' : 'More details'}</Button>
        {!branchId && <span className="self-center text-xs text-ink-3">Choose a branch above to add expenses.</span>}
      </div>
    </Card>
  );
}

function History({ scope, categories, version, onChanged }: { scope: FinanceScope; categories: ExpenseCategory[]; version: number; onChanged: () => void }) {
  const [categoryId, setCategoryId] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const { prompt, dialog } = useConfirm();
  const key = `${JSON.stringify(scope)}|${categoryId}|${showVoid}|${version}`;
  const { data, error, reload } = useApiData(key, () => expensesApi<{ expenses: Expense[]; total: number }>({ action: 'list', ...scopeParams(scope, { dates: true }), ...(categoryId ? { categoryId } : {}), includeVoid: showVoid }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  return (
    <div className="space-y-3">
      {dialog}
      {voidError && <Notice kind="error">{voidError}</Notice>}
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label="Category" htmlFor="h-cat"><select id="h-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={fieldClasses}><option value="">All</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} /> Show voided</label>
        <Button variant="secondary" disabled={!data?.expenses.length} onClick={() => data && downloadCsv(`expenses-${scope.from || 'all'}-${scope.to || 'today'}.csv`, data.expenses, [
          { header: 'Date', value: (e) => e.date }, { header: 'Title', value: (e) => e.title }, { header: 'Category', value: (e) => e.categoryName }, { header: 'Amount (INR)', value: (e) => moneyPlain(e.amount) },
          { header: 'Method', value: (e) => e.method }, { header: 'Paid to', value: (e) => e.paidTo ?? '' }, { header: 'Reference', value: (e) => e.reference ?? '' }, { header: 'Branch', value: (e) => e.branchId },
          { header: 'Recurring', value: (e) => (e.recurringId ? 'yes' : 'no') }, { header: 'Status', value: (e) => e.status }, { header: 'Void reason', value: (e) => e.voidReason ?? '' }, { header: 'Recorded by', value: (e) => e.createdByName },
        ], [['Academy', scope.orgId], ['Branch', scope.branchId || 'All branches'], ['From', scope.from || 'start'], ['To', scope.to || 'today']])}>Export CSV</Button>
        <Button variant="ghost" onClick={() => window.print()}>Print</Button>
      </div>
      {!data ? <LoadingState label="Loading expenses…" /> : data.expenses.length === 0 ? <EmptyState title="No expenses">Nothing recorded for these filters.</EmptyState> : (
        <Card className="overflow-x-auto">
          <p className="p-3 text-sm font-semibold text-ink">Total {formatMoney(data.total)} across {data.expenses.filter((e) => e.status === 'paid').length} expenses</p>
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Date</th><th className="p-3">Expense</th><th className="p-3">Category</th><th className="p-3 text-right">Amount</th><th className="p-3">Paid</th><th className="p-3 print:hidden" /></tr></thead>
            <tbody>{data.expenses.map((e) => (
              <tr key={e.id} className={cx('border-b border-line last:border-0', e.status === 'void' && 'text-ink-4')}>
                <td className="p-3">{formatDate(e.date)}</td>
                <td className="p-3"><span className={cx('font-semibold', e.status === 'void' ? 'line-through' : 'text-ink')}>{e.title}</span>{e.recurringId && <span className="ml-1 text-xs text-ink-3">(recurring)</span>}{e.status === 'void' && <div className="text-xs">Void: {e.voidReason}</div>}{e.documentUrl && <div><a className="text-xs text-brand-ink underline" href={e.documentUrl} target="_blank" rel="noopener noreferrer">Invoice</a></div>}</td>
                <td className="p-3">{e.categoryName}</td>
                <td className="p-3 text-right tabular-nums">{formatMoney(e.amount)}</td>
                <td className="p-3 text-xs text-ink-2">{METHODS.find((m) => m.id === e.method)?.label}{e.paidTo ? ` · ${e.paidTo}` : ''}{e.reference ? ` · ${e.reference}` : ''}</td>
                <td className="p-3 text-right print:hidden">{e.status === 'paid' && <button type="button" className="text-xs font-semibold text-danger-ink" onClick={async () => {
                  const reason = await prompt({ title: `Void “${e.title}”?`, body: 'The expense stays in the history, marked void.', label: 'Why is it being voided?', confirmLabel: 'Void expense', tone: 'danger' });
                  if (!reason) return;
                  setVoidError(null);
                  try { await expensesApi({ action: 'void_expense', expenseId: e.id, reason }); onChanged(); } catch (err) { setVoidError(firestoreErrorMessage(err, 'Something went wrong. Try again.')); }
                }}>Void</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

interface Occurrence { recurringId: string; title: string; categoryName: string; period: string; amount: number; state: 'scheduled' | 'due' | 'overdue' | 'paid' | 'cancelled'; paidOn: string | null }
const OCC_TONE = { scheduled: 'neutral', due: 'warning', overdue: 'danger', paid: 'success', cancelled: 'neutral' } as const;

function Recurring({ scope, categories, onChanged }: { scope: FinanceScope; categories: ExpenseCategory[]; onChanged: () => void }) {
  const from = scope.from || `${todayLocal().slice(0, 4)}-01-01`;
  const to = scope.to || `${todayLocal().slice(0, 4)}-12-31`;
  const key = `${JSON.stringify(scope)}`;
  const { data, error, reload } = useApiData(key, () => expensesApi<{ schedules: RecurringExpense[]; occurrences: Occurrence[] }>({ action: 'schedule', ...scopeParams(scope), from, to }));
  const [f, setF] = useState({ title: '', categoryId: '', amount: '', frequency: 'monthly', startDate: todayLocal(), endDate: '', paidTo: '' });
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { prompt, dialog } = useConfirm();
  const act = async (body: Record<string, unknown>, ok: string) => {
    try { await expensesApi(body); setMsg({ kind: 'success', text: ok }); reload(); onChanged(); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); }
  };
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  return (
    <div className="space-y-4">
      {dialog}
      {scope.branchId && (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-bold text-ink">New recurring expense</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Title" htmlFor="r-title"><input id="r-title" value={f.title} placeholder="e.g. Classroom rent" onChange={(e) => setF({ ...f, title: e.target.value })} className={fieldClasses} /></Field>
            <Field label="Category" htmlFor="r-cat"><select id="r-cat" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} className={fieldClasses}><option value="">Choose</option>{categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Amount (₹)" htmlFor="r-amt"><input id="r-amt" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={fieldClasses} /></Field>
            <Field label="Repeats" htmlFor="r-freq"><select id="r-freq" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} className={fieldClasses}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></Field>
            <Field label="First due date" htmlFor="r-start"><input id="r-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className={fieldClasses} /></Field>
            <Field label="Ends (optional)" htmlFor="r-end"><input id="r-end" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} className={fieldClasses} /></Field>
            <Field label="Paid to" htmlFor="r-to"><input id="r-to" value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} className={fieldClasses} /></Field>
          </div>
          <Button size="sm" onClick={() => {
            const amount = toPaise(f.amount);
            if (!f.title.trim() || !f.categoryId || !amount) { setMsg({ kind: 'error', text: 'Enter a title, category and amount.' }); return; }
            act({ action: 'add_recurring', branchId: scope.branchId, title: f.title.trim(), categoryId: f.categoryId, amount, frequency: f.frequency, startDate: f.startDate, ...(f.endDate ? { endDate: f.endDate } : {}), ...(f.paidTo.trim() ? { paidTo: f.paidTo.trim() } : {}) }, 'Recurring expense added. Pay each occurrence when it is actually paid.');
          }}>Add schedule</Button>
        </Card>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {!data ? <LoadingState label="Loading schedules…" /> : data.occurrences.length === 0 ? <EmptyState title="No recurring expenses">{scope.branchId ? 'Add rent, salaries or bills that repeat.' : 'Choose a branch to add recurring expenses.'}</EmptyState> : (
        <Card className="overflow-x-auto">
          <p className="p-3 text-xs text-ink-3">{formatDate(from)} – {formatDate(to)}. Due = within the next 7 days.</p>
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Due date</th><th className="p-3">Expense</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody>{data.occurrences.map((o) => (
              <tr key={`${o.recurringId}-${o.period}`} className="border-b border-line last:border-0">
                <td className="p-3">{formatDate(o.period)}</td><td className="p-3 font-semibold text-ink">{o.title}<div className="text-xs font-normal text-ink-3">{o.categoryName}</div></td>
                <td className="p-3 text-right">{formatMoney(o.amount)}</td>
                <td className="p-3"><StatusPill size="sm" tone={OCC_TONE[o.state]}>{o.state}{o.paidOn ? ` ${formatDate(o.paidOn)}` : ''}</StatusPill></td>
                <td className="p-3 text-right">{['due', 'overdue', 'scheduled'].includes(o.state) && <span className="inline-flex gap-2">
                  <button type="button" className="text-xs font-semibold text-brand-ink" disabled={o.period > todayLocal() && o.state === 'scheduled'} onClick={async () => {
                    const method = await prompt({ title: `Mark “${o.title}” paid?`, body: `For ${formatDate(o.period)}, ${formatMoney(o.amount)}, recorded as paid today.`, label: 'Paid by', choices: METHODS.map((m) => ({ value: m.id, label: m.label })), defaultValue: 'bank_transfer', confirmLabel: 'Mark paid' });
                    if (!method) return;
                    act({ action: 'pay_occurrence', recurringId: o.recurringId, period: o.period, date: todayLocal(), method }, `Paid “${o.title}” for ${formatDate(o.period)}.`);
                  }}>Mark paid</button>
                  <button type="button" className="text-xs font-semibold text-ink-3" onClick={async () => {
                    const reason = await prompt({ title: `Cancel “${o.title}” for ${formatDate(o.period)}?`, label: 'Why is this occurrence cancelled?', confirmLabel: 'Cancel occurrence', tone: 'danger' });
                    if (reason) act({ action: 'cancel_occurrence', recurringId: o.recurringId, period: o.period, reason }, 'Occurrence cancelled.');
                  }}>Cancel</button>
                </span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
      {data && data.schedules.length > 0 && (
        <Card className="divide-y divide-line">
          {data.schedules.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <span className="min-w-0 flex-1 font-semibold text-ink">{s.title} <span className="font-normal text-ink-3">· {formatMoney(s.amount)} {s.frequency} from {formatDate(s.startDate)}{s.endDate ? ` to ${formatDate(s.endDate)}` : ''}</span></span>
              <StatusPill size="sm" tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Stopped'}</StatusPill>
              <Button size="sm" variant="ghost" onClick={() => act({ action: 'update_recurring', recurringId: s.id, active: !s.active }, s.active ? 'Schedule stopped.' : 'Schedule resumed.')}>{s.active ? 'Stop' : 'Resume'}</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Analysis({ scope, version }: { scope: FinanceScope; version: number }) {
  const key = `${JSON.stringify(scope)}|${version}`;
  const { data, error } = useApiData(key, () => expensesApi<{ expenses: Expense[]; total: number }>({ action: 'list', ...scopeParams(scope, { dates: true }) }));
  const stats = useMemo(() => {
    const rows = data?.expenses ?? [];
    const by = (f: (e: Expense) => string) => [...rows.reduce((m, e) => m.set(f(e), (m.get(f(e)) ?? 0) + e.amount), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]);
    return { categories: by((e) => e.categoryName), months: by((e) => e.date.slice(0, 7)).sort((a, b) => a[0].localeCompare(b[0])), branches: by((e) => e.branchId), recurring: rows.filter((e) => e.recurringId).reduce((s, e) => s + e.amount, 0) };
  }, [data]);
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!data) return <LoadingState label="Analysing…" />;
  const max = stats.categories[0]?.[1] ?? 1;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Total expenses" value={formatMoney(data.total)} tone="coral" />
        <KpiTile label="Recurring" value={formatMoney(stats.recurring)} tone="lavender" />
        <KpiTile label="One-time" value={formatMoney(data.total - stats.recurring)} tone="teal" />
        <KpiTile label="Highest category" value={stats.categories[0]?.[0] ?? '—'} tone="warning" hint={stats.categories[0] ? formatMoney(stats.categories[0][1]) : undefined} />
      </div>
      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-bold text-ink">By category</h2>
        {stats.categories.map(([name, amt]) => (
          <div key={name} className="grid grid-cols-[minmax(120px,200px)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate">{name}</span>
            <span className="h-2.5 rounded-full bg-surface-sunken"><span className="block h-full rounded-full bg-coral" style={{ width: `${Math.max(2, (amt / max) * 100)}%` }} /></span>
            <span className="tabular-nums">{formatMoney(amt)}</span>
          </div>
        ))}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><h2 className="mb-2 text-sm font-bold text-ink">By month</h2><ul className="space-y-1 text-sm">{stats.months.map(([m, a]) => <li key={m} className="flex justify-between"><span>{m}</span><span className="tabular-nums">{formatMoney(a)}</span></li>)}</ul></Card>
        {stats.branches.length > 1 && <Card className="p-5"><h2 className="mb-2 text-sm font-bold text-ink">By branch</h2><ul className="space-y-1 text-sm">{stats.branches.map(([b, a]) => <li key={b} className="flex justify-between"><span>{b}</span><span className="tabular-nums">{formatMoney(a)}</span></li>)}</ul></Card>}
      </div>
    </div>
  );
}

function Categories({ data, reload }: { data: { categories: ExpenseCategory[]; canManage: boolean }; reload: () => void }) {
  const { tenant } = useAuth();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="New category" htmlFor="c-name"><input id="c-name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClasses} /></Field>
        <Button onClick={async () => {
          try { await expensesApi({ action: 'add_category', name: name.trim() }); setName(''); setMsg({ kind: 'success', text: 'Category added for the whole academy.' }); reload(); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); }
        }} disabled={name.trim().length < 2}>Add</Button>
      </Card>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Card className="divide-y divide-line">
        {data.categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 p-3 text-sm">
            <span className="flex-1">{c.name}</span>
            {c.builtIn ? <span className="text-xs text-ink-3">Built in</span> : tenant && ['super_admin', 'university_admin'].includes(tenant.role) && (
              <Button size="sm" variant="ghost" onClick={async () => { await expensesApi({ action: 'set_category_active', categoryId: c.id, active: !c.active }); reload(); }}>{c.active ? 'Retire' : 'Restore'}</Button>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

function Expenses() {
  const { tenant } = useAuth();
  const { scope, setScope } = useFinanceScope({ from: monthStart(), to: todayLocal(), branchId: tenant?.role === 'branch_admin' ? tenant.branchId ?? '' : '' });
  const effective = { ...scope, branchId: tenant?.role === 'branch_admin' ? tenant.branchId ?? '' : scope.branchId };
  const cats = useCategories();
  const [tab, setTab] = useState<Tab>('history');
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" description="Record branch spending, keep recurring bills on schedule, and see where the money goes." />
      <ScopePicker scope={effective} onChange={setScope} dates />
      {cats.data && <QuickAdd branchId={effective.branchId} categories={cats.data.categories} onSaved={bump} />}
      <Tabs<Tab> idPrefix="exp" label="Expenses" value={tab} onChange={setTab} items={[{ id: 'history', label: 'History' }, { id: 'recurring', label: 'Recurring' }, { id: 'analysis', label: 'Analysis' }, { id: 'categories', label: 'Categories' }]} />
      {cats.error ? <ErrorState onRetry={cats.reload}>{cats.error}</ErrorState> : !cats.data ? <LoadingState label="Loading…" /> :
        tab === 'history' ? <History scope={effective} categories={cats.data.categories} version={version} onChanged={bump} />
          : tab === 'recurring' ? <Recurring scope={effective} categories={cats.data.categories} onChanged={bump} />
            : tab === 'analysis' ? <Analysis scope={effective} version={version} />
              : <Categories data={cats.data} reload={cats.reload} />}
    </div>
  );
}

export default function ExpensesPage() {
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><AppShell><Expenses /></AppShell></RequireRole>;
}

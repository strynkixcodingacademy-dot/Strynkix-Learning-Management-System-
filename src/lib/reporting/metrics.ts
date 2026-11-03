/**
 * Strynkix LMS — period financial metrics (Stage 9). Pure and client-safe.
 * The single definition of "collected", "refunds", "discounts", "expenses",
 * "net" and the period-end balances, used by the live finance summary,
 * snapshots and reconciliation alike.
 */

import type { Expense, FeeAccount, FeeTransaction } from '@/types/academy';

export interface FinanceSources { accounts: FeeAccount[]; ledger: FeeTransaction[]; expenses: Expense[] }

export interface PeriodFinance {
  /** Cash received in the period: payments − reversed payments − refunds + reversed refunds. */
  collected: number;
  payments: number;
  paymentReversals: number;
  /** Refunds net of reversed refunds (same meaning as the finance summary). */
  refunds: number;
  /** Adjustments dated in the period: extra charges (+) and waivers (−), kept apart. */
  charges: number;
  waivers: number;
  /** Approved discounts on fee accounts opened in the period. */
  discounts: number;
  expenses: number;
  /** collected − expenses (cash basis, not audited profit). */
  net: number;
  /** As of the last day of the period. */
  expectedAtEnd: number;
  collectedToEnd: number;
  outstandingAtEnd: number;
}

const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

/** Signed cash effect of a ledger entry (adjustments move no cash). */
export function cashEffect(t: FeeTransaction, byId: Map<string, FeeTransaction>): number {
  if (t.type === 'payment') return t.amount;
  if (t.type === 'refund') return -t.amount;
  if (t.type === 'reversal') return byId.get(t.reversesId ?? '')?.type === 'refund' ? t.amount : -t.amount;
  return 0;
}

/** `accounts` exclude cancelled ones; `expenses` are paid (not void) ones. */
export function periodMetrics(src: FinanceSources, from: string, to: string, byId: Map<string, FeeTransaction> = new Map(src.ledger.map((t) => [t.id, t]))): PeriodFinance {
  const tx = src.ledger.filter((t) => inRange(t.date, from, to));
  const reversalOf = (type: string) => tx.filter((t) => t.type === 'reversal' && byId.get(t.reversesId ?? '')?.type === type);
  const collected = sum(tx, (t) => cashEffect(t, byId));
  const expenses = sum(src.expenses.filter((e) => inRange(e.date, from, to)), (e) => e.amount);
  const adjustments = tx.filter((t) => t.type === 'adjustment');
  const expectedAtEnd = sum(src.accounts.filter((a) => a.createdAt.slice(0, 10) <= to), (a) => a.agreedFee)
    + sum(src.ledger.filter((t) => t.type === 'adjustment' && t.date <= to), (t) => t.amount);
  const collectedToEnd = sum(src.ledger.filter((t) => t.date <= to), (t) => cashEffect(t, byId));
  return {
    collected,
    payments: sum(tx.filter((t) => t.type === 'payment'), (t) => t.amount),
    paymentReversals: sum(reversalOf('payment'), (t) => t.amount),
    refunds: sum(tx.filter((t) => t.type === 'refund'), (t) => t.amount) - sum(reversalOf('refund'), (t) => t.amount),
    charges: sum(adjustments.filter((t) => t.amount > 0), (t) => t.amount),
    waivers: -sum(adjustments.filter((t) => t.amount < 0), (t) => t.amount),
    discounts: sum(src.accounts.filter((a) => a.discount.status === 'approved' && inRange(a.createdAt.slice(0, 10), from, to)), (a) => a.discount.amount),
    expenses,
    net: collected - expenses,
    expectedAtEnd, collectedToEnd, outstandingAtEnd: Math.max(0, expectedAtEnd - collectedToEnd),
  };
}

export const FINANCE_METRICS: (keyof PeriodFinance)[] = ['collected', 'payments', 'paymentReversals', 'refunds', 'charges', 'waivers', 'discounts', 'expenses', 'net', 'expectedAtEnd', 'collectedToEnd', 'outstandingAtEnd'];

/** Metric-by-metric differences (empty when they agree). */
export function compareFinance(stored: Partial<PeriodFinance>, source: PeriodFinance): { metric: string; snapshot: number | null; source: number; difference: number }[] {
  return FINANCE_METRICS.flatMap((m) => {
    const s = stored[m];
    return s === source[m] ? [] : [{ metric: m, snapshot: typeof s === 'number' ? s : null, source: source[m], difference: source[m] - (typeof s === 'number' ? s : 0) }];
  });
}

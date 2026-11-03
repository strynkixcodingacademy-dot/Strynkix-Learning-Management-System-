/**
 * Strynkix LMS — fee arithmetic (integer paise; discounts in basis points,
 * 1% = 100). Pure functions shared by the server, which is the only writer,
 * and the browser, which previews.
 *
 * How balances work:
 *   gross      = standard fee + registration fee + other fees (from pricing at admission)
 *   agreed     = gross − approved discount            (fixed at admission)
 *   due        = agreed + adjustments                 (adjustments: extra charges +, waivers −)
 *   collected  = payments − reversed payments − refunds
 *   balance    = due − collected                      (never below zero; overpayment is refused)
 * A refund gives money back, so it lowers `collected` and raises the balance; when
 * a student withdraws, a waiver adjustment brings `due` down to what is kept.
 * Installments are a schedule of `due`; payments are allocated oldest first, so
 * paid / partly paid / overdue states are always derived from the ledger.
 */

import type { CoursePricing, FeeAccount, InstallmentPlanItem, UserRoleLike } from './types';

export const MAX_INSTALLMENTS = 24;

export function grossFee(p: Pick<CoursePricing, 'standardFee' | 'registrationFee' | 'otherFees'>): number {
  return p.standardFee + p.registrationFee + p.otherFees.reduce((s, f) => s + f.amount, 0);
}

export function discountAmount(gross: number, type: 'none' | 'fixed' | 'percent', value: number): number {
  if (type === 'none' || value <= 0) return 0;
  if (type === 'fixed') return Math.min(Math.round(value), gross);
  return Math.min(Math.round((gross * Math.min(value, 10000)) / 10000), gross);
}

/** Largest discount (basis points) a role may grant without approval. */
export function discountLimitBp(role: UserRoleLike, p: Pick<CoursePricing, 'discountLimits'>): number {
  if (role === 'super_admin') return 10000;
  if (role === 'university_admin') return p.discountLimits.university_admin;
  if (role === 'branch_admin') return p.discountLimits.branch_admin;
  return 0;
}

export const discountBp = (gross: number, amount: number) => (gross > 0 ? Math.round((amount * 10000) / gross) : 0);
/** Exact integer comparison (no rounding), so even a 1-paisa discount beyond the limit needs approval. */
export const needsApproval = (role: UserRoleLike, p: Pick<CoursePricing, 'discountLimits'>, gross: number, amount: number) =>
  amount > 0 && amount * 10000 > discountLimitBp(role, p) * gross;

/** Splits `total` into `count` near-equal installments, one per month from `firstDue` (remainder on the first). */
export function equalInstallments(total: number, count: number, firstDue: string): InstallmentPlanItem[] {
  const n = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(count)));
  const base = Math.floor(total / n);
  const [y, m, d] = firstDue.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1 + i, 1));
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(d, last));
    return { number: i + 1, dueDate: date.toISOString().slice(0, 10), amount: base + (i === 0 ? total - base * n : 0) };
  });
}

/** Problems with a schedule, or null when it is valid for `total`. */
export function scheduleError(items: InstallmentPlanItem[], total: number): string | null {
  if (!items.length) return 'Add at least one installment.';
  if (items.length > MAX_INSTALLMENTS) return `Use at most ${MAX_INSTALLMENTS} installments.`;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)) return `Installment ${i + 1} needs a due date.`;
    if (!Number.isInteger(it.amount) || it.amount <= 0) return `Installment ${i + 1} needs an amount above zero.`;
    if (i > 0 && it.dueDate < items[i - 1].dueDate) return 'Installment due dates must be in order.';
  }
  const sum = items.reduce((s, it) => s + it.amount, 0);
  if (sum !== total) return `The installments add up to ${(sum / 100).toFixed(2)}, but the amount due is ${(total / 100).toFixed(2)}.`;
  return null;
}

export const dueOf = (a: Pick<FeeAccount, 'agreedFee' | 'totals'>) => a.agreedFee + a.totals.adjustments;
export const collectedOf = (a: Pick<FeeAccount, 'totals'>) => a.totals.paid - a.totals.refunded;
export const balanceOf = (a: Pick<FeeAccount, 'agreedFee' | 'totals'>) => Math.max(0, dueOf(a) - collectedOf(a));

export type InstallmentState = 'paid' | 'partial' | 'overdue' | 'due_today' | 'upcoming';

export interface AllocatedInstallment extends InstallmentPlanItem { paid: number; remaining: number; state: InstallmentState }

/** Allocates the collected amount to installments oldest first. `today` is YYYY-MM-DD. */
export function allocate(items: InstallmentPlanItem[], collected: number, today: string): AllocatedInstallment[] {
  let left = Math.max(0, collected);
  return items.map((it) => {
    const paid = Math.min(it.amount, left);
    left -= paid;
    const remaining = it.amount - paid;
    const state: InstallmentState = remaining === 0 ? 'paid' : it.dueDate < today ? 'overdue' : it.dueDate === today ? 'due_today' : paid > 0 ? 'partial' : 'upcoming';
    return { ...it, paid, remaining, state: remaining > 0 && paid > 0 && it.dueDate >= today ? 'partial' : state };
  });
}

/** The next installment with something left to pay, and the overdue total. */
export function dueSummary(items: InstallmentPlanItem[], collected: number, today: string) {
  const alloc = allocate(items, collected, today);
  const next = alloc.find((i) => i.remaining > 0) ?? null;
  const overdue = alloc.filter((i) => i.state === 'overdue').reduce((s, i) => s + i.remaining, 0);
  return { next, overdue, installments: alloc };
}

export function paymentStatus(a: Pick<FeeAccount, 'agreedFee' | 'totals' | 'installments' | 'status'>, today: string): 'paid' | 'overdue' | 'partial' | 'pending' | 'cancelled' {
  if (a.status === 'cancelled') return 'cancelled';
  const balance = balanceOf(a);
  if (balance === 0) return 'paid';
  if (dueSummary(a.installments, collectedOf(a), today).overdue > 0) return 'overdue';
  return collectedOf(a) > 0 ? 'partial' : 'pending';
}

/**
 * Fits a schedule to a new total: a lower total is taken off the last
 * installments first (dropping any that reach zero); a higher one is added to
 * the last installment.
 */
export function fitSchedule(items: InstallmentPlanItem[], total: number): InstallmentPlanItem[] {
  const out = items.map((i) => ({ ...i }));
  let diff = out.reduce((s, i) => s + i.amount, 0) - total;
  if (diff < 0 && out.length) out[out.length - 1].amount -= diff;
  for (let i = out.length - 1; i >= 0 && diff > 0; i--) {
    const take = Math.min(out[i].amount, diff);
    out[i].amount -= take;
    diff -= take;
  }
  return out.filter((i) => i.amount > 0).map((i, n) => ({ ...i, number: n + 1 }));
}

import { describe, it, expect } from 'vitest';
import { affectedPeriods, isCompleted, localMidnightUtc, monthsBetween, periodBounds, periodKeyFor, previousPeriod, snapshotId } from '@/lib/reporting/periods';
import { compareFinance, periodMetrics } from '@/lib/reporting/metrics';
import type { Expense, FeeAccount, FeeTransaction } from '@/types/academy';

describe('reporting periods (Asia/Kolkata)', () => {
  it('daily, monthly and yearly boundaries use local midnight', () => {
    expect(periodBounds('daily', '2026-03-15')).toMatchObject({ from: '2026-03-15', to: '2026-03-15', startUtc: '2026-03-14T18:30:00.000Z', endUtc: '2026-03-15T18:30:00.000Z' });
    expect(periodBounds('monthly', '2024-02')).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
    expect(periodBounds('monthly', '2026-12')).toMatchObject({ to: '2026-12-31', endUtc: '2026-12-31T18:30:00.000Z' });
    expect(periodBounds('yearly', '2026')).toMatchObject({ from: '2026-01-01', to: '2026-12-31', startUtc: '2025-12-31T18:30:00.000Z' });
    expect(() => periodBounds('daily', '2026-02-30')).toThrow();
    expect(() => periodBounds('monthly', '2026-13')).toThrow();
  });
  it('handles DST zones too (London spring forward)', () => {
    expect(localMidnightUtc('2026-03-29', 'Europe/London')).toBe('2026-03-29T00:00:00.000Z');
    expect(localMidnightUtc('2026-03-30', 'Europe/London')).toBe('2026-03-29T23:00:00.000Z');
  });
  it('previous completed periods and completion', () => {
    expect(previousPeriod('daily', '2026-03-01')).toBe('2026-02-28');
    expect(previousPeriod('monthly', '2026-01-10')).toBe('2025-12');
    expect(previousPeriod('yearly', '2026-01-01')).toBe('2025');
    expect(isCompleted('monthly', '2026-03', '2026-03-31')).toBe(false);
    expect(isCompleted('monthly', '2026-03', '2026-04-01')).toBe(true);
    expect(periodKeyFor('monthly', '2026-03-15')).toBe('2026-03');
    expect(monthsBetween('2025-11-20', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('deterministic snapshot ids and affected periods for a backdated change', () => {
    expect(snapshotId('organization', 'all', 'daily', '2026-03-15')).toBe('org_all_daily_2026-03-15');
    expect(snapshotId('branch', 'b1', 'monthly', '2026-03')).toBe('branch_b1_monthly_2026-03');
    const a = affectedPeriods('2026-02-27', '2026-02-27', '2026-03-05');
    expect(a).toEqual([{ type: 'daily', key: '2026-02-27' }, { type: 'monthly', key: '2026-02' }]);
    const onward = affectedPeriods('2025-12-30', null, '2026-01-02');
    expect(onward.filter((p) => p.type === 'daily').map((p) => p.key)).toEqual(['2025-12-30', '2025-12-31', '2026-01-01']);
    expect(onward.filter((p) => p.type !== 'daily')).toEqual([{ type: 'monthly', key: '2025-12' }, { type: 'yearly', key: '2025' }]);
    expect(affectedPeriods('2026-03-05', null, '2026-03-05')).toEqual([]); // today: open period only
  });
});

describe('period finance metrics', () => {
  const acct = (id: string, created: string, agreed: number, discount = 0): FeeAccount => ({ id, createdAt: `${created}T05:00:00.000Z`, agreedFee: agreed, discount: { type: discount ? 'fixed' : 'none', value: discount, amount: discount, status: discount ? 'approved' : 'none' } } as FeeAccount);
  const tx = (id: string, type: FeeTransaction['type'], amount: number, date: string, reversesId?: string): FeeTransaction => ({ id, type, amount, date, reversesId } as FeeTransaction);
  const src = {
    accounts: [acct('a1', '2026-01-10', 10_000, 1_000), acct('a2', '2026-02-05', 5_000)],
    ledger: [tx('p1', 'payment', 4_000, '2026-01-15'), tx('p2', 'payment', 500, '2026-02-01'), tx('rv', 'reversal', 500, '2026-02-02', 'p2'), tx('rf', 'refund', 1_000, '2026-02-10'), tx('rr', 'reversal', 1_000, '2026-02-11', 'rf'), tx('ad', 'adjustment', -300, '2026-02-12'), tx('ch', 'adjustment', 200, '2026-02-13')],
    expenses: [{ id: 'e1', amount: 700, date: '2026-02-20' } as Expense],
  };
  it('separates payments, reversals, refunds, charges and waivers; period-end balances', () => {
    expect(periodMetrics(src, '2026-01-01', '2026-01-31')).toMatchObject({ collected: 4_000, payments: 4_000, discounts: 1_000, expectedAtEnd: 10_000, collectedToEnd: 4_000, outstandingAtEnd: 6_000 });
    expect(periodMetrics(src, '2026-02-01', '2026-02-28')).toMatchObject({
      collected: 0, payments: 500, paymentReversals: 500, refunds: 0, charges: 200, waivers: 300, expenses: 700, net: -700,
      expectedAtEnd: 14_900, collectedToEnd: 4_000, outstandingAtEnd: 10_900,
    });
  });
  it('reports metric differences for reconciliation', () => {
    const m = periodMetrics(src, '2026-02-01', '2026-02-28');
    expect(compareFinance(m, m)).toEqual([]);
    expect(compareFinance({ ...m, collected: 100 }, m)).toEqual([{ metric: 'collected', snapshot: 100, source: 0, difference: -100 }]);
  });
});

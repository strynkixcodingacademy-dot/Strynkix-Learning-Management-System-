import { describe, it, expect } from 'vitest';
import { allocate, balanceOf, discountAmount, dueSummary, equalInstallments, grossFee, needsApproval, paymentStatus, scheduleError } from '@/lib/finance/fees';

const pricing = { standardFee: 50_000_00, registrationFee: 1_000_00, otherFees: [{ label: 'Exam', amount: 500_00 }], discountLimits: { branch_admin: 1000, university_admin: 2500 } };

describe('fees', () => {
  it('gross, fixed and percent discounts (capped at the gross)', () => {
    expect(grossFee(pricing)).toBe(51_500_00);
    expect(discountAmount(51_500_00, 'percent', 1000)).toBe(5_150_00);
    expect(discountAmount(51_500_00, 'fixed', 2_000_00)).toBe(2_000_00);
    expect(discountAmount(100_00, 'fixed', 500_00)).toBe(100_00);
    expect(discountAmount(100_00, 'none', 500_00)).toBe(0);
  });
  it('discount approval boundary per role', () => {
    const g = grossFee(pricing);
    expect(needsApproval('branch_admin', pricing, g, discountAmount(g, 'percent', 1000))).toBe(false);
    expect(needsApproval('branch_admin', pricing, g, discountAmount(g, 'percent', 1001))).toBe(true);
    expect(needsApproval('university_admin', pricing, g, discountAmount(g, 'percent', 2500))).toBe(false);
    expect(needsApproval('university_admin', pricing, g, discountAmount(g, 'percent', 3000))).toBe(true);
    expect(needsApproval('super_admin', pricing, g, g)).toBe(false);
    expect(needsApproval('instructor', pricing, g, 1)).toBe(true);
  });
  it('equal installments add up exactly and fall on valid month days', () => {
    const items = equalInstallments(10_000_01, 3, '2026-01-31');
    expect(items.map((i) => i.amount)).toEqual([3_333_35, 3_333_33, 3_333_33]);
    expect(items.map((i) => i.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(scheduleError(items, 10_000_01)).toBeNull();
    expect(scheduleError(items, 10_000_00)).toMatch(/add up/);
    expect(scheduleError([{ number: 1, dueDate: '2026-02-01', amount: 5 }, { number: 2, dueDate: '2026-01-01', amount: 5 }], 10)).toMatch(/order/);
    expect(scheduleError([{ number: 1, dueDate: '2026-02-01', amount: 0 }], 0)).toMatch(/above zero/);
  });
  it('allocates partial payments oldest first and derives overdue', () => {
    const items = [{ number: 1, dueDate: '2026-01-10', amount: 100 }, { number: 2, dueDate: '2026-02-10', amount: 100 }, { number: 3, dueDate: '2026-03-10', amount: 100 }];
    expect(allocate(items, 150, '2026-02-15').map((i) => [i.paid, i.state])).toEqual([[100, 'paid'], [50, 'overdue'], [0, 'upcoming']]);
    expect(allocate(items, 150, '2026-02-01').map((i) => i.state)).toEqual(['paid', 'partial', 'upcoming']);
    expect(dueSummary(items, 150, '2026-02-15')).toMatchObject({ overdue: 50, next: { number: 2, remaining: 50 } });
  });
  it('balance and status come from the totals: refunds raise the balance, waivers lower the due', () => {
    const acct = { agreedFee: 300, totals: { paid: 300, refunded: 0, adjustments: 0 }, installments: [{ number: 1, dueDate: '2026-01-01', amount: 300 }], status: 'active' as const };
    expect(balanceOf(acct)).toBe(0);
    expect(paymentStatus(acct, '2026-06-01')).toBe('paid');
    const refunded = { ...acct, totals: { paid: 300, refunded: 100, adjustments: 0 } };
    expect(balanceOf(refunded)).toBe(100);
    expect(paymentStatus(refunded, '2026-06-01')).toBe('overdue');
    expect(balanceOf({ ...refunded, totals: { paid: 300, refunded: 100, adjustments: -100 } })).toBe(0);
  });
});

import { fitSchedule } from '@/lib/finance/fees';
describe('fitSchedule', () => {
  const items = [{ number: 1, dueDate: '2026-01-01', amount: 100 }, { number: 2, dueDate: '2026-02-01', amount: 100 }, { number: 3, dueDate: '2026-03-01', amount: 100 }];
  it('takes a reduction off the last installments and renumbers', () => {
    expect(fitSchedule(items, 150).map((i) => [i.number, i.amount])).toEqual([[1, 100], [2, 50]]);
    expect(fitSchedule(items, 350).map((i) => i.amount)).toEqual([100, 100, 150]);
    expect(fitSchedule(items, 300)).toEqual(items);
  });
});

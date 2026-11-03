import { describe, it, expect } from 'vitest';
import { isValidPeriod, nthDate, occurrences, occurrenceState } from '@/lib/finance/recurrence';

describe('recurring expenses', () => {
  it('monthly dates clamp to month end and never drift', () => {
    expect(occurrences({ startDate: '2026-01-31', frequency: 'monthly' }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(nthDate('2026-01-15', 'quarterly', 2)).toBe('2026-07-15');
    expect(nthDate('2026-01-01', 'weekly', 2)).toBe('2026-01-15');
    expect(occurrences({ startDate: '2026-01-05', frequency: 'yearly', endDate: '2027-12-31' }, '2025-01-01', '2030-01-01')).toEqual(['2026-01-05', '2027-01-05']);
  });
  it('states: paid and cancelled win; otherwise overdue, due within a week, or scheduled', () => {
    expect(occurrenceState('2026-03-01', '2026-03-10', false, false)).toBe('overdue');
    expect(occurrenceState('2026-03-15', '2026-03-10', false, false)).toBe('due');
    expect(occurrenceState('2026-04-15', '2026-03-10', false, false)).toBe('scheduled');
    expect(occurrenceState('2026-03-01', '2026-03-10', true, false)).toBe('paid');
    expect(occurrenceState('2026-03-01', '2026-03-10', false, true)).toBe('cancelled');
  });
  it('only real schedule dates are valid periods', () => {
    const s = { startDate: '2026-01-10', frequency: 'monthly' as const };
    expect(isValidPeriod(s, '2026-03-10')).toBe(true);
    expect(isValidPeriod(s, '2026-03-11')).toBe(false);
    expect(isValidPeriod(s, '2025-12-10')).toBe(false);
  });
});

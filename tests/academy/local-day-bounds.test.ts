import { describe, it, expect } from 'vitest';
import { localDate, localDayEndIso, localDayStartIso } from '@/lib/server/academy-scope';

describe('academy day boundaries (Asia/Kolkata)', () => {
  it('a day starts at local midnight, 18:30 UTC the evening before', () => {
    expect(localDayStartIso('2026-11-05')).toBe('2026-11-04T18:30:00.000Z');
    expect(localDayEndIso('2026-11-05')).toBe('2026-11-05T18:29:59.999Z');
  });

  it('an admission at 00:30 IST on the 1st counts in that day and month, not the one before', () => {
    const confirmedAt = '2026-10-31T19:00:00.000Z'; // 00:30 IST, 1 November
    expect(localDate(new Date(confirmedAt))).toBe('2026-11-01');
    expect(confirmedAt >= localDayStartIso('2026-11-01')).toBe(true);
    expect(confirmedAt >= '2026-11-01T00:00:00.000Z').toBe(false); // the old boundary missed it
  });
});

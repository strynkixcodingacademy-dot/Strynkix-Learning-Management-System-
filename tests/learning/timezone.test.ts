/**
 * Academy time zone (owner decision D4): "today" is the organization's calendar
 * day, not each device's.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getAcademyTimeZone, setAcademyTimeZone, toLocalDateKey } from '@/lib/learning/metrics';
import { lastNDays } from '@/lib/analytics/metrics';

afterEach(() => setAcademyTimeZone(undefined));

describe('academy time zone', () => {
  // 19:30 UTC is already 01:00 the next day in India.
  const lateUtc = new Date('2026-10-28T19:30:00Z');

  it('uses the academy zone for the calendar day', () => {
    expect(toLocalDateKey(lateUtc, 'Asia/Kolkata')).toBe('2026-10-29');
    expect(toLocalDateKey(lateUtc, 'UTC')).toBe('2026-10-28');
    expect(toLocalDateKey(lateUtc, 'America/New_York')).toBe('2026-10-28');
  });

  it('applies the academy zone by default once set', () => {
    setAcademyTimeZone('Asia/Kolkata');
    expect(getAcademyTimeZone()).toBe('Asia/Kolkata');
    expect(toLocalDateKey(lateUtc)).toBe('2026-10-29');
  });

  it('ignores an unknown zone instead of breaking dates', () => {
    setAcademyTimeZone('Mars/Olympus_Mons');
    expect(getAcademyTimeZone()).toBeUndefined();
    expect(toLocalDateKey(lateUtc)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lastNDays counts back from the academy’s today, across a month boundary', () => {
    setAcademyTimeZone('Asia/Kolkata');
    expect(lastNDays(new Date('2026-10-31T20:00:00Z'), 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
});

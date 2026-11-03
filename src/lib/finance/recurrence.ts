/**
 * Strynkix LMS — recurring expense schedules. Occurrences are computed from
 * the schedule, never stored, so nothing is generated twice; a payment is an
 * ordinary expense linked by `recurringId` + `period` (the due date), with a
 * deterministic id so the same occurrence can't be paid twice.
 */

import type { RecurrenceFrequency } from '@/types/academy';

export type OccurrenceState = 'scheduled' | 'due' | 'overdue' | 'paid' | 'cancelled';

const MONTHS: Record<Exclude<RecurrenceFrequency, 'weekly'>, number> = { monthly: 1, quarterly: 3, yearly: 12 };
const DUE_WINDOW_DAYS = 7;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The n-th due date (n = 0 is the start), clamped to the month's last day. */
export function nthDate(start: string, frequency: RecurrenceFrequency, n: number): string {
  if (frequency === 'weekly') return addDays(start, 7 * n);
  const [y, m, d] = start.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + MONTHS[frequency] * n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** Due dates within [from, to], bounded by the schedule's start and end (at most 400). */
export function occurrences(s: { startDate: string; endDate?: string; frequency: RecurrenceFrequency }, from: string, to: string): string[] {
  const out: string[] = [];
  const end = s.endDate && s.endDate < to ? s.endDate : to;
  for (let n = 0; n < 2000 && out.length < 400; n++) {
    const date = nthDate(s.startDate, s.frequency, n);
    if (date > end) break;
    if (date >= from) out.push(date);
  }
  return out;
}

export function occurrenceState(period: string, today: string, paid: boolean, cancelled: boolean): OccurrenceState {
  if (paid) return 'paid';
  if (cancelled) return 'cancelled';
  if (period < today) return 'overdue';
  return period <= addDays(today, DUE_WINDOW_DAYS) ? 'due' : 'scheduled';
}

export const isValidPeriod = (s: { startDate: string; endDate?: string; frequency: RecurrenceFrequency }, period: string) =>
  occurrences(s, period, period).length === 1;

/**
 * Strynkix LMS — reporting periods (Stage 9). Pure and client-safe.
 *
 * Periods are calendar days, months and years in the reporting time zone.
 * Ledger and expense dates are already local business dates (YYYY-MM-DD), so
 * money is bucketed by those dates directly; timestamp-based records
 * (admissions, submissions) use the UTC instants of local midnight.
 */

export const REPORTING_TIMEZONE = 'Asia/Kolkata';
export type PeriodType = 'daily' | 'monthly' | 'yearly';
export type SnapshotLevel = 'organization' | 'academy' | 'branch';

export interface PeriodBounds { type: PeriodType; key: string; from: string; to: string; startUtc: string; endUtc: string }

const DAY = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-\d{2}$/, YEAR = /^\d{4}$/;

export function isValidPeriodKey(type: PeriodType, key: string): boolean {
  if (type === 'daily') return DAY.test(key) && !Number.isNaN(Date.parse(`${key}T00:00:00Z`)) && new Date(`${key}T00:00:00Z`).toISOString().slice(0, 10) === key;
  if (type === 'monthly') return MONTH.test(key) && Number(key.slice(5)) >= 1 && Number(key.slice(5)) <= 12;
  return YEAR.test(key);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Offset of the time zone from UTC at an instant, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(instant).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** The UTC instant of local midnight at the start of `date` in the time zone. */
export function localMidnightUtc(date: string, timeZone = REPORTING_TIMEZONE): string {
  const guess = new Date(`${date}T00:00:00Z`);
  const first = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
  // Re-check once around DST transitions.
  return new Date(guess.getTime() - offsetMinutes(first, timeZone) * 60000).toISOString();
}

export function periodBounds(type: PeriodType, key: string, timeZone = REPORTING_TIMEZONE): PeriodBounds {
  if (!isValidPeriodKey(type, key)) throw new Error(`Invalid ${type} period “${key}”.`);
  let from: string, to: string;
  if (type === 'daily') { from = key; to = key; }
  else if (type === 'monthly') {
    const [y, m] = key.split('-').map(Number);
    from = `${key}-01`;
    to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  } else { from = `${key}-01-01`; to = `${key}-12-31`; }
  return { type, key, from, to, startUtc: localMidnightUtc(from, timeZone), endUtc: localMidnightUtc(addDays(to, 1), timeZone) };
}

/** The period of `type` that contains the local date. */
export function periodKeyFor(type: PeriodType, date: string): string {
  return type === 'daily' ? date : type === 'monthly' ? date.slice(0, 7) : date.slice(0, 4);
}

/** The most recent completed period before `today` (local date). */
export function previousPeriod(type: PeriodType, today: string): string {
  if (type === 'daily') return addDays(today, -1);
  if (type === 'monthly') { const [y, m] = today.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
  return String(Number(today.slice(0, 4)) - 1);
}

/** A period is complete once its last local day is before today. */
export const isCompleted = (type: PeriodType, key: string, today: string) => periodBounds(type, key).to < today;

/** Months (YYYY-MM) touching [from, to]. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 240) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/** Deterministic snapshot id: one logical snapshot per level, scope and period. */
export function snapshotId(level: SnapshotLevel, scopeId: string, type: PeriodType, key: string): string {
  return `${level === 'organization' ? 'org' : level}_${scopeId}_${type}_${key}`;
}

/** Periods of each type that overlap [fromDate, toDate] and are complete by `today`. */
export function affectedPeriods(fromDate: string, toDate: string | null, today: string): { type: PeriodType; key: string }[] {
  const end = toDate && toDate < today ? toDate : addDays(today, -1);
  if (fromDate > end) return [];
  const out: { type: PeriodType; key: string }[] = [];
  for (let d = fromDate, n = 0; d <= end && n < 400; d = addDays(d, 1), n++) out.push({ type: 'daily', key: d });
  for (const m of monthsBetween(fromDate, end)) if (isCompleted('monthly', m, today)) out.push({ type: 'monthly', key: m });
  for (let y = Number(fromDate.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) if (isCompleted('yearly', String(y), today)) out.push({ type: 'yearly', key: String(y) });
  return out;
}

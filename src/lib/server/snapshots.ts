import 'server-only';

/**
 * Strynkix LMS — reporting snapshots, scheduled jobs and reconciliation (Stage 9).
 *
 * The fee ledger stays the source of truth: a snapshot is a recomputation of
 * the shared period metrics (src/lib/reporting/metrics.ts) for one level
 * (organization / academy / branch), one scope and one period, stored for
 * fast historical reporting. Nothing here writes to fee accounts, the ledger
 * or expenses.
 *
 * - Identity: reportSnapshots/{level}_{scope}_{type}_{key} — one logical
 *   snapshot; re-running recomputes it from source (never increments), so a
 *   retry or duplicate run can't double-count.
 * - Writes: a transaction per snapshot; the version only advances when the
 *   figures change, and the previous version is archived in versions/{n}.
 * - Concurrency: a lease lock per period (snapshotLocks) so overlapping runs
 *   don't interleave; a second run is reported as skipped.
 * - Reconciliation: re-reads the scope's source records, recomputes and
 *   compares every metric, and checks cached account totals against the
 *   ledger. A mismatch marks the snapshot and opens a review record; it never
 *   corrects financial data.
 * - Historical changes: writes that change closed periods (backdated
 *   payments/refunds/expenses, voids, discount decisions, late attendance)
 *   record an invalidation in their own transaction; jobs mark the affected
 *   snapshots stale, and recalculation creates a new, traceable version.
 */

import { randomBytes } from 'node:crypto';
import { FieldValue, type Firestore, type Query } from 'firebase-admin/firestore';
import type { Expense, FeeAccount, FeeTransaction } from '@/types/academy';
import { compareFinance, periodMetrics, type FinanceSources, type PeriodFinance } from '@/lib/reporting/metrics';
import {
  REPORTING_TIMEZONE, affectedPeriods, isCompleted, isValidPeriodKey, periodBounds, previousPeriod, snapshotId,
  type PeriodBounds, type PeriodType, type SnapshotLevel,
} from '@/lib/reporting/periods';
import { localDate } from '@/lib/server/academy-scope';
import { totalsFromLedger } from '@/lib/server/finance';

export const SCHEMA_VERSION = 1;
export const CALC_VERSION = 'finance-1+academic-1';
const LOCK_MS = 10 * 60_000;

export type SnapshotStatus = 'generated' | 'reconciled' | 'mismatched' | 'stale' | 'failed';
export interface SnapshotScope { level: SnapshotLevel; scopeId: string; orgId: string | null; branchId: string | null }
export interface AcademicMetrics { admissions: number; newEnrollments: number; lessonsCompleted: number; assessmentSubmissions: number; assessmentParticipants: number; evaluationsCompleted: number; attendanceRecords: number; attendancePercent: number | null }
export interface Watermark { accounts: number; ledgerEntries: number; ledgerLastCreatedAt: string | null; expenses: number; expensesLastCreatedAt: string | null }
export interface SnapshotDoc extends SnapshotScope {
  periodType: PeriodType; periodKey: string; from: string; to: string; startUtc: string; endUtc: string; timezone: string;
  schemaVersion: number; calcVersion: string; finance: PeriodFinance; academic: AcademicMetrics; watermark: Watermark;
  jobId: string; status: SnapshotStatus; version: number; generatedAt: string; lastVerifiedAt: string;
  recalcReason?: string | null; staleReasons?: string[]; staleSince?: string | null;
  reconciliation?: { status: 'reconciled' | 'mismatched'; checkedAt: string; jobId: string; differences: { metric: string; snapshot: number | null; source: number; difference: number }[]; inconsistentAccounts: number; inconsistentAccountIds: string[] };
}

// --- sources ---------------------------------------------------------------

function scoped(db: Firestore, collection: string, s: { orgId: string | null; branchId: string | null }): Query {
  let q: Query = db.collection(collection);
  if (s.orgId) q = q.where('orgId', '==', s.orgId);
  if (s.branchId) q = q.where('branchId', '==', s.branchId);
  return q;
}

/** All fee accounts, ledger entries and paid expenses for a scope (organization = everything). */
export async function loadFinanceSources(db: Firestore, s: { orgId: string | null; branchId: string | null }): Promise<FinanceSources> {
  const [acc, led, exp] = await Promise.all([scoped(db, 'feeAccounts', s).get(), scoped(db, 'feeTransactions', s).get(), scoped(db, 'expenses', s).get()]);
  const accounts = acc.docs.map((d) => ({ id: d.id, ...d.data() } as FeeAccount)).filter((a) => a.status !== 'cancelled');
  const ids = new Set(accounts.map((a) => a.id));
  return {
    accounts,
    ledger: led.docs.map((d) => ({ id: d.id, ...d.data() } as FeeTransaction)).filter((t) => ids.has(t.feeAccountId)),
    expenses: exp.docs.map((d) => ({ id: d.id, ...d.data() } as Expense)).filter((e) => e.status === 'paid'),
  };
}

const inScope = (x: { orgId?: string; branchId?: string | null }, s: SnapshotScope) => (!s.orgId || x.orgId === s.orgId) && (!s.branchId || x.branchId === s.branchId);

function partitionFinance(src: FinanceSources, s: SnapshotScope): FinanceSources {
  return { accounts: src.accounts.filter((a) => inScope(a, s)), ledger: src.ledger.filter((t) => inScope(t, s)), expenses: src.expenses.filter((e) => inScope(e, s)) };
}

interface AcademicSources {
  admissions: { orgId: string; branchId: string }[]; enrollments: { orgId: string; branchId: string }[];
  lessons: { orgId: string; branchId: string | null }[]; submissions: { orgId: string; branchId: string; studentId: string }[];
  evaluations: { orgId: string; branchId: string }[]; attendance: { orgId: string; branchId: string; records: Record<string, string> }[];
}

/** Period-bounded academic records (timestamps compared against local-midnight instants). */
async function loadAcademicSources(db: Firestore, b: PeriodBounds, s: { orgId: string | null; branchId: string | null }): Promise<AcademicSources> {
  const range = (q: Query, field: string) => q.where(field, '>=', b.startUtc).where(field, '<', b.endUtc);
  const [adm, enr, prog, sub, ev, att, batches] = await Promise.all([
    range(scoped(db, 'admissions', s).where('status', '==', 'confirmed'), 'confirmedAt').select('orgId', 'branchId').get(),
    range(db.collection('enrollments'), 'enrolledAt').select('orgId', 'branchId').get(),
    range(db.collection('progress'), 'completedAt').select('orgId', 'batchId').get(),
    range(db.collection('assessmentAttempts'), 'submittedAt').select('orgId', 'branchId', 'studentId').get(),
    range(db.collection('assessmentAttempts'), 'evaluatedAt').select('orgId', 'branchId').get(),
    db.collection('attendance').where('date', '>=', b.from).where('date', '<=', b.to).select('orgId', 'branchId', 'records').get(),
    db.collection('batches').select('orgId', 'branchId').get(),
  ]);
  const batchBranch = new Map(batches.docs.map((d) => [d.id, d.data().branchId as string]));
  const data = <T>(snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map((d) => d.data() as T);
  return {
    admissions: data(adm), enrollments: data(enr),
    lessons: prog.docs.map((d) => ({ orgId: d.data().orgId as string, branchId: batchBranch.get(d.data().batchId as string) ?? null })),
    submissions: data(sub), evaluations: data(ev), attendance: data(att),
  };
}

function academicMetrics(a: AcademicSources, s: SnapshotScope): AcademicMetrics {
  const f = <T extends { orgId?: string; branchId?: string | null }>(rows: T[]) => rows.filter((r) => inScope(r, s));
  const subs = f(a.submissions);
  let records = 0, attended = 0, counted = 0;
  for (const x of f(a.attendance)) for (const st of Object.values(x.records ?? {})) { records++; if (st !== 'excused') counted++; if (st === 'present' || st === 'late') attended++; }
  return {
    admissions: f(a.admissions).length, newEnrollments: f(a.enrollments).length, lessonsCompleted: f(a.lessons).length,
    assessmentSubmissions: subs.length, assessmentParticipants: new Set(subs.map((x) => x.studentId)).size, evaluationsCompleted: f(a.evaluations).length,
    attendanceRecords: records, attendancePercent: counted ? Math.round((attended / counted) * 1000) / 10 : null,
  };
}

function watermark(src: FinanceSources): Watermark {
  const last = (xs: { createdAt?: string }[]) => xs.reduce<string | null>((m, x) => (x.createdAt && (!m || x.createdAt > m) ? x.createdAt : m), null);
  return { accounts: src.accounts.length, ledgerEntries: src.ledger.length, ledgerLastCreatedAt: last(src.ledger), expenses: src.expenses.length, expensesLastCreatedAt: last(src.expenses) };
}

/** Organization, every academy and every branch. */
export async function allScopes(db: Firestore): Promise<SnapshotScope[]> {
  const [orgs, branches] = await Promise.all([db.collection('organizations').select().get(), db.collection('branches').select('orgId').get()]);
  return [
    { level: 'organization', scopeId: 'all', orgId: null, branchId: null },
    ...orgs.docs.map((d) => ({ level: 'academy' as const, scopeId: d.id, orgId: d.id, branchId: null })),
    ...branches.docs.map((d) => ({ level: 'branch' as const, scopeId: d.id, orgId: d.data().orgId as string, branchId: d.id })),
  ];
}

function scopeOf(doc: Pick<SnapshotDoc, 'level' | 'scopeId' | 'orgId' | 'branchId'>): SnapshotScope {
  return { level: doc.level, scopeId: doc.scopeId, orgId: doc.orgId, branchId: doc.branchId };
}

// --- writing ----------------------------------------------------------------

type Body = Pick<SnapshotDoc, 'finance' | 'academic' | 'watermark'>;
export type WriteOutcome = 'created' | 'updated' | 'unchanged';

/** Atomically creates, verifies or re-versions one snapshot (previous version archived). */
async function writeSnapshot(db: Firestore, s: SnapshotScope, b: PeriodBounds, body: Body, ctx: { jobId: string; reason?: string }): Promise<WriteOutcome> {
  const id = snapshotId(s.level, s.scopeId, b.type, b.key);
  const ref = db.doc(`reportSnapshots/${id}`);
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() as SnapshotDoc) : null;
    const same = prev && prev.calcVersion === CALC_VERSION && JSON.stringify(prev.finance) === JSON.stringify(body.finance) && JSON.stringify(prev.academic) === JSON.stringify(body.academic);
    if (prev && same) {
      // Recomputed from source and identical: verified. A stale/failed snapshot goes back to "generated" for reconciliation.
      tx.update(ref, { lastVerifiedAt: iso, watermark: body.watermark, ...(prev.status === 'stale' || prev.status === 'failed' ? { status: 'generated', staleReasons: [], staleSince: null } : {}) });
      return 'unchanged';
    }
    if (prev) tx.create(ref.collection('versions').doc(String(prev.version)), { ...prev, archivedAt: iso, supersededByJob: ctx.jobId });
    const doc: SnapshotDoc = {
      ...s, periodType: b.type, periodKey: b.key, from: b.from, to: b.to, startUtc: b.startUtc, endUtc: b.endUtc, timezone: REPORTING_TIMEZONE,
      schemaVersion: SCHEMA_VERSION, calcVersion: CALC_VERSION, ...body, jobId: ctx.jobId, status: 'generated', version: (prev?.version ?? 0) + 1,
      generatedAt: iso, lastVerifiedAt: iso, recalcReason: prev ? ctx.reason ?? 'Source records changed' : null, staleReasons: [], staleSince: null,
    };
    tx.set(ref, doc);
    return prev ? 'updated' : 'created';
  });
}

// --- reconciliation ----------------------------------------------------------

/** Re-reads the scope's source records, recomputes and compares; checks cached account totals against the ledger. */
export async function reconcileSnapshot(db: Firestore, id: string, jobId: string): Promise<'reconciled' | 'mismatched' | 'stale'> {
  const ref = db.doc(`reportSnapshots/${id}`);
  const before = (await ref.get()).data() as SnapshotDoc | undefined;
  if (!before) throw new Error(`Snapshot ${id} doesn't exist.`);
  const s = scopeOf(before);
  const src = await loadFinanceSources(db, s);
  const source = periodMetrics(src, before.from, before.to);
  const byAccount = new Map<string, FeeTransaction[]>();
  for (const t of src.ledger) byAccount.set(t.feeAccountId, [...(byAccount.get(t.feeAccountId) ?? []), t]);
  const byId = new Map(src.ledger.map((t) => [t.id, t]));
  const inconsistent = src.accounts.filter((a) => {
    const t = totalsFromLedger(byAccount.get(a.id) ?? [], byId);
    return t.paid !== a.totals.paid || t.refunded !== a.totals.refunded || t.adjustments !== a.totals.adjustments;
  }).map((a) => a.id);
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const doc = snap.data() as SnapshotDoc;
    if (doc.status === 'stale') return 'stale'; // needs recalculation first; don't certify it
    const differences = compareFinance(doc.finance, source);
    const status = differences.length || inconsistent.length ? 'mismatched' : 'reconciled';
    tx.update(ref, { status, reconciliation: { status, checkedAt: iso, jobId, differences, inconsistentAccounts: inconsistent.length, inconsistentAccountIds: inconsistent.slice(0, 20) } });
    if (status === 'mismatched') {
      // One review per snapshot version (idempotent): an actionable record, never an automatic correction.
      tx.set(db.doc(`reconciliationReviews/${id}_v${doc.version}`), {
        snapshotId: id, version: doc.version, level: doc.level, scopeId: doc.scopeId, orgId: doc.orgId, branchId: doc.branchId, periodType: doc.periodType, periodKey: doc.periodKey,
        differences, inconsistentAccounts: inconsistent.length, inconsistentAccountIds: inconsistent.slice(0, 20), status: 'open', openedAt: iso, jobId,
      }, { merge: true });
    }
    return status;
  });
}

// --- invalidation -----------------------------------------------------------

export { recordInvalidation } from '@/lib/server/snapshot-invalidation';

/** Snapshot ids an invalidation touches (organization, its academy and branch, every affected completed period). */
export function affectedSnapshotIds(inv: { orgId: string; branchId: string | null; fromDate: string; toDate: string | null }, today: string): string[] {
  const scopes: [SnapshotLevel, string][] = [['organization', 'all'], ['academy', inv.orgId], ...(inv.branchId ? [['branch', inv.branchId] as [SnapshotLevel, string]] : [])];
  return affectedPeriods(inv.fromDate, inv.toDate, today).flatMap((p) => scopes.map(([level, id]) => snapshotId(level, id, p.type, p.key)));
}

/** Marks snapshots touched by pending invalidations as stale (with the reason) and closes the invalidations. */
export async function applyInvalidations(db: Firestore, limit = 200): Promise<{ invalidations: number; markedStale: number }> {
  const today = localDate();
  const pending = await db.collection('snapshotInvalidations').where('status', '==', 'pending').limit(limit).get();
  let marked = 0;
  for (const d of pending.docs) {
    const inv = d.data() as { orgId: string; branchId: string | null; fromDate: string; toDate: string | null; reason: string };
    const ids = affectedSnapshotIds(inv, today);
    marked += await db.runTransaction(async (tx) => {
      const refs = ids.map((id) => db.doc(`reportSnapshots/${id}`));
      const snaps = refs.length ? await tx.getAll(...refs) : [];
      const fresh = await tx.get(d.ref);
      if (fresh.data()?.status !== 'pending') return 0;
      const iso = new Date().toISOString();
      let n = 0;
      for (const s of snaps) {
        if (!s.exists) continue;
        tx.update(s.ref, { status: 'stale', staleReasons: FieldValue.arrayUnion(inv.reason), staleSince: (s.data() as SnapshotDoc).staleSince ?? iso });
        n++;
      }
      tx.update(d.ref, { status: 'applied', appliedAt: iso, snapshotsMarked: n });
      return n;
    });
  }
  return { invalidations: pending.size, markedStale: marked };
}

// --- jobs --------------------------------------------------------------------

export interface JobResult { created: number; updated: number; unchanged: number; reconciled: number; mismatched: number; stale: number; failed: number }
const emptyResult = (): JobResult => ({ created: 0, updated: 0, unchanged: 0, reconciled: 0, mismatched: 0, stale: 0, failed: 0 });
export const newJobId = () => `job_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

async function acquireLock(db: Firestore, name: string, jobId: string): Promise<boolean> {
  const ref = db.doc(`snapshotLocks/${name}`);
  try {
    return await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const now = Date.now();
      const lease = { jobId, acquiredAt: new Date(now).toISOString(), expiresAt: now + LOCK_MS };
      if (s.exists) {
        if ((s.data()!.expiresAt as number) > now && s.data()!.jobId !== jobId) return false;
        tx.update(ref, lease); // an expired lease is taken over
      } else {
        tx.create(ref, lease); // create() fails if another run created the lock first, so only one run can win
      }
      return true;
    });
  } catch (e) {
    if ((e as { code?: number | string }).code === 6 || (e as { code?: string }).code === 'already-exists') return false;
    throw e;
  }
}

async function releaseLock(db: Firestore, name: string, jobId: string) {
  const ref = db.doc(`snapshotLocks/${name}`);
  await db.runTransaction(async (tx) => { const s = await tx.get(ref); if (s.exists && s.data()!.jobId === jobId) tx.delete(ref); });
}

export interface JobSpec { kind: 'generate' | 'recalculate' | 'reconcile' | 'scheduled'; periodType?: PeriodType; periodKey?: string; snapshotId?: string; reason?: string }

/** Runs a job with a job record, a lease lock and per-scope error capture. Safe to retry. */
export async function runJob(db: Firestore, spec: JobSpec, ctx: { trigger: 'cron' | 'manual' | 'retry'; actorId: string; retryOf?: string; jobId?: string }) {
  const jobId = ctx.jobId ?? newJobId();
  const jobRef = db.doc(`snapshotJobs/${jobId}`);
  const lockName = spec.kind === 'scheduled' ? 'scheduled' : spec.snapshotId ? `snapshot_${spec.snapshotId}` : `${spec.periodType}_${spec.periodKey}`;
  const startedAt = new Date().toISOString();
  await jobRef.set({ ...spec, trigger: ctx.trigger, actorId: ctx.actorId, ...(ctx.retryOf ? { retryOf: ctx.retryOf } : {}), status: 'running', startedAt, results: emptyResult(), errors: [] });
  if (!(await acquireLock(db, lockName, jobId))) {
    await jobRef.update({ status: 'skipped', finishedAt: new Date().toISOString(), message: 'Another run for the same period is in progress; nothing was changed.' });
    return { jobId, status: 'skipped' as const, results: emptyResult(), errors: [] as { scope: string; message: string }[] };
  }
  const results = emptyResult();
  const errors: { scope: string; message: string }[] = [];
  try {
    if (spec.kind === 'generate') await generatePeriod(db, spec.periodType!, spec.periodKey!, jobId, results, errors, spec.reason);
    else if (spec.kind === 'recalculate') await recalculate(db, spec.snapshotId!, jobId, spec.reason ?? 'Recalculation requested', results);
    else if (spec.kind === 'reconcile') bump(results, await reconcileSnapshot(db, spec.snapshotId!, jobId));
    else await scheduled(db, jobId, results, errors);
  } catch (e) {
    errors.push({ scope: 'job', message: (e as Error).message });
  } finally {
    await releaseLock(db, lockName, jobId);
  }
  const status = errors.length ? 'failed' : 'succeeded';
  await jobRef.update({ status, finishedAt: new Date().toISOString(), results, errors: errors.slice(0, 50) });
  return { jobId, status, results, errors };
}

function bump(r: JobResult, outcome: WriteOutcome | 'reconciled' | 'mismatched' | 'stale') { r[outcome] += 1; }

/** Generates every scope's snapshot for one completed period, then reconciles each. */
async function generatePeriod(db: Firestore, type: PeriodType, key: string, jobId: string, results: JobResult, errors: { scope: string; message: string }[], reason?: string) {
  if (!isValidPeriodKey(type, key)) throw new Error(`Invalid ${type} period “${key}”.`);
  if (!isCompleted(type, key, localDate())) throw new Error('Only completed periods are snapshotted; the current period uses live figures.');
  const b = periodBounds(type, key);
  const all = { orgId: null, branchId: null };
  // One read of the sources for the whole run, partitioned per scope in memory.
  const [scopes, fin, acad] = await Promise.all([allScopes(db), loadFinanceSources(db, all), loadAcademicSources(db, b, all)]);
  for (const s of scopes) {
    try {
      const part = partitionFinance(fin, s);
      bump(results, await writeSnapshot(db, s, b, { finance: periodMetrics(part, b.from, b.to), academic: academicMetrics(acad, s), watermark: watermark(part) }, { jobId, reason }));
    } catch (e) {
      results.failed++;
      errors.push({ scope: snapshotId(s.level, s.scopeId, type, key), message: (e as Error).message });
    }
  }
  for (const s of scopes) {
    const id = snapshotId(s.level, s.scopeId, type, key);
    try { bump(results, await reconcileSnapshot(db, id, jobId)); } catch (e) { results.failed++; errors.push({ scope: id, message: `Reconciliation: ${(e as Error).message}` }); }
  }
}

/** Recomputes one snapshot from its scope's source records (new version if different), then reconciles. */
async function recalculate(db: Firestore, id: string, jobId: string, reason: string, results: JobResult) {
  const doc = (await db.doc(`reportSnapshots/${id}`).get()).data() as SnapshotDoc | undefined;
  if (!doc) throw new Error(`Snapshot ${id} doesn't exist.`);
  const s = scopeOf(doc);
  const b = periodBounds(doc.periodType, doc.periodKey);
  const [fin, acad] = await Promise.all([loadFinanceSources(db, s), loadAcademicSources(db, b, s)]);
  const why = [reason, ...(doc.staleReasons ?? [])].filter(Boolean).join('; ').slice(0, 500);
  bump(results, await writeSnapshot(db, s, b, { finance: periodMetrics(fin, b.from, b.to), academic: academicMetrics(acad, s), watermark: watermark(fin) }, { jobId, reason: why }));
  // A recalculation whose figures didn't change still clears the stale flag before reconciling.
  await db.doc(`reportSnapshots/${id}`).update({ status: 'generated', staleReasons: [], staleSince: null, recalcReason: why });
  bump(results, await reconcileSnapshot(db, id, jobId));
}

/**
 * The scheduled run (daily, after the reporting day closes): apply pending
 * invalidations; snapshot yesterday, the last completed month and year when
 * missing; recalculate stale snapshots; reconcile anything not yet reconciled.
 */
async function scheduled(db: Firestore, jobId: string, results: JobResult, errors: { scope: string; message: string }[]) {
  await applyInvalidations(db);
  const today = localDate();
  for (const type of ['daily', 'monthly', 'yearly'] as PeriodType[]) {
    const key = previousPeriod(type, today);
    const org = await db.doc(`reportSnapshots/${snapshotId('organization', 'all', type, key)}`).get();
    if (!org.exists || ['failed'].includes(org.data()!.status)) await generatePeriod(db, type, key, jobId, results, errors);
  }
  const stale = await db.collection('reportSnapshots').where('status', '==', 'stale').limit(25).get();
  for (const d of stale.docs) {
    try { await recalculate(db, d.id, jobId, 'Scheduled recalculation after source changes', results); } catch (e) { results.failed++; errors.push({ scope: d.id, message: (e as Error).message }); }
  }
  const unreconciled = await db.collection('reportSnapshots').where('status', '==', 'generated').limit(50).get();
  for (const d of unreconciled.docs) {
    try { bump(results, await reconcileSnapshot(db, d.id, jobId)); } catch (e) { results.failed++; errors.push({ scope: d.id, message: (e as Error).message }); }
  }
}

/** Reconciled, current snapshots are trusted; anything else falls back to live figures. */
export async function trustedSnapshots(db: Firestore, ids: string[]): Promise<Map<string, SnapshotDoc>> {
  if (!ids.length) return new Map();
  const snaps = await db.getAll(...ids.map((id) => db.doc(`reportSnapshots/${id}`)));
  return new Map(snaps.filter((s) => s.exists && (s.data() as SnapshotDoc).status === 'reconciled' && (s.data() as SnapshotDoc).calcVersion === CALC_VERSION).map((s) => [s.id, s.data() as SnapshotDoc]));
}

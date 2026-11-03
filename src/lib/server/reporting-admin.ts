import 'server-only';

/**
 * Strynkix LMS — reporting infrastructure controls for the Super Admin only
 * (Stage 9): snapshot and job status, reconciliation reviews, and the audited
 * actions to run, retry, recalculate and reconcile. The role comes from the
 * caller's stored profile.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore, type Query } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema } from '@/types/validation';
import { isValidPeriodKey, type PeriodType } from '@/lib/reporting/periods';
import { type Actor, conflict, denied, invalid, loadActor, notFound, parseBody } from '@/lib/server/academy-scope';
import { applyInvalidations, runJob, type JobSpec, type SnapshotDoc } from '@/lib/server/snapshots';

const PAGE = 25;
const periodType = z.enum(['daily', 'monthly', 'yearly']);
const cursor = z.string().max(64).optional();
const snapshotIdSchema = z.string().regex(/^(org|academy|branch)_[A-Za-z0-9_-]+_(daily|monthly|yearly)_[0-9-]{4,10}$/, 'Invalid snapshot id.');

export const reportingRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('snapshots'), status: z.enum(['generated', 'reconciled', 'mismatched', 'stale', 'failed']).optional(), periodType: periodType.optional(), level: z.enum(['organization', 'academy', 'branch']).optional(), cursor }).strict(),
  z.object({ action: z.literal('snapshot'), snapshotId: snapshotIdSchema }).strict(),
  z.object({ action: z.literal('jobs'), status: z.enum(['running', 'succeeded', 'failed', 'skipped']).optional(), cursor }).strict(),
  z.object({ action: z.literal('reviews'), status: z.enum(['open', 'resolved']).default('open') }).strict(),
  z.object({ action: z.literal('invalidations') }).strict(),
  z.object({ action: z.literal('run'), periodType, periodKey: z.string().max(10) }).strict(),
  z.object({ action: z.literal('run_scheduled') }).strict(),
  z.object({ action: z.literal('retry'), jobId: idSchema }).strict(),
  z.object({ action: z.literal('recalculate'), snapshotId: snapshotIdSchema, reason: z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(300) }).strict(),
  z.object({ action: z.literal('reconcile'), snapshotId: snapshotIdSchema }).strict(),
  z.object({ action: z.literal('apply_invalidations') }).strict(),
  z.object({ action: z.literal('resolve_review'), reviewId: z.string().regex(/^[A-Za-z0-9_-]+_v\d+$/), note: z.string().trim().min(5, 'Say how it was resolved (at least 5 characters).').max(500) }).strict(),
]);

type Services = { db: Firestore; auth: Auth };
const count = async (q: Query) => (await q.count().get()).data().count;
const rows = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

async function page(db: Firestore, q: Query, collection: string, after?: string) {
  let query = q;
  if (after) { const d = await db.doc(`${collection}/${after}`).get(); if (d.exists) query = query.startAfter(d); }
  const snap = await query.limit(PAGE + 1).get();
  const list = rows(snap).slice(0, PAGE);
  return { rows: list, cursor: snap.docs.length > PAGE ? list[list.length - 1].id : null };
}

function audit(db: Firestore, actor: Actor, action: string, targetId: string, extra: Record<string, unknown> = {}) {
  return db.collection('auditLog').add({ orgId: actor.orgId, courseId: null, targetType: 'report_snapshot', targetId, action, actorId: actor.id, actorRole: actor.role, ...extra, at: FieldValue.serverTimestamp() });
}

export async function handleReporting(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  if (actor.role !== 'super_admin') throw denied('Reporting infrastructure is for the Super Admin.');
  const req = parseBody(reportingRequestSchema, body);
  const { db } = services;
  const snaps = db.collection('reportSnapshots');

  switch (req.action) {
    case 'status': {
      const latest = async (t: PeriodType) => {
        const s = await snaps.where('level', '==', 'organization').where('periodType', '==', t).where('status', '==', 'reconciled').orderBy('periodKey', 'desc').limit(1).get();
        const d = s.docs[0]?.data() as SnapshotDoc | undefined;
        return d ? { id: s.docs[0].id, periodKey: d.periodKey, version: d.version, reconciledAt: d.reconciliation?.checkedAt ?? null, collected: d.finance.collected, outstandingAtEnd: d.finance.outstandingAtEnd } : null;
      };
      const [daily, monthly, yearly, generated, reconciled, mismatched, stale, failed, openReviews, pendingInv, failedJobs, lastJob, lastRecon] = await Promise.all([
        latest('daily'), latest('monthly'), latest('yearly'),
        count(snaps.where('status', '==', 'generated')), count(snaps.where('status', '==', 'reconciled')), count(snaps.where('status', '==', 'mismatched')),
        count(snaps.where('status', '==', 'stale')), count(snaps.where('status', '==', 'failed')),
        count(db.collection('reconciliationReviews').where('status', '==', 'open')), count(db.collection('snapshotInvalidations').where('status', '==', 'pending')),
        count(db.collection('snapshotJobs').where('status', '==', 'failed')),
        db.collection('snapshotJobs').orderBy('startedAt', 'desc').limit(1).get(),
        snaps.where('status', '==', 'reconciled').orderBy('reconciliation.checkedAt', 'desc').limit(1).get(),
      ]);
      return {
        latest: { daily, monthly, yearly }, counts: { generated, reconciled, mismatched, stale, failed }, openReviews, pendingInvalidations: pendingInv, failedJobs,
        lastJob: lastJob.docs[0] ? { id: lastJob.docs[0].id, ...lastJob.docs[0].data() } : null,
        lastReconciledAt: (lastRecon.docs[0]?.data() as SnapshotDoc | undefined)?.reconciliation?.checkedAt ?? null,
        cronConfigured: Boolean(process.env.CRON_SECRET),
      };
    }

    case 'snapshots': {
      let q: Query = snaps;
      if (req.status) q = q.where('status', '==', req.status);
      q = q.orderBy('generatedAt', 'desc');
      const p = await page(db, q, 'reportSnapshots', req.cursor);
      // Period type / level narrow the page in memory (keeps indexes to status + generatedAt).
      const list = (p.rows as (SnapshotDoc & { id: string })[]).filter((s) => (!req.periodType || s.periodType === req.periodType) && (!req.level || s.level === req.level));
      return { snapshots: list.map((s) => ({ id: s.id, level: s.level, scopeId: s.scopeId, orgId: s.orgId, branchId: s.branchId, periodType: s.periodType, periodKey: s.periodKey, status: s.status, version: s.version, generatedAt: s.generatedAt, collected: s.finance.collected, outstandingAtEnd: s.finance.outstandingAtEnd, differences: s.reconciliation?.differences.length ?? 0, staleReasons: s.staleReasons ?? [] })), cursor: p.cursor };
    }

    case 'snapshot': {
      const ref = db.doc(`reportSnapshots/${req.snapshotId}`);
      const [doc, versions, reviews, jobs] = await Promise.all([
        ref.get(), ref.collection('versions').get(),
        db.collection('reconciliationReviews').where('snapshotId', '==', req.snapshotId).get(),
        db.collection('snapshotJobs').where('snapshotId', '==', req.snapshotId).get(),
      ]);
      if (!doc.exists) throw notFound('That snapshot');
      return {
        snapshot: { id: doc.id, ...doc.data() },
        versions: versions.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(b.id) - Number(a.id)),
        reviews: rows(reviews), jobs: rows(jobs).sort((a, b) => String((b as { startedAt?: string }).startedAt ?? '').localeCompare(String((a as { startedAt?: string }).startedAt ?? ''))).slice(0, 20),
      };
    }

    case 'jobs': {
      let q: Query = db.collection('snapshotJobs');
      if (req.status) q = q.where('status', '==', req.status);
      const p = await page(db, q.orderBy('startedAt', 'desc'), 'snapshotJobs', req.cursor);
      return { jobs: p.rows, cursor: p.cursor };
    }

    case 'reviews': {
      const s = await db.collection('reconciliationReviews').where('status', '==', req.status).orderBy('openedAt', 'desc').limit(100).get();
      return { reviews: rows(s) };
    }

    case 'invalidations': {
      const s = await db.collection('snapshotInvalidations').where('status', '==', 'pending').orderBy('createdAt', 'desc').limit(100).get();
      return { invalidations: rows(s) };
    }

    case 'run': {
      if (!isValidPeriodKey(req.periodType, req.periodKey)) throw invalid(`“${req.periodKey}” isn’t a valid ${req.periodType} period.`);
      const r = await runJob(db, { kind: 'generate', periodType: req.periodType, periodKey: req.periodKey, reason: 'Manual run' }, { trigger: 'manual', actorId: actor.id });
      await audit(db, actor, 'snapshot_run', `${req.periodType}_${req.periodKey}`, { jobId: r.jobId, status: r.status });
      if (r.status === 'failed' && r.errors.some((e) => e.scope === 'job')) throw conflict(r.errors[0].message);
      return r;
    }

    case 'run_scheduled': {
      const r = await runJob(db, { kind: 'scheduled' }, { trigger: 'manual', actorId: actor.id });
      await audit(db, actor, 'snapshot_run_scheduled', 'scheduled', { jobId: r.jobId, status: r.status });
      return r;
    }

    case 'retry': {
      const job = await db.doc(`snapshotJobs/${req.jobId}`).get();
      if (!job.exists) throw notFound('That job');
      const j = job.data() as JobSpec & { status: string };
      if (j.status !== 'failed') throw conflict('Only failed jobs can be retried.');
      const spec: JobSpec = { kind: j.kind, ...(j.periodType ? { periodType: j.periodType } : {}), ...(j.periodKey ? { periodKey: j.periodKey } : {}), ...(j.snapshotId ? { snapshotId: j.snapshotId } : {}), reason: `Retry of ${req.jobId}` };
      const r = await runJob(db, spec, { trigger: 'retry', actorId: actor.id, retryOf: req.jobId });
      await job.ref.update({ retriedBy: r.jobId });
      await audit(db, actor, 'snapshot_retry', req.jobId, { jobId: r.jobId, status: r.status });
      return r;
    }

    case 'recalculate': {
      if (!(await db.doc(`reportSnapshots/${req.snapshotId}`).get()).exists) throw notFound('That snapshot');
      const r = await runJob(db, { kind: 'recalculate', snapshotId: req.snapshotId, reason: req.reason }, { trigger: 'manual', actorId: actor.id });
      await audit(db, actor, 'snapshot_recalculate', req.snapshotId, { jobId: r.jobId, status: r.status, reason: req.reason });
      return r;
    }

    case 'reconcile': {
      if (!(await db.doc(`reportSnapshots/${req.snapshotId}`).get()).exists) throw notFound('That snapshot');
      const r = await runJob(db, { kind: 'reconcile', snapshotId: req.snapshotId }, { trigger: 'manual', actorId: actor.id });
      await audit(db, actor, 'snapshot_reconcile', req.snapshotId, { jobId: r.jobId, status: r.status });
      return r;
    }

    case 'apply_invalidations': {
      const r = await applyInvalidations(db);
      await audit(db, actor, 'snapshot_apply_invalidations', 'invalidations', r);
      return r;
    }

    case 'resolve_review': {
      const ref = db.doc(`reconciliationReviews/${req.reviewId}`);
      return db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) throw notFound('That review');
        if (s.data()!.status === 'resolved') throw conflict('It is already resolved.');
        tx.update(ref, { status: 'resolved', resolvedAt: new Date().toISOString(), resolvedById: actor.id, resolutionNote: req.note });
        tx.create(db.collection('auditLog').doc(), { orgId: actor.orgId, courseId: null, targetType: 'reconciliation_review', targetId: req.reviewId, action: 'reconciliation_review_resolve', actorId: actor.id, actorRole: actor.role, reason: req.note, at: FieldValue.serverTimestamp() });
        return { ok: true };
      });
    }
  }
}

/**
 * Strynkix LMS — Analytics loaders.
 * Every query is batch-scoped (orgId + batchId equality), the same shape the
 * rules use to prove access, so each role only ever aggregates what it can read.
 */

import { collection, Firestore, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { TenantContext } from '@/types/auth';
import { Assignment, Batch } from '@/types/domain';
import { getBatchEnrollments, getBatchesForTenant, getBatchProgress } from '@/lib/batches/service';
import { getBatchPlans, normalizeSubmission } from '@/lib/learning/service';
import { BatchData } from './metrics';

/** Upper bound on batches aggregated in one report, to keep reads predictable. */
export const ANALYTICS_BATCH_LIMIT = 20;
const PER_BATCH_LIMIT = 500;

export async function getBatchAssignments(batch: Batch, fs: Firestore = db): Promise<Assignment[]> {
  const snap = await getDocs(
    query(collection(fs, 'assignments'), where('orgId', '==', batch.orgId), where('batchId', '==', batch.id), limit(PER_BATCH_LIMIT))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Assignment));
}

export async function getBatchSubmissions(batch: Batch, fs: Firestore = db) {
  const snap = await getDocs(
    query(collection(fs, 'submissions'), where('orgId', '==', batch.orgId), where('batchId', '==', batch.id), limit(PER_BATCH_LIMIT))
  );
  return snap.docs.map((d) => normalizeSubmission(d.id, d.data()));
}

export async function loadBatchData(batch: Batch): Promise<BatchData> {
  const [enrollments, plans, assignments, submissions, progress] = await Promise.all([
    getBatchEnrollments(batch),
    getBatchPlans(batch),
    getBatchAssignments(batch),
    getBatchSubmissions(batch),
    getBatchProgress(batch).catch(() => []),
  ]);
  return { batch, enrollments, plans, assignments, submissions, progress };
}

/**
 * Loads analytics input for the caller's batches. Archived/cancelled batches are
 * excluded unless `includeClosed` is set. Batches that fail to load are reported
 * by name instead of silently disappearing.
 */
export async function loadAnalyticsData(
  tenant: TenantContext,
  uid: string,
  opts: { includeClosed?: boolean; branchId?: string } = {}
): Promise<{ data: BatchData[]; failed: string[]; truncated: boolean; all: Batch[] }> {
  const all = await getBatchesForTenant(tenant, uid);
  const inScope = all.filter(
    (b) =>
      (opts.includeClosed || !['archived', 'cancelled'].includes(b.status)) &&
      (!opts.branchId || b.branchId === opts.branchId)
  );
  const picked = inScope.slice(0, ANALYTICS_BATCH_LIMIT);
  const settled = await Promise.allSettled(picked.map(loadBatchData));
  const data: BatchData[] = [];
  const failed: string[] = [];
  settled.forEach((r, i) => (r.status === 'fulfilled' ? data.push(r.value) : failed.push(picked[i].name)));
  return { data, failed, truncated: inScope.length > picked.length, all };
}

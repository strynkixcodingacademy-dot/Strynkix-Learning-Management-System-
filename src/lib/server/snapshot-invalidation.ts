import 'server-only';

/**
 * Strynkix LMS — records that a write changed closed reporting periods
 * (Stage 9). Called inside the write's own transaction, after its reads, so
 * the invalidation exists exactly when the change was committed. Snapshot
 * jobs later mark the affected snapshots stale (src/lib/server/snapshots.ts).
 * `toDate` null = from this date onward (e.g. period-end balances).
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { localDate } from '@/lib/server/academy-scope';

export function recordInvalidation(tx: Transaction, db: Firestore, inv: { orgId: string; branchId: string | null; fromDate: string; toDate: string | null; reason: string; sourceType: string; sourceId: string }): void {
  if (inv.fromDate >= localDate()) return; // only closed periods need recalculation
  tx.create(db.collection('snapshotInvalidations').doc(), { ...inv, status: 'pending', createdAt: new Date().toISOString() });
}

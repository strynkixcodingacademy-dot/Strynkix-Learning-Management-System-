/**
 * Strynkix LMS — Stage 6 Enrollment Migration Applier
 *
 * Applies a MigrationPlan with one transaction per action. Every action is
 * idempotent: re-running a plan skips work already done and reports conflicts
 * instead of overwriting. Writes bypass security rules, so callers must use a
 * trusted context. This module is exercised against the Firestore emulator; a
 * production run requires a separately approved Admin SDK port (see
 * docs/ENROLLMENT_MIGRATION.md).
 */

import { doc, Firestore, runTransaction, setDoc } from 'firebase/firestore';
import type { MigrationAction, MigrationPlan } from './enrollment-migration';

export const MIGRATION_ACTOR_ID = 'system_stage6_migration';

export type ActionOutcome =
  | 'created'
  | 'archived'
  | 'retagged'
  | 'skipped_already_done'
  | 'skipped_source_missing'
  | 'conflict';

export interface ActionResult {
  action: MigrationAction['type'];
  targetId: string;
  outcome: ActionOutcome;
  detail?: string;
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

async function applyAction(db: Firestore, action: MigrationAction, runId: string, now: string): Promise<ActionResult> {
  switch (action.type) {
    case 'create_enrollment':
      return runTransaction(db, async (tx) => {
        const ref = doc(db, 'enrollments', action.enrollmentId);
        const existing = await tx.get(ref);
        if (existing.exists()) {
          const same = existing.data().batchId === action.batchId;
          return {
            action: action.type,
            targetId: action.enrollmentId,
            outcome: same ? 'skipped_already_done' : 'conflict',
            detail: same ? undefined : 'canonical enrollment exists with a different batch',
          };
        }
        // Roster snapshot must match the profile so later admin updates pass rules.
        const student = await tx.get(doc(db, 'users', action.studentId));
        if (!student.exists()) {
          return { action: action.type, targetId: action.enrollmentId, outcome: 'conflict', detail: 'student profile missing' };
        }
        tx.set(
          ref,
          withoutUndefined({
            id: action.enrollmentId,
            orgId: action.orgId,
            branchId: action.branchId,
            courseId: action.courseId,
            batchId: action.batchId,
            studentId: action.studentId,
            status: action.status,
            enrolledAt: action.enrolledAt ?? now,
            completedAt: action.completedAt,
            studentDisplayName: student.data().displayName ?? '',
            studentEmail: student.data().email ?? '',
            enrolledById: MIGRATION_ACTOR_ID,
            createdAt: now,
            updatedAt: now,
          })
        );
        return { action: action.type, targetId: action.enrollmentId, outcome: 'created' };
      });

    case 'archive_legacy_enrollment':
      return runTransaction(db, async (tx) => {
        const legacyRef = doc(db, 'enrollments', action.legacyEnrollmentId);
        const legacy = await tx.get(legacyRef);
        if (!legacy.exists()) {
          return { action: action.type, targetId: action.legacyEnrollmentId, outcome: 'skipped_already_done' };
        }
        // Never remove a legacy record before its canonical replacement exists.
        const canonical = await tx.get(doc(db, 'enrollments', action.canonicalEnrollmentId));
        if (!canonical.exists()) {
          return {
            action: action.type,
            targetId: action.legacyEnrollmentId,
            outcome: 'conflict',
            detail: 'canonical enrollment missing; legacy record kept',
          };
        }
        tx.set(doc(db, 'enrollmentLegacyArchive', action.legacyEnrollmentId), {
          ...legacy.data(),
          archivedAt: now,
          archivedByRunId: runId,
          canonicalEnrollmentId: action.canonicalEnrollmentId,
        });
        tx.delete(legacyRef);
        return { action: action.type, targetId: action.legacyEnrollmentId, outcome: 'archived' };
      });

    case 'retag_progress':
      return runTransaction(db, async (tx) => {
        const ref = doc(db, 'progress', action.progressId);
        const progress = await tx.get(ref);
        if (!progress.exists()) {
          return { action: action.type, targetId: action.progressId, outcome: 'skipped_source_missing' };
        }
        const current = progress.data().batchId;
        if (current === action.batchId) {
          return { action: action.type, targetId: action.progressId, outcome: 'skipped_already_done' };
        }
        if (current) {
          return { action: action.type, targetId: action.progressId, outcome: 'conflict', detail: 'progress tagged with another batch' };
        }
        tx.update(ref, { batchId: action.batchId });
        return { action: action.type, targetId: action.progressId, outcome: 'retagged' };
      });
  }
}

/**
 * Applies the plan sequentially (creates precede the archives that depend on
 * them) and stores an ID-only audit record at /migrationAudit/{runId}.
 */
export async function applyEnrollmentMigration(
  db: Firestore,
  plan: MigrationPlan,
  runId: string,
  now: string = new Date().toISOString()
): Promise<ActionResult[]> {
  const ordered = [
    ...plan.actions.filter((a) => a.type === 'create_enrollment'),
    ...plan.actions.filter((a) => a.type === 'archive_legacy_enrollment'),
    ...plan.actions.filter((a) => a.type === 'retag_progress'),
  ];

  const results: ActionResult[] = [];
  for (const action of ordered) {
    results.push(await applyAction(db, action, runId, now));
  }

  const outcomes: Record<string, number> = {};
  for (const r of results) outcomes[`${r.action}:${r.outcome}`] = (outcomes[`${r.action}:${r.outcome}`] ?? 0) + 1;

  await setDoc(doc(db, 'migrationAudit', runId), {
    runId,
    ranAt: now,
    actor: MIGRATION_ACTOR_ID,
    planSummary: plan.summary,
    outcomes,
    results: results.map((r) => withoutUndefined({ ...r })),
  });

  return results;
}

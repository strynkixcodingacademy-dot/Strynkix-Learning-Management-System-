/**
 * Stage 6.1 — Enrollment migration against the Firestore emulator:
 * apply, rules compatibility of migrated records, idempotency, and audit output.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { planEnrollmentMigration } from '@/lib/migration/enrollment-migration';
import { applyEnrollmentMigration } from '@/lib/migration/apply-enrollment-migration';
import { loadMigrationSnapshot } from '@/lib/migration/load-snapshot';

const NOW = '2026-10-01T00:00:00.000Z';
let testEnv: RulesTestEnvironment;

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

async function trusted<T>(fn: (db: Firestore) => Promise<T>): Promise<T> {
  let result: T;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    result = await fn(ctx.firestore() as unknown as Firestore);
  });
  return result!;
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'strynkix-lms-migration',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  await testEnv.clearFirestore();
  await trusted(async (db) => {
    const put = (p: string, data: Record<string, unknown>) => setDoc(doc(db, p), data);
    const user = (uid: string, role: string, branchId: string | null) =>
      put(`users/${uid}`, { role, orgId: 'strynkix', branchId, status: 'active', displayName: `Name ${uid}`, email: `${uid}@example.test` });
    await put('branches/branch_pune', { orgId: 'strynkix', status: 'active' });
    await user('ba_pune', 'branch_admin', 'branch_pune');
    await user('inst_pune', 'instructor', 'branch_pune');
    await user('stu_legacy', 'student', 'branch_pune');
    await user('stu_canon', 'student', 'branch_pune');
    await user('stu_unmapped', 'student', 'branch_pune');
    await put('courses/course_fs', { orgId: 'strynkix', status: 'published' });
    await put('lessons/les_1', { orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_1', status: 'published' });
    await put('batches/b_pune_fs', {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', name: 'Pune FS', code: 'PUN-FS',
      instructorUserIds: ['inst_pune'], startDate: NOW, status: 'in_progress',
    });
    // Legacy-format enrollment (pre-Stage 6 ID) and a legacy duplicate of a canonical record.
    await put('enrollments/b_pune_fs_stu_legacy', {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', batchId: 'b_pune_fs',
      studentId: 'stu_legacy', status: 'active', enrolledAt: '2026-08-01T00:00:00.000Z',
    });
    await put('enrollments/course_fs_stu_canon', {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', batchId: 'b_pune_fs',
      studentId: 'stu_canon', status: 'active', enrolledAt: NOW,
    });
    await put('enrollments/b_pune_fs_stu_canon', {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', batchId: 'b_pune_fs',
      studentId: 'stu_canon', status: 'active', enrolledAt: NOW,
    });
    // Pre-Stage 6 progress (no batchId) for the legacy student and an unmapped student.
    await put('progress/stu_legacy_course_fs_les_1', {
      orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_1', lessonId: 'les_1', studentId: 'stu_legacy',
      status: 'completed', timeSpentSeconds: 120,
    });
    await put('progress/stu_unmapped_course_fs_les_1', {
      orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_1', lessonId: 'les_1', studentId: 'stu_unmapped',
      status: 'in_progress', timeSpentSeconds: 60,
    });
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

describe('Stage 6.1 — enrollment migration on the emulator', () => {
  let firstPlan: ReturnType<typeof planEnrollmentMigration>;

  it('before migration: a legacy-enrolled student has no access under Stage 6 rules', async () => {
    await assertFails(getDoc(doc(as('stu_legacy'), 'lessons/les_1')));
  });

  it('dry run plans one enrollment, two archives, one progress tag, and one review item', async () => {
    firstPlan = planEnrollmentMigration(await trusted(loadMigrationSnapshot));
    expect(firstPlan.summary).toMatchObject({
      enrollmentsToCreate: 1,
      legacyEnrollmentsToArchive: 2,
      progressToRetag: 1,
      alreadyMigrated: 1,
      manualReview: 1,
    });
    expect(firstPlan.manualReview[0]).toMatchObject({ studentId: 'stu_unmapped', reason: 'progress_without_enrollment' });
  });

  it('apply writes rules-compatible records and keeps an audit trail', async () => {
    const results = await trusted((db) => applyEnrollmentMigration(db, firstPlan, 'run_1', NOW));
    expect(results.map((r) => `${r.action}:${r.outcome}`).sort()).toEqual([
      'archive_legacy_enrollment:archived',
      'archive_legacy_enrollment:archived',
      'create_enrollment:created',
      'retag_progress:retagged',
    ]);

    // Student now has access; instructor sees the retagged progress.
    await assertSucceeds(getDoc(doc(as('stu_legacy'), 'lessons/les_1')));
    const batchProgress = await assertSucceeds(getDocs(query(
      collection(as('inst_pune'), 'progress'),
      where('orgId', '==', 'strynkix'), where('batchId', '==', 'b_pune_fs'), where('courseId', '==', 'course_fs')
    )));
    expect(batchProgress.size).toBe(1);

    // Legacy records are gone from the live collection: one roster row per student.
    const roster = await assertSucceeds(getDocs(query(
      collection(as('ba_pune'), 'enrollments'),
      where('orgId', '==', 'strynkix'), where('branchId', '==', 'branch_pune'), where('batchId', '==', 'b_pune_fs')
    )));
    expect(roster.docs.map((d) => d.id).sort()).toEqual(['course_fs_stu_canon', 'course_fs_stu_legacy']);

    // A migrated record passes the Stage 6 update rules (admin can withdraw and reactivate it).
    await assertSucceeds(updateDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_legacy'), { status: 'dropped', updatedAt: NOW }));
    await assertSucceeds(updateDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_legacy'), { status: 'active', updatedAt: NOW }));
  });

  it('re-running the dry run finds nothing left to do (idempotent)', async () => {
    const second = planEnrollmentMigration(await trusted(loadMigrationSnapshot));
    expect(second.summary).toMatchObject({ enrollmentsToCreate: 0, legacyEnrollmentsToArchive: 0, progressToRetag: 0, alreadyMigrated: 2 });
  });

  it('re-applying the stale first plan changes nothing and reports no conflicts', async () => {
    const results = await trusted((db) => applyEnrollmentMigration(db, firstPlan, 'run_2', NOW));
    expect(results.every((r) => r.outcome === 'skipped_already_done')).toBe(true);
  });

  it('audit and archive records contain IDs only and are closed to clients', async () => {
    const audit = await trusted(async (db) => (await getDoc(doc(db, 'migrationAudit/run_1'))).data());
    expect(JSON.stringify(audit)).not.toMatch(/displayName|email|@example/);
    await assertFails(getDoc(doc(as('ba_pune'), 'migrationAudit/run_1')));
    await assertFails(getDoc(doc(as('ba_pune'), 'enrollmentLegacyArchive/b_pune_fs_stu_legacy')));
    const archived = await trusted(async (db) => (await getDoc(doc(db, 'enrollmentLegacyArchive/b_pune_fs_stu_legacy'))).data());
    expect(archived).toMatchObject({ archivedByRunId: 'run_1', canonicalEnrollmentId: 'course_fs_stu_legacy' });
  });
});

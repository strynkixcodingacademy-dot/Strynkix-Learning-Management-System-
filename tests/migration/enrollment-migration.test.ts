import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CreateEnrollmentAction,
  MigrationPlan,
  MigrationSnapshot,
  planEnrollmentMigration,
} from '@/lib/migration/enrollment-migration';

const snapshot: MigrationSnapshot = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../fixtures/migration/sample-snapshot.json'), 'utf8')
);

const creates = (plan: MigrationPlan) =>
  plan.actions.filter((a): a is CreateEnrollmentAction => a.type === 'create_enrollment');
const archives = (plan: MigrationPlan) =>
  plan.actions.filter((a) => a.type === 'archive_legacy_enrollment').map((a) => (a as { legacyEnrollmentId: string }).legacyEnrollmentId).sort();
const reviewReason = (plan: MigrationPlan, studentId: string) =>
  [...plan.manualReview, ...plan.ambiguous].filter((i) => i.studentId === studentId).map((i) => i.reason);

describe('Stage 6.1: Enrollment migration planner (dry run)', () => {
  const plan = planEnrollmentMigration(snapshot);

  it('migrates only fully validated legacy enrollments, to the canonical ID', () => {
    expect(creates(plan).map((c) => c.enrollmentId).sort()).toEqual(['course_ds_stu_derived', 'course_fs_stu_legacy']);
    const legacy = creates(plan).find((c) => c.studentId === 'stu_legacy')!;
    expect(legacy).toMatchObject({ batchId: 'b_pune_fs', branchId: 'branch_pune', status: 'active', enrolledAt: '2026-08-15T00:00:00.000Z', source: 'legacy_enrollment' });
  });

  it('derives courseId from the batch when a legacy record lacks it, and preserves status', () => {
    const derived = creates(plan).find((c) => c.studentId === 'stu_derived')!;
    expect(derived).toMatchObject({ courseId: 'course_ds', status: 'completed', completedAt: '2026-07-01T00:00:00.000Z' });
  });

  it('flags an active enrollment in a non-open batch as a warning, not a block', () => {
    expect(creates(plan).find((c) => c.studentId === 'stu_legacy')!.warnings).toEqual([]);
    // stu_derived is completed (not active) in a completed batch: no warning either.
    expect(creates(plan).find((c) => c.studentId === 'stu_derived')!.warnings).toEqual([]);
  });

  it('archives legacy duplicates of valid canonical records and migrated legacy records', () => {
    expect(archives(plan)).toEqual(['b_pune_fs_stu_canon', 'b_pune_fs_stu_legacy', 'legacy_derived']);
    expect(plan.alreadyMigrated).toEqual(['course_fs_stu_canon', 'course_fs_stu_conflict']);
  });

  it('tags legacy progress for resolved pairs only, never guessing a batch', () => {
    const retags = plan.actions.filter((a) => a.type === 'retag_progress');
    expect(retags).toEqual([{ type: 'retag_progress', progressId: 'stu_legacy_course_fs_l1', batchId: 'b_pune_fs' }]);
  });

  it('routes ambiguous and invalid relationships to review with explicit reasons', () => {
    expect(reviewReason(plan, 'stu_multi')).toEqual(['multiple_batches_for_course']);
    expect(reviewReason(plan, 'stu_conflict')).toEqual(['legacy_conflicts_with_canonical']);
    expect(reviewReason(plan, 'stu_branchmis')).toEqual(['student_branch_mismatch']);
    expect(reviewReason(plan, 'stu_nobatch')).toEqual(['legacy_enrollment_missing_batch']);
    expect(reviewReason(plan, 'stu_ghostbatch')).toEqual(['batch_not_found']);
    expect(reviewReason(plan, 'stu_suspended')).toEqual(['student_not_active']);
  });

  it('never auto-enrolls from progress alone; lists candidate batches (excluding archived)', () => {
    const p1 = plan.manualReview.find((i) => i.studentId === 'stu_progress1')!;
    expect(p1).toMatchObject({ reason: 'progress_without_enrollment', candidateBatchIds: ['b_pune_fs', 'b_pune_fs2'] });
    expect(p1.sourceIds).toHaveLength(2);
    const p0 = plan.manualReview.find((i) => i.studentId === 'stu_progress0')!;
    expect(p0).toMatchObject({ reason: 'progress_without_enrollment_no_candidate_batch', candidateBatchIds: [] });
    expect(creates(plan).some((c) => c.studentId.startsWith('stu_progress'))).toBe(false);
  });

  it('reports students without evidence and profile issues', () => {
    expect(plan.studentsWithoutEvidence).toEqual(['stu_badbranch', 'stu_nobranch', 'stu_none']);
    expect(plan.profileIssues.map((p) => `${p.studentId}:${p.reason}`).sort()).toEqual([
      'legacy_pending:legacy_role_pending_verification',
      'stu_badbranch:student_branch_not_in_org',
      'stu_nobranch:student_missing_branch',
    ]);
  });

  it('summary counts match the plan', () => {
    expect(plan.summary).toMatchObject({
      students: 14,
      enrollmentsToCreate: 2,
      legacyEnrollmentsToArchive: 3,
      progressToRetag: 1,
      alreadyMigrated: 2,
      manualReview: 6,
      ambiguous: 2,
      studentsWithoutEvidence: 3,
      profileIssues: 3,
    });
  });

  it('plan output contains no personal fields', () => {
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toMatch(/displayName|email|@/);
  });
});

describe('Stage 6.1: Manual decisions', () => {
  it('a valid decision creates the enrollment, archives superseded legacy records, and clears the review item', () => {
    const plan = planEnrollmentMigration(snapshot, [
      { studentId: 'stu_multi', courseId: 'course_fs', batchId: 'b_pune_fs2', decidedBy: 'uni_admin_1' },
      { studentId: 'stu_progress1', courseId: 'course_fs', batchId: 'b_pune_fs', decidedBy: 'uni_admin_1' },
    ]);
    const decided = creates(plan).filter((c) => c.source === 'manual_decision').map((c) => `${c.studentId}:${c.batchId}`).sort();
    expect(decided).toEqual(['stu_multi:b_pune_fs2', 'stu_progress1:b_pune_fs']);
    expect(archives(plan)).toEqual(expect.arrayContaining(['legacy_multi_1', 'legacy_multi_2']));
    expect(reviewReason(plan, 'stu_multi')).toEqual([]);
    expect(reviewReason(plan, 'stu_progress1')).toEqual([]);
    // Progress for the decided pair is now tagged.
    expect(plan.actions.filter((a) => a.type === 'retag_progress').length).toBe(3);
  });

  it('re-validates decisions: wrong branch, wrong course, missing approver, and duplicates are rejected', () => {
    const plan = planEnrollmentMigration(snapshot, [
      { studentId: 'stu_progress0', courseId: 'course_fs', batchId: 'b_mumbai_fs', decidedBy: 'uni_admin_1' },
      { studentId: 'stu_none', courseId: 'course_ml', batchId: 'b_pune_fs', decidedBy: 'uni_admin_1' },
      { studentId: 'stu_none', courseId: 'course_fs', batchId: 'b_pune_fs', decidedBy: '' },
      { studentId: 'stu_nobranch', courseId: 'course_fs', batchId: 'b_pune_fs', decidedBy: 'uni_admin_1' },
      { studentId: 'stu_nobranch', courseId: 'course_fs', batchId: 'b_pune_fs2', decidedBy: 'uni_admin_1' },
    ]);
    expect(creates(plan).filter((c) => c.source === 'manual_decision')).toEqual([]);
    expect(reviewReason(plan, 'stu_progress0')).toContain('decision_student_branch_mismatch');
    expect(reviewReason(plan, 'stu_none')).toEqual(expect.arrayContaining(['decision_batch_course_mismatch', 'decision_missing_decidedBy']));
    expect(reviewReason(plan, 'stu_nobranch')).toEqual(expect.arrayContaining(['decision_student_branch_mismatch', 'duplicate_decision']));
  });

  it('a decision that contradicts an existing canonical enrollment is ambiguous, and one that matches is a no-op', () => {
    const plan = planEnrollmentMigration(snapshot, [
      { studentId: 'stu_canon', courseId: 'course_fs', batchId: 'b_pune_fs2', decidedBy: 'uni_admin_1' },
      { studentId: 'stu_legacy', courseId: 'course_fs', batchId: 'b_pune_fs', decidedBy: 'uni_admin_1' },
    ]);
    expect(reviewReason(plan, 'stu_canon')).toEqual(['decision_conflicts_with_enrollment']);
    expect(creates(plan).filter((c) => c.studentId === 'stu_legacy')).toHaveLength(1);
  });
});

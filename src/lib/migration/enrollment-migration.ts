/**
 * Strynkix LMS — Stage 6 Enrollment Migration Planner (pure, no I/O)
 *
 * Stage 6 rules grant course access only through an enrollment stored at the
 * deterministic ID `{courseId}_{studentId}`. This planner inspects existing data
 * and decides, without guessing, what can be migrated:
 *
 *  - A legacy enrollment (any other ID) whose batch, course, org, branch and
 *    student all validate is migrated to the canonical ID.
 *  - Anything ambiguous or failing validation goes to manual review with a reason.
 *  - Progress without an enrollment is evidence a student studied a course, but
 *    not of which batch: it is ALWAYS manual review, even with one candidate batch.
 *  - Humans resolve review items through explicit decisions, which are
 *    re-validated exactly like legacy enrollments.
 *
 * Output contains document IDs only — no names or emails.
 */

import { enrollmentIdFor } from '@/lib/batches/scope';

export interface SnapshotUser {
  id: string;
  role?: string;
  orgId?: string;
  branchId?: string | null;
  status?: string;
}
export interface SnapshotCourse {
  id: string;
  orgId?: string;
  status?: string;
}
export interface SnapshotBatch {
  id: string;
  orgId?: string;
  branchId?: string;
  courseId?: string;
  status?: string;
}
export interface SnapshotEnrollment {
  id: string;
  orgId?: string;
  branchId?: string;
  courseId?: string;
  batchId?: string;
  studentId?: string;
  status?: string;
  enrolledAt?: string;
  completedAt?: string;
}
export interface SnapshotProgress {
  id: string;
  orgId?: string;
  studentId?: string;
  courseId?: string;
  batchId?: string;
}

export interface SnapshotBranch {
  id: string;
  orgId?: string;
}

export interface MigrationSnapshot {
  users: SnapshotUser[];
  branches?: SnapshotBranch[];
  courses: SnapshotCourse[];
  batches: SnapshotBatch[];
  enrollments: SnapshotEnrollment[];
  progress: SnapshotProgress[];
}

/** A human decision resolving a manual-review item. */
export interface ManualDecision {
  studentId: string;
  courseId: string;
  batchId: string;
  decidedBy: string;
  note?: string;
}

export type EnrollmentStatusValue = 'active' | 'completed' | 'dropped' | 'suspended';

export interface CreateEnrollmentAction {
  type: 'create_enrollment';
  enrollmentId: string;
  orgId: string;
  branchId: string;
  courseId: string;
  batchId: string;
  studentId: string;
  status: EnrollmentStatusValue;
  enrolledAt?: string;
  completedAt?: string;
  source: 'legacy_enrollment' | 'manual_decision';
  sourceIds: string[];
  warnings: string[];
}

export interface ArchiveLegacyAction {
  type: 'archive_legacy_enrollment';
  legacyEnrollmentId: string;
  canonicalEnrollmentId: string;
}

export interface RetagProgressAction {
  type: 'retag_progress';
  progressId: string;
  batchId: string;
}

export type MigrationAction = CreateEnrollmentAction | ArchiveLegacyAction | RetagProgressAction;

export interface ReviewItem {
  studentId: string;
  courseId?: string;
  reason: string;
  sourceIds: string[];
  candidateBatchIds?: string[];
}

export interface MigrationPlan {
  actions: MigrationAction[];
  alreadyMigrated: string[];
  manualReview: ReviewItem[];
  ambiguous: ReviewItem[];
  studentsWithoutEvidence: string[];
  profileIssues: ReviewItem[];
  summary: {
    students: number;
    enrollmentsToCreate: number;
    legacyEnrollmentsToArchive: number;
    progressToRetag: number;
    alreadyMigrated: number;
    manualReview: number;
    ambiguous: number;
    studentsWithoutEvidence: number;
    profileIssues: number;
    reasons: Record<string, number>;
  };
}

const ENROLLMENT_STATUSES: EnrollmentStatusValue[] = ['active', 'completed', 'dropped', 'suspended'];
const ACCESS_STATUSES = new Set<string>(['active', 'completed']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

interface Indexes {
  users: Map<string, SnapshotUser>;
  courses: Map<string, SnapshotCourse>;
  batches: Map<string, SnapshotBatch>;
}

/**
 * Validates a (student, course, batch) relationship against authoritative
 * records. Returns a reason code, or null if valid.
 */
function relationshipError(
  idx: Indexes,
  studentId: string,
  courseId: string,
  batchId: string,
  claimedOrgId?: string
): string | null {
  const batch = idx.batches.get(batchId);
  if (!batch) return 'batch_not_found';
  const course = idx.courses.get(courseId);
  if (!course) return 'course_not_found';
  if (batch.courseId !== courseId) return 'batch_course_mismatch';
  if (!batch.orgId || batch.orgId !== course.orgId) return 'batch_course_org_mismatch';
  if (claimedOrgId && claimedOrgId !== batch.orgId) return 'enrollment_org_mismatch';
  const student = idx.users.get(studentId);
  if (!student) return 'student_not_found';
  if (student.role !== 'student') return 'not_a_student';
  if (student.orgId !== batch.orgId) return 'student_org_mismatch';
  if (!student.branchId || student.branchId !== batch.branchId) return 'student_branch_mismatch';
  if ((student.status ?? 'active') !== 'active') return 'student_not_active';
  return null;
}

function keyOf(studentId: string, courseId: string) {
  return `${studentId}\u0000${courseId}`;
}

export function planEnrollmentMigration(
  snapshot: MigrationSnapshot,
  decisions: ManualDecision[] = []
): MigrationPlan {
  const idx: Indexes = {
    users: new Map(snapshot.users.map((u) => [u.id, u])),
    courses: new Map(snapshot.courses.map((c) => [c.id, c])),
    batches: new Map(snapshot.batches.map((b) => [b.id, b])),
  };

  const actions: MigrationAction[] = [];
  const alreadyMigrated: string[] = [];
  const manualReview: ReviewItem[] = [];
  const ambiguous: ReviewItem[] = [];
  const profileIssues: ReviewItem[] = [];

  /** Batch each (student, course) resolves to, for progress retagging. */
  const resolvedBatch = new Map<string, string>();
  /** (student, course) pairs with any enrollment evidence or decision. */
  const covered = new Set<string>();

  // ---------------------------------------------------------------------------
  // 1. Partition enrollments into canonical and legacy, grouped by (student, course).
  // ---------------------------------------------------------------------------
  const canonicalByKey = new Map<string, SnapshotEnrollment>();
  const legacyByKey = new Map<string, SnapshotEnrollment[]>();
  /** Every legacy enrollment per pair, kept for archiving after a manual decision. */
  const legacyIdsByKey = new Map<string, string[]>();
  const archivedLegacyIds = new Set<string>();

  for (const e of snapshot.enrollments) {
    // A batch fully determines its course, so deriving courseId from it is not a guess.
    const courseId = e.courseId || (e.batchId ? idx.batches.get(e.batchId)?.courseId : undefined);
    if (!e.studentId || !courseId) {
      manualReview.push({
        studentId: e.studentId || '(missing)',
        reason: !e.studentId ? 'enrollment_missing_student' : 'enrollment_course_unresolvable',
        sourceIds: [e.id],
      });
      continue;
    }
    const key = keyOf(e.studentId, courseId);
    covered.add(key);
    if (e.id === enrollmentIdFor(courseId, e.studentId) && e.courseId === courseId) {
      canonicalByKey.set(key, e);
    } else {
      legacyByKey.set(key, [...(legacyByKey.get(key) ?? []), { ...e, courseId }]);
      legacyIdsByKey.set(key, [...(legacyIdsByKey.get(key) ?? []), e.id]);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Canonical enrollments: already migrated, but re-validated.
  // ---------------------------------------------------------------------------
  for (const [key, e] of canonicalByKey) {
    const error = e.batchId
      ? relationshipError(idx, e.studentId!, e.courseId!, e.batchId, e.orgId)
      : 'enrollment_missing_batch';
    if (error && error !== 'student_not_active') {
      manualReview.push({ studentId: e.studentId!, courseId: e.courseId, reason: `canonical_${error}`, sourceIds: [e.id] });
      continue;
    }
    alreadyMigrated.push(e.id);
    resolvedBatch.set(key, e.batchId!);

    for (const legacy of legacyByKey.get(key) ?? []) {
      if (legacy.batchId === e.batchId) {
        actions.push({ type: 'archive_legacy_enrollment', legacyEnrollmentId: legacy.id, canonicalEnrollmentId: e.id });
        archivedLegacyIds.add(legacy.id);
      } else {
        ambiguous.push({
          studentId: e.studentId!,
          courseId: e.courseId,
          reason: 'legacy_conflicts_with_canonical',
          sourceIds: [e.id, legacy.id],
        });
      }
    }
    legacyByKey.delete(key);
  }

  // ---------------------------------------------------------------------------
  // 3. Legacy-only enrollments.
  // ---------------------------------------------------------------------------
  for (const [key, group] of legacyByKey) {
    const { studentId, courseId } = group[0] as Required<Pick<SnapshotEnrollment, 'studentId' | 'courseId'>>;
    const ids = group.map((g) => g.id);

    // Prefer records that currently grant access; fall back to inactive history.
    const granting = group.filter((g) => ACCESS_STATUSES.has(g.status ?? ''));
    const pool = granting.length > 0 ? granting : group;
    const batchIds = [...new Set(pool.map((g) => g.batchId).filter((b): b is string => Boolean(b)))];

    if (batchIds.length === 0) {
      manualReview.push({ studentId, courseId, reason: 'legacy_enrollment_missing_batch', sourceIds: ids });
      continue;
    }
    if (batchIds.length > 1) {
      ambiguous.push({ studentId, courseId, reason: 'multiple_batches_for_course', sourceIds: ids, candidateBatchIds: batchIds });
      continue;
    }

    const chosen = pool.find((g) => g.batchId === batchIds[0])!;
    const error = relationshipError(idx, studentId, courseId, batchIds[0], chosen.orgId);
    if (error) {
      manualReview.push({ studentId, courseId, reason: error, sourceIds: ids });
      continue;
    }

    const status = ENROLLMENT_STATUSES.includes(chosen.status as EnrollmentStatusValue)
      ? (chosen.status as EnrollmentStatusValue)
      : null;
    if (!status) {
      manualReview.push({ studentId, courseId, reason: 'legacy_unknown_status', sourceIds: ids });
      continue;
    }

    const batch = idx.batches.get(batchIds[0])!;
    const warnings: string[] = [];
    if (status === 'active' && !['upcoming', 'in_progress'].includes(batch.status ?? '')) {
      warnings.push(`active_enrollment_in_${batch.status ?? 'unknown'}_batch`);
    }
    const canonicalId = enrollmentIdFor(courseId, studentId);
    actions.push({
      type: 'create_enrollment',
      enrollmentId: canonicalId,
      orgId: batch.orgId!,
      branchId: batch.branchId!,
      courseId,
      batchId: batch.id,
      studentId,
      status,
      enrolledAt: chosen.enrolledAt && ISO.test(chosen.enrolledAt) ? chosen.enrolledAt : undefined,
      completedAt: chosen.completedAt && ISO.test(chosen.completedAt) ? chosen.completedAt : undefined,
      source: 'legacy_enrollment',
      sourceIds: ids,
      warnings,
    });
    for (const legacyId of ids) {
      actions.push({ type: 'archive_legacy_enrollment', legacyEnrollmentId: legacyId, canonicalEnrollmentId: canonicalId });
      archivedLegacyIds.add(legacyId);
    }
    resolvedBatch.set(key, batch.id);
  }

  // ---------------------------------------------------------------------------
  // 4. Manual decisions (explicit human mappings), re-validated.
  // ---------------------------------------------------------------------------
  const decidedKeys = new Set<string>();
  const decisionCreatedKeys = new Set<string>();
  for (const d of decisions) {
    const key = keyOf(d.studentId, d.courseId);
    const sourceIds = [`decision:${d.studentId}:${d.courseId}`];
    if (!d.decidedBy) {
      manualReview.push({ studentId: d.studentId, courseId: d.courseId, reason: 'decision_missing_decidedBy', sourceIds });
      continue;
    }
    if (decidedKeys.has(key)) {
      ambiguous.push({ studentId: d.studentId, courseId: d.courseId, reason: 'duplicate_decision', sourceIds });
      continue;
    }
    decidedKeys.add(key);
    covered.add(key);

    const existingBatch = resolvedBatch.get(key);
    if (existingBatch) {
      if (existingBatch !== d.batchId) {
        ambiguous.push({ studentId: d.studentId, courseId: d.courseId, reason: 'decision_conflicts_with_enrollment', sourceIds });
      }
      continue; // Same batch: already handled; idempotent.
    }

    const error = relationshipError(idx, d.studentId, d.courseId, d.batchId);
    if (error) {
      manualReview.push({ studentId: d.studentId, courseId: d.courseId, reason: `decision_${error}`, sourceIds });
      continue;
    }
    const batch = idx.batches.get(d.batchId)!;
    const canonicalId = enrollmentIdFor(d.courseId, d.studentId);
    actions.push({
      type: 'create_enrollment',
      enrollmentId: canonicalId,
      orgId: batch.orgId!,
      branchId: batch.branchId!,
      courseId: d.courseId,
      batchId: d.batchId,
      studentId: d.studentId,
      status: 'active',
      source: 'manual_decision',
      sourceIds,
      warnings: ['upcoming', 'in_progress'].includes(batch.status ?? '') ? [] : [`active_enrollment_in_${batch.status ?? 'unknown'}_batch`],
    });
    // Legacy records the decision supersedes are archived so rosters show one row.
    for (const legacyId of legacyIdsByKey.get(key) ?? []) {
      if (archivedLegacyIds.has(legacyId)) continue;
      actions.push({ type: 'archive_legacy_enrollment', legacyEnrollmentId: legacyId, canonicalEnrollmentId: canonicalId });
      archivedLegacyIds.add(legacyId);
    }
    resolvedBatch.set(key, d.batchId);
    decisionCreatedKeys.add(key);
  }

  // Drop non-decision review items that a valid decision has since resolved.
  const isDecisionItem = (item: ReviewItem) => item.sourceIds.some((id) => id.startsWith('decision:'));
  const resolvedByDecision = (item: ReviewItem) =>
    !isDecisionItem(item) &&
    item.courseId !== undefined &&
    decisionCreatedKeys.has(keyOf(item.studentId, item.courseId));
  const remainingReview = manualReview.filter((i) => !resolvedByDecision(i));
  const remainingAmbiguous = ambiguous.filter((i) => !resolvedByDecision(i));

  // ---------------------------------------------------------------------------
  // 5. Progress: retag for resolved pairs; progress-only pairs need review.
  // ---------------------------------------------------------------------------
  const progressOnly = new Map<string, string[]>();
  for (const p of snapshot.progress) {
    if (!p.studentId || !p.courseId) continue;
    const key = keyOf(p.studentId, p.courseId);
    const batchId = resolvedBatch.get(key);
    if (batchId) {
      if (!p.batchId) actions.push({ type: 'retag_progress', progressId: p.id, batchId });
      else if (p.batchId !== batchId) {
        remainingReview.push({ studentId: p.studentId, courseId: p.courseId, reason: 'progress_batch_differs_from_enrollment', sourceIds: [p.id] });
      }
    } else if (!covered.has(key)) {
      progressOnly.set(key, [...(progressOnly.get(key) ?? []), p.id]);
    }
  }
  for (const [key, ids] of progressOnly) {
    const [studentId, courseId] = key.split('\u0000');
    const student = idx.users.get(studentId);
    const candidates = snapshot.batches
      .filter(
        (b) =>
          b.courseId === courseId &&
          b.status !== 'archived' &&
          student?.branchId &&
          b.branchId === student.branchId &&
          b.orgId === student.orgId
      )
      .map((b) => b.id);
    remainingReview.push({
      studentId,
      courseId,
      reason: candidates.length === 0 ? 'progress_without_enrollment_no_candidate_batch' : 'progress_without_enrollment',
      sourceIds: ids,
      candidateBatchIds: candidates,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Students with no evidence at all, and profiles that need attention.
  // ---------------------------------------------------------------------------
  const students = snapshot.users.filter((u) => u.role === 'student');
  const studentsWithEvidence = new Set<string>();
  for (const key of [...covered, ...progressOnly.keys()]) studentsWithEvidence.add(key.split('\u0000')[0]);
  const studentsWithoutEvidence = students
    .filter((s) => (s.status ?? 'active') === 'active' && !studentsWithEvidence.has(s.id))
    .map((s) => s.id)
    .sort();

  // Profiles that cannot be enrolled as-is. Branch checks run only when branch
  // records are part of the snapshot.
  const branches = snapshot.branches ? new Map(snapshot.branches.map((b) => [b.id, b])) : null;
  for (const u of snapshot.users) {
    if (u.role === 'pending_verification') {
      // Written by the pre-Stage 6 self-signup rule, which accepted this as a role.
      profileIssues.push({ studentId: u.id, reason: 'legacy_role_pending_verification', sourceIds: [u.id] });
    } else if (u.role === 'student' && !u.branchId) {
      profileIssues.push({ studentId: u.id, reason: 'student_missing_branch', sourceIds: [u.id] });
    } else if (u.role === 'student' && branches && branches.get(u.branchId!)?.orgId !== u.orgId) {
      profileIssues.push({ studentId: u.id, reason: 'student_branch_not_in_org', sourceIds: [u.id] });
    }
  }

  const reasons: Record<string, number> = {};
  for (const item of [...remainingReview, ...remainingAmbiguous, ...profileIssues]) {
    reasons[item.reason] = (reasons[item.reason] ?? 0) + 1;
  }

  return {
    actions,
    alreadyMigrated: alreadyMigrated.sort(),
    manualReview: remainingReview,
    ambiguous: remainingAmbiguous,
    studentsWithoutEvidence,
    profileIssues,
    summary: {
      students: students.length,
      enrollmentsToCreate: actions.filter((a) => a.type === 'create_enrollment').length,
      legacyEnrollmentsToArchive: actions.filter((a) => a.type === 'archive_legacy_enrollment').length,
      progressToRetag: actions.filter((a) => a.type === 'retag_progress').length,
      alreadyMigrated: alreadyMigrated.length,
      manualReview: remainingReview.length,
      ambiguous: remainingAmbiguous.length,
      studentsWithoutEvidence: studentsWithoutEvidence.length,
      profileIssues: profileIssues.length,
      reasons,
    },
  };
}

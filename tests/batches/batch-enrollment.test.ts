import { describe, it, expect } from 'vitest';
import { batchSchema, batchUpdateSchema, enrollmentSchema } from '@/types/validation';
import {
  canManageBatchScope,
  enrollmentIdFor,
  getInstructorAssignmentError,
  getStudentEnrollmentError,
  grantsContentAccess,
  isBatchOpenForEnrollment,
} from '@/lib/batches/scope';
import { buildRosterProgress } from '@/lib/batches/roster';
import { Enrollment, Progress } from '@/types/domain';

const validBatch = {
  orgId: 'strynkix',
  branchId: 'branch_pune',
  courseId: 'course_fs',
  name: 'Full Stack Alpha 2026',
  code: 'fsa-26',
  instructorUserIds: ['inst_1'],
  startDate: '2026-11-01T00:00:00.000Z',
  endDate: '2027-03-01T00:00:00.000Z',
  maxStudents: 30,
};

describe('Stage 6: Batch schema', () => {
  it('accepts a valid batch and normalizes the code to uppercase', () => {
    const result = batchSchema.safeParse(validBatch);
    expect(result.success).toBe(true);
    expect(result.success && result.data.code).toBe('FSA-26');
    expect(result.success && result.data.status).toBe('upcoming');
  });

  it('rejects an end date before the start date', () => {
    expect(batchSchema.safeParse({ ...validBatch, endDate: '2026-01-01T00:00:00.000Z' }).success).toBe(false);
  });

  it('rejects more than 5 instructors and duplicate instructors', () => {
    expect(
      batchSchema.safeParse({ ...validBatch, instructorUserIds: ['a', 'b', 'c', 'd', 'e', 'f'] }).success
    ).toBe(false);
    expect(batchSchema.safeParse({ ...validBatch, instructorUserIds: ['a', 'a'] }).success).toBe(false);
  });

  it('rejects out-of-range capacity, unknown status, and malformed IDs', () => {
    expect(batchSchema.safeParse({ ...validBatch, maxStudents: 0 }).success).toBe(false);
    expect(batchSchema.safeParse({ ...validBatch, maxStudents: 201 }).success).toBe(false);
    expect(batchSchema.safeParse({ ...validBatch, status: 'open' }).success).toBe(false);
    expect(batchSchema.safeParse({ ...validBatch, courseId: '../courses/x' }).success).toBe(false);
  });

  it('accepts archived as a batch status', () => {
    expect(batchSchema.safeParse({ ...validBatch, status: 'archived' }).success).toBe(true);
  });

  it('update schema strips immutable fields (orgId, branchId, courseId)', () => {
    const result = batchUpdateSchema.safeParse({ name: 'Renamed', orgId: 'rival', branchId: 'x', courseId: 'y' });
    expect(result.success).toBe(true);
    expect(result.success && Object.keys(result.data)).toEqual(['name']);
  });

  it('a status-only update (archive) does not reset instructors or other fields via defaults', () => {
    const result = batchUpdateSchema.safeParse({ status: 'archived' });
    expect(result.success && result.data).toEqual({ status: 'archived' });
  });

  it('update schema enforces date ordering', () => {
    expect(
      batchUpdateSchema.safeParse({ startDate: '2026-06-01T00:00:00.000Z', endDate: '2026-05-01T00:00:00.000Z' }).success
    ).toBe(false);
  });
});

describe('Stage 6: Enrollment schema', () => {
  it('accepts a valid enrollment with roster snapshot', () => {
    const result = enrollmentSchema.safeParse({
      orgId: 'strynkix',
      branchId: 'branch_pune',
      courseId: 'course_fs',
      batchId: 'batch_1',
      studentId: 'stu_1',
      enrolledAt: '2026-10-01T00:00:00.000Z',
      studentDisplayName: 'Aarav',
      studentEmail: 'aarav@example.test',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.status).toBe('active');
  });

  it('rejects unknown enrollment statuses', () => {
    expect(
      enrollmentSchema.safeParse({
        orgId: 'strynkix',
        branchId: 'b',
        courseId: 'c',
        batchId: 'x',
        studentId: 's',
        enrolledAt: '2026-10-01T00:00:00.000Z',
        status: 'vip',
      }).success
    ).toBe(false);
  });
});

describe('Stage 6: Scope policy', () => {
  const pune = { orgId: 'strynkix', branchId: 'branch_pune' };

  it('fails closed without a tenant', () => {
    expect(canManageBatchScope(null, pune)).toBe(false);
  });

  it('allows super admin everywhere, university admin within org, branch admin within branch', () => {
    expect(canManageBatchScope({ role: 'super_admin', orgId: 'other' }, pune)).toBe(true);
    expect(canManageBatchScope({ role: 'university_admin', orgId: 'strynkix' }, pune)).toBe(true);
    expect(canManageBatchScope({ role: 'university_admin', orgId: 'rival' }, pune)).toBe(false);
    expect(canManageBatchScope({ role: 'branch_admin', orgId: 'strynkix', branchId: 'branch_pune' }, pune)).toBe(true);
    expect(canManageBatchScope({ role: 'branch_admin', orgId: 'strynkix', branchId: 'branch_mumbai' }, pune)).toBe(false);
    expect(canManageBatchScope({ role: 'branch_admin', orgId: 'strynkix' }, pune)).toBe(false);
  });

  it('never grants batch management to instructors or students', () => {
    expect(canManageBatchScope({ role: 'instructor', orgId: 'strynkix', branchId: 'branch_pune' }, pune)).toBe(false);
    expect(canManageBatchScope({ role: 'student', orgId: 'strynkix', branchId: 'branch_pune' }, pune)).toBe(false);
  });

  it('builds deterministic enrollment IDs', () => {
    expect(enrollmentIdFor('course_fs', 'stu_1')).toBe('course_fs_stu_1');
  });

  it('only upcoming and in-progress batches accept enrollments', () => {
    expect(isBatchOpenForEnrollment('upcoming')).toBe(true);
    expect(isBatchOpenForEnrollment('in_progress')).toBe(true);
    expect(isBatchOpenForEnrollment('completed')).toBe(false);
    expect(isBatchOpenForEnrollment('cancelled')).toBe(false);
    expect(isBatchOpenForEnrollment('archived')).toBe(false);
  });

  it('only active and completed enrollments grant content access', () => {
    expect(grantsContentAccess('active')).toBe(true);
    expect(grantsContentAccess('completed')).toBe(true);
    expect(grantsContentAccess('dropped')).toBe(false);
    expect(grantsContentAccess('suspended')).toBe(false);
  });

  it('validates instructor assignment relationships', () => {
    const ok = { role: 'instructor' as const, orgId: 'strynkix', status: 'active' as const, branchId: 'branch_pune' };
    expect(getInstructorAssignmentError(ok, pune)).toBeNull();
    expect(getInstructorAssignmentError({ ...ok, branchId: undefined }, pune)).toBeNull();
    expect(getInstructorAssignmentError(null, pune)).toMatch(/not found/);
    expect(getInstructorAssignmentError({ ...ok, role: 'student' }, pune)).toMatch(/not an instructor/);
    expect(getInstructorAssignmentError({ ...ok, orgId: 'rival' }, pune)).toMatch(/different organization/);
    expect(getInstructorAssignmentError({ ...ok, branchId: 'branch_mumbai' }, pune)).toMatch(/different branch/);
    expect(getInstructorAssignmentError({ ...ok, status: 'suspended' }, pune)).toMatch(/not active/);
  });

  it('validates student enrollment relationships', () => {
    const ok = { role: 'student' as const, orgId: 'strynkix', status: 'active' as const, branchId: 'branch_pune' };
    expect(getStudentEnrollmentError(ok, pune)).toBeNull();
    expect(getStudentEnrollmentError({ ...ok, role: 'instructor' }, pune)).toMatch(/Only student/);
    expect(getStudentEnrollmentError({ ...ok, orgId: 'rival' }, pune)).toMatch(/different organization/);
    expect(getStudentEnrollmentError({ ...ok, branchId: 'branch_mumbai' }, pune)).toMatch(/different branch/);
    expect(getStudentEnrollmentError({ ...ok, branchId: undefined }, pune)).toMatch(/different branch/);
    expect(getStudentEnrollmentError({ ...ok, status: 'pending_verification' }, pune)).toMatch(/not active/);
  });
});

describe('Stage 6: Roster progress aggregation', () => {
  const enrollment = (studentId: string): Enrollment => ({
    id: `course_fs_${studentId}`,
    orgId: 'strynkix',
    branchId: 'branch_pune',
    courseId: 'course_fs',
    batchId: 'batch_1',
    studentId,
    status: 'active',
    enrolledAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  });

  const progress = (studentId: string, lessonId: string, status: Progress['status'], lastAccessedAt: string): Progress => ({
    id: `${studentId}_course_fs_${lessonId}`,
    orgId: 'strynkix',
    courseId: 'course_fs',
    moduleId: 'mod_1',
    lessonId,
    studentId,
    batchId: 'batch_1',
    status,
    timeSpentSeconds: 60,
    lastAccessedAt,
    createdAt: lastAccessedAt,
    updatedAt: lastAccessedAt,
  });

  const lessons = ['l1', 'l2', 'l3', 'l4'];

  it('distinguishes tracked progress from students with no activity', () => {
    const rows = buildRosterProgress(
      [enrollment('alice'), enrollment('bob')],
      [
        progress('alice', 'l1', 'completed', '2026-10-02T00:00:00.000Z'),
        progress('alice', 'l2', 'in_progress', '2026-10-03T00:00:00.000Z'),
      ],
      lessons
    );
    expect(rows[0]).toMatchObject({
      state: 'tracked',
      completedCount: 1,
      inProgressCount: 1,
      percentage: 25,
      lastAccessedAt: '2026-10-03T00:00:00.000Z',
    });
    expect(rows[1]).toMatchObject({ state: 'no_activity', completedCount: 0, percentage: 0, lastAccessedAt: null });
  });

  it('a student with started-but-unfinished lessons is tracked at 0%, not "no activity"', () => {
    const rows = buildRosterProgress(
      [enrollment('alice')],
      [progress('alice', 'l1', 'in_progress', '2026-10-02T00:00:00.000Z')],
      lessons
    );
    expect(rows[0]).toMatchObject({ state: 'tracked', percentage: 0, inProgressCount: 1 });
  });

  it('marks every row unavailable when progress failed to load', () => {
    const rows = buildRosterProgress([enrollment('alice')], null, lessons);
    expect(rows[0]).toMatchObject({ state: 'unavailable', percentage: null });
  });

  it('reports no percentage when the course has no published lessons', () => {
    const rows = buildRosterProgress([enrollment('alice')], [], []);
    expect(rows[0]).toMatchObject({ state: 'no_activity', percentage: null, totalLessons: 0 });
  });

  it('ignores progress on unpublished lessons and other students', () => {
    const rows = buildRosterProgress(
      [enrollment('alice')],
      [
        progress('alice', 'draft_lesson', 'completed', '2026-10-02T00:00:00.000Z'),
        progress('mallory', 'l1', 'completed', '2026-10-02T00:00:00.000Z'),
      ],
      lessons
    );
    expect(rows[0]).toMatchObject({ state: 'no_activity', completedCount: 0 });
  });
});

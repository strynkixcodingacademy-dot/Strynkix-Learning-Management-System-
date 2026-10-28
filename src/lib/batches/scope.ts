/**
 * Strynkix LMS — Batch & Enrollment Scope Policy
 * Pure, framework-free authorization and relationship checks shared by the
 * service layer and UI. These mirror firestore.rules so users get a clear
 * error before a write is attempted; Firestore Security Rules remain the
 * enforcement boundary.
 */

import { BatchStatus, EnrollmentStatus, UserProfile, UserRole } from '@/types/domain';
import { TenantContext } from '@/types/auth';

export const BATCH_MANAGER_ROLES: UserRole[] = ['super_admin', 'university_admin', 'branch_admin'];

/** Batch statuses that accept new or reactivated enrollments. */
export const ENROLLABLE_BATCH_STATUSES: BatchStatus[] = ['upcoming', 'in_progress'];

/** Enrollment statuses that grant access to course content. */
export const CONTENT_ACCESS_ENROLLMENT_STATUSES: EnrollmentStatus[] = ['active', 'completed'];

export function isBatchManagerRole(role?: UserRole | null): boolean {
  return Boolean(role && BATCH_MANAGER_ROLES.includes(role));
}

/**
 * Whether the tenant may administer batches/enrollments for the given org and branch.
 * Fails closed when the tenant context is missing.
 */
export function canManageBatchScope(
  tenant: TenantContext | null,
  target: { orgId: string; branchId: string }
): boolean {
  if (!tenant) return false;
  switch (tenant.role) {
    case 'super_admin':
      return true;
    case 'university_admin':
      return tenant.orgId === target.orgId;
    case 'branch_admin':
      return Boolean(tenant.branchId) && tenant.orgId === target.orgId && tenant.branchId === target.branchId;
    default:
      return false;
  }
}

/** Deterministic enrollment document ID; see firestore.rules /enrollments. */
export function enrollmentIdFor(courseId: string, studentId: string): string {
  return `${courseId}_${studentId}`;
}

export function isBatchOpenForEnrollment(status: BatchStatus): boolean {
  return ENROLLABLE_BATCH_STATUSES.includes(status);
}

export function grantsContentAccess(status: EnrollmentStatus): boolean {
  return CONTENT_ACCESS_ENROLLMENT_STATUSES.includes(status);
}

type ProfileLike = Pick<UserProfile, 'role' | 'orgId' | 'status'> & { branchId?: string | null };

/**
 * Returns an error message if the user cannot be assigned as an instructor of a
 * batch in the given org/branch, or null if the assignment is valid.
 */
export function getInstructorAssignmentError(
  instructor: ProfileLike | null,
  target: { orgId: string; branchId: string }
): string | null {
  if (!instructor) return 'Instructor profile not found.';
  if (instructor.role !== 'instructor') return 'Selected user is not an instructor.';
  if (instructor.orgId !== target.orgId) return 'Instructor belongs to a different organization.';
  if (instructor.status !== 'active') return 'Instructor account is not active.';
  if (instructor.branchId && instructor.branchId !== target.branchId) {
    return 'Instructor is assigned to a different branch.';
  }
  return null;
}

/**
 * Returns an error message if the student cannot be enrolled into a batch in the
 * given org/branch, or null if the enrollment target is valid.
 */
export function getStudentEnrollmentError(
  student: ProfileLike | null,
  target: { orgId: string; branchId: string }
): string | null {
  if (!student) return 'Student profile not found.';
  if (student.role !== 'student') return 'Only student accounts can be enrolled.';
  if (student.orgId !== target.orgId) return 'Student belongs to a different organization.';
  if (!student.branchId || student.branchId !== target.branchId) {
    return 'Student belongs to a different branch than this batch.';
  }
  if (student.status !== 'active') return 'Student account is not active.';
  return null;
}

/**
 * Strynkix LMS — Batch, Enrollment & Roster Service
 * Validated client-side operations for cohort management. Every write is
 * re-verified by Firestore Security Rules; the checks here exist to fail fast
 * with clear messages and to cover limits rules cannot express (capacity).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { TenantContext } from '@/types/auth';
import {
  Batch,
  BatchStatus,
  Branch,
  Course,
  Enrollment,
  EnrollmentStatus,
  Progress,
  UserProfile,
} from '@/types/domain';
import { batchSchema, batchUpdateSchema, enrollmentSchema } from '@/types/validation';
import {
  canManageBatchScope,
  enrollmentIdFor,
  getInstructorAssignmentError,
  getStudentEnrollmentError,
  grantsContentAccess,
  isBatchOpenForEnrollment,
} from './scope';

export interface CreateBatchInput {
  orgId: string;
  branchId: string;
  courseId: string;
  name: string;
  code: string;
  instructorUserIds: string[];
  startDate: string;
  endDate?: string;
  maxStudents?: number;
  status?: BatchStatus;
}

export type UpdateBatchInput = Partial<
  Pick<Batch, 'name' | 'code' | 'instructorUserIds' | 'startDate' | 'endDate' | 'maxStudents' | 'status'>
>;

function formatZodError(error: { issues: { message: string }[] }): string {
  return error.issues.map((i) => i.message).join('; ');
}

/** Removes undefined values; Firestore rejects them in writes. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function assertTenant(tenant: TenantContext | null): asserts tenant is TenantContext {
  if (!tenant) {
    throw new Error('Your session has no verified tenant context. Please sign in again.');
  }
}

async function loadUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as UserProfile) : null;
}

function isPermissionDenied(err: unknown): boolean {
  return (err as { code?: string })?.code === 'permission-denied';
}

/** Validates instructors and returns their display names, in the same order. */
async function assertValidInstructors(ids: string[], target: { orgId: string; branchId: string }): Promise<string[]> {
  const names: string[] = [];
  for (const uid of ids) {
    let profile: UserProfile | null;
    try {
      profile = await loadUserProfile(uid);
    } catch (err) {
      if (isPermissionDenied(err)) throw new Error(`${uid}: instructor is outside your administrative scope.`);
      throw err;
    }
    const error = getInstructorAssignmentError(profile, target);
    if (error) throw new Error(`${uid}: ${error}`);
    names.push((profile?.displayName || 'Instructor').slice(0, 100));
  }
  return names;
}

// -----------------------------------------------------------------------------
// Seats (owner decision D2): capped batches keep activeEnrollmentCount in step
// with active enrollments, inside the same atomic write. See firestore.rules.
// -----------------------------------------------------------------------------

const isCapped = (batch: Pick<Batch, 'maxStudents'>) => typeof batch.maxStudents === 'number';

/** Seat change for an enrollment going from `was` to `now` (only 'active' holds a seat). */
export function seatDelta(was: EnrollmentStatus | null, now: EnrollmentStatus | null): number {
  return (now === 'active' ? 1 : 0) - (was === 'active' ? 1 : 0);
}

async function countActiveSeats(batch: Batch): Promise<number> {
  return (await getBatchEnrollments(batch)).filter((e) => e.status === 'active').length;
}

/**
 * Re-counts a capped batch's active seats and stores the result when it has
 * drifted (legacy batches created before the counter existed). Returns the count.
 */
export async function reconcileSeatCount(batch: Batch): Promise<number> {
  const count = await countActiveSeats(batch);
  if (isCapped(batch) && batch.activeEnrollmentCount !== count) {
    await updateDoc(doc(db, 'batches', batch.id), { activeEnrollmentCount: count, updatedAt: new Date().toISOString() });
  }
  return count;
}

function isFullError(err: unknown, batch: Batch): Error | null {
  if (isPermissionDenied(err) && isCapped(batch)) {
    return new Error(`Batch is full (${batch.maxStudents} seats), or the seat count changed. Refresh and try again.`);
  }
  return null;
}

// -----------------------------------------------------------------------------
// Batches
// -----------------------------------------------------------------------------

/**
 * Loads the batches visible to the current user. Queries are shaped so
 * Firestore rules can prove every result is in scope.
 */
export async function getBatchesForTenant(tenant: TenantContext | null, uid: string): Promise<Batch[]> {
  assertTenant(tenant);
  const coll = collection(db, 'batches');

  let batchQuery;
  switch (tenant.role) {
    case 'super_admin':
      batchQuery = coll;
      break;
    case 'university_admin':
      batchQuery = query(coll, where('orgId', '==', tenant.orgId));
      break;
    case 'branch_admin':
      if (!tenant.branchId) throw new Error('Branch administrator profile has no branch assigned.');
      batchQuery = query(coll, where('orgId', '==', tenant.orgId), where('branchId', '==', tenant.branchId));
      break;
    case 'instructor':
      batchQuery = query(
        coll,
        where('orgId', '==', tenant.orgId),
        where('instructorUserIds', 'array-contains', uid)
      );
      break;
    default:
      return [];
  }

  const snap = await getDocs(batchQuery);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Batch))
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
}

export async function getBatchById(batchId: string): Promise<Batch | null> {
  const snap = await getDoc(doc(db, 'batches', batchId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Batch) : null;
}

export async function createBatch(
  input: CreateBatchInput,
  tenant: TenantContext | null,
  actorUid: string
): Promise<Batch> {
  assertTenant(tenant);
  const parsed = batchSchema.safeParse({ ...input, status: input.status || 'upcoming' });
  if (!parsed.success) throw new Error(`Invalid batch data: ${formatZodError(parsed.error)}`);
  const data = parsed.data;

  if (!canManageBatchScope(tenant, data)) {
    throw new Error('You are not authorized to create batches for this branch.');
  }
  if (data.status === 'archived') throw new Error('A new batch cannot start archived.');

  const [branchSnap, courseSnap] = await Promise.all([
    getDoc(doc(db, 'branches', data.branchId)),
    getDoc(doc(db, 'courses', data.courseId)),
  ]);
  const branch = branchSnap.exists() ? (branchSnap.data() as Branch) : null;
  const course = courseSnap.exists() ? (courseSnap.data() as Course) : null;
  if (!branch || branch.orgId !== data.orgId) throw new Error('Branch not found in this organization.');
  if (branch.status === 'inactive') throw new Error('Cannot create a batch in an inactive branch.');
  if (!course || course.orgId !== data.orgId) throw new Error('Course not found in this organization.');
  if (course.status === 'archived') throw new Error('Cannot create a batch for an archived course.');

  const instructorNames = await assertValidInstructors(data.instructorUserIds, data);

  const slug = data.code.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const batchId = `batch_${slug}_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const record: Batch = withoutUndefined({
    id: batchId,
    ...data,
    instructorNames,
    activeEnrollmentCount: isCapped(data) ? 0 : undefined,
    createdById: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  await setDoc(doc(db, 'batches', batchId), record);
  return record;
}

/**
 * Updates editable batch fields. orgId, branchId, courseId and createdById are
 * never sent, and rules reject any attempt to change them.
 */
export async function updateBatch(
  batch: Batch,
  updates: UpdateBatchInput,
  tenant: TenantContext | null
): Promise<void> {
  assertTenant(tenant);
  if (!canManageBatchScope(tenant, batch)) {
    throw new Error('You are not authorized to modify this batch.');
  }

  const parsed = batchUpdateSchema.safeParse({
    ...updates,
    // Validate date ordering against the stored value when only one side changes.
    startDate: updates.startDate ?? batch.startDate,
    endDate: updates.endDate ?? batch.endDate,
  });
  if (!parsed.success) throw new Error(`Invalid batch update: ${formatZodError(parsed.error)}`);

  const changes: Record<string, unknown> = withoutUndefined({ ...parsed.data });
  const instructorsChanged =
    changes.instructorUserIds &&
    JSON.stringify(changes.instructorUserIds) !== JSON.stringify(batch.instructorUserIds);
  if (instructorsChanged || (changes.instructorUserIds && !batch.instructorNames)) {
    changes.instructorNames = await assertValidInstructors(changes.instructorUserIds as string[], batch);
  }
  // Setting or changing a cap re-counts seats so the counter starts accurate.
  if (typeof changes.maxStudents === 'number' && changes.maxStudents !== batch.maxStudents) {
    const seats = await countActiveSeats(batch);
    if (seats > (changes.maxStudents as number)) {
      throw new Error(`This batch already has ${seats} active students; Max Students can't be lower than that.`);
    }
    changes.activeEnrollmentCount = seats;
  }

  await updateDoc(doc(db, 'batches', batch.id), {
    ...changes,
    updatedAt: new Date().toISOString(),
  });
}

export async function setBatchStatus(
  batch: Batch,
  status: BatchStatus,
  tenant: TenantContext | null
): Promise<void> {
  return updateBatch(batch, { status }, tenant);
}

// -----------------------------------------------------------------------------
// People pickers
// -----------------------------------------------------------------------------

/**
 * Lists active instructors eligible for a batch in the given branch. Branch
 * admins can only read profiles in their own branch, so org-wide instructors
 * are listed only for university and super admins.
 */
export async function getAssignableInstructors(
  target: { orgId: string; branchId: string },
  tenant: TenantContext | null
): Promise<UserProfile[]> {
  assertTenant(tenant);
  const coll = collection(db, 'users');
  const instructorQuery =
    tenant.role === 'branch_admin'
      ? query(coll, where('orgId', '==', target.orgId), where('branchId', '==', target.branchId), where('role', '==', 'instructor'))
      : query(coll, where('orgId', '==', target.orgId), where('role', '==', 'instructor'));

  const snap = await getDocs(instructorQuery);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as UserProfile))
    .filter((u) => getInstructorAssignmentError(u, target) === null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Lists active students of a branch (candidates for enrollment). */
export async function getBranchStudents(target: { orgId: string; branchId: string }): Promise<UserProfile[]> {
  const snap = await getDocs(
    query(
      collection(db, 'users'),
      where('orgId', '==', target.orgId),
      where('branchId', '==', target.branchId),
      where('role', '==', 'student')
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as UserProfile))
    .filter((u) => getStudentEnrollmentError(u, target) === null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// -----------------------------------------------------------------------------
// Enrollments
// -----------------------------------------------------------------------------

/** Roster query scoped by org, branch and batch so rules can prove access for every role. */
export async function getBatchEnrollments(batch: Batch): Promise<Enrollment[]> {
  const snap = await getDocs(
    query(
      collection(db, 'enrollments'),
      where('orgId', '==', batch.orgId),
      where('branchId', '==', batch.branchId),
      where('batchId', '==', batch.id)
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Enrollment))
    .sort((a, b) => (a.studentDisplayName || a.studentId).localeCompare(b.studentDisplayName || b.studentId));
}

export async function getStudentEnrollments(orgId: string, studentId: string): Promise<Enrollment[]> {
  const snap = await getDocs(
    query(collection(db, 'enrollments'), where('orgId', '==', orgId), where('studentId', '==', studentId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));
}

/**
 * Returns the student's enrollment for a course, or null when not enrolled.
 * Uses a query (not getDoc) so "not enrolled" is an empty result rather than
 * a permission error.
 */
export async function getStudentCourseEnrollment(
  orgId: string,
  studentId: string,
  courseId: string
): Promise<Enrollment | null> {
  const snap = await getDocs(
    query(
      collection(db, 'enrollments'),
      where('orgId', '==', orgId),
      where('studentId', '==', studentId),
      where('courseId', '==', courseId)
    )
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Enrollment;
}

async function assertCapacity(batch: Batch) {
  if (!batch.maxStudents) return;
  const activeCount = (await getBatchEnrollments(batch)).filter((e) => e.status === 'active').length;
  if (activeCount >= batch.maxStudents) {
    throw new Error(`Batch is full (${activeCount}/${batch.maxStudents} active students).`);
  }
}

/**
 * Enrolls a student into a batch, or reactivates their withdrawn/suspended
 * enrollment for the same course into this batch.
 */
export async function enrollStudent(
  batch: Batch,
  studentId: string,
  tenant: TenantContext | null,
  actorUid: string
): Promise<Enrollment> {
  assertTenant(tenant);
  if (!canManageBatchScope(tenant, batch)) {
    throw new Error('You are not authorized to enroll students in this batch.');
  }
  if (!isBatchOpenForEnrollment(batch.status)) {
    throw new Error(`This batch is ${batch.status.replace('_', ' ')} and is not accepting enrollments.`);
  }

  const student = await loadUserProfile(studentId);
  const studentError = getStudentEnrollmentError(student, batch);
  if (studentError || !student) throw new Error(studentError || 'Student profile not found.');

  const enrollmentId = enrollmentIdFor(batch.courseId, studentId);
  const ref = doc(db, 'enrollments', enrollmentId);

  // A point read of a missing document is denied by the rules (they read
  // resource.data), so look the enrollment up with a branch-scoped query: "not
  // enrolled here" is then an empty result. An enrollment in another branch is
  // invisible here and makes the write below fail with permission-denied.
  const existingSnap = await getDocs(
    query(
      collection(db, 'enrollments'),
      where('orgId', '==', batch.orgId),
      where('branchId', '==', batch.branchId),
      where('courseId', '==', batch.courseId),
      where('studentId', '==', studentId)
    )
  );
  const found = existingSnap.docs.find((d) => d.id === enrollmentId);
  const existing: Enrollment | null = found ? ({ id: found.id, ...found.data() } as Enrollment) : null;

  if (existing && grantsContentAccess(existing.status)) {
    throw new Error(
      existing.batchId === batch.id
        ? 'Student is already enrolled in this batch.'
        : 'Student already has an active enrollment for this course in another batch. Withdraw it first.'
    );
  }

  await assertCapacity(batch);

  const now = new Date().toISOString();
  const roster = {
    studentDisplayName: student.displayName || '',
    studentEmail: student.email || '',
  };

  if (existing) {
    const reactivation = {
      branchId: batch.branchId,
      batchId: batch.id,
      status: 'active' as const,
      enrolledAt: now,
      ...roster,
      updatedAt: now,
    };
    const write = writeBatch(db);
    write.update(ref, reactivation);
    if (isCapped(batch)) write.update(doc(db, 'batches', batch.id), { activeEnrollmentCount: increment(1), updatedAt: now });
    // Moving out of another batch frees a seat there (only if it held one).
    if (existing.batchId !== batch.id && existing.status === 'active') {
      write.update(doc(db, 'batches', existing.batchId), { activeEnrollmentCount: increment(-1), updatedAt: now });
    }
    try {
      await write.commit();
    } catch (err) {
      throw isFullError(err, batch) ?? err;
    }
    return { ...existing, ...reactivation };
  }

  const parsed = enrollmentSchema.safeParse({
    orgId: batch.orgId,
    branchId: batch.branchId,
    courseId: batch.courseId,
    batchId: batch.id,
    studentId,
    status: 'active',
    enrolledAt: now,
    enrolledById: actorUid,
    ...roster,
  });
  if (!parsed.success) throw new Error(`Invalid enrollment: ${formatZodError(parsed.error)}`);

  const record: Enrollment = withoutUndefined({
    id: enrollmentId,
    ...parsed.data,
    createdAt: now,
    updatedAt: now,
  });
  try {
    const write = writeBatch(db);
    write.set(ref, record);
    if (isCapped(batch)) write.update(doc(db, 'batches', batch.id), { activeEnrollmentCount: increment(1), updatedAt: now });
    await write.commit();
  } catch (err) {
    if (isPermissionDenied(err) && isCapped(batch) && (await countActiveSeats(batch).catch(() => 0)) >= batch.maxStudents!) {
      throw new Error(`Batch is full (${batch.maxStudents} seats).`);
    }
    if (isPermissionDenied(err)) {
      throw new Error('This student already has an enrollment for this course in another branch, or is outside your scope.');
    }
    throw err;
  }
  return record;
}

/**
 * Changes enrollment status: 'dropped' (withdraw), 'suspended' (deactivate),
 * 'completed', or 'active' (reactivate in the same batch).
 */
export async function changeEnrollmentStatus(
  enrollment: Enrollment,
  batch: Batch,
  status: EnrollmentStatus,
  tenant: TenantContext | null
): Promise<void> {
  assertTenant(tenant);
  if (enrollment.batchId !== batch.id) throw new Error('Enrollment does not belong to this batch.');
  if (!canManageBatchScope(tenant, enrollment)) {
    throw new Error('You are not authorized to modify this enrollment.');
  }
  if (enrollment.status === status) return;

  if (status === 'active') {
    if (!isBatchOpenForEnrollment(batch.status)) {
      throw new Error(`Cannot reactivate: this batch is ${batch.status.replace('_', ' ')}.`);
    }
    const studentError = getStudentEnrollmentError(await loadUserProfile(enrollment.studentId), batch);
    if (studentError) throw new Error(`Cannot reactivate: ${studentError}`);
    await assertCapacity(batch);
  }

  const now = new Date().toISOString();
  const write = writeBatch(db);
  write.update(
    doc(db, 'enrollments', enrollment.id),
    withoutUndefined({
      status,
      completedAt: status === 'completed' ? now : undefined,
      updatedAt: now,
    })
  );
  const delta = seatDelta(enrollment.status, status);
  if (isCapped(batch) && delta !== 0) {
    write.update(doc(db, 'batches', batch.id), { activeEnrollmentCount: increment(delta), updatedAt: now });
  }
  try {
    await write.commit();
  } catch (err) {
    throw (delta > 0 ? isFullError(err, batch) : null) ?? err;
  }
}

// -----------------------------------------------------------------------------
// Progress
// -----------------------------------------------------------------------------

/** Progress records tagged with this batch (requires batch-scoped read access). */
export async function getBatchProgress(batch: Batch): Promise<Progress[]> {
  const snap = await getDocs(
    query(
      collection(db, 'progress'),
      where('orgId', '==', batch.orgId),
      where('batchId', '==', batch.id),
      where('courseId', '==', batch.courseId)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Progress));
}

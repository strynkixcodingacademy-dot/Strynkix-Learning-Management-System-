/**
 * Strynkix LMS — Stage 6 Security Rules Suite
 * Batch management, enrollment integrity, enrollment-gated content,
 * instructor scoping, and regressions for pre-existing tenant gaps.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  Firestore,
} from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ID = 'strynkix-lms';
let testEnv: RulesTestEnvironment;

const NOW = '2026-10-01T00:00:00.000Z';

function as(uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}

function validBatch(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'strynkix',
    branchId: 'branch_pune',
    courseId: 'course_fs',
    name: 'Pune Full Stack Cohort B',
    code: 'PUN-FS-B',
    instructorUserIds: ['inst_pune'],
    startDate: '2026-11-01T00:00:00.000Z',
    endDate: '2027-03-01T00:00:00.000Z',
    // Uncapped by default: seat accounting has its own suite (capacity.rules.test.ts).
    status: 'upcoming',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function validEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'strynkix',
    branchId: 'branch_pune',
    courseId: 'course_fs',
    batchId: 'batch_pune_fs',
    studentId: 'stu_pune_3',
    studentDisplayName: 'Pune Student Three',
    status: 'active',
    enrolledAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeAll(async () => {
  const rules = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const put = (p: string, data: Record<string, unknown>) => setDoc(doc(db, p), data);

    await put('organizations/strynkix', { name: 'Strynkix', status: 'active' });
    await put('organizations/rival_org', { name: 'Rival', status: 'active' });

    await put('branches/branch_pune', { orgId: 'strynkix', name: 'Pune', status: 'active' });
    await put('branches/branch_mumbai', { orgId: 'strynkix', name: 'Mumbai', status: 'active' });
    await put('branches/branch_rival', { orgId: 'rival_org', name: 'Rival HQ', status: 'active' });

    const user = (uid: string, role: string, orgId: string, branchId: string | null, status = 'active') =>
      put(`users/${uid}`, {
        id: uid,
        role,
        orgId,
        branchId,
        status,
        email: `${uid}@example.test`,
        displayName: uid === 'stu_pune_3' ? 'Pune Student Three' : `User ${uid}`,
      });

    await user('super_admin_1', 'super_admin', 'strynkix', null);
    await user('uni_admin_1', 'university_admin', 'strynkix', null);
    await user('uni_admin_rival', 'university_admin', 'rival_org', null);
    await user('ba_pune', 'branch_admin', 'strynkix', 'branch_pune');
    await user('ba_mumbai', 'branch_admin', 'strynkix', 'branch_mumbai');
    await user('ba_pune_suspended', 'branch_admin', 'strynkix', 'branch_pune', 'suspended');
    await user('inst_pune', 'instructor', 'strynkix', 'branch_pune');
    await user('inst_pune_2', 'instructor', 'strynkix', 'branch_pune');
    await user('inst_mumbai', 'instructor', 'strynkix', 'branch_mumbai');
    await user('inst_unassigned', 'instructor', 'strynkix', 'branch_pune');
    await user('inst_suspended', 'instructor', 'strynkix', 'branch_pune', 'suspended');
    await user('inst_rival', 'instructor', 'rival_org', 'branch_rival');
    await user('stu_pune_1', 'student', 'strynkix', 'branch_pune');
    await user('stu_pune_2', 'student', 'strynkix', 'branch_pune');
    await user('stu_pune_3', 'student', 'strynkix', 'branch_pune');
    await user('stu_mumbai_1', 'student', 'strynkix', 'branch_mumbai');
    await user('stu_suspended', 'student', 'strynkix', 'branch_pune', 'suspended');
    await user('stu_pending', 'student', 'strynkix', 'branch_pune', 'pending_verification');
    await user('stu_rival', 'student', 'rival_org', 'branch_rival');

    await put('courses/course_fs', { orgId: 'strynkix', title: 'Full Stack', status: 'published' });
    await put('courses/course_other', { orgId: 'strynkix', title: 'Other', status: 'published' });
    await put('courses/course_rival', { orgId: 'rival_org', title: 'Rival', status: 'published' });

    await put('modules/mod_fs_1', { orgId: 'strynkix', courseId: 'course_fs', title: 'M1', status: 'published', orderIndex: 0 });
    await put('lessons/les_fs_1', {
      orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', title: 'L1', status: 'published', orderIndex: 0, blocks: [],
    });
    await put('lessons/les_fs_2', {
      orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', title: 'L2', status: 'published', orderIndex: 1, blocks: [],
    });
    await put('lessons/les_fs_draft', {
      orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', title: 'Draft', status: 'draft', orderIndex: 1, blocks: [],
    });
    await put('lessons/les_rival', {
      orgId: 'rival_org', courseId: 'course_rival', moduleId: 'mod_rival', title: 'Rival', status: 'published', orderIndex: 0, blocks: [],
    });

    await put('batches/batch_pune_fs', validBatch({
      name: 'Pune Full Stack A', code: 'PUN-FS-A', status: 'in_progress',
    }));
    await put('batches/batch_pune_fs_b', validBatch({ name: 'Pune Full Stack B', code: 'PUN-FS-B' }));
    await put('batches/batch_mumbai_fs', validBatch({
      branchId: 'branch_mumbai', name: 'Mumbai Full Stack', code: 'MUM-FS', instructorUserIds: ['inst_mumbai'],
    }));
    await put('batches/batch_pune_archived', validBatch({ name: 'Archived', code: 'PUN-OLD', status: 'archived' }));

    await put('enrollments/course_fs_stu_pune_1', validEnrollment({ studentId: 'stu_pune_1', studentDisplayName: 'User stu_pune_1' }));
    await put('enrollments/course_fs_stu_pune_2', validEnrollment({
      studentId: 'stu_pune_2', studentDisplayName: 'User stu_pune_2', status: 'dropped',
    }));
    await put('enrollments/course_fs_stu_mumbai_1', validEnrollment({
      studentId: 'stu_mumbai_1', studentDisplayName: 'User stu_mumbai_1', branchId: 'branch_mumbai', batchId: 'batch_mumbai_fs',
    }));

    await put('progress/stu_pune_1_course_fs_les_fs_1', {
      orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', lessonId: 'les_fs_1',
      studentId: 'stu_pune_1', batchId: 'batch_pune_fs', status: 'in_progress', timeSpentSeconds: 60,
    });
    await put('progress/stu_mumbai_1_course_fs_les_fs_1', {
      orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', lessonId: 'les_fs_1',
      studentId: 'stu_mumbai_1', batchId: 'batch_mumbai_fs', status: 'completed', timeSpentSeconds: 90,
    });

    await put('assignments/assign_fs_1', {
      orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', title: 'Lab 1', status: 'published', totalPoints: 100,
    });
    await put('submissions/sub_pune_1', {
      orgId: 'strynkix', assignmentId: 'assign_fs_1', batchId: 'batch_pune_fs', studentId: 'stu_pune_1', status: 'submitted',
    });
    await put('submissions/sub_mumbai_1', {
      orgId: 'strynkix', assignmentId: 'assign_fs_1', batchId: 'batch_mumbai_fs', studentId: 'stu_mumbai_1', status: 'submitted',
    });
  });
});

// -----------------------------------------------------------------------------
// A. Batch management
// -----------------------------------------------------------------------------
describe('Stage 6 — Batch creation', () => {
  it('university_admin CAN create a valid batch in their org', async () => {
    await assertSucceeds(setDoc(doc(as('uni_admin_1'), 'batches/new_batch'), validBatch()));
  });

  it('branch_admin CAN create a valid batch in their own branch', async () => {
    await assertSucceeds(setDoc(doc(as('ba_pune'), 'batches/new_batch'), validBatch({ maxStudents: 30, activeEnrollmentCount: 0 })));
  });

  it('branch_admin CANNOT create a batch in another branch', async () => {
    await assertFails(setDoc(doc(as('ba_pune'), 'batches/new_batch'), validBatch({
      branchId: 'branch_mumbai', instructorUserIds: ['inst_mumbai'],
    })));
  });

  it('university_admin of another org CANNOT create a batch in strynkix', async () => {
    await assertFails(setDoc(doc(as('uni_admin_rival'), 'batches/new_batch'), validBatch()));
  });

  it('CANNOT create a batch referencing a course from another org or a missing course', async () => {
    await assertFails(setDoc(doc(as('uni_admin_1'), 'batches/b1'), validBatch({ courseId: 'course_rival' })));
    await assertFails(setDoc(doc(as('uni_admin_1'), 'batches/b2'), validBatch({ courseId: 'course_missing' })));
  });

  it('CANNOT create a batch claiming a branch that belongs to another org', async () => {
    await assertFails(setDoc(doc(as('uni_admin_1'), 'batches/b1'), validBatch({
      branchId: 'branch_rival', instructorUserIds: [],
    })));
  });

  it('CANNOT assign a student, a foreign-org instructor, a cross-branch instructor, or a suspended instructor', async () => {
    const db = as('uni_admin_1');
    await assertFails(setDoc(doc(db, 'batches/b1'), validBatch({ instructorUserIds: ['stu_pune_1'] })));
    await assertFails(setDoc(doc(db, 'batches/b2'), validBatch({ instructorUserIds: ['inst_rival'] })));
    await assertFails(setDoc(doc(db, 'batches/b3'), validBatch({ instructorUserIds: ['inst_mumbai'] })));
    await assertFails(setDoc(doc(db, 'batches/b4'), validBatch({ instructorUserIds: ['inst_suspended'] })));
    await assertFails(setDoc(doc(db, 'batches/b5'), validBatch({ instructorUserIds: ['ghost_user'] })));
  });

  it('CANNOT create a malformed batch (unknown field, bad status, too many instructors, end before start)', async () => {
    const db = as('uni_admin_1');
    await assertFails(setDoc(doc(db, 'batches/b1'), validBatch({ isPrivileged: true })));
    await assertFails(setDoc(doc(db, 'batches/b2'), validBatch({ status: 'super_open' })));
    await assertFails(setDoc(doc(db, 'batches/b3'), validBatch({
      instructorUserIds: ['inst_pune', 'inst_pune_2', 'inst_unassigned', 'inst_pune', 'inst_pune_2', 'inst_unassigned'],
    })));
    await assertFails(setDoc(doc(db, 'batches/b4'), validBatch({ endDate: '2026-01-01T00:00:00.000Z' })));
    await assertFails(setDoc(doc(db, 'batches/b5'), validBatch({ maxStudents: 0 })));
  });

  it('instructor, student, and suspended branch_admin CANNOT create batches', async () => {
    await assertFails(setDoc(doc(as('inst_pune'), 'batches/b1'), validBatch()));
    await assertFails(setDoc(doc(as('stu_pune_1'), 'batches/b1'), validBatch()));
    await assertFails(setDoc(doc(as('ba_pune_suspended'), 'batches/b1'), validBatch()));
  });
});

describe('Stage 6 — Batch updates and archiving', () => {
  it('branch_admin CAN edit schedule, instructors, and archive a batch in their branch', async () => {
    const db = as('ba_pune');
    await assertSucceeds(updateDoc(doc(db, 'batches/batch_pune_fs'), {
      name: 'Pune Full Stack A (Evening)',
      instructorUserIds: ['inst_pune', 'inst_pune_2'],
      endDate: '2027-04-01T00:00:00.000Z',
      updatedAt: NOW,
    }));
    await assertSucceeds(updateDoc(doc(db, 'batches/batch_pune_fs'), { status: 'archived', updatedAt: NOW }));
  });

  it('nobody can change orgId, branchId, courseId, or createdById of a batch', async () => {
    const db = as('uni_admin_1');
    await assertFails(updateDoc(doc(db, 'batches/batch_pune_fs'), { orgId: 'rival_org' }));
    await assertFails(updateDoc(doc(db, 'batches/batch_pune_fs'), { branchId: 'branch_mumbai' }));
    await assertFails(updateDoc(doc(db, 'batches/batch_pune_fs'), { courseId: 'course_other' }));
    await assertFails(updateDoc(doc(db, 'batches/batch_pune_fs'), { createdById: 'uni_admin_1' }));
  });

  it('branch_admin CANNOT edit another branch batch; instructor and student CANNOT edit batches', async () => {
    await assertFails(updateDoc(doc(as('ba_mumbai'), 'batches/batch_pune_fs'), { name: 'Hijacked' }));
    await assertFails(updateDoc(doc(as('inst_pune'), 'batches/batch_pune_fs'), { name: 'Instructor Edit' }));
    await assertFails(updateDoc(doc(as('stu_pune_1'), 'batches/batch_pune_fs'), { name: 'Student Edit' }));
    await assertFails(updateDoc(doc(as('ba_pune_suspended'), 'batches/batch_pune_fs'), { name: 'Suspended Edit' }));
  });

  it('CANNOT swap in an invalid instructor on update', async () => {
    await assertFails(updateDoc(doc(as('ba_pune'), 'batches/batch_pune_fs'), { instructorUserIds: ['stu_pune_3'] }));
  });
});

describe('Stage 6 — Batch read scoping', () => {
  it('assigned instructor CAN read their batch; unassigned and other-branch instructors CANNOT', async () => {
    await assertSucceeds(getDoc(doc(as('inst_pune'), 'batches/batch_pune_fs')));
    await assertFails(getDoc(doc(as('inst_unassigned'), 'batches/batch_pune_fs')));
    await assertFails(getDoc(doc(as('inst_mumbai'), 'batches/batch_pune_fs')));
  });

  it('instructor CAN list only batches they are assigned to (array-contains query)', async () => {
    const db = as('inst_pune');
    const snap = await assertSucceeds(getDocs(query(
      collection(db, 'batches'),
      where('orgId', '==', 'strynkix'),
      where('instructorUserIds', 'array-contains', 'inst_pune'),
    )));
    if (snap.size < 1) throw new Error('expected assigned batches');
    await assertFails(getDocs(query(collection(db, 'batches'), where('orgId', '==', 'strynkix'))));
  });

  it('branch_admin CAN list own-branch batches and CANNOT read another branch batch', async () => {
    const db = as('ba_pune');
    await assertSucceeds(getDocs(query(
      collection(db, 'batches'),
      where('orgId', '==', 'strynkix'),
      where('branchId', '==', 'branch_pune'),
    )));
    await assertFails(getDoc(doc(db, 'batches/batch_mumbai_fs')));
  });

  it('enrolled student CAN read their batch; unenrolled, dropped, and other-branch students CANNOT', async () => {
    await assertSucceeds(getDoc(doc(as('stu_pune_1'), 'batches/batch_pune_fs')));
    await assertFails(getDoc(doc(as('stu_pune_3'), 'batches/batch_pune_fs')));
    await assertFails(getDoc(doc(as('stu_pune_2'), 'batches/batch_pune_fs')));
    await assertFails(getDoc(doc(as('stu_mumbai_1'), 'batches/batch_pune_fs')));
  });

  it('cross-org university_admin CANNOT read strynkix batches', async () => {
    await assertFails(getDoc(doc(as('uni_admin_rival'), 'batches/batch_pune_fs')));
  });
});

// -----------------------------------------------------------------------------
// B. Enrollment management
// -----------------------------------------------------------------------------
describe('Stage 6 — Enrollment creation', () => {
  it('branch_admin CAN enroll an active student of their branch into an open batch', async () => {
    await assertSucceeds(setDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_3'), validEnrollment({
      enrolledById: 'ba_pune',
    })));
  });

  it('university_admin CAN enroll a student', async () => {
    await assertSucceeds(setDoc(doc(as('uni_admin_1'), 'enrollments/course_fs_stu_pune_3'), validEnrollment()));
  });

  it('enrollment document ID MUST be {courseId}_{studentId} (prevents duplicate records)', async () => {
    await assertFails(setDoc(doc(as('ba_pune'), 'enrollments/random_id'), validEnrollment()));
    await assertFails(setDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_1_dup'), validEnrollment({
      studentId: 'stu_pune_1', studentDisplayName: 'User stu_pune_1',
    })));
  });

  it('CANNOT enroll a student from another branch, a non-student, a suspended or pending student', async () => {
    const db = as('uni_admin_1');
    await assertFails(setDoc(doc(db, 'enrollments/course_fs_stu_mumbai_x'), validEnrollment({ studentId: 'stu_mumbai_x' })));
    await assertFails(setDoc(doc(db, 'enrollments/course_fs_inst_unassigned'), validEnrollment({
      studentId: 'inst_unassigned', studentDisplayName: 'User inst_unassigned',
    })));
    await assertFails(setDoc(doc(db, 'enrollments/course_fs_stu_suspended'), validEnrollment({
      studentId: 'stu_suspended', studentDisplayName: 'User stu_suspended',
    })));
    await assertFails(setDoc(doc(db, 'enrollments/course_fs_stu_pending'), validEnrollment({
      studentId: 'stu_pending', studentDisplayName: 'User stu_pending',
    })));
  });

  it('CANNOT enroll into a batch whose branch differs from the student branch', async () => {
    await assertFails(setDoc(doc(as('uni_admin_1'), 'enrollments/course_fs_stu_pune_3'), validEnrollment({
      branchId: 'branch_mumbai', batchId: 'batch_mumbai_fs',
    })));
  });

  it('CANNOT enroll with a courseId that does not match the batch course', async () => {
    await assertFails(setDoc(doc(as('uni_admin_1'), 'enrollments/course_other_stu_pune_3'), validEnrollment({
      courseId: 'course_other',
    })));
  });

  it('CANNOT enroll into an archived batch or a missing batch', async () => {
    await assertFails(setDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_3'), validEnrollment({
      batchId: 'batch_pune_archived',
    })));
    await assertFails(setDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_3'), validEnrollment({
      batchId: 'batch_does_not_exist',
    })));
  });

  it('CANNOT create an enrollment in a non-active status or with a forged display name', async () => {
    await assertFails(setDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_3'), validEnrollment({ status: 'completed' })));
    await assertFails(setDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_3'), validEnrollment({
      studentDisplayName: 'Somebody Else',
    })));
  });

  it('CANNOT forge enrolledById as another user', async () => {
    await assertFails(setDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_3'), validEnrollment({
      enrolledById: 'uni_admin_1',
    })));
  });

  it('cross-org admin, branch admin of another branch, instructor, and student CANNOT create enrollments', async () => {
    await assertFails(setDoc(doc(as('uni_admin_rival'), 'enrollments/course_fs_stu_pune_3'), validEnrollment()));
    await assertFails(setDoc(doc(as('ba_mumbai'), 'enrollments/course_fs_stu_pune_3'), validEnrollment()));
    await assertFails(setDoc(doc(as('inst_pune'), 'enrollments/course_fs_stu_pune_3'), validEnrollment()));
    await assertFails(setDoc(doc(as('stu_pune_3'), 'enrollments/course_fs_stu_pune_3'), validEnrollment()));
  });
});

describe('Stage 6 — Enrollment status changes', () => {
  it('branch_admin CAN withdraw (dropped) and deactivate (suspended) an enrollment', async () => {
    const db = as('ba_pune');
    await assertSucceeds(updateDoc(doc(db, 'enrollments/course_fs_stu_pune_1'), { status: 'suspended', updatedAt: NOW }));
    await assertSucceeds(updateDoc(doc(db, 'enrollments/course_fs_stu_pune_1'), { status: 'dropped', updatedAt: NOW }));
  });

  it('branch_admin CAN reactivate a dropped enrollment into an open batch of the same course', async () => {
    await assertSucceeds(updateDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_2'), {
      status: 'active', batchId: 'batch_pune_fs_b', updatedAt: NOW,
    }));
  });

  it('CANNOT reactivate into an archived batch', async () => {
    await assertFails(updateDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_2'), {
      status: 'active', batchId: 'batch_pune_archived', updatedAt: NOW,
    }));
  });

  it('CANNOT move an enrollment to another batch without making it active', async () => {
    await assertFails(updateDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_2'), {
      batchId: 'batch_pune_fs_b', updatedAt: NOW,
    }));
  });

  it('CANNOT change studentId, orgId, or courseId on an enrollment', async () => {
    const db = as('uni_admin_1');
    await assertFails(updateDoc(doc(db, 'enrollments/course_fs_stu_pune_1'), { studentId: 'stu_pune_3' }));
    await assertFails(updateDoc(doc(db, 'enrollments/course_fs_stu_pune_1'), { orgId: 'rival_org' }));
    await assertFails(updateDoc(doc(db, 'enrollments/course_fs_stu_pune_1'), { courseId: 'course_other' }));
  });

  it('branch_admin CANNOT transfer an enrollment into another branch', async () => {
    await assertFails(updateDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu_pune_1'), {
      branchId: 'branch_mumbai', batchId: 'batch_mumbai_fs',
    }));
  });

  it('other-branch admin, instructor, and the student themselves CANNOT change enrollment status', async () => {
    await assertFails(updateDoc(doc(as('ba_mumbai'), 'enrollments/course_fs_stu_pune_1'), { status: 'dropped' }));
    await assertFails(updateDoc(doc(as('inst_pune'), 'enrollments/course_fs_stu_pune_1'), { status: 'completed' }));
    await assertFails(updateDoc(doc(as('stu_pune_2'), 'enrollments/course_fs_stu_pune_2'), { status: 'active' }));
  });
});

describe('Stage 6 — Enrollment read scoping', () => {
  it('student CAN read only their own enrollments', async () => {
    const db = as('stu_pune_1');
    await assertSucceeds(getDoc(doc(db, 'enrollments/course_fs_stu_pune_1')));
    await assertSucceeds(getDocs(query(
      collection(db, 'enrollments'),
      where('orgId', '==', 'strynkix'),
      where('studentId', '==', 'stu_pune_1'),
    )));
    await assertFails(getDoc(doc(db, 'enrollments/course_fs_stu_mumbai_1')));
    await assertFails(getDocs(query(collection(db, 'enrollments'), where('orgId', '==', 'strynkix'))));
  });

  it('assigned instructor CAN list their batch roster; others CANNOT', async () => {
    const roster = (db: Firestore, branchId: string, batchId: string) => getDocs(query(
      collection(db, 'enrollments'),
      where('orgId', '==', 'strynkix'),
      where('branchId', '==', branchId),
      where('batchId', '==', batchId),
    ));
    await assertSucceeds(roster(as('inst_pune'), 'branch_pune', 'batch_pune_fs'));
    await assertFails(roster(as('inst_mumbai'), 'branch_pune', 'batch_pune_fs'));
    await assertFails(roster(as('inst_unassigned'), 'branch_pune', 'batch_pune_fs'));
    await assertFails(getDocs(query(collection(as('inst_pune'), 'enrollments'), where('orgId', '==', 'strynkix'))));
  });

  it('branch_admin CANNOT read another branch enrollment; cross-org admin CANNOT read any', async () => {
    await assertFails(getDoc(doc(as('ba_mumbai'), 'enrollments/course_fs_stu_pune_1')));
    await assertFails(getDoc(doc(as('uni_admin_rival'), 'enrollments/course_fs_stu_pune_1')));
  });
});

// -----------------------------------------------------------------------------
// C. Enrollment-gated learning content
// -----------------------------------------------------------------------------
describe('Stage 6 — Enrollment-gated content', () => {
  it('actively enrolled student CAN read the published course, modules, and lessons', async () => {
    const db = as('stu_pune_1');
    await assertSucceeds(getDoc(doc(db, 'courses/course_fs')));
    await assertSucceeds(getDoc(doc(db, 'lessons/les_fs_1')));
    await assertSucceeds(getDocs(query(
      collection(db, 'modules'),
      where('courseId', '==', 'course_fs'),
      where('orgId', '==', 'strynkix'),
      where('status', '==', 'published'),
    )));
    await assertSucceeds(getDocs(query(
      collection(db, 'lessons'),
      where('courseId', '==', 'course_fs'),
      where('orgId', '==', 'strynkix'),
      where('status', '==', 'published'),
    )));
  });

  it('enrolled student still CANNOT read a draft lesson', async () => {
    await assertFails(getDoc(doc(as('stu_pune_1'), 'lessons/les_fs_draft')));
  });

  it('unenrolled and dropped students CANNOT read course content of their own org', async () => {
    await assertFails(getDoc(doc(as('stu_pune_3'), 'courses/course_fs')));
    await assertFails(getDoc(doc(as('stu_pune_3'), 'lessons/les_fs_1')));
    await assertFails(getDoc(doc(as('stu_pune_2'), 'courses/course_fs')));
    await assertFails(getDocs(query(
      collection(as('stu_pune_3'), 'courses'),
      where('orgId', '==', 'strynkix'),
      where('status', '==', 'published'),
    )));
  });

  it('staff can still read course content for authoring', async () => {
    await assertSucceeds(getDoc(doc(as('inst_unassigned'), 'lessons/les_fs_draft')));
  });
});

// -----------------------------------------------------------------------------
// D. Progress scoping
// -----------------------------------------------------------------------------
describe('Stage 6 — Progress integrity and instructor visibility', () => {
  const progress = (studentId: string, batchId: string) => ({
    orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', lessonId: 'les_fs_1',
    studentId, batchId, status: 'in_progress', timeSpentSeconds: 30,
  });

  it('enrolled student CAN create progress tagged with their enrollment batch', async () => {
    await assertSucceeds(setDoc(doc(as('stu_pune_1'), 'progress/stu_pune_1_course_fs_les_fs_2'), {
      ...progress('stu_pune_1', 'batch_pune_fs'),
      lessonId: 'les_fs_2',
    }));
  });

  it('student CAN look up a not-yet-created progress record with an owner-scoped query (service path)', async () => {
    // recordLessonProgress relies on this: a getDoc on a missing record is denied,
    // so the service checks existence with a query constrained to the caller.
    const snap = await assertSucceeds(getDocs(query(
      collection(as('stu_pune_1'), 'progress'),
      where('orgId', '==', 'strynkix'),
      where('studentId', '==', 'stu_pune_1'),
      where('courseId', '==', 'course_fs'),
      where('lessonId', '==', 'les_fs_2'),
    )));
    if (!snap.empty) throw new Error('expected no existing progress');
    await assertFails(getDoc(doc(as('stu_pune_1'), 'progress/stu_pune_1_course_fs_les_fs_2')));
  });

  it('student CANNOT create progress with a batchId other than their enrollment batch', async () => {
    await assertFails(setDoc(doc(as('stu_pune_1'), 'progress/stu_pune_1_x'), progress('stu_pune_1', 'batch_pune_fs_b')));
  });

  it('unenrolled and dropped students CANNOT create progress', async () => {
    await assertFails(setDoc(doc(as('stu_pune_3'), 'progress/stu_pune_3_x'), progress('stu_pune_3', 'batch_pune_fs')));
    await assertFails(setDoc(doc(as('stu_pune_2'), 'progress/stu_pune_2_x'), progress('stu_pune_2', 'batch_pune_fs')));
  });

  it('student CANNOT retag existing progress to another batch', async () => {
    await assertFails(updateDoc(doc(as('stu_pune_1'), 'progress/stu_pune_1_course_fs_les_fs_1'), { batchId: 'batch_mumbai_fs' }));
  });

  it('assigned instructor CAN query batch progress; other instructors CANNOT', async () => {
    const batchProgress = (db: Firestore, batchId: string) => getDocs(query(
      collection(db, 'progress'),
      where('orgId', '==', 'strynkix'),
      where('batchId', '==', batchId),
      where('courseId', '==', 'course_fs'),
    ));
    const snap = await assertSucceeds(batchProgress(as('inst_pune'), 'batch_pune_fs'));
    if (snap.size !== 1) throw new Error(`expected exactly the pune progress record, got ${snap.size}`);
    await assertFails(batchProgress(as('inst_pune'), 'batch_mumbai_fs'));
    await assertFails(batchProgress(as('inst_unassigned'), 'batch_pune_fs'));
    await assertFails(getDoc(doc(as('inst_pune'), 'progress/stu_mumbai_1_course_fs_les_fs_1')));
  });

  it('branch_admin CAN read own-branch batch progress and CANNOT read another branch progress', async () => {
    await assertSucceeds(getDoc(doc(as('ba_pune'), 'progress/stu_pune_1_course_fs_les_fs_1')));
    await assertFails(getDoc(doc(as('ba_pune'), 'progress/stu_mumbai_1_course_fs_les_fs_1')));
  });

  it('staff previewing a course CAN query their own (empty) progress', async () => {
    await assertSucceeds(getDocs(query(
      collection(as('inst_unassigned'), 'progress'),
      where('orgId', '==', 'strynkix'),
      where('courseId', '==', 'course_fs'),
      where('studentId', '==', 'inst_unassigned'),
    )));
  });
});

// -----------------------------------------------------------------------------
// E. Submission scoping (data model exists; grading UI is a later milestone)
// -----------------------------------------------------------------------------
describe('Stage 6 — Submission scoping', () => {
  it('assigned instructor CAN read and grade a submission in their batch', async () => {
    const db = as('inst_pune');
    await assertSucceeds(getDoc(doc(db, 'submissions/sub_pune_1')));
    await assertSucceeds(updateDoc(doc(db, 'submissions/sub_pune_1'), {
      score: 90, feedback: 'Good', status: 'graded', gradedByUserId: 'inst_pune', gradedAt: serverTimestamp(),
    }));
  });

  it('instructor of another batch CANNOT read or grade the submission', async () => {
    await assertFails(getDoc(doc(as('inst_mumbai'), 'submissions/sub_pune_1')));
    await assertFails(updateDoc(doc(as('inst_mumbai'), 'submissions/sub_pune_1'), { score: 10, status: 'graded' }));
    await assertFails(updateDoc(doc(as('inst_unassigned'), 'submissions/sub_pune_1'), { score: 10, status: 'graded' }));
  });

  it('grader CANNOT move a submission to another batch or student', async () => {
    await assertFails(updateDoc(doc(as('inst_pune'), 'submissions/sub_pune_1'), { batchId: 'batch_mumbai_fs' }));
  });

  it('student CANNOT mark their own submission as graded', async () => {
    await assertFails(updateDoc(doc(as('stu_pune_1'), 'submissions/sub_pune_1'), { status: 'graded' }));
  });

  it('student CANNOT submit into a batch they are not enrolled in', async () => {
    // Stage 7 contract fields included so these fail only on enrollment scope.
    await assertFails(setDoc(doc(as('stu_pune_1'), 'submissions/assign_fs_1_stu_pune_1'), {
      orgId: 'strynkix', assignmentId: 'assign_fs_1', batchId: 'batch_mumbai_fs', studentId: 'stu_pune_1', status: 'submitted',
      attemptCount: 1, submittedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(as('stu_pune_3'), 'submissions/assign_fs_1_stu_pune_3'), {
      orgId: 'strynkix', assignmentId: 'assign_fs_1', batchId: 'batch_pune_fs', studentId: 'stu_pune_3', status: 'submitted',
      attemptCount: 1, submittedAt: serverTimestamp(),
    }));
  });

  it('enrolled student CAN submit into their own batch', async () => {
    await assertSucceeds(setDoc(doc(as('stu_pune_1'), 'submissions/assign_fs_1_stu_pune_1'), {
      orgId: 'strynkix', assignmentId: 'assign_fs_1', batchId: 'batch_pune_fs', studentId: 'stu_pune_1', status: 'submitted',
      attemptCount: 1, submittedAt: serverTimestamp(),
    }));
  });
});

// -----------------------------------------------------------------------------
// F. Regressions for gaps found in the Stage 6 audit
// -----------------------------------------------------------------------------
describe('Stage 6 — Audit regressions', () => {
  it('foreign-org instructor CANNOT overwrite a lesson, module, or assignment by relabelling orgId', async () => {
    const db = as('inst_rival');
    await assertFails(setDoc(doc(db, 'lessons/les_fs_1'), {
      orgId: 'rival_org', courseId: 'course_fs', moduleId: 'mod_fs_1', title: 'Defaced', status: 'published', blocks: [],
    }));
    await assertFails(setDoc(doc(db, 'modules/mod_fs_1'), {
      orgId: 'rival_org', courseId: 'course_fs', title: 'Defaced', status: 'published',
    }));
    await assertFails(setDoc(doc(db, 'assignments/assign_fs_1'), {
      orgId: 'rival_org', courseId: 'course_fs', moduleId: 'mod_fs_1', title: 'Defaced', status: 'published',
    }));
  });

  it('instructor CANNOT move a lesson to another course', async () => {
    await assertFails(updateDoc(doc(as('inst_pune'), 'lessons/les_fs_1'), { courseId: 'course_other' }));
  });

  it('public self-signup CANNOT create an active student profile', async () => {
    await assertFails(setDoc(doc(as('newcomer'), 'users/newcomer'), {
      role: 'student', orgId: 'strynkix', branchId: 'branch_pune', status: 'active',
      email: 'newcomer@example.test', displayName: 'Newcomer',
    }));
    await assertFails(setDoc(doc(as('newcomer2'), 'users/newcomer2'), {
      role: 'student', orgId: 'strynkix', email: 'newcomer2@example.test', displayName: 'Newcomer Two',
    }));
  });

  it('public self-signup CAN create a pending_verification student profile that has no content access', async () => {
    await assertSucceeds(setDoc(doc(as('newcomer'), 'users/newcomer'), {
      role: 'student', orgId: 'strynkix', status: 'pending_verification',
      email: 'newcomer@example.test', displayName: 'Newcomer',
    }));
    await assertFails(getDoc(doc(as('newcomer'), 'courses/course_fs')));
    await assertFails(getDoc(doc(as('newcomer'), 'batches/batch_pune_fs')));
  });

  it('suspended student with an active enrollment is DENIED content, batch, and progress', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'enrollments/course_fs_stu_suspended'), validEnrollment({
        studentId: 'stu_suspended', studentDisplayName: 'User stu_suspended',
      }));
    });
    const db = as('stu_suspended');
    await assertFails(getDoc(doc(db, 'courses/course_fs')));
    await assertFails(getDoc(doc(db, 'batches/batch_pune_fs')));
    await assertFails(getDoc(doc(db, 'enrollments/course_fs_stu_suspended')));
  });
});

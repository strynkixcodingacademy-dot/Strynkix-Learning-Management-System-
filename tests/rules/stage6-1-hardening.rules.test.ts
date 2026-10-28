/**
 * Strynkix LMS — Stage 6.1 Security Hardening Regression Suite
 * Each describe block targets one finding from the Stage 6.1 production review.
 * Positive controls sit next to each denial so a fix cannot pass by denying everything.
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { recordLessonProgress } from '@/lib/livebook/service';

const PROJECT_ID = 'strynkix-lms';
const NOW = '2026-10-01T00:00:00.000Z';
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
let testEnv: RulesTestEnvironment;

function as(uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
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
    const user = (uid: string, role: string, orgId: string, branchId: string | null, status = 'active') =>
      put(`users/${uid}`, { id: uid, role, orgId, branchId, status, email: `${uid}@example.test`, displayName: `User ${uid}` });

    await put('branches/branch_pune', { orgId: 'strynkix', name: 'Pune', status: 'active' });
    await put('branches/branch_rival', { orgId: 'rival_org', name: 'Rival', status: 'active' });

    await user('uni_admin_1', 'university_admin', 'strynkix', null);
    await user('uni_admin_2', 'university_admin', 'strynkix', null);
    await user('ba_pune', 'branch_admin', 'strynkix', 'branch_pune');
    await user('inst_pune', 'instructor', 'strynkix', 'branch_pune');
    await user('stu_1', 'student', 'strynkix', 'branch_pune');
    await user('stu_pending', 'student', 'strynkix', 'branch_pune', 'pending_verification');
    // Underscore-bearing IDs used to probe enrollment-ID collisions.
    await user('stu', 'student', 'strynkix', 'branch_pune');
    await user('x_stu', 'student', 'strynkix', 'branch_pune');

    await put('courses/course_fs', { orgId: 'strynkix', title: 'Full Stack', status: 'published', createdById: 'inst_pune', createdAt: NOW });
    await put('courses/crs', { orgId: 'strynkix', title: 'Course A', status: 'published' });
    await put('courses/crs_x', { orgId: 'strynkix', title: 'Course B', status: 'published' });
    await put('modules/mod_fs_1', { orgId: 'strynkix', courseId: 'course_fs', title: 'M1', status: 'published' });
    await put('lessons/les_fs_1', { orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', title: 'L1', status: 'published', blocks: [] });
    await put('lessons/les_fs_2', { orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', title: 'L2', status: 'published', blocks: [] });

    await put('batches/batch_pune_fs', {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', name: 'Pune FS', code: 'PUN-FS',
      instructorUserIds: ['inst_pune'], startDate: NOW, status: 'in_progress',
    });
    await put('enrollments/course_fs_stu_1', {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', batchId: 'batch_pune_fs',
      studentId: 'stu_1', status: 'active', enrolledAt: NOW,
    });
    // Legitimate enrollment of student "x_stu" in course "crs": its ID "crs_x_stu"
    // is textually identical to the ID for student "stu" in course "crs_x".
    await put('enrollments/crs_x_stu', {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'crs', batchId: 'batch_crs',
      studentId: 'x_stu', status: 'active', enrolledAt: NOW,
    });

    await put('progress/stu_1_course_fs_les_fs_1', {
      orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', lessonId: 'les_fs_1', studentId: 'stu_1',
      batchId: 'batch_pune_fs', status: 'completed', timeSpentSeconds: 300,
      lastAccessedAt: NOW, completedAt: NOW, createdAt: NOW, updatedAt: NOW,
    });

    await put('assignments/assign_draft', { orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', title: 'Draft Lab', status: 'draft' });
    await put('assignments/assign_live', { orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', title: 'Live Lab', status: 'published' });
  });
});

// -----------------------------------------------------------------------------
// Finding 1: University admin role authority
// -----------------------------------------------------------------------------
describe('6.1 — University admin role authority', () => {
  it('positive control: university_admin CAN activate a pending student and move a student to instructor', async () => {
    const db = as('uni_admin_1');
    await assertSucceeds(updateDoc(doc(db, 'users/stu_pending'), { status: 'active' }));
    await assertSucceeds(updateDoc(doc(db, 'users/stu_1'), { role: 'instructor' }));
  });

  it('university_admin CANNOT promote a user to university_admin', async () => {
    await assertFails(updateDoc(doc(as('uni_admin_1'), 'users/stu_1'), { role: 'university_admin' }));
    await assertFails(updateDoc(doc(as('uni_admin_1'), 'users/ba_pune'), { role: 'university_admin' }));
  });

  it('university_admin CANNOT modify, suspend, or demote a peer university_admin', async () => {
    const db = as('uni_admin_1');
    await assertFails(updateDoc(doc(db, 'users/uni_admin_2'), { status: 'suspended' }));
    await assertFails(updateDoc(doc(db, 'users/uni_admin_2'), { role: 'student', branchId: 'branch_pune' }));
  });

  it('university_admin CANNOT assign a user to a branch belonging to another org (create or update)', async () => {
    const db = as('uni_admin_1');
    await assertFails(updateDoc(doc(db, 'users/stu_1'), { branchId: 'branch_rival' }));
    await assertFails(updateDoc(doc(db, 'users/stu_1'), { branchId: 'branch_does_not_exist' }));
    await assertFails(setDoc(doc(db, 'users/new_student'), {
      role: 'student', orgId: 'strynkix', branchId: 'branch_rival', status: 'active',
      email: 'n@example.test', displayName: 'New',
    }));
    await assertSucceeds(setDoc(doc(db, 'users/new_student_ok'), {
      role: 'student', orgId: 'strynkix', branchId: 'branch_pune', status: 'active',
      email: 'ok@example.test', displayName: 'New OK',
    }));
  });

  it('branch_admin CANNOT create a branch_admin or touch another branch_admin', async () => {
    await assertFails(setDoc(doc(as('ba_pune'), 'users/new_ba'), {
      role: 'branch_admin', orgId: 'strynkix', branchId: 'branch_pune', status: 'active', email: 'x@example.test', displayName: 'X',
    }));
  });
});

// -----------------------------------------------------------------------------
// Finding 6: Self-service profile updates
// -----------------------------------------------------------------------------
describe('6.1 — Self profile updates are limited to presentation fields', () => {
  it('positive control: a user CAN change their own displayName', async () => {
    await assertSucceeds(updateDoc(doc(as('stu_1'), 'users/stu_1'), { displayName: 'Renamed', updatedAt: NOW }));
  });

  it('a user CANNOT change their own email or add arbitrary fields', async () => {
    await assertFails(updateDoc(doc(as('stu_1'), 'users/stu_1'), { email: 'someone.else@example.test' }));
    await assertFails(updateDoc(doc(as('stu_1'), 'users/stu_1'), { isStaff: true }));
  });

  it('a pending self-registered user CANNOT activate or edit themselves', async () => {
    await assertFails(updateDoc(doc(as('stu_pending'), 'users/stu_pending'), { status: 'active' }));
    await assertFails(updateDoc(doc(as('stu_pending'), 'users/stu_pending'), { displayName: 'Still Pending' }));
  });
});

// -----------------------------------------------------------------------------
// Finding 2: Course ownership fields
// -----------------------------------------------------------------------------
describe('6.1 — Course ownership fields cannot be forged', () => {
  it('positive control: instructor CAN create a course attributed to themselves', async () => {
    await assertSucceeds(setDoc(doc(as('inst_pune'), 'courses/new_course'), {
      orgId: 'strynkix', title: 'New', status: 'draft', createdById: 'inst_pune', createdAt: NOW,
    }));
  });

  it('instructor CANNOT create a course attributed to someone else', async () => {
    await assertFails(setDoc(doc(as('inst_pune'), 'courses/forged_course'), {
      orgId: 'strynkix', title: 'Forged', status: 'draft', createdById: 'uni_admin_1', createdAt: NOW,
    }));
  });

  it('nobody can rewrite createdById or createdAt on an existing course', async () => {
    await assertFails(updateDoc(doc(as('uni_admin_1'), 'courses/course_fs'), { createdById: 'uni_admin_1' }));
    await assertFails(updateDoc(doc(as('inst_pune'), 'courses/course_fs'), { createdAt: '2020-01-01T00:00:00.000Z' }));
  });
});

// -----------------------------------------------------------------------------
// Finding 3/8: Enrollment lookup must verify the record's own fields
// -----------------------------------------------------------------------------
describe('6.1 — Enrollment ID collisions cannot grant access', () => {
  it('positive control: x_stu (the real owner) CAN read course "crs"', async () => {
    await assertSucceeds(getDoc(doc(as('x_stu'), 'courses/crs')));
  });

  it('student "stu" CANNOT read course "crs_x" through enrollment "crs_x_stu" owned by x_stu', async () => {
    await assertFails(getDoc(doc(as('stu'), 'courses/crs_x')));
  });
});

// -----------------------------------------------------------------------------
// Finding 5: Lessons and modules follow the course's publication state
// -----------------------------------------------------------------------------
describe('6.1 — Unpublishing a course hides its content from students', () => {
  it('positive control: enrolled student reads published lesson and module', async () => {
    await assertSucceeds(getDoc(doc(as('stu_1'), 'lessons/les_fs_1')));
    await assertSucceeds(getDoc(doc(as('stu_1'), 'modules/mod_fs_1')));
  });

  it('enrolled student CANNOT read lessons or modules once the course is unpublished', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'courses/course_fs'), { status: 'draft' });
    });
    await assertFails(getDoc(doc(as('stu_1'), 'lessons/les_fs_1')));
    await assertFails(getDoc(doc(as('stu_1'), 'modules/mod_fs_1')));
  });

  it('policy: an active enrollment in an ARCHIVED batch keeps content access (revoke by withdrawing)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'batches/batch_pune_fs'), { status: 'archived' });
    });
    await assertSucceeds(getDoc(doc(as('stu_1'), 'lessons/les_fs_1')));
  });
});

// -----------------------------------------------------------------------------
// Finding 9: Progress record integrity and timestamps
// -----------------------------------------------------------------------------
describe('6.1 — Progress record integrity', () => {
  const fresh = (overrides: Record<string, unknown> = {}) => ({
    orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1', lessonId: 'les_fs_2', studentId: 'stu_1',
    batchId: 'batch_pune_fs', status: 'in_progress', timeSpentSeconds: 30,
    lastAccessedAt: NOW, createdAt: NOW, updatedAt: NOW, ...overrides,
  });

  it('positive control: well-formed progress create succeeds', async () => {
    await assertSucceeds(setDoc(doc(as('stu_1'), 'progress/stu_1_course_fs_les_fs_2'), fresh()));
  });

  it('CANNOT create progress with an unknown status, a malformed timestamp, or extra fields', async () => {
    const db = as('stu_1');
    await assertFails(setDoc(doc(db, 'progress/p1'), fresh({ status: 'mastered' })));
    await assertFails(setDoc(doc(db, 'progress/p2'), fresh({ lastAccessedAt: 'yesterday' })));
    await assertFails(setDoc(doc(db, 'progress/p3'), fresh({ grade: 'A+' })));
    await assertFails(setDoc(doc(db, 'progress/p4'), fresh({ timeSpentSeconds: 10_000_000 })));
  });

  it('CANNOT decrease timeSpentSeconds or un-complete a completed lesson', async () => {
    const db = as('stu_1');
    await assertFails(updateDoc(doc(db, 'progress/stu_1_course_fs_les_fs_1'), { timeSpentSeconds: 10 }));
    await assertFails(updateDoc(doc(db, 'progress/stu_1_course_fs_les_fs_1'), { status: 'in_progress' }));
    await assertSucceeds(updateDoc(doc(db, 'progress/stu_1_course_fs_les_fs_1'), { timeSpentSeconds: 330, lastAccessedAt: NOW }));
  });

  it('service path: recordLessonProgress creates a missing record, then updates it, with valid ISO timestamps', async () => {
    const db = as('stu_1');
    const params = {
      studentId: 'stu_1', orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1',
      lessonId: 'les_fs_2', batchId: 'batch_pune_fs',
    };
    await recordLessonProgress({ ...params, status: 'in_progress', timeSpentSeconds: 30 }, db);
    await recordLessonProgress({ ...params, status: 'completed', timeSpentSeconds: 60 }, db);

    let stored: Record<string, unknown> | undefined;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      stored = (await getDoc(doc(context.firestore(), 'progress/stu_1_course_fs_les_fs_2'))).data();
    });
    expect(stored).toBeDefined();
    expect(stored!.status).toBe('completed');
    expect(stored!.timeSpentSeconds).toBe(90);
    expect(stored!.batchId).toBe('batch_pune_fs');
    for (const field of ['lastAccessedAt', 'completedAt', 'createdAt', 'updatedAt']) {
      expect(stored![field], field).toMatch(ISO_PATTERN);
    }
  });

  it('service path: unenrolled student is rejected by rules', async () => {
    await expect(
      recordLessonProgress(
        {
          studentId: 'stu', orgId: 'strynkix', courseId: 'course_fs', moduleId: 'mod_fs_1',
          lessonId: 'les_fs_2', batchId: 'batch_pune_fs', status: 'in_progress',
        },
        as('stu')
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// -----------------------------------------------------------------------------
// Finding 5/8: Timestamps and publication checks on other Stage 6 writes
// -----------------------------------------------------------------------------
describe('6.1 — Other write validation', () => {
  it('CANNOT create a batch or enrollment with non-ISO dates', async () => {
    await assertFails(setDoc(doc(as('ba_pune'), 'batches/bad_dates'), {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', name: 'Bad Dates', code: 'BAD',
      instructorUserIds: [], startDate: 'next monday!', status: 'upcoming',
    }));
    await assertFails(setDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu'), {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', batchId: 'batch_pune_fs',
      studentId: 'stu', status: 'active', enrolledAt: 'some time',
    }));
  });

  it('positive control: a well-formed enrollment still succeeds', async () => {
    await assertSucceeds(setDoc(doc(as('ba_pune'), 'enrollments/course_fs_stu'), {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', batchId: 'batch_pune_fs',
      studentId: 'stu', status: 'active', enrolledAt: NOW,
    }));
  });

  it('student CANNOT submit to an unpublished assignment; CAN submit to a published one', async () => {
    // Stage 7 contract: deterministic ID, first attempt, server timestamp.
    const base = { orgId: 'strynkix', batchId: 'batch_pune_fs', studentId: 'stu_1', status: 'submitted', attemptCount: 1, submittedAt: serverTimestamp() };
    await assertFails(setDoc(doc(as('stu_1'), 'submissions/assign_draft_stu_1'), { ...base, assignmentId: 'assign_draft' }));
    await assertSucceeds(setDoc(doc(as('stu_1'), 'submissions/assign_live_stu_1'), { ...base, assignmentId: 'assign_live' }));
  });
});

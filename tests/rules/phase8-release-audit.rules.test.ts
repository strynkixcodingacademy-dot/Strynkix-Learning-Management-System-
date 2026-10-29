/**
 * Strynkix LMS — Phase 8 release-readiness rules audit.
 * Covers reassignment/removal, profile privacy, unauthenticated and pending
 * access, forged progress, branch scope and archived plans, plus the owner-approved
 * course governance (D3) and batch capacity (D2) policies.
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, increment, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NOW = '2026-10-01T00:00:00.000Z';
const PLAN = 'batch_a_2026-10-01';
let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
const anon = () => testEnv.unauthenticatedContext().firestore() as unknown as Firestore;

async function trusted(fn: (db: Firestore) => Promise<unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'strynkix-lms',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await trusted(async (db) => {
    const put = (p: string, data: Record<string, unknown>) => setDoc(doc(db, p), data);
    const user = (uid: string, role: string, orgId: string, branchId: string | null, status = 'active') =>
      put(`users/${uid}`, { role, orgId, branchId, status, email: `${uid}@example.test`, displayName: uid, phoneNumber: '+910000000000' });
    await put('branches/branch_a', { orgId: 'strynkix', name: 'A', status: 'active' });
    await put('branches/branch_b', { orgId: 'strynkix', name: 'B', status: 'active' });
    await user('uni', 'university_admin', 'strynkix', null);
    await user('uni_rival', 'university_admin', 'rival', null);
    await user('ba_a', 'branch_admin', 'strynkix', 'branch_a');
    await user('ba_b', 'branch_admin', 'strynkix', 'branch_b');
    await user('inst_a', 'instructor', 'strynkix', 'branch_a');
    await user('inst_other', 'instructor', 'strynkix', 'branch_a');
    await user('stu_1', 'student', 'strynkix', 'branch_a');
    await user('stu_2', 'student', 'strynkix', 'branch_a');
    await user('stu_b', 'student', 'strynkix', 'branch_b');
    await user('pending', 'student', 'strynkix', 'branch_a', 'pending_verification');
    await put('courses/course_x', { orgId: 'strynkix', title: 'X', status: 'published' });
    await put('lessons/les_1', { orgId: 'strynkix', courseId: 'course_x', moduleId: 'm1', status: 'published' });
    await put('batches/batch_a', {
      orgId: 'strynkix', branchId: 'branch_a', courseId: 'course_x', name: 'A', code: 'A',
      instructorUserIds: ['inst_a'], startDate: NOW, status: 'in_progress',
    });
    for (const s of ['stu_1', 'stu_2']) {
      await put(`enrollments/course_x_${s}`, { orgId: 'strynkix', branchId: 'branch_a', courseId: 'course_x', batchId: 'batch_a', studentId: s, status: 'active', enrolledAt: NOW });
    }
    await put(`dailyPlans/${PLAN}`, {
      orgId: 'strynkix', branchId: 'branch_a', courseId: 'course_x', batchId: 'batch_a', date: '2026-10-01', title: 'Day 1',
      objectives: [], lessonIds: ['les_1'], learningDueAt: NOW, assignmentId: PLAN, status: 'published', createdById: 'inst_a',
    });
    await put(`assignments/${PLAN}`, {
      orgId: 'strynkix', courseId: 'course_x', batchId: 'batch_a', planId: PLAN, title: 'Lab', description: 'Do the lab',
      submissionType: 'text', totalPoints: 10, deadline: NOW, status: 'published', createdById: 'inst_a',
    });
    await put(`submissions/${PLAN}_stu_1`, {
      orgId: 'strynkix', assignmentId: PLAN, batchId: 'batch_a', courseId: 'course_x', studentId: 'stu_1',
      textAnswer: 'answer', status: 'submitted', attemptCount: 1, submittedAt: Timestamp.fromDate(new Date(NOW)),
    });
    await put('progress/stu_1_course_x_les_1', {
      orgId: 'strynkix', courseId: 'course_x', moduleId: 'm1', lessonId: 'les_1', studentId: 'stu_1', batchId: 'batch_a',
      status: 'in_progress', timeSpentSeconds: 30,
    });
  });
});

const batchReads = (db: Firestore): Array<() => Promise<unknown>> => [
  () => getDoc(doc(db, `dailyPlans/${PLAN}`)),
  () => getDoc(doc(db, `submissions/${PLAN}_stu_1`)),
  () => getDoc(doc(db, 'progress/stu_1_course_x_les_1')),
  () => getDocs(query(collection(db, 'enrollments'), where('orgId', '==', 'strynkix'), where('branchId', '==', 'branch_a'), where('batchId', '==', 'batch_a'))),
];
const grade = (uid: string) => ({ status: 'graded', score: 5, feedback: 'ok', gradedByUserId: uid, gradedAt: serverTimestamp() });

describe('Phase 8 — instructor reassignment and removal', () => {
  it('positive control: the assigned instructor reads plan, submission, progress and roster, and can grade', async () => {
    for (const read of batchReads(as('inst_a'))) await assertSucceeds(read());
    await assertSucceeds(updateDoc(doc(as('inst_a'), `submissions/${PLAN}_stu_1`), grade('inst_a')));
  });

  it('an instructor removed from the batch immediately loses every batch-scoped read and grading', async () => {
    await trusted((db) => updateDoc(doc(db, 'batches/batch_a'), { instructorUserIds: ['inst_other'] }));
    for (const read of batchReads(as('inst_a'))) await assertFails(read());
    await assertFails(updateDoc(doc(as('inst_a'), `submissions/${PLAN}_stu_1`), grade('inst_a')));
    await assertFails(updateDoc(doc(as('inst_a'), `dailyPlans/${PLAN}`), { title: 'Edited after removal' }));
    // ...and the newly assigned instructor gains them.
    for (const read of batchReads(as('inst_other'))) await assertSucceeds(read());
  });

  it('a suspended instructor still listed on the batch is denied', async () => {
    await trusted((db) => updateDoc(doc(db, 'users/inst_a'), { status: 'suspended' }));
    for (const read of batchReads(as('inst_a'))) await assertFails(read());
  });
});

describe('Phase 8 — profile privacy', () => {
  it('users read their own profile', async () => {
    await assertSucceeds(getDoc(doc(as('stu_1'), 'users/stu_1')));
  });

  it('students cannot read classmates or staff profiles, or list users', async () => {
    await assertFails(getDoc(doc(as('stu_1'), 'users/stu_2')));
    await assertFails(getDoc(doc(as('stu_1'), 'users/inst_a')));
    await assertFails(getDocs(query(collection(as('stu_1'), 'users'), where('orgId', '==', 'strynkix'))));
  });

  it('instructors cannot read student profiles (rosters use the enrollment snapshot instead)', async () => {
    await assertFails(getDoc(doc(as('inst_a'), 'users/stu_1')));
  });

  it('branch admins read only their branch; university admins only their org', async () => {
    await assertSucceeds(getDoc(doc(as('ba_a'), 'users/stu_1')));
    await assertFails(getDoc(doc(as('ba_a'), 'users/stu_b')));
    await assertSucceeds(getDoc(doc(as('uni'), 'users/stu_b')));
    await assertFails(getDoc(doc(as('uni_rival'), 'users/stu_1')));
  });
});

describe('Phase 8 — unauthenticated and pending accounts', () => {
  it('unauthenticated clients can read nothing tenant-owned', async () => {
    const db = anon();
    for (const p of ['courses/course_x', 'lessons/les_1', 'batches/batch_a', `dailyPlans/${PLAN}`, `assignments/${PLAN}`,
      `submissions/${PLAN}_stu_1`, 'enrollments/course_x_stu_1', 'progress/stu_1_course_x_les_1', 'users/stu_1', 'branches/branch_a']) {
      await assertFails(getDoc(doc(db, p)));
    }
  });

  it('a pending (self-registered) account reads nothing beyond its own profile', async () => {
    const db = as('pending');
    await assertSucceeds(getDoc(doc(db, 'users/pending')));
    for (const p of ['courses/course_x', 'branches/branch_a', `dailyPlans/${PLAN}`, 'batches/batch_a']) {
      await assertFails(getDoc(doc(db, p)));
    }
  });
});

describe('Phase 8 — forged and cross-student writes', () => {
  it('a student cannot create progress or a submission on behalf of a classmate', async () => {
    await assertFails(setDoc(doc(as('stu_1'), 'progress/stu_2_course_x_les_1'), {
      orgId: 'strynkix', courseId: 'course_x', moduleId: 'm1', lessonId: 'les_1', studentId: 'stu_2', batchId: 'batch_a',
      status: 'completed', timeSpentSeconds: 30,
    }));
    await assertFails(setDoc(doc(as('stu_1'), `submissions/${PLAN}_stu_2`), {
      orgId: 'strynkix', assignmentId: PLAN, batchId: 'batch_a', courseId: 'course_x', studentId: 'stu_2',
      textAnswer: 'x', status: 'submitted', attemptCount: 1, submittedAt: serverTimestamp(),
    }));
  });

  it('a student cannot read a classmate\'s submission, marks or feedback', async () => {
    await trusted((db) => updateDoc(doc(db, `submissions/${PLAN}_stu_1`), { status: 'graded', score: 9, feedback: 'great' }));
    await assertFails(getDoc(doc(as('stu_2'), `submissions/${PLAN}_stu_1`)));
    await assertFails(getDocs(query(collection(as('stu_2'), 'submissions'), where('orgId', '==', 'strynkix'), where('assignmentId', '==', PLAN))));
  });
});

describe('Phase 8 — branch scope and archived plans', () => {
  it('a branch admin edits only their own branch document', async () => {
    await assertSucceeds(updateDoc(doc(as('ba_a'), 'branches/branch_a'), { name: 'A renamed' }));
    await assertFails(updateDoc(doc(as('ba_a'), 'branches/branch_b'), { name: 'Hijack' }));
  });

  it('archived plans and their assignments disappear for students', async () => {
    await trusted(async (db) => {
      await updateDoc(doc(db, `dailyPlans/${PLAN}`), { status: 'archived' });
      await updateDoc(doc(db, `assignments/${PLAN}`), { status: 'archived' });
    });
    await assertFails(getDoc(doc(as('stu_1'), `dailyPlans/${PLAN}`)));
    await assertFails(getDoc(doc(as('stu_1'), `assignments/${PLAN}`)));
  });
});

describe('Course governance (owner decision D3, approved)', () => {
  it('instructors and branch managers cannot publish, unpublish or archive a shared course', async () => {
    await assertFails(updateDoc(doc(as('inst_other'), 'courses/course_x'), { lastEditedById: 'inst_other', status: 'draft' }));
    await assertFails(updateDoc(doc(as('ba_a'), 'courses/course_x'), { lastEditedById: 'ba_a', status: 'archived' }));
  });

  it('only the Super Admin deletes courses; branch managers and instructors cannot', async () => {
    await assertFails(deleteDoc(doc(as('ba_b'), 'courses/course_x')));
    await assertFails(deleteDoc(doc(as('inst_a'), 'courses/course_x')));
    await assertFails(deleteDoc(doc(as('inst_a'), 'lessons/les_1')));
  });

  it('staff cannot edit a published course, but can create and edit drafts', async () => {
    await assertFails(updateDoc(doc(as('inst_a'), 'courses/course_x'), { lastEditedById: 'inst_a', title: 'Renamed' }));
    await assertFails(setDoc(doc(as('inst_a'), 'courses/course_new'), { lastEditedById: 'inst_a', orgId: 'strynkix', title: 'New', status: 'published' }));
    await assertSucceeds(setDoc(doc(as('inst_a'), 'courses/course_new'), { lastEditedById: 'inst_a', orgId: 'strynkix', title: 'New', status: 'draft' }));
    await assertSucceeds(updateDoc(doc(as('inst_a'), 'courses/course_new'), { lastEditedById: 'inst_a', title: 'New, edited' }));
    await assertFails(updateDoc(doc(as('inst_a'), 'courses/course_new'), { lastEditedById: 'inst_a', status: 'published' }));
  });

  it('staff edit draft lesson content but cannot change lesson status', async () => {
    // Stage C3: les_1 is published, so it is immutable; drafts are edited in place.
    await assertFails(updateDoc(doc(as('inst_a'), 'lessons/les_1'), { lastEditedById: 'inst_a', title: 'Edited lesson' }));
    await assertFails(updateDoc(doc(as('inst_a'), 'lessons/les_1'), { lastEditedById: 'inst_a', status: 'draft' }));
    await assertFails(setDoc(doc(as('inst_a'), 'lessons/les_new'), { lastEditedById: 'inst_a', orgId: 'strynkix', courseId: 'course_x', moduleId: 'm1', status: 'published' }));
    await assertSucceeds(setDoc(doc(as('inst_a'), 'lessons/les_new'), { lastEditedById: 'inst_a', orgId: 'strynkix', courseId: 'course_x', moduleId: 'm1', status: 'draft' }));
    await assertSucceeds(updateDoc(doc(as('inst_a'), 'lessons/les_new'), { lastEditedById: 'inst_a', title: 'Edited lesson' }));
  });

  // Stage C2: the Super Admin publishes, unpublishes and archives only through
  // the audited review route (tests/emulator/content-review.emulator.test.ts);
  // a direct client status write is refused even for the Super Admin.
  it('the Super Admin changes status only through the audited route, and still deletes', async () => {
    await trusted((db) => setDoc(doc(db, 'users/super'), { role: 'super_admin', orgId: 'strynkix', status: 'active', email: 's@example.test', displayName: 'S' }));
    await assertFails(updateDoc(doc(as('super'), 'lessons/les_1'), { lastEditedById: 'super', status: 'draft' }));
    await assertFails(updateDoc(doc(as('super'), 'courses/course_x'), { lastEditedById: 'super', status: 'archived' }));
    // Stage C3: published lessons are immutable for the Super Admin too.
    await assertFails(updateDoc(doc(as('super'), 'lessons/les_1'), { lastEditedById: 'super', title: 'Edited by the Super Admin' }));
    await assertSucceeds(deleteDoc(doc(as('super'), 'courses/course_x')));
  });
});

describe('Phase 8 — batch capacity (was a known gap; fixed by owner decision D2)', () => {
  it('fixed: two concurrent enrollments into a batch with maxStudents = 1 — only one succeeds', async () => {
    await trusted(async (db) => {
      await setDoc(doc(db, 'users/stu_3'), { role: 'student', orgId: 'strynkix', branchId: 'branch_a', status: 'active', email: 'stu_3@example.test', displayName: 'stu_3' });
      await setDoc(doc(db, 'users/stu_4'), { role: 'student', orgId: 'strynkix', branchId: 'branch_a', status: 'active', email: 'stu_4@example.test', displayName: 'stu_4' });
      await setDoc(doc(db, 'courses/course_y'), { lastEditedById: 'pending', orgId: 'strynkix', title: 'Y', status: 'published' });
      await setDoc(doc(db, 'batches/batch_cap'), {
        orgId: 'strynkix', branchId: 'branch_a', courseId: 'course_y', name: 'Cap', code: 'CAP',
        instructorUserIds: [], startDate: NOW, status: 'upcoming', maxStudents: 1, activeEnrollmentCount: 0,
      });
    });
    const enroll = (admin: string, studentId: string) => {
      const db = as(admin);
      const w = writeBatch(db);
      w.set(doc(db, `enrollments/course_y_${studentId}`), {
        orgId: 'strynkix', branchId: 'branch_a', courseId: 'course_y', batchId: 'batch_cap', studentId, status: 'active', enrolledAt: NOW,
      });
      w.update(doc(db, 'batches/batch_cap'), { activeEnrollmentCount: increment(1) });
      return w.commit();
    };
    const results = await Promise.allSettled([enroll('ba_a', 'stu_3'), enroll('uni', 'stu_4')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

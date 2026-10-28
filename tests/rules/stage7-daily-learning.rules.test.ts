/**
 * Strynkix LMS — Stage 7 Daily Plans, Daily Assignments & Submissions rules suite.
 * See docs/DAILY_LEARNING.md for the permission matrix and state machine.
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
  Timestamp,
  updateDoc,
  where,
  Firestore,
} from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ID = 'strynkix-lms';
const NOW = '2026-10-01T00:00:00.000Z';
const PLAN = 'batch_pune_2026-10-01';
const DRAFT_PLAN = 'batch_pune_2026-10-02';
const MUMBAI_PLAN = 'batch_mumbai_2026-10-01';
let testEnv: RulesTestEnvironment;

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

function plan(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', batchId: 'batch_pune',
    date: '2026-10-05', title: 'Day 5: Async JS', objectives: ['Understand promises'], lessonIds: ['les_1'],
    learningDueAt: '2026-10-05T18:00:00.000Z', status: 'draft', createdById: 'inst_pune',
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'strynkix', courseId: 'course_fs', batchId: 'batch_pune', planId: DRAFT_PLAN,
    title: 'Promise drills', description: 'Write three promise chains.', submissionType: 'text_and_code',
    totalPoints: 10, rubric: [], deadline: '2026-10-02T18:00:00.000Z', status: 'draft',
    createdById: 'inst_pune', createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function submission(studentId: string, overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'strynkix', assignmentId: PLAN, batchId: 'batch_pune', courseId: 'course_fs', studentId,
    textAnswer: 'My answer', codeContent: 'console.log(1);', status: 'submitted', attemptCount: 1,
    submittedAt: serverTimestamp(), createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

const grade = (uid: string, overrides: Record<string, unknown> = {}) => ({
  status: 'graded', score: 8, feedback: 'Solid work', gradedByUserId: uid, gradedAt: serverTimestamp(), updatedAt: NOW, ...overrides,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
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
      put(`users/${uid}`, { role, orgId, branchId, status, email: `${uid}@example.test`, displayName: uid });
    const batch = (id: string, branchId: string, instructors: string[], status = 'in_progress') =>
      put(`batches/${id}`, {
        orgId: 'strynkix', branchId, courseId: 'course_fs', name: id, code: id.toUpperCase(),
        instructorUserIds: instructors, startDate: NOW, status,
      });
    const enroll = (studentId: string, batchId: string, branchId: string, status = 'active') =>
      put(`enrollments/course_fs_${studentId}`, {
        orgId: 'strynkix', branchId, courseId: 'course_fs', batchId, studentId, status, enrolledAt: NOW,
      });

    await put('branches/branch_pune', { orgId: 'strynkix', status: 'active' });
    await put('branches/branch_mumbai', { orgId: 'strynkix', status: 'active' });
    await user('uni_admin', 'university_admin', 'strynkix', null);
    await user('uni_rival', 'university_admin', 'rival_org', null);
    await user('ba_pune', 'branch_admin', 'strynkix', 'branch_pune');
    await user('ba_mumbai', 'branch_admin', 'strynkix', 'branch_mumbai');
    await user('inst_pune', 'instructor', 'strynkix', 'branch_pune');
    await user('inst_other', 'instructor', 'strynkix', 'branch_pune');
    await user('inst_mumbai', 'instructor', 'strynkix', 'branch_mumbai');
    for (const s of ['stu_1', 'stu_2', 'stu_unenrolled']) await user(s, 'student', 'strynkix', 'branch_pune');
    await user('stu_suspended', 'student', 'strynkix', 'branch_pune', 'suspended');
    await user('stu_mumbai', 'student', 'strynkix', 'branch_mumbai');

    await put('courses/course_fs', { orgId: 'strynkix', title: 'Full Stack', status: 'published' });
    await put('courses/course_other', { orgId: 'strynkix', title: 'Other', status: 'published' });
    await put('lessons/les_1', { orgId: 'strynkix', courseId: 'course_fs', moduleId: 'm1', status: 'published' });

    await batch('batch_pune', 'branch_pune', ['inst_pune']);
    await batch('batch_mumbai', 'branch_mumbai', ['inst_mumbai']);
    await batch('batch_archived', 'branch_pune', ['inst_pune'], 'archived');

    await enroll('stu_1', 'batch_pune', 'branch_pune');
    await enroll('stu_2', 'batch_pune', 'branch_pune');
    await enroll('stu_suspended', 'batch_pune', 'branch_pune');
    await enroll('stu_mumbai', 'batch_mumbai', 'branch_mumbai');

    await put(`dailyPlans/${PLAN}`, plan({ date: '2026-10-01', status: 'published', assignmentId: PLAN, publishedAt: NOW }));
    await put(`dailyPlans/${DRAFT_PLAN}`, plan({ date: '2026-10-02' }));
    await put(`dailyPlans/${MUMBAI_PLAN}`, plan({
      date: '2026-10-01', branchId: 'branch_mumbai', batchId: 'batch_mumbai', status: 'published', createdById: 'inst_mumbai',
    }));

    await put(`assignments/${PLAN}`, assignment({ planId: PLAN, status: 'published', deadline: '2026-10-01T18:00:00.000Z' }));
    await put(`assignments/${MUMBAI_PLAN}`, assignment({
      planId: MUMBAI_PLAN, batchId: 'batch_mumbai', status: 'published', createdById: 'inst_mumbai',
    }));
    await put(`submissions/${PLAN}_stu_2`, {
      ...submission('stu_2'), submittedAt: Timestamp.fromDate(new Date(NOW)),
    });
  });
});

// -----------------------------------------------------------------------------
describe('Stage 7 — Daily plan writes', () => {
  it('assigned instructor and branch admin CAN create a valid plan for their batch', async () => {
    await assertSucceeds(setDoc(doc(as('inst_pune'), 'dailyPlans/batch_pune_2026-10-05'), plan()));
    await assertSucceeds(setDoc(doc(as('ba_pune'), 'dailyPlans/batch_pune_2026-10-06'), plan({ date: '2026-10-06', createdById: 'ba_pune' })));
  });

  it('plan ID MUST be {batchId}_{date}', async () => {
    await assertFails(setDoc(doc(as('inst_pune'), 'dailyPlans/any_id'), plan()));
    await assertFails(setDoc(doc(as('inst_pune'), 'dailyPlans/batch_pune_2026-10-09'), plan()));
  });

  it('unassigned, other-branch, cross-org staff and students CANNOT create plans', async () => {
    const id = 'dailyPlans/batch_pune_2026-10-05';
    await assertFails(setDoc(doc(as('inst_other'), id), plan({ createdById: 'inst_other' })));
    await assertFails(setDoc(doc(as('inst_mumbai'), id), plan({ createdById: 'inst_mumbai' })));
    await assertFails(setDoc(doc(as('ba_mumbai'), id), plan({ createdById: 'ba_mumbai' })));
    await assertFails(setDoc(doc(as('uni_rival'), id), plan({ createdById: 'uni_rival' })));
    await assertFails(setDoc(doc(as('stu_1'), id), plan({ createdById: 'stu_1', status: 'published' })));
  });

  it('CANNOT create a plan whose org/branch/course disagree with the batch, or on an archived batch', async () => {
    const db = as('uni_admin');
    await assertFails(setDoc(doc(db, 'dailyPlans/batch_pune_2026-10-05'), plan({ courseId: 'course_other', createdById: 'uni_admin' })));
    await assertFails(setDoc(doc(db, 'dailyPlans/batch_pune_2026-10-05'), plan({ branchId: 'branch_mumbai', createdById: 'uni_admin' })));
    await assertFails(setDoc(doc(db, 'dailyPlans/batch_archived_2026-10-05'), plan({ batchId: 'batch_archived', createdById: 'uni_admin' })));
  });

  it('CANNOT create a malformed plan or forge the creator', async () => {
    const db = as('inst_pune');
    const id = 'dailyPlans/batch_pune_2026-10-05';
    await assertFails(setDoc(doc(db, id), plan({ createdById: 'uni_admin' })));
    await assertFails(setDoc(doc(db, id), plan({ lessonIds: Array.from({ length: 11 }, (_, i) => `l${i}`) })));
    await assertFails(setDoc(doc(db, id), plan({ learningDueAt: 'tonight' })));
    await assertFails(setDoc(doc(db, id), plan({ status: 'live' })));
    await assertFails(setDoc(doc(db, id), plan({ secret: true })));
    await assertFails(setDoc(doc(db, 'dailyPlans/batch_pune_5-10-2026'), plan({ date: '5-10-2026' })));
  });

  it('assigned instructor CAN publish; immutable fields cannot change; students cannot publish', async () => {
    const db = as('inst_pune');
    await assertSucceeds(updateDoc(doc(db, `dailyPlans/${DRAFT_PLAN}`), { status: 'published', publishedAt: NOW, updatedAt: NOW }));
    await assertFails(updateDoc(doc(db, `dailyPlans/${DRAFT_PLAN}`), { date: '2026-10-03' }));
    await assertFails(updateDoc(doc(db, `dailyPlans/${DRAFT_PLAN}`), { batchId: 'batch_mumbai' }));
    await assertFails(updateDoc(doc(db, `dailyPlans/${DRAFT_PLAN}`), { createdById: 'inst_other' }));
    await assertFails(updateDoc(doc(as('stu_1'), `dailyPlans/${DRAFT_PLAN}`), { status: 'published' }));
    await assertFails(updateDoc(doc(as('inst_mumbai'), `dailyPlans/${DRAFT_PLAN}`), { title: 'Hijack' }));
  });
});

describe('Stage 7 — Daily plan reads', () => {
  it('enrolled student CAN read published plans of their own batch only', async () => {
    await assertSucceeds(getDoc(doc(as('stu_1'), `dailyPlans/${PLAN}`)));
    await assertFails(getDoc(doc(as('stu_1'), `dailyPlans/${DRAFT_PLAN}`)));
    await assertFails(getDoc(doc(as('stu_1'), `dailyPlans/${MUMBAI_PLAN}`)));
    await assertFails(getDoc(doc(as('stu_mumbai'), `dailyPlans/${PLAN}`)));
  });

  it('unenrolled and suspended students CANNOT read plans', async () => {
    await assertFails(getDoc(doc(as('stu_unenrolled'), `dailyPlans/${PLAN}`)));
    await assertFails(getDoc(doc(as('stu_suspended'), `dailyPlans/${PLAN}`)));
  });

  it('student list query must be scoped to course, batch and published status', async () => {
    const db = as('stu_1');
    await assertSucceeds(getDocs(query(collection(db, 'dailyPlans'),
      where('orgId', '==', 'strynkix'), where('courseId', '==', 'course_fs'),
      where('batchId', '==', 'batch_pune'), where('status', '==', 'published'))));
    await assertFails(getDocs(query(collection(db, 'dailyPlans'),
      where('orgId', '==', 'strynkix'), where('courseId', '==', 'course_fs'), where('batchId', '==', 'batch_pune'))));
  });

  it('assigned instructor CAN list batch plans; unassigned instructor CANNOT', async () => {
    const q = (db: Firestore) => getDocs(query(collection(db, 'dailyPlans'), where('orgId', '==', 'strynkix'), where('batchId', '==', 'batch_pune')));
    await assertSucceeds(q(as('inst_pune')));
    await assertFails(q(as('inst_other')));
    await assertFails(q(as('inst_mumbai')));
  });
});

// -----------------------------------------------------------------------------
describe('Stage 7 — Daily assignment writes and reads', () => {
  it('assigned instructor CAN create the daily assignment for a plan of their batch', async () => {
    await assertSucceeds(setDoc(doc(as('inst_pune'), `assignments/${DRAFT_PLAN}`), assignment()));
  });

  it('assignment ID must equal its plan, and the plan must belong to the same batch', async () => {
    await assertFails(setDoc(doc(as('inst_pune'), 'assignments/other_id'), assignment()));
    await assertFails(setDoc(doc(as('inst_pune'), `assignments/${MUMBAI_PLAN}_x`), assignment({ planId: MUMBAI_PLAN })));
    await assertFails(setDoc(doc(as('inst_pune'), `assignments/batch_pune_2026-12-31`), assignment({ planId: 'batch_pune_2026-12-31' })));
  });

  it('unassigned instructor and students CANNOT create or edit assignments', async () => {
    await assertFails(setDoc(doc(as('inst_other'), `assignments/${DRAFT_PLAN}`), assignment({ createdById: 'inst_other' })));
    await assertFails(updateDoc(doc(as('stu_1'), `assignments/${PLAN}`), { deadline: '2030-01-01T00:00:00.000Z' }));
    await assertFails(updateDoc(doc(as('inst_mumbai'), `assignments/${PLAN}`), { deadline: '2030-01-01T00:00:00.000Z' }));
  });

  it('legacy course-level assignments (no batch) can no longer be written by staff', async () => {
    await assertFails(setDoc(doc(as('inst_pune'), 'assignments/course_level'), {
      orgId: 'strynkix', courseId: 'course_fs', moduleId: 'm1', title: 'Course-wide', status: 'published',
    }));
  });

  it('instructor CAN extend a deadline but CANNOT change marks after publishing', async () => {
    await assertSucceeds(updateDoc(doc(as('inst_pune'), `assignments/${PLAN}`), { deadline: '2026-10-03T18:00:00.000Z', updatedAt: NOW }));
    await assertFails(updateDoc(doc(as('inst_pune'), `assignments/${PLAN}`), { totalPoints: 100 }));
    await assertFails(updateDoc(doc(as('inst_pune'), `assignments/${PLAN}`), { batchId: 'batch_mumbai' }));
  });

  it('students read only published assignments of their own batch', async () => {
    await assertSucceeds(getDoc(doc(as('stu_1'), `assignments/${PLAN}`)));
    await assertFails(getDoc(doc(as('stu_1'), `assignments/${MUMBAI_PLAN}`)));
    await assertFails(getDoc(doc(as('stu_mumbai'), `assignments/${PLAN}`)));
    await assertFails(getDoc(doc(as('stu_unenrolled'), `assignments/${PLAN}`)));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `assignments/${DRAFT_PLAN}`), assignment());
    });
    await assertFails(getDoc(doc(as('stu_1'), `assignments/${DRAFT_PLAN}`)));
  });
});

// -----------------------------------------------------------------------------
describe('Stage 7 — Student submissions', () => {
  it('enrolled student CAN submit once with a deterministic ID and server timestamp', async () => {
    await assertSucceeds(setDoc(doc(as('stu_1'), `submissions/${PLAN}_stu_1`), submission('stu_1')));
  });

  it('rejects wrong IDs, client-forged timestamps, self-grading and inflated attempts', async () => {
    const db = as('stu_1');
    await assertFails(setDoc(doc(db, 'submissions/random_id'), submission('stu_1')));
    await assertFails(setDoc(doc(db, `submissions/${PLAN}_stu_1`), submission('stu_1', { submittedAt: '2026-09-01T00:00:00.000Z' })));
    await assertFails(setDoc(doc(db, `submissions/${PLAN}_stu_1`), submission('stu_1', { score: 10 })));
    await assertFails(setDoc(doc(db, `submissions/${PLAN}_stu_1`), submission('stu_1', { status: 'graded' })));
    await assertFails(setDoc(doc(db, `submissions/${PLAN}_stu_1`), submission('stu_1', { attemptCount: 5 })));
    await assertFails(setDoc(doc(db, `submissions/${PLAN}_stu_1`), submission('stu_1', { extra: 'x' })));
  });

  it('CANNOT submit for another student, to another batch, or to an unpublished assignment', async () => {
    await assertFails(setDoc(doc(as('stu_1'), `submissions/${PLAN}_stu_unenrolled`), submission('stu_unenrolled')));
    await assertFails(setDoc(doc(as('stu_1'), `submissions/${MUMBAI_PLAN}_stu_1`), submission('stu_1', { assignmentId: MUMBAI_PLAN, batchId: 'batch_mumbai' })));
    await assertFails(setDoc(doc(as('stu_unenrolled'), `submissions/${PLAN}_stu_unenrolled`), submission('stu_unenrolled')));
    await assertFails(setDoc(doc(as('stu_suspended'), `submissions/${PLAN}_stu_suspended`), submission('stu_suspended')));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `assignments/${DRAFT_PLAN}`), assignment());
    });
    await assertFails(setDoc(doc(as('stu_1'), `submissions/${DRAFT_PLAN}_stu_1`), submission('stu_1', { assignmentId: DRAFT_PLAN })));
  });

  it('student CAN edit before review (attempt +1, fresh server time) but not keep the old attempt count', async () => {
    const ref = doc(as('stu_2'), `submissions/${PLAN}_stu_2`);
    await assertFails(updateDoc(ref, { textAnswer: 'Edited', attemptCount: 1, submittedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { textAnswer: 'Edited', attemptCount: 2, submittedAt: serverTimestamp() }));
  });

  it('students CANNOT read or modify another student\'s submission', async () => {
    await assertFails(getDoc(doc(as('stu_1'), `submissions/${PLAN}_stu_2`)));
    await assertFails(updateDoc(doc(as('stu_1'), `submissions/${PLAN}_stu_2`), { textAnswer: 'vandalised' }));
  });
});

describe('Stage 7 — Review and grading transitions', () => {
  const ref = (uid: string) => doc(as(uid), `submissions/${PLAN}_stu_2`);

  it('assigned instructor CAN grade within totalPoints with self-attributed server-timestamped grading', async () => {
    await assertSucceeds(updateDoc(ref('inst_pune'), grade('inst_pune')));
  });

  it('rejects scores above totalPoints or negative, forged grader, client grading time, missing score', async () => {
    await assertFails(updateDoc(ref('inst_pune'), grade('inst_pune', { score: 11 })));
    await assertFails(updateDoc(ref('inst_pune'), grade('inst_pune', { score: -1 })));
    await assertFails(updateDoc(ref('inst_pune'), grade('inst_pune', { gradedByUserId: 'uni_admin' })));
    await assertFails(updateDoc(ref('inst_pune'), grade('inst_pune', { gradedAt: NOW })));
    await assertFails(updateDoc(ref('inst_pune'), { status: 'graded', gradedByUserId: 'inst_pune', gradedAt: serverTimestamp() }));
  });

  it('reviewers cannot touch student content; out-of-scope staff cannot grade', async () => {
    await assertFails(updateDoc(ref('inst_pune'), { ...grade('inst_pune'), codeContent: 'rewritten' }));
    await assertFails(updateDoc(ref('inst_other'), grade('inst_other')));
    await assertFails(updateDoc(ref('inst_mumbai'), grade('inst_mumbai')));
    await assertFails(updateDoc(ref('ba_mumbai'), grade('ba_mumbai')));
    await assertSucceeds(updateDoc(ref('ba_pune'), grade('ba_pune')));
  });

  it('a graded submission CANNOT be reopened or altered by the student', async () => {
    await assertSucceeds(updateDoc(ref('inst_pune'), grade('inst_pune')));
    await assertFails(updateDoc(ref('stu_2'), { status: 'submitted', textAnswer: 'new', attemptCount: 2, submittedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref('stu_2'), { score: 10 }));
  });

  it('correction request needs feedback; student may then resubmit (attempt +1) without touching grades', async () => {
    await assertFails(updateDoc(ref('inst_pune'), { status: 'resubmit_requested', feedback: '', gradedByUserId: 'inst_pune', gradedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref('inst_pune'), { status: 'resubmit_requested', feedback: 'Handle the rejection case', gradedByUserId: 'inst_pune', gradedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref('stu_2'), { status: 'submitted', attemptCount: 2, submittedAt: serverTimestamp(), feedback: 'I think it was fine' }));
    await assertSucceeds(updateDoc(ref('stu_2'), { status: 'submitted', textAnswer: 'Fixed', attemptCount: 2, submittedAt: serverTimestamp() }));
  });

  it('reviewers in scope CAN read submissions; others CANNOT', async () => {
    await assertSucceeds(getDoc(ref('inst_pune')));
    await assertSucceeds(getDocs(query(collection(as('inst_pune'), 'submissions'),
      where('orgId', '==', 'strynkix'), where('batchId', '==', 'batch_pune'), where('assignmentId', '==', PLAN))));
    await assertFails(getDoc(ref('inst_mumbai')));
    await assertFails(getDoc(ref('uni_rival')));
  });
});

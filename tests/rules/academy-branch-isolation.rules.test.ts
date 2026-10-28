/**
 * Strynkix LMS — Phase 8.1 academy branch isolation.
 * Two franchise branches of the Strynkix academy org, each with its own branch
 * admin, instructor, student, batch, enrollment, plan, assignment, submission and
 * progress. Every denial has a positive control proving the same payload works
 * for the actor who IS in scope, so a denial can't pass merely on bad shape.
 * "coupling:" tests pin current university-admin behaviour documented in
 * docs/RELEASE_READINESS.md (Phase 8.1) for owner decision.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ORG = 'strynkix';
const NOW = '2026-10-01T00:00:00.000Z';
const DATE = '2026-10-01';
let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

async function trusted(fn: (db: Firestore) => Promise<unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}

const plan = (b: 'a' | 'b') => `batch_${b}_${DATE}`;
const enrollment = (b: 'a' | 'b') => `course_x_stu_${b}`;
const submission = (b: 'a' | 'b') => `${plan(b)}_stu_${b}`;
const progress = (b: 'a' | 'b') => `stu_${b}_course_x_les_1`;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'strynkix-lms-academy',
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
    const user = (uid: string, role: string, branchId: string | null, extra: Record<string, unknown> = {}) =>
      put(`users/${uid}`, { role, orgId: ORG, ...(branchId ? { branchId } : {}), status: 'active', email: `${uid}@example.test`, displayName: uid, ...extra });
    await user('super', 'super_admin', null);
    await user('uni', 'university_admin', null);
    await user('inst_unscoped', 'instructor', null);
    await put('courses/course_x', { orgId: ORG, title: 'X', status: 'published' });
    await put('lessons/les_1', { orgId: ORG, courseId: 'course_x', moduleId: 'm1', status: 'published' });
    for (const b of ['a', 'b'] as const) {
      await put(`branches/branch_${b}`, { orgId: ORG, name: `Branch ${b}`, status: 'active' });
      await user(`ba_${b}`, 'branch_admin', `branch_${b}`);
      await user(`inst_${b}`, 'instructor', `branch_${b}`);
      await user(`stu_${b}`, 'student', `branch_${b}`);
      await user(`stu_${b}2`, 'student', `branch_${b}`);
      await put(`batches/batch_${b}`, {
        orgId: ORG, branchId: `branch_${b}`, courseId: 'course_x', name: `Batch ${b}`, code: `B-${b}`,
        instructorUserIds: [`inst_${b}`], startDate: NOW, status: 'in_progress',
      });
      await put(`enrollments/${enrollment(b)}`, {
        orgId: ORG, branchId: `branch_${b}`, courseId: 'course_x', batchId: `batch_${b}`, studentId: `stu_${b}`, status: 'active', enrolledAt: NOW,
      });
      await put(`dailyPlans/${plan(b)}`, {
        orgId: ORG, branchId: `branch_${b}`, courseId: 'course_x', batchId: `batch_${b}`, date: DATE, title: 'Day 1',
        objectives: [], lessonIds: ['les_1'], learningDueAt: NOW, assignmentId: plan(b), status: 'published', createdById: `inst_${b}`,
      });
      await put(`assignments/${plan(b)}`, {
        orgId: ORG, courseId: 'course_x', batchId: `batch_${b}`, planId: plan(b), title: 'Lab', description: 'Do the lab',
        submissionType: 'text', totalPoints: 10, deadline: NOW, status: 'published', createdById: `inst_${b}`,
      });
      await put(`submissions/${submission(b)}`, {
        orgId: ORG, assignmentId: plan(b), batchId: `batch_${b}`, courseId: 'course_x', studentId: `stu_${b}`,
        textAnswer: 'answer', status: 'submitted', attemptCount: 1, submittedAt: Timestamp.fromDate(new Date(NOW)),
      });
      await put(`progress/${progress(b)}`, {
        orgId: ORG, courseId: 'course_x', moduleId: 'm1', lessonId: 'les_1', studentId: `stu_${b}`, batchId: `batch_${b}`,
        status: 'in_progress', timeSpentSeconds: 30,
      });
    }
  });
});

// Every branch-owned record of branch b, as single reads and as list queries.
const branchReads = (db: Firestore, b: 'a' | 'b'): Array<[string, () => Promise<unknown>]> => [
  ['batch', () => getDoc(doc(db, `batches/batch_${b}`))],
  ['enrollment', () => getDoc(doc(db, `enrollments/${enrollment(b)}`))],
  ['student profile', () => getDoc(doc(db, `users/stu_${b}`))],
  ['instructor profile', () => getDoc(doc(db, `users/inst_${b}`))],
  ['daily plan', () => getDoc(doc(db, `dailyPlans/${plan(b)}`))],
  ['assignment', () => getDoc(doc(db, `assignments/${plan(b)}`))],
  ['submission', () => getDoc(doc(db, `submissions/${submission(b)}`))],
  ['progress', () => getDoc(doc(db, `progress/${progress(b)}`))],
  ['batch list', () => getDocs(query(collection(db, 'batches'), where('orgId', '==', ORG), where('branchId', '==', `branch_${b}`)))],
  ['roster list', () => getDocs(query(collection(db, 'enrollments'), where('orgId', '==', ORG), where('branchId', '==', `branch_${b}`)))],
  ['user list', () => getDocs(query(collection(db, 'users'), where('orgId', '==', ORG), where('branchId', '==', `branch_${b}`)))],
];

async function expectAll(kind: 'allow' | 'deny', reads: Array<[string, () => Promise<unknown>]>) {
  for (const [label, read] of reads) {
    try {
      await (kind === 'allow' ? assertSucceeds(read()) : assertFails(read()));
    } catch (e) {
      throw new Error(`${kind} expected for "${label}": ${(e as Error).message}`);
    }
  }
}

const newBatch = (branch: string, extra: Record<string, unknown> = {}) => ({
  orgId: ORG, branchId: branch, courseId: 'course_x', name: 'New batch', code: 'NB-1',
  instructorUserIds: [], startDate: NOW, status: 'upcoming', ...extra,
});
const newEnrollment = (student: string, branch: string, batch: string, extra: Record<string, unknown> = {}) => ({
  orgId: ORG, branchId: branch, courseId: 'course_x', batchId: batch, studentId: student, status: 'active', enrolledAt: NOW, ...extra,
});
const grade = (uid: string) => ({ status: 'graded', score: 5, feedback: 'ok', gradedByUserId: uid, gradedAt: serverTimestamp() });

describe('Phase 8.1 — branch admin A cannot read branch B', () => {
  it('positive control: each branch admin reads every record of their own branch', async () => {
    await expectAll('allow', branchReads(as('ba_a'), 'a'));
    await expectAll('allow', branchReads(as('ba_b'), 'b'));
  });

  it('branch admin A is denied every branch B record, single read or list query', async () => {
    await expectAll('deny', branchReads(as('ba_a'), 'b'));
    await expectAll('deny', branchReads(as('ba_b'), 'a'));
  });

  it('an org-wide list query (no branch filter) is denied for a branch admin', async () => {
    await assertFails(getDocs(query(collection(as('ba_a'), 'batches'), where('orgId', '==', ORG))));
    await assertFails(getDocs(query(collection(as('ba_a'), 'enrollments'), where('orgId', '==', ORG))));
  });
});

describe('Phase 8.1 — branch admin A cannot modify branch B', () => {
  it('batches: create in B and edit batch B are denied; the same writes work for B\'s admin', async () => {
    await assertFails(setDoc(doc(as('ba_a'), 'batches/new_b'), newBatch('branch_b')));
    await assertSucceeds(setDoc(doc(as('ba_b'), 'batches/new_b'), newBatch('branch_b')));
    await assertFails(updateDoc(doc(as('ba_a'), 'batches/batch_b'), { name: 'Hijacked' }));
    await assertSucceeds(updateDoc(doc(as('ba_b'), 'batches/batch_b'), { name: 'Renamed' }));
  });

  it('enrollments: enrolling or withdrawing a branch B student is denied', async () => {
    await assertFails(setDoc(doc(as('ba_a'), 'enrollments/course_x_stu_b2'), newEnrollment('stu_b2', 'branch_b', 'batch_b')));
    await assertFails(updateDoc(doc(as('ba_a'), `enrollments/${enrollment('b')}`), { status: 'dropped' }));
    await assertSucceeds(setDoc(doc(as('ba_b'), 'enrollments/course_x_stu_b2'), newEnrollment('stu_b2', 'branch_b', 'batch_b')));
    await assertSucceeds(updateDoc(doc(as('ba_b'), `enrollments/${enrollment('b')}`), { status: 'dropped' }));
  });

  it('teaching records: editing B\'s plan or grading B\'s submission is denied', async () => {
    await assertFails(updateDoc(doc(as('ba_a'), `dailyPlans/${plan('b')}`), { title: 'Hijacked' }));
    await assertFails(updateDoc(doc(as('ba_a'), `submissions/${submission('b')}`), grade('ba_a')));
    await assertSucceeds(updateDoc(doc(as('ba_b'), `dailyPlans/${plan('b')}`), { title: 'Edited' }));
    await assertSucceeds(updateDoc(doc(as('ba_b'), `submissions/${submission('b')}`), grade('ba_b')));
  });

  it('people: editing, suspending or creating branch B users is denied', async () => {
    await assertFails(updateDoc(doc(as('ba_a'), 'users/stu_b'), { displayName: 'Renamed' }));
    await assertFails(updateDoc(doc(as('ba_a'), 'users/inst_b'), { status: 'suspended' }));
    await assertFails(setDoc(doc(as('ba_a'), 'users/new_b'), { role: 'student', orgId: ORG, branchId: 'branch_b', status: 'active', email: 'n@example.test', displayName: 'N' }));
    await assertSucceeds(updateDoc(doc(as('ba_b'), 'users/stu_b'), { displayName: 'Renamed' }));
    await assertSucceeds(setDoc(doc(as('ba_b'), 'users/new_b'), { role: 'student', orgId: ORG, branchId: 'branch_b', status: 'active', email: 'n@example.test', displayName: 'N' }));
  });

  it('branch documents: admin A cannot edit branch B', async () => {
    await assertFails(updateDoc(doc(as('ba_a'), 'branches/branch_b'), { name: 'Hijacked' }));
    await assertSucceeds(updateDoc(doc(as('ba_b'), 'branches/branch_b'), { name: 'Branch B renamed' }));
  });
});

describe('Phase 8.1 — forged tenant, branch, role, ownership and relationship fields', () => {
  it('a branch admin cannot move their batch, student or instructor into another branch', async () => {
    await assertFails(updateDoc(doc(as('ba_a'), 'batches/batch_a'), { branchId: 'branch_b' }));
    await assertFails(updateDoc(doc(as('ba_a'), 'users/stu_a'), { branchId: 'branch_b' }));
    await assertFails(updateDoc(doc(as('ba_a'), 'users/inst_a'), { branchId: 'branch_b' }));
  });

  it('a branch admin cannot relabel orgId on their own records', async () => {
    await assertFails(updateDoc(doc(as('ba_a'), 'batches/batch_a'), { orgId: 'rival' }));
    await assertFails(updateDoc(doc(as('ba_a'), 'users/stu_a'), { orgId: 'rival' }));
    await assertFails(updateDoc(doc(as('ba_a'), `enrollments/${enrollment('a')}`), { orgId: 'rival' }));
  });

  it('a branch admin cannot grant admin roles or change their own role or branch', async () => {
    await assertFails(updateDoc(doc(as('ba_a'), 'users/stu_a'), { role: 'branch_admin' }));
    await assertFails(updateDoc(doc(as('ba_a'), 'users/inst_a'), { role: 'university_admin' }));
    await assertFails(setDoc(doc(as('ba_a'), 'users/new_admin'), { role: 'branch_admin', orgId: ORG, branchId: 'branch_a', status: 'active', email: 'x@example.test', displayName: 'X' }));
    await assertFails(updateDoc(doc(as('ba_a'), 'users/ba_a'), { branchId: 'branch_b' }));
    await assertFails(updateDoc(doc(as('ba_a'), 'users/ba_a'), { role: 'super_admin' }));
  });

  it('students and instructors cannot change their own role, status, org or branch', async () => {
    for (const uid of ['stu_a', 'inst_a']) {
      await assertFails(updateDoc(doc(as(uid), `users/${uid}`), { role: 'branch_admin' }));
      await assertFails(updateDoc(doc(as(uid), `users/${uid}`), { branchId: 'branch_b' }));
      await assertFails(updateDoc(doc(as(uid), `users/${uid}`), { orgId: 'rival' }));
      await assertFails(updateDoc(doc(as(uid), `users/${uid}`), { status: 'active', role: 'super_admin' }));
    }
  });

  it('creator and enroller IDs cannot be forged, and are immutable', async () => {
    await assertFails(setDoc(doc(as('ba_a'), 'batches/forged'), newBatch('branch_a', { createdById: 'ba_b' })));
    await assertFails(setDoc(doc(as('ba_a'), 'enrollments/course_x_stu_a2'), newEnrollment('stu_a2', 'branch_a', 'batch_a', { enrolledById: 'ba_b' })));
    await assertSucceeds(setDoc(doc(as('ba_a'), 'enrollments/course_x_stu_a2'), newEnrollment('stu_a2', 'branch_a', 'batch_a', { enrolledById: 'ba_a' })));
    await assertFails(updateDoc(doc(as('ba_a'), 'enrollments/course_x_stu_a2'), { enrolledById: 'ba_b' }));
    await assertFails(updateDoc(doc(as('ba_a'), `dailyPlans/${plan('a')}`), { createdById: 'ba_a' }));
  });

  it('enrollment relationships must be consistent: no cross-branch batch, student, or mislabelled branch', async () => {
    // A's student into B's batch, labelled either branch.
    await assertFails(setDoc(doc(as('ba_a'), 'enrollments/course_x_stu_a2'), newEnrollment('stu_a2', 'branch_a', 'batch_b')));
    await assertFails(setDoc(doc(as('ba_a'), 'enrollments/course_x_stu_a2'), newEnrollment('stu_a2', 'branch_b', 'batch_b')));
    // B's student into A's batch.
    await assertFails(setDoc(doc(as('ba_a'), 'enrollments/course_x_stu_b2'), newEnrollment('stu_b2', 'branch_a', 'batch_a')));
    // Moving A's existing enrollment into B's batch.
    await assertFails(updateDoc(doc(as('ba_a'), `enrollments/${enrollment('a')}`), { batchId: 'batch_b', branchId: 'branch_b' }));
    // Enrollment ID must match {courseId}_{studentId}.
    await assertFails(setDoc(doc(as('ba_a'), 'enrollments/course_x_someone_else'), newEnrollment('stu_a2', 'branch_a', 'batch_a')));
  });

  it('enrolling a new student: the branch-scoped existence query works, a point read of the missing doc stays denied', async () => {
    const db = as('ba_a');
    const snap = await assertSucceeds(getDocs(query(collection(db, 'enrollments'),
      where('orgId', '==', ORG), where('branchId', '==', 'branch_a'), where('courseId', '==', 'course_x'), where('studentId', '==', 'stu_a2'))));
    if (!snap.empty) throw new Error('expected no enrollment yet');
    // Rules never open "read anything that doesn't exist" (that would be an existence oracle).
    await assertFails(getDoc(doc(as('stu_a'), 'enrollments/course_x_stu_a2')));
    await assertSucceeds(setDoc(doc(db, 'enrollments/course_x_stu_a2'), newEnrollment('stu_a2', 'branch_a', 'batch_a')));
  });

  it('a branch admin cannot assign another branch\'s instructor to their batch', async () => {
    await assertFails(updateDoc(doc(as('ba_a'), 'batches/batch_a'), { instructorUserIds: ['inst_a', 'inst_b'] }));
    await assertSucceeds(updateDoc(doc(as('ba_b'), 'batches/batch_b'), { instructorUserIds: ['inst_b', 'inst_unscoped'] }));
  });
});

describe('Phase 8.1 — instructors and students stay inside their branch', () => {
  it('instructor A cannot read or grade branch B teaching records', async () => {
    await assertFails(getDoc(doc(as('inst_a'), `dailyPlans/${plan('b')}`)));
    await assertFails(getDoc(doc(as('inst_a'), `submissions/${submission('b')}`)));
    await assertFails(getDoc(doc(as('inst_a'), `progress/${progress('b')}`)));
    await assertFails(getDocs(query(collection(as('inst_a'), 'enrollments'), where('orgId', '==', ORG), where('batchId', '==', 'batch_b'))));
    await assertFails(updateDoc(doc(as('inst_a'), `submissions/${submission('b')}`), grade('inst_a')));
    await assertSucceeds(updateDoc(doc(as('inst_b'), `submissions/${submission('b')}`), grade('inst_b')));
  });

  it('student A cannot read branch B\'s batch, plan, assignment or submissions', async () => {
    await assertFails(getDoc(doc(as('stu_a'), 'batches/batch_b')));
    await assertFails(getDoc(doc(as('stu_a'), `dailyPlans/${plan('b')}`)));
    await assertFails(getDoc(doc(as('stu_a'), `assignments/${plan('b')}`)));
    await assertFails(getDoc(doc(as('stu_a'), `submissions/${submission('b')}`)));
    await assertSucceeds(getDoc(doc(as('stu_a'), `dailyPlans/${plan('a')}`)));
  });
});

describe('Phase 8.1 — a branch admin profile with no branchId has no branch authority', () => {
  beforeEach(async () => {
    await trusted((db) => setDoc(doc(db, 'users/ba_none'), { role: 'branch_admin', orgId: ORG, status: 'active', email: 'none@example.test', displayName: 'No branch' }));
  });

  it('cannot read org-wide (unscoped) staff profiles', async () => {
    await assertFails(getDoc(doc(as('ba_none'), 'users/inst_unscoped')));
    await assertFails(getDoc(doc(as('ba_none'), 'users/uni')));
    await assertFails(getDoc(doc(as('ba_none'), 'users/super')));
  });

  it('cannot mint unscoped instructors or students', async () => {
    await assertFails(setDoc(doc(as('ba_none'), 'users/minted'), { role: 'instructor', orgId: ORG, branchId: '', status: 'active', email: 'm@example.test', displayName: 'M' }));
    await assertFails(setDoc(doc(as('ba_none'), 'users/minted2'), { role: 'student', orgId: ORG, branchId: '', status: 'active', email: 'm2@example.test', displayName: 'M2' }));
  });

  it('cannot read or modify any branch\'s records', async () => {
    await expectAll('deny', branchReads(as('ba_none'), 'a'));
    await assertFails(updateDoc(doc(as('ba_none'), 'batches/batch_a'), { name: 'X' }));
  });
});

describe('Phase 8.1 — coupling: university admin in the academy org (owner decision)', () => {
  it('coupling: a university_admin placed in the academy org manages every academy branch', async () => {
    await expectAll('allow', branchReads(as('uni'), 'a'));
    await expectAll('allow', branchReads(as('uni'), 'b'));
    await assertSucceeds(updateDoc(doc(as('uni'), 'batches/batch_b'), { name: 'Changed by university admin' }));
  });
});

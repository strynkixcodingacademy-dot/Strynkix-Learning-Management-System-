/**
 * Stage 7 — Daily learning & assignment workflow on the Firestore emulator, using
 * the real service functions under the real security rules.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getAssignment,
  getAssignmentSubmissions,
  getOwnSubmission,
  getStudentPlans,
  getStudentSubmissions,
  gradeSubmission,
  listenToOwnSubmission,
  loadStudentCourseOverview,
  requestCorrection,
  saveDailyAssignment,
  savePlan,
  setPlanStatus,
  submitAssignment,
} from '@/lib/learning/service';
import { isLateSubmission } from '@/lib/learning/submission-state';
import { toLocalDateKey } from '@/lib/learning/metrics';
import { recordLessonProgress } from '@/lib/livebook/service';
import { Batch, DailyPlan, Enrollment, Submission } from '@/types/domain';
import { TenantContext } from '@/types/auth';

let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

const NOW = new Date();
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
const HOUR = 3600_000;
const TODAY = toLocalDateKey(NOW);
const YESTERDAY = toLocalDateKey(new Date(NOW.getTime() - 24 * HOUR));
const TOMORROW = toLocalDateKey(new Date(NOW.getTime() + 24 * HOUR));

const batch: Batch = {
  id: 'wf7_batch', orgId: 'strynkix', branchId: 'branch_pune', courseId: 'wf7_course', name: 'WF7', code: 'WF7',
  instructorUserIds: ['wf7_inst'], startDate: iso(-30 * 24 * HOUR), status: 'in_progress', createdAt: '', updatedAt: '',
};
const instructor: TenantContext = { role: 'instructor', orgId: 'strynkix', branchId: 'branch_pune' };
const outsider: TenantContext = { role: 'instructor', orgId: 'strynkix', branchId: 'branch_pune' };
const enrollment = (studentId: string): Enrollment => ({
  id: `wf7_course_${studentId}`, orgId: 'strynkix', branchId: 'branch_pune', courseId: 'wf7_course', batchId: 'wf7_batch',
  studentId, status: 'active', enrolledAt: iso(-10 * 24 * HOUR), createdAt: '', updatedAt: '',
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'strynkix-lms-stage7',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (p: string, data: Record<string, unknown>) => setDoc(doc(db, p), data);
    const user = (uid: string, role: string) =>
      put(`users/${uid}`, { role, orgId: 'strynkix', branchId: 'branch_pune', status: 'active', displayName: uid, email: `${uid}@example.test` });
    await put('branches/branch_pune', { orgId: 'strynkix', status: 'active' });
    await user('wf7_inst', 'instructor');
    await user('wf7_other_inst', 'instructor');
    await user('wf7_stu_1', 'student');
    await user('wf7_stu_2', 'student');
    await put('courses/wf7_course', { orgId: 'strynkix', title: 'WF7 Course', status: 'published' });
    await put('courses/wf7_other_course', { orgId: 'strynkix', title: 'Other', status: 'published' });
    for (const id of ['wf7_les_1', 'wf7_les_2']) {
      await put(`lessons/${id}`, { orgId: 'strynkix', courseId: 'wf7_course', moduleId: 'wf7_mod', title: id, status: 'published', orderIndex: 0 });
    }
    await put('lessons/wf7_foreign', { orgId: 'strynkix', courseId: 'wf7_other_course', moduleId: 'x', title: 'Foreign', status: 'published' });
    const { id, ...batchData } = batch;
    await put(`batches/${id}`, batchData);
    for (const s of ['wf7_stu_1', 'wf7_stu_2']) {
      const { id: eid, ...e } = enrollment(s);
      await put(`enrollments/${eid}`, e);
    }
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

describe('Stage 7 — end-to-end daily learning workflow (emulator)', () => {
  let pastPlan: DailyPlan;
  let todayPlan: DailyPlan;

  it('1. assigned instructor plans two days and attaches daily assignments; validation and scope are enforced', async () => {
    const db = as('wf7_inst');
    pastPlan = await savePlan(batch, {
      date: YESTERDAY, title: 'Day 1: Foundations', objectives: ['Read both lessons'],
      lessonIds: ['wf7_les_1', 'wf7_les_2'], learningDueAt: iso(-2 * HOUR),
    }, instructor, 'wf7_inst', null, db);
    todayPlan = await savePlan(batch, {
      date: TODAY, title: 'Day 2: Practice', objectives: ['Finish lesson 2'],
      lessonIds: ['wf7_les_2'], learningDueAt: iso(6 * HOUR),
    }, instructor, 'wf7_inst', null, db);

    await expect(savePlan(batch, { date: TOMORROW, title: 'Bad', objectives: [], lessonIds: ['wf7_foreign'], learningDueAt: iso(30 * HOUR) },
      instructor, 'wf7_inst', null, db)).rejects.toThrow(/not published lessons of this course/);
    await expect(savePlan(batch, { date: YESTERDAY, title: 'Dup', objectives: [], lessonIds: [], learningDueAt: iso(HOUR) },
      instructor, 'wf7_inst', null, db)).rejects.toThrow(/already exists/);
    await expect(savePlan(batch, { date: TOMORROW, title: 'Outsider', objectives: [], lessonIds: [], learningDueAt: iso(30 * HOUR) },
      outsider, 'wf7_other_inst', null, as('wf7_other_inst'))).rejects.toThrow(/not authorized/);

    await saveDailyAssignment(pastPlan, {
      title: 'Lab 1', description: 'Explain closures and show code.', submissionType: 'text_and_code', totalPoints: 10, deadline: iso(-HOUR),
    }, 'wf7_inst', null, db);
    await saveDailyAssignment(todayPlan, {
      title: 'Lab 2', description: 'Write a promise chain.', submissionType: 'code', totalPoints: 20, deadline: iso(5 * HOUR),
    }, 'wf7_inst', null, db);
  });

  it('2. students see nothing until the plans are published', async () => {
    expect(await getStudentPlans(enrollment('wf7_stu_1'), as('wf7_stu_1'))).toEqual([]);
    const db = as('wf7_inst');
    for (const plan of [pastPlan, todayPlan]) {
      await setPlanStatus(plan, 'published', await getAssignment(plan.id, db), db);
    }
    const plans = await getStudentPlans(enrollment('wf7_stu_1'), as('wf7_stu_1'));
    expect(plans.map((p) => p.date)).toEqual([TODAY, YESTERDAY]);
    expect(plans.every((p) => p.assignmentId === p.id)).toBe(true);
  });

  it('3. a late submission is accepted and identified from the server timestamp', async () => {
    const db = as('wf7_stu_1');
    const lab1 = (await getAssignment(pastPlan.id, db))!;
    await expect(submitAssignment({ assignment: lab1, studentId: 'wf7_stu_1', textAnswer: 'Only text' }, db)).rejects.toThrow(/Both/);
    await submitAssignment({ assignment: lab1, studentId: 'wf7_stu_1', textAnswer: 'Closures capture scope', codeContent: 'const f = () => x;' }, db);
    const sub = (await getOwnSubmission('strynkix', 'wf7_stu_1', lab1.id, db))!;
    expect(sub).toMatchObject({ status: 'submitted', attemptCount: 1 });
    expect(isLateSubmission(sub.submittedAt, lab1.deadline)).toBe(true);

    const lab2 = (await getAssignment(todayPlan.id, db))!;
    await submitAssignment({ assignment: lab2, studentId: 'wf7_stu_1', codeContent: 'fetch().then(r => r.json())' }, db);
    const onTime = (await getOwnSubmission('strynkix', 'wf7_stu_1', lab2.id, db))!;
    expect(isLateSubmission(onTime.submittedAt, lab2.deadline)).toBe(false);
  });

  it('4. instructor requests a correction; the student is notified live and resubmits', async () => {
    const inst = as('wf7_inst');
    const lab1 = (await getAssignment(pastPlan.id, inst))!;
    const [sub] = await getAssignmentSubmissions(lab1, inst);

    const updates: Submission[] = [];
    const unsubscribe = listenToOwnSubmission('strynkix', 'wf7_stu_1', lab1.id,
      (s) => s && updates.push(s), (err) => { throw err; }, as('wf7_stu_1'));

    await expect(requestCorrection(sub, { feedback: '' }, 'wf7_inst', inst)).rejects.toThrow();
    await requestCorrection(sub, { feedback: 'Add an example with a loop.' }, 'wf7_inst', inst);
    // Generous window: listener delivery is slower when the full emulator suite runs.
    await expect.poll(() => updates.at(-1)?.status, { timeout: 10000 }).toBe('resubmit_requested');
    unsubscribe();

    const stu = as('wf7_stu_1');
    await submitAssignment({ assignment: lab1, studentId: 'wf7_stu_1', textAnswer: 'Now with a loop', codeContent: 'for (const f of fs) f();' }, stu);
    expect(await getOwnSubmission('strynkix', 'wf7_stu_1', lab1.id, stu)).toMatchObject({ status: 'submitted', attemptCount: 2 });
  });

  it('5. instructor grades within marks; a graded submission is final for the student', async () => {
    const inst = as('wf7_inst');
    const lab1 = (await getAssignment(pastPlan.id, inst))!;
    const [sub] = await getAssignmentSubmissions(lab1, inst);
    await expect(gradeSubmission(sub, lab1, { score: 11, feedback: '' }, 'wf7_inst', inst)).rejects.toThrow(/cannot exceed 10/);
    await gradeSubmission(sub, lab1, { score: 7, feedback: 'Good fix' }, 'wf7_inst', inst);

    const stu = as('wf7_stu_1');
    expect(await getOwnSubmission('strynkix', 'wf7_stu_1', lab1.id, stu)).toMatchObject({ status: 'graded', score: 7, feedback: 'Good fix' });
    await expect(submitAssignment({ assignment: lab1, studentId: 'wf7_stu_1', textAnswer: 'x', codeContent: 'y' }, stu)).rejects.toThrow(/graded/);
  });

  it('6. metrics reflect learning, submission and assessment separately', async () => {
    const stu = as('wf7_stu_1');
    await recordLessonProgress({
      studentId: 'wf7_stu_1', orgId: 'strynkix', courseId: 'wf7_course', moduleId: 'wf7_mod',
      lessonId: 'wf7_les_1', batchId: 'wf7_batch', status: 'completed', timeSpentSeconds: 60,
    }, stu);
    // Opening lesson 2 is not completion.
    await recordLessonProgress({
      studentId: 'wf7_stu_1', orgId: 'strynkix', courseId: 'wf7_course', moduleId: 'wf7_mod',
      lessonId: 'wf7_les_2', batchId: 'wf7_batch', status: 'in_progress', timeSpentSeconds: 30,
    }, stu);

    const subs = await getStudentSubmissions('strynkix', 'wf7_stu_1', stu);
    const overview = (await loadStudentCourseOverview(enrollment('wf7_stu_1'), 'wf7_stu_1', subs, new Date(), stu))!;
    expect(overview.metrics.learningCompletion).toEqual({ numerator: 1, denominator: 2, percentage: 50 });
    expect(overview.metrics.overdueLessons.map((o) => o.lessonId)).toEqual(['wf7_les_2']);
    expect(overview.metrics.submissionRate).toEqual({ numerator: 1, denominator: 1, percentage: 100 });
    expect(overview.metrics.upcomingAssignments).toBe(1);
    expect(overview.metrics.assessment).toMatchObject({ numerator: 7, denominator: 10, percentage: 70, gradedCount: 1 });
    expect(overview.metrics.lateSubmissions).toBe(1);
    expect(overview.courseCompletion).toEqual({ completed: 1, total: 2, percentage: 50 });

    const stu2 = as('wf7_stu_2');
    const other = (await loadStudentCourseOverview(enrollment('wf7_stu_2'), 'wf7_stu_2',
      await getStudentSubmissions('strynkix', 'wf7_stu_2', stu2), new Date(), stu2))!;
    expect(other.metrics.submissionRate).toEqual({ numerator: 0, denominator: 1, percentage: 0 });
    expect(other.metrics.overdueAssignments).toHaveLength(1);
    expect(other.metrics.assessment.percentage).toBeNull();
  });

  it('7. a student cannot read a classmate\'s submission through the service', async () => {
    await expect(getAssignmentSubmissions((await getAssignment(pastPlan.id, as('wf7_inst')))!, as('wf7_stu_2')))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });
});

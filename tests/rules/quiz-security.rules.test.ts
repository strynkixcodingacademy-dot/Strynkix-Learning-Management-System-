/**
 * Strynkix LMS — Stage C1 assessment security against firestore.rules.
 * Confidential answer keys (lessons/{id}/answerKey/current), server-only quiz
 * results and completion of quiz-carrying lessons, immutable attempt history,
 * and regressions for lessons without quizzes, legacy inline quizzes and
 * instructor / branch-admin draft authoring.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NOW = '2026-10-29T00:00:00.000Z';
let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

const cd = (responsibilities: string[], assignedCourseIds: string[]) => ({
  department: 'course_design', responsibilities, assignedCourseIds, assignedAt: NOW, assignedByUserId: 'super',
});

const question = (id: string) => ({
  id, type: 'quiz', question: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
});

const key = (lessonId: string, courseId: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'org_a', courseId, lessonId, keyVersion: 1, release: 'after_pass',
  items: [{ blockId: 'q1', correctOptionId: 'a', explanation: 'Because A.' }],
  updatedById: 'super', updatedAt: NOW, ...overrides,
});

const SUMMARY = {
  attemptCount: 1, bestCorrect: 1, bestPercent: 100, lastCorrect: 1, lastPercent: 100, total: 1, passed: true,
  keyVersion: 1, attemptDay: '2026-10-29', attemptsToday: 1, lastAttemptAt: NOW, firstPassedAt: NOW,
};

const progress = (lessonId: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'org_a', courseId: 'c_pub', moduleId: 'm_pub', lessonId, studentId: 'stu', batchId: 'bt1',
  status: 'in_progress', timeSpentSeconds: 30, lastAccessedAt: NOW, createdAt: NOW, updatedAt: NOW, ...overrides,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'strynkix-lms-quizsecurity',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (p: string, d: Record<string, unknown>) => setDoc(doc(db, p), d);
    const user = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
      put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@x.test`, displayName: uid, ...extra });
    await put('branches/b1', { orgId: 'org_a', name: 'B1', status: 'active' });
    await put('branches/b2', { orgId: 'org_a', name: 'B2', status: 'active' });
    await user('super', 'super_admin');
    await user('uni', 'university_admin');
    await user('ba', 'branch_admin', { branchId: 'b1' });
    await user('ba_b2', 'branch_admin', { branchId: 'b2' });
    await user('inst', 'instructor', { branchId: 'b1' });
    await user('inst_other', 'instructor', { branchId: 'b1' });
    await user('stu', 'student', { branchId: 'b1' });
    await user('stu2', 'student', { branchId: 'b1' });
    await user('designer_c1', 'content_designer', { courseDesign: cd(['content_developer'], ['c1']) });
    await user('designer_pub', 'content_designer', { courseDesign: cd(['content_developer'], ['c_pub']) });
    await user('reviewer_c1', 'content_designer', { courseDesign: cd(['reviewer'], ['c1']) });
    await user('assess_c1', 'content_designer', { courseDesign: cd(['assessment_designer'], ['c1']) });
    await user('designer_b', 'content_designer', { orgId: 'org_b', courseDesign: cd(['content_developer', 'reviewer'], ['*']) });
    await user('inst_b', 'instructor', { orgId: 'org_b' });
    await user('stu_b', 'student', { orgId: 'org_b' });

    await put('courses/c1', { orgId: 'org_a', title: 'Draft course', status: 'draft', createdById: 'super' });
    await put('courses/c_pub', { orgId: 'org_a', title: 'Published course', status: 'published', createdById: 'super' });
    await put('modules/m1', { orgId: 'org_a', courseId: 'c1', title: 'M1', status: 'draft' });
    await put('modules/m_pub', { orgId: 'org_a', courseId: 'c_pub', title: 'M', status: 'published' });
    const lesson = (id: string, courseId: string, moduleId: string, status: string, blocks: unknown[]) =>
      put(`lessons/${id}`, { orgId: 'org_a', courseId, moduleId, title: id, status, blocks, createdAt: NOW, updatedAt: NOW });
    await lesson('l_draft', 'c1', 'm1', 'draft', [question('q1')]);
    await lesson('l_quiz', 'c_pub', 'm_pub', 'published', [question('q1')]);
    await lesson('l_plain', 'c_pub', 'm_pub', 'published', [{ id: 't1', type: 'text', content: 'Read me.' }]);
    await lesson('l_legacy', 'c_pub', 'm_pub', 'published', [{ ...question('q1'), correctOptionId: 'a', explanation: 'Because A.' }]);
    await lesson('l_emptykey', 'c_pub', 'm_pub', 'published', [{ id: 't1', type: 'text', content: 'No quiz any more.' }]);
    // Drafts in the published course: answer keys are managed only on drafts (Stage C3).
    await lesson('l_quiz_d', 'c_pub', 'm_pub', 'draft', [question('q1')]);
    await lesson('l_plain_d', 'c_pub', 'm_pub', 'draft', [{ id: 't1', type: 'text', content: 'Read me.' }]);
    await put('lessons/l_draft/answerKey/current', key('l_draft', 'c1'));
    await put('lessons/l_quiz/answerKey/current', key('l_quiz', 'c_pub'));
    await put('lessons/l_quiz_d/answerKey/current', key('l_quiz_d', 'c_pub'));
    await put('lessons/l_emptykey/answerKey/current', key('l_emptykey', 'c_pub', { keyVersion: 2, items: [] }));

    await put('batches/bt1', { orgId: 'org_a', branchId: 'b1', courseId: 'c_pub', name: 'B1 batch', instructorUserIds: ['inst'], status: 'in_progress' });
    await put('enrollments/c_pub_stu', { orgId: 'org_a', branchId: 'b1', courseId: 'c_pub', batchId: 'bt1', studentId: 'stu', status: 'active', enrolledAt: NOW });

    // Server-written state: a passed quiz lesson and its first attempt.
    await put('progress/stu_c_pub_l_quiz', progress('l_quiz', { status: 'completed', completedAt: NOW, quiz: SUMMARY }));
    await put('progress/stu_c_pub_l_quiz/quizAttempts/000001', {
      attemptNumber: 1, studentId: 'stu', orgId: 'org_a', courseId: 'c_pub', lessonId: 'l_quiz', batchId: 'bt1',
      keyVersion: 1, answers: { q1: 'a' }, correct: 1, total: 1, percent: 100, passed: true, attemptedAt: NOW,
    });
  });
});

const KEY = 'lessons/l_quiz/answerKey/current';
const DRAFT_KEY = 'lessons/l_draft/answerKey/current';

describe('C1 — answer keys are confidential', () => {
  it('students (enrolled or not, any org) can never read or list a key', async () => {
    for (const uid of ['stu', 'stu2', 'stu_b']) {
      await assertFails(getDoc(doc(as(uid), KEY)));
      await assertFails(getDocs(collection(as(uid), 'lessons/l_quiz/answerKey')));
    }
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore() as unknown as Firestore, KEY)));
  });

  it('positive control: the enrolled student can still read the (answer-free) lesson', async () => {
    const snap = await assertSucceeds(getDoc(doc(as('stu'), 'lessons/l_quiz')));
    const blocks = snap.data()!.blocks as Record<string, unknown>[];
    for (const b of blocks) {
      if (b.type === 'quiz') {
        if ('correctOptionId' in b || 'explanation' in b) throw new Error('lesson leaks answers');
      }
    }
  });

  it('students cannot create, change or delete a key', async () => {
    const db = as('stu');
    await assertFails(setDoc(doc(db, 'lessons/l_plain/answerKey/current'), key('l_plain', 'c_pub', { updatedById: 'stu' })));
    await assertFails(updateDoc(doc(db, KEY), { keyVersion: 2, updatedById: 'stu' }));
    await assertFails(setDoc(doc(db, KEY), key('l_quiz', 'c_pub', { keyVersion: 2, updatedById: 'stu', items: [] })));
  });

  it('authors in the org read keys; staff of another org cannot', async () => {
    for (const uid of ['super', 'uni', 'ba', 'inst']) await assertSucceeds(getDoc(doc(as(uid), KEY)));
    for (const uid of ['inst_b', 'designer_b']) {
      await assertFails(getDoc(doc(as(uid), KEY)));
      await assertFails(getDoc(doc(as(uid), DRAFT_KEY)));
    }
  });

  it('Course Design members read only in-scope keys', async () => {
    await assertSucceeds(getDoc(doc(as('designer_c1'), DRAFT_KEY)));
    await assertSucceeds(getDoc(doc(as('reviewer_c1'), DRAFT_KEY)));
    await assertFails(getDoc(doc(as('designer_c1'), KEY)));
    await assertFails(getDoc(doc(as('reviewer_c1'), KEY)));
  });

  it('only the document "current" is readable or writable', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'lessons/l_quiz/answerKey/old'), key('l_quiz', 'c_pub'));
    });
    await assertFails(getDoc(doc(as('inst'), 'lessons/l_quiz/answerKey/old')));
    await assertFails(setDoc(doc(as('inst'), 'lessons/l_plain/answerKey/v1'), key('l_plain', 'c_pub', { updatedById: 'inst' })));
  });
});

describe('C1 — managing answer keys', () => {
  it('C3: the live key of a published lesson never changes from a client, not even the Super Admin’s', async () => {
    for (const uid of ['inst', 'ba', 'super']) {
      await assertFails(setDoc(doc(as(uid), KEY), key('l_quiz', 'c_pub', { keyVersion: 2, updatedById: uid })));
      await assertFails(setDoc(doc(as(uid), 'lessons/l_plain/answerKey/current'), key('l_plain', 'c_pub', { updatedById: uid })));
    }
  });

  it('instructors and branch admins create and update keys of drafts, bumping keyVersion each time', async () => {
    await assertSucceeds(setDoc(doc(as('inst'), 'lessons/l_plain_d/answerKey/current'), key('l_plain_d', 'c_pub', { updatedById: 'inst' })));
    await assertSucceeds(setDoc(doc(as('ba'), 'lessons/l_quiz_d/answerKey/current'), key('l_quiz_d', 'c_pub', { keyVersion: 2, updatedById: 'ba' })));
  });

  it('a key update must bump keyVersion by exactly one and keep org and course', async () => {
    const db = as('inst');
    await assertFails(setDoc(doc(db, 'lessons/l_quiz_d/answerKey/current'), key('l_quiz_d', 'c_pub', { keyVersion: 1, updatedById: 'inst' })));
    await assertFails(setDoc(doc(db, 'lessons/l_quiz_d/answerKey/current'), key('l_quiz_d', 'c_pub', { keyVersion: 5, updatedById: 'inst' })));
    await assertFails(setDoc(doc(db, 'lessons/l_quiz_d/answerKey/current'), key('l_quiz_d', 'c1', { keyVersion: 2, updatedById: 'inst' })));
    await assertFails(setDoc(doc(db, 'lessons/l_plain_d/answerKey/current'), key('l_plain_d', 'c_pub', { keyVersion: 3, updatedById: 'inst' })));
  });

  it('rejects malformed keys: wrong lesson, extra fields, other release policy, forged author, too many items', async () => {
    const db = as('inst');
    const target = doc(db, 'lessons/l_plain_d/answerKey/current');
    await assertFails(setDoc(target, key('l_quiz_d', 'c_pub', { updatedById: 'inst' })));
    await assertFails(setDoc(target, { ...key('l_plain_d', 'c_pub', { updatedById: 'inst' }), secret: true }));
    await assertFails(setDoc(target, key('l_plain_d', 'c_pub', { updatedById: 'inst', release: 'immediately' })));
    await assertFails(setDoc(target, key('l_plain_d', 'c_pub', { updatedById: 'super' })));
    await assertFails(setDoc(target, key('l_plain_d', 'c_pub', { updatedById: 'inst', updatedAt: 'now' })));
    const many = Array.from({ length: 21 }, (_, i) => ({ blockId: `q${i}`, correctOptionId: 'a', explanation: 'Because A.' }));
    await assertFails(setDoc(target, key('l_plain_d', 'c_pub', { updatedById: 'inst', items: many })));
    await assertFails(setDoc(target, key('l_plain_d', 'c1', { updatedById: 'inst' })));
  });

  it('content developers and assessment designers manage in-scope draft keys only; reviewers never write', async () => {
    await assertSucceeds(setDoc(doc(as('designer_c1'), DRAFT_KEY), key('l_draft', 'c1', { keyVersion: 2, updatedById: 'designer_c1' })));
    await assertSucceeds(setDoc(doc(as('assess_c1'), DRAFT_KEY), key('l_draft', 'c1', { keyVersion: 3, updatedById: 'assess_c1' })));
    await assertFails(setDoc(doc(as('reviewer_c1'), DRAFT_KEY), key('l_draft', 'c1', { keyVersion: 4, updatedById: 'reviewer_c1' })));
    // In scope but the course is published: no changes outside the draft stage.
    await assertFails(setDoc(doc(as('designer_pub'), KEY), key('l_quiz', 'c_pub', { keyVersion: 2, updatedById: 'designer_pub' })));
    await assertFails(setDoc(doc(as('designer_b'), DRAFT_KEY), key('l_draft', 'c1', { keyVersion: 2, updatedById: 'designer_b' })));
  });

  it('only the Super Admin deletes a key', async () => {
    await assertFails(testEnv.authenticatedContext('inst').firestore().doc(KEY).delete());
    await assertSucceeds(testEnv.authenticatedContext('super').firestore().doc(KEY).delete());
  });

  it('Block Studio save path: stripped lesson blocks and the key commit together in one batch', async () => {
    const db = as('inst');
    const batch = writeBatch(db);
    batch.update(doc(db, 'lessons/l_draft'), { blocks: [question('q1'), question('q2')], lastEditedById: 'inst', updatedAt: NOW });
    batch.set(doc(db, DRAFT_KEY), key('l_draft', 'c1', {
      keyVersion: 2, updatedById: 'inst',
      items: [{ blockId: 'q1', correctOptionId: 'a', explanation: 'Because A.' }, { blockId: 'q2', correctOptionId: 'b', explanation: 'Because B.' }],
    }));
    await assertSucceeds(batch.commit());
  });

  it('a batch with an invalid key rolls back the lesson update too', async () => {
    const db = as('inst');
    const batch = writeBatch(db);
    batch.update(doc(db, 'lessons/l_draft'), { title: 'Changed', lastEditedById: 'inst', updatedAt: NOW });
    batch.set(doc(db, DRAFT_KEY), key('l_draft', 'c1', { keyVersion: 1, updatedById: 'inst' }));
    await assertFails(batch.commit());
    let title: unknown;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      title = (await getDoc(doc(ctx.firestore(), 'lessons/l_draft'))).data()!.title;
    });
    if (title !== 'l_draft') throw new Error('lesson changed despite a rejected key');
  });
});

describe('C1 — quiz results and completion come only from the server', () => {
  it('students cannot create progress carrying a quiz result', async () => {
    const db = as('stu');
    await assertFails(setDoc(doc(db, 'progress/stu_c_pub_l_plain'), progress('l_plain', { quiz: SUMMARY })));
    await assertFails(setDoc(doc(db, 'progress/stu_c_pub_l_legacy'), progress('l_legacy', { quiz: SUMMARY })));
  });

  it('students cannot complete a keyed quiz lesson directly, on create or update', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'progress/stu_c_pub_l_quiz'), progress('l_quiz'));
    });
    const db = as('stu');
    await assertFails(updateDoc(doc(db, 'progress/stu_c_pub_l_quiz'), { status: 'completed', completedAt: NOW, updatedAt: NOW }));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('progress/stu_c_pub_l_quiz').delete();
    });
    await assertFails(setDoc(doc(db, 'progress/stu_c_pub_l_quiz'), progress('l_quiz', { status: 'completed', completedAt: NOW })));
    // Positive control: an in-progress visit is still recorded.
    await assertSucceeds(setDoc(doc(db, 'progress/stu_c_pub_l_quiz'), progress('l_quiz')));
  });

  it('students cannot forge, change or remove the server quiz summary', async () => {
    const db = as('stu');
    const ref = doc(db, 'progress/stu_c_pub_l_quiz');
    await assertFails(updateDoc(ref, { 'quiz.bestPercent': 100, 'quiz.attemptsToday': 0 }));
    await assertFails(updateDoc(ref, { 'quiz.attemptsToday': 0 }));
    await assertFails(updateDoc(ref, { 'quiz.lastAttemptAt': '2020-01-01T00:00:00.000Z' }));
    await assertFails(updateDoc(ref, { quiz: deleteField() }));
    // Positive control: time accumulates on a completed lesson with the summary untouched.
    await assertSucceeds(updateDoc(ref, { timeSpentSeconds: 60, lastAccessedAt: NOW, updatedAt: NOW }));
  });

  it('students cannot inject a quiz summary into existing progress', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'progress/stu_c_pub_l_plain'), progress('l_plain'));
    });
    await assertFails(updateDoc(doc(as('stu'), 'progress/stu_c_pub_l_plain'), { quiz: SUMMARY }));
  });

  it('completion is never downgraded', async () => {
    await assertFails(updateDoc(doc(as('stu'), 'progress/stu_c_pub_l_quiz'), { status: 'in_progress', updatedAt: NOW }));
  });

  it('regression: lessons without a quiz are still completed by the student', async () => {
    const db = as('stu');
    await assertSucceeds(setDoc(doc(db, 'progress/stu_c_pub_l_plain'), progress('l_plain')));
    await assertSucceeds(updateDoc(doc(db, 'progress/stu_c_pub_l_plain'), { status: 'completed', completedAt: NOW, updatedAt: NOW }));
  });

  it('regression: a lesson whose key was emptied (quiz removed) can be completed directly', async () => {
    await assertSucceeds(setDoc(doc(as('stu'), 'progress/stu_c_pub_l_emptykey'), progress('l_emptykey', { status: 'completed', completedAt: NOW })));
  });

  it('legacy inline-answer lessons (pre-C4 migration) keep client completion', async () => {
    await assertSucceeds(setDoc(doc(as('stu'), 'progress/stu_c_pub_l_legacy'), progress('l_legacy', { status: 'completed', completedAt: NOW })));
  });
});

describe('C1 — attempt history is immutable and scoped', () => {
  const ATTEMPT = 'progress/stu_c_pub_l_quiz/quizAttempts/000001';
  const attempt = {
    attemptNumber: 2, studentId: 'stu', orgId: 'org_a', courseId: 'c_pub', lessonId: 'l_quiz', batchId: 'bt1',
    keyVersion: 1, answers: { q1: 'a' }, correct: 1, total: 1, percent: 100, passed: true, attemptedAt: NOW,
  };

  it('nobody writes attempts from a client, not even the Super Admin', async () => {
    for (const uid of ['stu', 'inst', 'uni', 'super']) {
      const db = as(uid);
      await assertFails(setDoc(doc(db, 'progress/stu_c_pub_l_quiz/quizAttempts/000002'), attempt));
      await assertFails(updateDoc(doc(db, ATTEMPT), { passed: false }));
      await assertFails(testEnv.authenticatedContext(uid).firestore().doc(ATTEMPT).delete());
    }
    await assertFails(setDoc(doc(as('stu'), 'progress/stu_c_pub_l_plain/quizAttempts/000001'), { ...attempt, lessonId: 'l_plain' }));
  });

  it('the student, the org and branch admins and the assigned instructor read attempts', async () => {
    for (const uid of ['stu', 'super', 'uni', 'ba', 'inst']) await assertSucceeds(getDoc(doc(as(uid), ATTEMPT)));
  });

  it('other students, other branches, unassigned instructors, designers and other orgs cannot read attempts', async () => {
    for (const uid of ['stu2', 'ba_b2', 'inst_other', 'designer_pub', 'reviewer_c1', 'inst_b', 'stu_b']) {
      await assertFails(getDoc(doc(as(uid), ATTEMPT)));
    }
  });
});

describe('C1 — authoring regressions', () => {
  it('instructors and branch admins still save draft lesson content', async () => {
    await assertSucceeds(updateDoc(doc(as('inst'), 'lessons/l_draft'), { lastEditedById: 'inst', title: 'Edited by instructor', updatedAt: NOW }));
    await assertSucceeds(updateDoc(doc(as('ba'), 'lessons/l_draft'), { lastEditedById: 'ba', title: 'Edited by branch admin', updatedAt: NOW }));
  });

  it('reviewers still cannot edit lessons', async () => {
    await assertFails(updateDoc(doc(as('reviewer_c1'), 'lessons/l_draft'), { lastEditedById: 'reviewer_c1', title: 'x', updatedAt: NOW }));
  });
});

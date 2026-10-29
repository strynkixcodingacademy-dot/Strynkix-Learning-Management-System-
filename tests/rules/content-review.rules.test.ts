/**
 * Stage C2 — content review against firestore.rules. Clients (even the Super
 * Admin) can never change publication status or review state, every write
 * names its writer, content is frozen while in review or approved (answer keys
 * included), and the audit log is server-written and scoped.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NOW = '2026-10-29T00:00:00.000Z';
let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
const cd = (responsibilities: string[], assignedCourseIds: string[]) => ({
  department: 'course_design', responsibilities, assignedCourseIds, assignedAt: NOW, assignedByUserId: 'super',
});
const IN_REVIEW = { state: 'in_review', submittedById: 'inst', submittedAt: NOW };
const APPROVED = { ...IN_REVIEW, state: 'approved', reviewedById: 'reviewer', reviewedAt: NOW };
const CHANGES = { ...IN_REVIEW, state: 'changes_requested', reviewedById: 'reviewer', reviewedAt: NOW, comment: 'Fix it.' };
const key = (lessonId: string, keyVersion: number, updatedById: string) => ({
  orgId: 'org_a', courseId: 'c1', lessonId, keyVersion, release: 'after_pass',
  items: [{ blockId: 'q1', correctOptionId: 'a', explanation: 'Because A.' }], updatedById, updatedAt: NOW,
});
const audit = (overrides: Record<string, unknown> = {}) => ({
  orgId: 'org_a', courseId: 'c1', targetType: 'lesson', targetId: 'l_draft', action: 'approve', actorId: 'reviewer', actorRole: 'content_designer',
  fromStatus: 'draft', toStatus: 'draft', fromReview: 'in_review', toReview: 'approved', override: false, at: NOW, ...overrides,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'strynkix-lms-contentreview',
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
    await user('super', 'super_admin');
    await user('uni', 'university_admin');
    await user('inst', 'instructor', { branchId: 'b1' });
    await user('stu', 'student', { branchId: 'b1' });
    await user('author', 'content_designer', { courseDesign: cd(['content_developer'], ['c1']) });
    await user('reviewer', 'content_designer', { courseDesign: cd(['reviewer'], ['c1']) });
    await user('reviewer_c2', 'content_designer', { courseDesign: cd(['reviewer'], ['c2']) });
    await user('assess', 'content_designer', { courseDesign: cd(['assessment_designer'], ['c1']) });
    await user('inst_b', 'instructor', { orgId: 'org_b' });
    await put('courses/c1', { orgId: 'org_a', title: 'C1', status: 'draft', createdById: 'inst' });
    await put('courses/c_review', { orgId: 'org_a', title: 'In review', status: 'draft', createdById: 'inst', review: IN_REVIEW });
    await put('courses/c2', { orgId: 'org_a', title: 'C2', status: 'draft', createdById: 'inst' });
    const lesson = (id: string, extra: Record<string, unknown> = {}) =>
      put(`lessons/${id}`, { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: id, status: 'draft', blocks: [], ...extra });
    await lesson('l_draft');
    await lesson('l_review', { review: IN_REVIEW });
    await lesson('l_approved', { review: APPROVED });
    await lesson('l_changes', { review: CHANGES });
    await lesson('l_pub', { status: 'published' });
    for (const id of ['l_draft', 'l_review', 'l_approved', 'l_changes']) await put(`lessons/${id}/answerKey/current`, key(id, 1, 'inst'));
    await put('auditLog/a1', audit());
    await put('auditLog/a_c2', audit({ courseId: 'c2', targetId: 'l_c2' }));
    await put('auditLog/a_b', audit({ orgId: 'org_b', courseId: 'cb', targetId: 'lb' }));
  });
});

describe('C2 — status and review change only through the server', () => {
  it('nobody, not even the Super Admin, changes status or review with a client write', async () => {
    for (const uid of ['super', 'uni', 'inst']) {
      const db = as(uid);
      await assertFails(updateDoc(doc(db, 'lessons/l_draft'), { lastEditedById: uid, status: 'published' }));
      await assertFails(updateDoc(doc(db, 'lessons/l_draft'), { lastEditedById: uid, review: APPROVED }));
      await assertFails(updateDoc(doc(db, 'lessons/l_pub'), { lastEditedById: uid, status: 'archived' }));
      await assertFails(updateDoc(doc(db, 'courses/c1'), { lastEditedById: uid, status: 'published' }));
      await assertFails(updateDoc(doc(db, 'courses/c1'), { lastEditedById: uid, review: APPROVED }));
    }
    await assertFails(updateDoc(doc(as('reviewer'), 'lessons/l_review'), { lastEditedById: 'reviewer', review: APPROVED }));
  });

  it('new content is a plain draft: no published or pre-approved creation, even by the Super Admin', async () => {
    const db = as('super');
    const base = { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'New', blocks: [], lastEditedById: 'super' };
    await assertFails(setDoc(doc(db, 'lessons/l_new'), { ...base, status: 'published' }));
    await assertFails(setDoc(doc(db, 'lessons/l_new'), { ...base, status: 'draft', review: APPROVED }));
    await assertFails(setDoc(doc(db, 'courses/c_new'), { orgId: 'org_a', title: 'New', status: 'published', createdById: 'super', lastEditedById: 'super' }));
    await assertSucceeds(setDoc(doc(db, 'lessons/l_new'), { ...base, status: 'draft' }));
    await assertSucceeds(setDoc(doc(db, 'courses/c_new'), { orgId: 'org_a', title: 'New', status: 'draft', createdById: 'super', lastEditedById: 'super' }));
  });

  it('every content write must name its writer: missing or forged editors are refused', async () => {
    const db = as('inst');
    await assertFails(updateDoc(doc(db, 'lessons/l_draft'), { title: 'No editor' }));
    await assertFails(updateDoc(doc(db, 'lessons/l_draft'), { title: 'Forged', lastEditedById: 'reviewer' }));
    await assertFails(updateDoc(doc(db, 'courses/c1'), { title: 'Forged', lastEditedById: 'super' }));
    await assertFails(setDoc(doc(db, 'lessons/l_x'), { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'X', status: 'draft', blocks: [], lastEditedById: 'author' }));
    await assertSucceeds(updateDoc(doc(db, 'lessons/l_draft'), { title: 'Named', lastEditedById: 'inst' }));
  });
});

describe('C2 — content is frozen while in review or approved', () => {
  it('lessons and courses in review or approved cannot be edited, by anyone', async () => {
    for (const uid of ['super', 'inst', 'author']) {
      for (const id of ['l_review', 'l_approved']) {
        await assertFails(updateDoc(doc(as(uid), `lessons/${id}`), { title: 'Sneaky edit', lastEditedById: uid }));
      }
    }
    await assertFails(updateDoc(doc(as('inst'), 'courses/c_review'), { title: 'Sneaky edit', lastEditedById: 'inst' }));
  });

  it('answer keys of frozen lessons cannot change either', async () => {
    for (const id of ['l_review', 'l_approved']) {
      await assertFails(setDoc(doc(as('inst'), `lessons/${id}/answerKey/current`), key(id, 2, 'inst')));
    }
  });

  it('positive control: drafts and changes-requested content are editable, keys included', async () => {
    await assertSucceeds(updateDoc(doc(as('author'), 'lessons/l_changes'), { title: 'Fixed', lastEditedById: 'author' }));
    await assertSucceeds(setDoc(doc(as('inst'), 'lessons/l_changes/answerKey/current'), key('l_changes', 2, 'inst')));
    await assertSucceeds(setDoc(doc(as('inst'), 'lessons/l_draft/answerKey/current'), key('l_draft', 2, 'inst')));
  });

  // Stage C3: published lessons are immutable; changes go through a working revision.
  it('published lesson content is no longer edited in place, by anyone', async () => {
    for (const uid of ['inst', 'super']) {
      await assertFails(updateDoc(doc(as(uid), 'lessons/l_pub'), { title: 'Typo fix', lastEditedById: uid }));
    }
  });
});

describe('C2 — assessment designers', () => {
  it('cannot write lesson documents directly (they use the assessment route)', async () => {
    await assertFails(updateDoc(doc(as('assess'), 'lessons/l_draft'), { title: 'Rewritten', lastEditedById: 'assess' }));
    await assertFails(updateDoc(doc(as('assess'), 'lessons/l_draft'), { blocks: [{ id: 't', type: 'text', content: 'x' }], lastEditedById: 'assess' }));
  });
  it('can still read in-scope content and keys', async () => {
    await assertSucceeds(getDoc(doc(as('assess'), 'lessons/l_draft')));
    await assertSucceeds(getDoc(doc(as('assess'), 'lessons/l_draft/answerKey/current')));
  });
});

describe('C2 — audit log', () => {
  it('no client creates, changes or deletes audit entries, not even the Super Admin', async () => {
    for (const uid of ['super', 'uni', 'inst', 'reviewer', 'stu']) {
      const db = as(uid);
      await assertFails(setDoc(doc(db, `auditLog/forged_${uid}`), audit({ actorId: uid })));
      await assertFails(updateDoc(doc(db, 'auditLog/a1'), { override: true }));
      await assertFails(deleteDoc(doc(db, 'auditLog/a1')));
    }
  });

  it('authors and in-scope Course Design members read their org’s entries', async () => {
    for (const uid of ['super', 'uni', 'inst', 'reviewer', 'author', 'assess']) await assertSucceeds(getDoc(doc(as(uid), 'auditLog/a1')));
    await assertSucceeds(getDocs(query(collection(as('reviewer'), 'auditLog'), where('orgId', '==', 'org_a'), where('courseId', '==', 'c1'), where('targetId', '==', 'l_draft'))));
  });

  it('students, out-of-scope members and other organizations cannot read entries', async () => {
    await assertFails(getDoc(doc(as('stu'), 'auditLog/a1')));
    await assertFails(getDoc(doc(as('reviewer'), 'auditLog/a_c2')));
    await assertFails(getDoc(doc(as('reviewer_c2'), 'auditLog/a1')));
    await assertFails(getDoc(doc(as('inst_b'), 'auditLog/a1')));
    await assertFails(getDoc(doc(as('inst'), 'auditLog/a_b')));
    await assertFails(getDocs(query(collection(as('reviewer'), 'auditLog'), where('orgId', '==', 'org_a'))));
  });
});

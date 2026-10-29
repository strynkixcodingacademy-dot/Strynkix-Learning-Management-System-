/**
 * Stage C3 — versioning against firestore.rules. Published lessons and courses
 * are immutable for every client; changes go to a working revision and a
 * working answer key that students never see; published versions are
 * server-written and immutable.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NOW = '2026-10-29T00:00:00.000Z';
let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
const cd = (responsibilities: string[], assignedCourseIds: string[]) => ({
  department: 'course_design', responsibilities, assignedCourseIds, assignedAt: NOW, assignedByUserId: 'super',
});
const quiz = { id: 'q1', type: 'quiz', question: 'Question one?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] };
const revision = (by: string, extra: Record<string, unknown> = {}) => ({
  title: 'Improved lesson', estimatedMinutes: 25, blocks: [quiz], baseVersion: 1, lastEditedById: by, createdAt: NOW, updatedAt: NOW, ...extra,
});
const key = (lessonId: string, courseId: string, keyVersion: number, updatedById: string, correct = 'a') => ({
  orgId: 'org_a', courseId, lessonId, keyVersion, release: 'after_pass',
  items: [{ blockId: 'q1', correctOptionId: correct, explanation: `Because ${correct}.` }], updatedById, updatedAt: NOW,
});
const version = (lessonId: string, courseId: string) => ({
  version: 1, orgId: 'org_a', courseId, lessonId, moduleId: 'm1', title: 'Live', estimatedMinutes: 20, blocks: [quiz],
  answerKey: { keyVersion: 1, items: [{ blockId: 'q1', correctOptionId: 'a', explanation: 'Because a.' }] },
  publishedById: 'super', approvedById: 'reviewer', override: false, baseline: false, auditId: 'a1', publishedAt: NOW,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'strynkix-lms-versioning',
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
      put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@x.test`, displayName: uid, branchId: 'b1', ...extra });
    await user('super', 'super_admin');
    await user('inst', 'instructor');
    await user('ba', 'branch_admin');
    await user('stu', 'student');
    await user('designer', 'content_designer', { courseDesign: cd(['content_developer'], ['c_draft', 'c_pub']) });
    await user('assess', 'content_designer', { courseDesign: cd(['assessment_designer'], ['c_draft']) });
    await user('reviewer', 'content_designer', { courseDesign: cd(['reviewer'], ['c_pub', 'c_draft']) });
    await user('inst_b', 'instructor', { orgId: 'org_b' });
    await user('designer_other', 'content_designer', { courseDesign: cd(['content_developer', 'reviewer'], ['c_other']) });
    await user('inst_sus', 'instructor', { status: 'suspended' });
    await user('reviewer_sus', 'content_designer', { status: 'suspended', courseDesign: cd(['reviewer'], ['c_pub']) });
    await put('courses/c_pub', { orgId: 'org_a', title: 'Live course', status: 'published', createdById: 'inst' });
    await put('courses/c_draft', { orgId: 'org_a', title: 'Draft course', status: 'draft', createdById: 'inst' });
    const lesson = (id: string, courseId: string, status: string) =>
      put(`lessons/${id}`, { orgId: 'org_a', courseId, moduleId: 'm1', title: id, status, blocks: [quiz], publishedVersion: status === 'published' ? 1 : null });
    await lesson('l_live', 'c_pub', 'published');
    await lesson('l_live_dc', 'c_draft', 'published');
    await lesson('l_draft', 'c_pub', 'draft');
    await lesson('l_frozen', 'c_pub', 'published');
    await put('enrollments/c_pub_stu', { orgId: 'org_a', branchId: 'b1', courseId: 'c_pub', batchId: 'bt1', studentId: 'stu', status: 'active' });
    for (const id of ['l_live', 'l_frozen', 'l_draft']) await put(`lessons/${id}/answerKey/current`, key(id, 'c_pub', 1, 'inst'));
    await put('lessons/l_live_dc/answerKey/current', key('l_live_dc', 'c_draft', 1, 'inst'));
    await put('lessons/l_frozen/revisions/working', revision('inst', { review: { state: 'in_review', submittedById: 'inst', submittedAt: NOW } }));
    await put('lessons/l_frozen/answerKey/working', key('l_frozen', 'c_pub', 2, 'inst', 'b'));
    await put('lessons/l_live/versions/000001', version('l_live', 'c_pub'));
    await put('courses/c_pub/versions/000001', { version: 1, orgId: 'org_a', courseId: 'c_pub', title: 'Live course', publishedById: 'super', publishedAt: NOW });
  });
});

describe('C3 — published content is immutable', () => {
  it('no client edits a published lesson or its live key, not even the Super Admin', async () => {
    for (const uid of ['super', 'inst', 'ba']) {
      await assertFails(updateDoc(doc(as(uid), 'lessons/l_live'), { title: 'Changed live', lastEditedById: uid }));
      await assertFails(updateDoc(doc(as(uid), 'lessons/l_live'), { blocks: [], lastEditedById: uid }));
      await assertFails(setDoc(doc(as(uid), 'lessons/l_live/answerKey/current'), key('l_live', 'c_pub', 2, uid, 'b')));
    }
  });

  it('no client edits a published course, not even the Super Admin', async () => {
    for (const uid of ['super', 'inst']) await assertFails(updateDoc(doc(as(uid), 'courses/c_pub'), { title: 'Renamed', lastEditedById: uid }));
  });

  it('positive control: drafts are still edited in place, keys included', async () => {
    await assertSucceeds(updateDoc(doc(as('inst'), 'lessons/l_draft'), { title: 'Draft edit', lastEditedById: 'inst' }));
    await assertSucceeds(setDoc(doc(as('inst'), 'lessons/l_draft/answerKey/current'), key('l_draft', 'c_pub', 2, 'inst')));
  });
});

describe('C3 — working revisions', () => {
  it('authors start and update a revision of a published lesson, with its working key, in one batch', async () => {
    const db = as('inst');
    const b = writeBatch(db);
    b.set(doc(db, 'lessons/l_live/revisions/working'), revision('inst'));
    b.set(doc(db, 'lessons/l_live/answerKey/working'), key('l_live', 'c_pub', 2, 'inst', 'b'));
    await assertSucceeds(b.commit());
    await assertSucceeds(setDoc(doc(db, 'lessons/l_live/revisions/working'), { title: 'Improved again', lastEditedById: 'inst', updatedAt: NOW }, { merge: true }));
    await assertSucceeds(setDoc(doc(as('ba'), 'lessons/l_live/answerKey/working'), key('l_live', 'c_pub', 2, 'ba', 'a')));
  });

  it('a revision must name its writer, have a valid shape and carry no review state', async () => {
    const ref = doc(as('inst'), 'lessons/l_live/revisions/working');
    await assertFails(setDoc(ref, revision('reviewer')));
    await assertFails(setDoc(ref, revision('inst', { review: { state: 'approved' } })));
    await assertFails(setDoc(ref, revision('inst', { status: 'published' })));
    await assertFails(setDoc(ref, revision('inst', { estimatedMinutes: 'long' })));
    await assertFails(setDoc(ref, revision('inst', { blocks: Array.from({ length: 51 }, (_, i) => ({ id: `t${i}`, type: 'text', content: 'x' })) })));
    await assertFails(setDoc(doc(as('inst'), 'lessons/l_live/revisions/other'), revision('inst')));
  });

  it('drafts have no revisions; the working key exists only for published lessons', async () => {
    await assertFails(setDoc(doc(as('inst'), 'lessons/l_draft/revisions/working'), revision('inst')));
    await assertFails(setDoc(doc(as('inst'), 'lessons/l_draft/answerKey/working'), key('l_draft', 'c_pub', 2, 'inst')));
  });

  it('a revision in review is frozen: no edits, no key changes, no discarding', async () => {
    const db = as('inst');
    await assertFails(setDoc(doc(db, 'lessons/l_frozen/revisions/working'), { title: 'Sneaky', lastEditedById: 'inst', updatedAt: NOW }, { merge: true }));
    await assertFails(setDoc(doc(db, 'lessons/l_frozen/answerKey/working'), key('l_frozen', 'c_pub', 2, 'inst', 'a')));
    await assertFails(deleteDoc(doc(db, 'lessons/l_frozen/revisions/working')));
    await assertFails(deleteDoc(doc(db, 'lessons/l_frozen/answerKey/working')));
    await assertFails(setDoc(doc(db, 'lessons/l_frozen/revisions/working'), { review: { state: 'approved' }, lastEditedById: 'inst', updatedAt: NOW }, { merge: true }));
  });

  it('authors discard an unfrozen revision with its working key', async () => {
    const db = as('inst');
    await setDoc(doc(db, 'lessons/l_live/revisions/working'), revision('inst'));
    await setDoc(doc(db, 'lessons/l_live/answerKey/working'), key('l_live', 'c_pub', 2, 'inst'));
    const b = writeBatch(db);
    b.delete(doc(db, 'lessons/l_live/revisions/working'));
    b.delete(doc(db, 'lessons/l_live/answerKey/working'));
    await assertSucceeds(b.commit());
  });

  it('Course Design members revise only lessons of in-scope draft courses; reviewers and assessment designers never write revisions', async () => {
    await assertSucceeds(setDoc(doc(as('designer'), 'lessons/l_live_dc/revisions/working'), revision('designer')));
    await assertFails(setDoc(doc(as('designer'), 'lessons/l_live/revisions/working'), revision('designer')));
    await assertFails(setDoc(doc(as('reviewer'), 'lessons/l_live/revisions/working'), revision('reviewer')));
    await assertFails(setDoc(doc(as('assess'), 'lessons/l_live_dc/revisions/working'), revision('assess')));
    await assertFails(setDoc(doc(as('inst_b'), 'lessons/l_live/revisions/working'), revision('inst_b')));
  });

  it('students never read revisions, working keys or live keys', async () => {
    const db = as('stu');
    await assertSucceeds(getDoc(doc(db, 'lessons/l_live')));
    await assertFails(getDoc(doc(db, 'lessons/l_frozen/revisions/working')));
    await assertFails(getDoc(doc(db, 'lessons/l_frozen/answerKey/working')));
    await assertFails(getDoc(doc(db, 'lessons/l_frozen/answerKey/current')));
  });

  it('staff and in-scope reviewers read revisions; other organizations do not', async () => {
    for (const uid of ['super', 'inst', 'reviewer']) {
      await assertSucceeds(getDoc(doc(as(uid), 'lessons/l_frozen/revisions/working')));
      await assertSucceeds(getDoc(doc(as(uid), 'lessons/l_frozen/answerKey/working')));
    }
    await assertFails(getDoc(doc(as('inst_b'), 'lessons/l_frozen/revisions/working')));
    await assertFails(getDoc(doc(as('inst_b'), 'lessons/l_frozen/answerKey/working')));
  });
});

describe('C3 — published versions', () => {
  it('nobody writes, changes or deletes versions from a client', async () => {
    for (const uid of ['super', 'inst', 'reviewer', 'stu']) {
      const db = as(uid);
      await assertFails(setDoc(doc(db, 'lessons/l_live/versions/000002'), { ...version('l_live', 'c_pub'), version: 2 }));
      await assertFails(updateDoc(doc(db, 'lessons/l_live/versions/000001'), { title: 'Rewritten history' }));
      await assertFails(deleteDoc(doc(db, 'lessons/l_live/versions/000001')));
      await assertFails(setDoc(doc(db, 'courses/c_pub/versions/000002'), { version: 2, orgId: 'org_a', courseId: 'c_pub' }));
      await assertFails(deleteDoc(doc(db, 'courses/c_pub/versions/000001')));
    }
  });

  it('staff and in-scope members read versions (they carry answers); students and other orgs do not', async () => {
    for (const uid of ['super', 'inst', 'reviewer']) {
      await assertSucceeds(getDocs(query(collection(as(uid), 'lessons/l_live/versions'), where('orgId', '==', 'org_a'), where('courseId', '==', 'c_pub'))));
      await assertSucceeds(getDoc(doc(as(uid), 'courses/c_pub/versions/000001')));
    }
    await assertFails(getDoc(doc(as('stu'), 'lessons/l_live/versions/000001')));
    await assertFails(getDoc(doc(as('stu'), 'courses/c_pub/versions/000001')));
    await assertFails(getDoc(doc(as('inst_b'), 'lessons/l_live/versions/000001')));
  });
});

describe('C3 — scope and account status', () => {
  it('out-of-scope Course Design members and suspended accounts cannot read or write revisions, working keys or versions', async () => {
    for (const uid of ['designer_other', 'inst_sus', 'reviewer_sus']) {
      const db = as(uid);
      await assertFails(getDoc(doc(db, 'lessons/l_frozen/revisions/working')));
      await assertFails(getDoc(doc(db, 'lessons/l_frozen/answerKey/working')));
      await assertFails(getDoc(doc(db, 'lessons/l_live/versions/000001')));
      await assertFails(getDoc(doc(db, 'courses/c_pub/versions/000001')));
      await assertFails(setDoc(doc(db, 'lessons/l_live/revisions/working'), revision(uid)));
    }
  });
});

describe('C6 regression — reading a key that does not exist yet', () => {
  it('lesson staff and in-scope members get an empty result (the Block Studio needs it); students are still refused', async () => {
    for (const uid of ['inst', 'ba', 'reviewer', 'designer']) {
      const snap = await assertSucceeds(getDoc(doc(as(uid), 'lessons/l_live/answerKey/working')));
      if (snap.exists()) throw new Error('expected no working key');
    }
    await assertFails(getDoc(doc(as('stu'), 'lessons/l_live/answerKey/working')));
    await assertFails(getDoc(doc(as('inst_b'), 'lessons/l_live/answerKey/working')));
    await assertFails(getDoc(doc(as('designer_other'), 'lessons/l_live/answerKey/working')));
  });
});


/**
 * Stage C3 — versioned publishing through POST /api/content/review and
 * POST /api/content/assessment on the Auth + Firestore emulators. Students keep
 * the published version (content and answer key) while a revision is written,
 * reviewed and published; each publish records an immutable version.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST as reviewPOST } from '@/app/api/content/review/route';
import { POST as assessmentPOST } from '@/app/api/content/assessment/route';
import { POST as quizPOST } from '@/app/api/quiz/attempt/route';
import { getAdminServices } from '@/lib/server/firebase-admin';
import type { LessonVersion } from '@/types/domain';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-10-29T00:00:00.000Z';
const USERS = ['vr_super', 'vr_inst', 'vr_reviewer', 'vr_assess', 'vr_stu'];

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();

async function idToken(uid: string): Promise<string> {
  const cached = tokens.get(uid);
  if (cached) return cached;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  tokens.set(uid, json.idToken);
  return json.idToken;
}

async function call(handler: (r: Request) => Promise<Response>, uid: string, payload: unknown) {
  const res = await handler(new Request('http://localhost/api', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(uid)}` }, body: JSON.stringify(payload),
  }));
  return { status: res.status, json: await res.json() };
}

const act = (uid: string, action: string, extra: Record<string, unknown> = {}, targetId = 'l1', targetType = 'lesson') =>
  call(reviewPOST, uid, { targetType, targetId, action, ...extra });
const attempt = (answers: Record<string, string>) => call(quizPOST, 'vr_stu', { courseId: 'c1', lessonId: 'l1', answers });
const get = async (p: string) => (await db.doc(p).get()).data();
const versions = async (id = 'l1') => (await db.collection(`lessons/${id}/versions`).orderBy('version').get()).docs.map((d) => ({ id: d.id, ...(d.data() as LessonVersion) }));

const quiz = (id: string) => ({ id, type: 'quiz', question: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] });
const keyDoc = (keyVersion: number, correct: string, updatedById = 'vr_inst', lessonId = 'l1') => ({
  orgId: 'org_a', courseId: 'c1', lessonId, keyVersion, release: 'after_pass',
  items: [{ blockId: 'q1', correctOptionId: correct, explanation: `Because ${correct}.` }], updatedById, updatedAt: NOW,
});

/** Simulates the Block Studio saving a revision (client writes are covered by the rules suite). */
async function writeRevision(correct: string, title = 'L1 improved') {
  await db.doc('lessons/l1/revisions/working').set({
    title, estimatedMinutes: 30, blocks: [{ id: 't1', type: 'text', content: 'Rewritten.' }, quiz('q1')], baseVersion: 1,
    lastEditedById: 'vr_inst', createdAt: NOW, updatedAt: NOW,
  });
  await db.doc('lessons/l1/answerKey/working').set(keyDoc(2, correct));
}

async function publishFirstVersion() {
  expect((await act('vr_inst', 'submit')).status).toBe(200);
  expect((await act('vr_reviewer', 'approve')).status).toBe(200);
  expect((await act('vr_super', 'publish')).json).toMatchObject({ status: 'published', version: 1 });
}

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  for (const uid of USERS) {
    await auth.deleteUser(uid).catch(() => undefined);
    await auth.createUser({ uid, email: `${uid}@versions.test` });
  }
});

beforeEach(async () => {
  const res = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error('clear failed');
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const user = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
    put(`users/${uid}`, { role, orgId: 'org_a', branchId: 'b1', status: 'active', email: `${uid}@versions.test`, displayName: uid, ...extra });
  const cd = (r: string[]) => ({ department: 'course_design', responsibilities: r, assignedCourseIds: ['c1'], assignedAt: NOW, assignedByUserId: 'vr_super' });
  await user('vr_super', 'super_admin');
  await user('vr_inst', 'instructor');
  await user('vr_reviewer', 'content_designer', { courseDesign: cd(['reviewer']) });
  await user('vr_assess', 'content_designer', { courseDesign: cd(['assessment_designer']) });
  await user('vr_stu', 'student');
  await put('organizations/org_a', { name: 'Org A' });
  await put('courses/c1', {
    orgId: 'org_a', title: 'C1', slug: 'c1', tagline: 'T', description: 'D', level: 'beginner', tags: [], prerequisites: [], estimatedWeeks: 4,
    status: 'published', createdById: 'vr_inst', lastEditedById: 'vr_inst',
  });
  await put('enrollments/c1_vr_stu', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', batchId: 'bt1', studentId: 'vr_stu', status: 'active' });
  await put('lessons/l1', {
    orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'L1', estimatedMinutes: 20, status: 'draft', lastEditedById: 'vr_inst',
    blocks: [{ id: 't1', type: 'text', content: 'Original.' }, quiz('q1')],
  });
  await put('lessons/l1/answerKey/current', keyDoc(1, 'a'));
});

describe('first publish', () => {
  it('records version 1 with the published blocks and the answer key it is graded against', async () => {
    await publishFirstVersion();
    expect(await get('lessons/l1')).toMatchObject({ status: 'published', publishedVersion: 1 });
    const [v1] = await versions();
    expect(v1).toMatchObject({
      id: '000001', version: 1, lessonId: 'l1', title: 'L1', baseline: false, override: false, publishedById: 'vr_super', approvedById: 'vr_reviewer',
      answerKey: { keyVersion: 1, items: [{ blockId: 'q1', correctOptionId: 'a' }] },
    });
    expect(v1.publishedAt).toBeInstanceOf(Timestamp);
    expect(JSON.stringify(v1.blocks)).not.toContain('correctOptionId');
    const audit = (await db.collection('auditLog').where('action', '==', 'publish').get()).docs[0].data();
    expect(audit).toMatchObject({ version: 1, override: false });
  });

  it('a draft with legacy inline answers is published answer-free, with the answers moved into the key', async () => {
    await db.doc('lessons/l1').update({ blocks: [{ ...quiz('q1'), correctOptionId: 'b', explanation: 'Inline b.' }] });
    await db.doc('lessons/l1/answerKey/current').delete();
    await publishFirstVersion();
    const lesson = await get('lessons/l1');
    expect(JSON.stringify(lesson!.blocks)).not.toContain('Inline b.');
    expect(await get('lessons/l1/answerKey/current')).toMatchObject({ keyVersion: 1, items: [{ blockId: 'q1', correctOptionId: 'b' }] });
  });
});

describe('revisions keep students on the published version', () => {
  it('students see and are graded on version 1 until the revision is published; then on version 2', async () => {
    await publishFirstVersion();
    await writeRevision('b');
    expect((await act('vr_inst', 'submit')).json).toMatchObject({ subject: 'revision', status: 'published', review: { state: 'in_review' } });
    expect((await act('vr_reviewer', 'approve')).json.review.state).toBe('approved');

    // Still version 1 for students: title, content and grading.
    expect(await get('lessons/l1')).toMatchObject({ title: 'L1', publishedVersion: 1, review: { state: 'none' } });
    const before = await attempt({ q1: 'a' });
    expect(before.json).toMatchObject({ passed: true });
    expect((await get('progress/vr_stu_c1_l1/quizAttempts/000001'))).toMatchObject({ keyVersion: 1, lessonVersion: 1 });

    const pub = await act('vr_super', 'publish');
    expect(pub.json).toMatchObject({ subject: 'revision', status: 'published', version: 2, override: false });
    expect(await get('lessons/l1')).toMatchObject({ title: 'L1 improved', estimatedMinutes: 30, publishedVersion: 2, lastEditedById: 'vr_inst', review: { state: 'none' } });
    expect(await get('lessons/l1/answerKey/current')).toMatchObject({ keyVersion: 2, items: [{ blockId: 'q1', correctOptionId: 'b' }] });
    expect(await get('lessons/l1/revisions/working')).toBeUndefined();
    expect(await get('lessons/l1/answerKey/working')).toBeUndefined();

    // Completed lessons retake without limits; the new key now applies.
    const after = await attempt({ q1: 'b' });
    expect(after.json).toMatchObject({ correct: 1, passed: true });
    expect((await get('progress/vr_stu_c1_l1/quizAttempts/000002'))).toMatchObject({ keyVersion: 2, lessonVersion: 2 });
  });

  it('published versions are immutable: version 1 is unchanged after version 2', async () => {
    await publishFirstVersion();
    const [v1Before] = await versions();
    await writeRevision('b');
    await act('vr_inst', 'submit');
    await act('vr_reviewer', 'approve');
    await act('vr_super', 'publish');
    const all = await versions();
    expect(all.map((v) => v.version)).toEqual([1, 2]);
    expect(all[0]).toEqual(v1Before);
    expect(all[1]).toMatchObject({ title: 'L1 improved', answerKey: { keyVersion: 2 }, baseline: false });
  });

  it('a lesson published before versioning gets its live content recorded as a baseline version 1', async () => {
    await db.doc('lessons/l1').update({ status: 'published' });
    await writeRevision('b');
    await act('vr_inst', 'submit');
    await act('vr_reviewer', 'approve');
    expect((await act('vr_super', 'publish')).json.version).toBe(2);
    const [v1, v2] = await versions();
    expect(v1).toMatchObject({ version: 1, baseline: true, title: 'L1', answerKey: { keyVersion: 1 } });
    expect(v2).toMatchObject({ version: 2, baseline: false, title: 'L1 improved' });
  });

  it('a revision without approval is published only as a reasoned, audited override', async () => {
    await publishFirstVersion();
    await writeRevision('b');
    expect((await act('vr_super', 'publish')).json.error).toBe('reason_required');
    const r = await act('vr_super', 'publish', { reason: 'Correcting a wrong answer students reported' });
    expect(r.json).toMatchObject({ override: true, version: 2 });
    expect((await versions())[1]).toMatchObject({ override: true, approvedById: null });
  });

  it('a revision whose quiz question has no answer cannot be published, and nothing changes', async () => {
    await publishFirstVersion();
    await writeRevision('b');
    await db.doc('lessons/l1/revisions/working').update({ blocks: [quiz('q1'), quiz('q2')] });
    await act('vr_inst', 'submit');
    await act('vr_reviewer', 'approve');
    expect((await act('vr_super', 'publish')).json.error).toBe('assessment_incomplete');
    expect(await get('lessons/l1')).toMatchObject({ publishedVersion: 1, title: 'L1' });
    expect(await versions()).toHaveLength(1);
    expect(await get('lessons/l1/revisions/working')).toBeDefined();
  });

  it('unpublishing or archiving waits until a pending revision is published or discarded', async () => {
    await publishFirstVersion();
    await writeRevision('b');
    expect((await act('vr_super', 'unpublish')).status).toBe(409);
    expect((await act('vr_super', 'archive')).status).toBe(409);
  });

  it('concurrent publishes of one approved revision create exactly one version', async () => {
    await publishFirstVersion();
    await writeRevision('b');
    await act('vr_inst', 'submit');
    await act('vr_reviewer', 'approve');
    const results = await Promise.all([act('vr_super', 'publish'), act('vr_super', 'publish'), act('vr_super', 'publish')]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await versions()).toHaveLength(2);
  });
});

describe('exact-revision approval', () => {
  it('content changed after approval (by any write path) cannot be published on that approval', async () => {
    await publishFirstVersion();
    await writeRevision('b');
    await act('vr_inst', 'submit');
    expect((await act('vr_reviewer', 'approve')).json.review.approvedContentHash).toMatch(/^[0-9a-f]{64}$/);
    // Rules freeze approved content for clients; this simulates any other write path.
    await db.doc('lessons/l1/answerKey/working').update({ items: [{ blockId: 'q1', correctOptionId: 'a', explanation: 'Swapped back.' }] });
    const stale = await act('vr_super', 'publish');
    expect(stale.json.error).toBe('stale_approval');
    expect(await get('lessons/l1')).toMatchObject({ publishedVersion: 1 });
    // The Super Admin may still override, with a reason, on the record.
    const forced = await act('vr_super', 'publish', { reason: 'Publishing the corrected answer key now' });
    expect(forced.json).toMatchObject({ override: true, version: 2 });
  });

  it('a draft lesson approval is bound to its content too', async () => {
    await act('vr_inst', 'submit');
    await act('vr_reviewer', 'approve');
    await db.doc('lessons/l1').update({ title: 'Changed after approval' });
    expect((await act('vr_super', 'publish')).json.error).toBe('stale_approval');
  });

  it('an unchanged approved revision publishes normally', async () => {
    await publishFirstVersion();
    await writeRevision('b');
    await act('vr_inst', 'submit');
    await act('vr_reviewer', 'approve');
    expect((await act('vr_super', 'publish')).json).toMatchObject({ override: false, version: 2 });
  });
});

describe('quiz submissions name the version they answered', () => {
  it('answers to an older version are refused (409) instead of being graded against new questions', async () => {
    await publishFirstVersion();
    expect((await call(quizPOST, 'vr_stu', { courseId: 'c1', lessonId: 'l1', answers: { q1: 'a' }, lessonVersion: 1 })).status).toBe(200);
    await writeRevision('b');
    await act('vr_inst', 'submit');
    await act('vr_reviewer', 'approve');
    await act('vr_super', 'publish');
    const stale = await call(quizPOST, 'vr_stu', { courseId: 'c1', lessonId: 'l1', answers: { q1: 'b' }, lessonVersion: 1 });
    expect(stale).toMatchObject({ status: 409, json: { error: 'lesson_updated' } });
    expect(JSON.stringify(stale.json)).not.toContain('Because');
    expect((await call(quizPOST, 'vr_stu', { courseId: 'c1', lessonId: 'l1', answers: { q1: 'b' }, lessonVersion: 2 })).json).toMatchObject({ passed: true });
    // Completion was never downgraded and history is intact.
    expect(await get('progress/vr_stu_c1_l1')).toMatchObject({ status: 'completed', quiz: { attemptCount: 2 } });
  });

  it('forged version types are rejected by the strict schema', async () => {
    await publishFirstVersion();
    for (const lessonVersion of ['1', -1, 1.5]) {
      expect((await call(quizPOST, 'vr_stu', { courseId: 'c1', lessonId: 'l1', answers: { q1: 'a' }, lessonVersion })).status).toBe(400);
    }
  });
});

describe('assessment authoring on published lessons', () => {
  it('Assessment Designers change the revision and working key; the live lesson and key are untouched', async () => {
    await db.doc('courses/c1').update({ status: 'draft' });
    await publishFirstVersion();
    const live = await get('lessons/l1');
    const r = await call(assessmentPOST, 'vr_assess', {
      lessonId: 'l1', questions: [{ ...quiz('q1'), correctOptionId: 'b', explanation: 'Because b, revised.' }],
    });
    expect(r.json).toMatchObject({ revision: true, keyVersion: 2 });
    expect(await get('lessons/l1')).toEqual(live);
    expect(await get('lessons/l1/answerKey/current')).toMatchObject({ keyVersion: 1, items: [{ correctOptionId: 'a' }] });
    expect(await get('lessons/l1/answerKey/working')).toMatchObject({ keyVersion: 2, updatedById: 'vr_assess', items: [{ correctOptionId: 'b' }] });
    expect(await get('lessons/l1/revisions/working')).toMatchObject({ lastEditedById: 'vr_assess', baseVersion: 1, title: 'L1' });
  });
});

describe('courses', () => {
  it('each course publish records an immutable course version', async () => {
    await db.doc('courses/c1').update({ status: 'draft' });
    expect((await act('vr_inst', 'submit', {}, 'c1', 'course')).status).toBe(200);
    await act('vr_reviewer', 'approve', {}, 'c1', 'course');
    expect((await act('vr_super', 'publish', {}, 'c1', 'course')).json.version).toBe(1);
    await act('vr_super', 'unpublish', {}, 'c1', 'course');
    expect((await act('vr_super', 'publish', {}, 'c1', 'course', )).json.error).toBe('reason_required');
    expect((await act('vr_super', 'publish', { reason: 'Republishing unchanged details' }, 'c1', 'course')).json.version).toBe(2);
    const vs = (await db.collection('courses/c1/versions').get()).docs.map((d) => d.data());
    expect(vs.map((v) => v.version).sort()).toEqual([1, 2]);
    expect(vs[0]).toMatchObject({ title: 'C1', estimatedWeeks: 4, publishedById: 'vr_super' });
  });
});

/**
 * Stage C2 — POST /api/content/review and POST /api/content/assessment on the
 * Auth + Firestore emulators, with the real route handlers, the Admin SDK and
 * real emulator ID tokens. Covers the review lifecycle, self-approval, scope,
 * account status, D3 publication, Super Admin overrides, the audit trail and
 * a C1 regression (a lesson published here is graded for students).
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST as reviewPOST } from '@/app/api/content/review/route';
import { POST as assessmentPOST } from '@/app/api/content/assessment/route';
import { POST as quizPOST } from '@/app/api/quiz/attempt/route';
import { getAdminServices } from '@/lib/server/firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-10-29T00:00:00.000Z';

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();

const USERS = ['cr_super', 'cr_uni', 'cr_inst', 'cr_author', 'cr_lead', 'cr_assess', 'cr_reviewer', 'cr_reviewer2', 'cr_reviewer_c2',
  'cr_reviewer_sus', 'cr_reviewer_b', 'cr_label', 'cr_stu'];

const cd = (responsibilities: string[], assignedCourseIds = ['c1']) => ({
  department: 'course_design', responsibilities, assignedCourseIds, assignedAt: NOW, assignedByUserId: 'cr_super',
});

async function idToken(uid: string): Promise<string> {
  const cached = tokens.get(uid);
  if (cached) return cached;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`sign-in failed for ${uid}`);
  tokens.set(uid, json.idToken);
  return json.idToken;
}

async function call(handler: (r: Request) => Promise<Response>, uid: string | null, payload: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = `Bearer ${await idToken(uid)}`;
  const res = await handler(new Request('http://localhost/api', { method: 'POST', headers, body: JSON.stringify(payload) }));
  return { status: res.status, json: await res.json() };
}

const act = (uid: string | null, action: string, extra: Record<string, unknown> = {}, target: { targetType: string; targetId: string } = { targetType: 'lesson', targetId: 'l1' }) =>
  call(reviewPOST, uid, { ...target, action, ...extra });
const lessonDoc = async (id = 'l1') => (await db.doc(`lessons/${id}`).get()).data()!;
const auditEntries = async () => (await db.collection('auditLog').get()).docs.map((d) => d.data());

const quiz = (id: string) => ({ id, type: 'quiz', question: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] });
const authored = (id: string, correct = 'a') => ({ ...quiz(id), correctOptionId: correct, explanation: `Because ${correct}.` });

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  for (const uid of USERS) {
    await auth.deleteUser(uid).catch(() => undefined);
    await auth.createUser({ uid, email: `${uid}@review.test` });
  }
});

beforeEach(async () => {
  const res = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error('clear failed');
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const user = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
    put(`users/${uid}`, { role, orgId: 'org_a', branchId: 'b1', status: 'active', email: `${uid}@review.test`, displayName: uid, ...extra });
  await user('cr_super', 'super_admin');
  await user('cr_uni', 'university_admin');
  await user('cr_inst', 'instructor');
  await user('cr_author', 'content_designer', { courseDesign: cd(['content_developer']) });
  await user('cr_lead', 'content_lead', { courseDesign: cd(['lead']) });
  await user('cr_assess', 'content_designer', { courseDesign: cd(['assessment_designer']) });
  await user('cr_reviewer', 'content_designer', { courseDesign: cd(['reviewer']) });
  await user('cr_reviewer2', 'instructor', { courseDesign: cd(['reviewer']) });
  await user('cr_reviewer_c2', 'content_designer', { courseDesign: cd(['reviewer'], ['c2']) });
  await user('cr_reviewer_sus', 'content_designer', { status: 'suspended', courseDesign: cd(['reviewer']) });
  await user('cr_reviewer_b', 'content_designer', { orgId: 'org_b', courseDesign: cd(['reviewer'], ['*']) });
  await user('cr_label', 'content_lead');
  await user('cr_stu', 'student');
  await put('organizations/org_a', { name: 'Org A' });
  await put('courses/c1', { orgId: 'org_a', title: 'C1', status: 'draft', createdById: 'cr_lead', lastEditedById: 'cr_lead' });
  await put('lessons/l1', {
    orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'L1', status: 'draft', lastEditedById: 'cr_author',
    blocks: [{ id: 't1', type: 'text', content: 'Read me.' }, quiz('q1'), { id: 't2', type: 'text', content: 'More.' }],
  });
  await put('lessons/l1/answerKey/current', {
    orgId: 'org_a', courseId: 'c1', lessonId: 'l1', keyVersion: 1, release: 'after_pass',
    items: [{ blockId: 'q1', correctOptionId: 'a', explanation: 'Because a.' }], updatedById: 'cr_author', updatedAt: NOW,
  });
});

describe('review lifecycle through the route', () => {
  it('draft → in review → approved → published → archived, each step audited with a server timestamp', async () => {
    expect((await act('cr_author', 'submit')).json.review).toMatchObject({ state: 'in_review', submittedById: 'cr_author' });
    expect((await act('cr_reviewer', 'approve', { comment: 'Clear and accurate.' })).json.review).toMatchObject({ state: 'approved', reviewedById: 'cr_reviewer' });
    const pub = await act('cr_super', 'publish');
    expect(pub.json).toMatchObject({ status: 'published', override: false });
    expect(await lessonDoc()).toMatchObject({ status: 'published', review: { state: 'none' } });
    expect((await act('cr_super', 'archive', { reason: 'Replaced by a newer lesson' })).json.status).toBe('archived');

    const entries = await auditEntries();
    expect(entries.map((e) => e.action).sort()).toEqual(['approve', 'archive', 'publish', 'submit']);
    for (const e of entries) {
      expect(e.at).toBeInstanceOf(Timestamp);
      expect(Math.abs((e.at as Timestamp).toMillis() - Date.now())).toBeLessThan(60_000);
      expect(e).toMatchObject({ orgId: 'org_a', courseId: 'c1', targetType: 'lesson', targetId: 'l1' });
    }
    expect(entries.find((e) => e.action === 'approve')).toMatchObject({ actorId: 'cr_reviewer', actorRole: 'content_designer', comment: 'Clear and accurate.', fromReview: 'in_review', toReview: 'approved' });
    expect(entries.find((e) => e.action === 'archive')).toMatchObject({ actorId: 'cr_super', reason: 'Replaced by a newer lesson', fromStatus: 'published', toStatus: 'archived' });
  });

  it('changes requested carries the comment back to the author, who fixes and resubmits', async () => {
    await act('cr_author', 'submit');
    expect((await act('cr_reviewer', 'request_changes')).json.error).toBe('comment_required');
    const r = await act('cr_reviewer', 'request_changes', { comment: 'Question 1 is ambiguous.' });
    expect(r.json.review).toMatchObject({ state: 'changes_requested', comment: 'Question 1 is ambiguous.' });
    expect((await act('cr_author', 'submit')).json.review.state).toBe('in_review');
  });

  it('courses follow the same cycle', async () => {
    const course = { targetType: 'course', targetId: 'c1' };
    expect((await act('cr_lead', 'submit', {}, course)).status).toBe(200);
    expect((await act('cr_author', 'submit', {}, course)).status).toBe(403);
    expect((await act('cr_reviewer', 'approve', {}, course)).json.review.state).toBe('approved');
    expect((await act('cr_super', 'publish', {}, course)).json.status).toBe('published');
  });

  it('rejects invalid transitions with 409 and writes no audit entry', async () => {
    expect((await act('cr_reviewer', 'approve')).status).toBe(409);
    expect((await act('cr_author', 'reopen')).status).toBe(409);
    expect((await act('cr_super', 'unpublish')).status).toBe(409);
    await act('cr_author', 'submit');
    expect((await act('cr_author', 'submit')).status).toBe(409);
    expect((await auditEntries()).map((e) => e.action)).toEqual(['submit']);
  });

  it('rejects unauthenticated and malformed requests, including forged actor and timestamp fields', async () => {
    expect((await act(null, 'submit')).status).toBe(401);
    for (const extra of [{ actorId: 'cr_super' }, { at: NOW }, { override: true }, { status: 'published' }]) {
      expect((await act('cr_author', 'submit', extra)).status, JSON.stringify(extra)).toBe(400);
    }
    expect((await call(reviewPOST, 'cr_author', { targetType: 'module', targetId: 'm1', action: 'submit' })).status).toBe(400);
    expect((await call(reviewPOST, 'cr_author', { targetType: 'lesson', targetId: 'l1', action: 'delete' })).status).toBe(400);
    expect((await act('cr_author', 'submit', {}, { targetType: 'lesson', targetId: 'missing' })).status).toBe(404);
    expect(await auditEntries()).toEqual([]);
  });
});

describe('self-approval', () => {
  it('the submitter cannot approve or request changes on their own submission', async () => {
    await db.doc('users/cr_author').update({ courseDesign: cd(['content_developer', 'reviewer']) });
    await act('cr_author', 'submit');
    expect((await act('cr_author', 'approve')).status).toBe(403);
    expect((await act('cr_author', 'request_changes', { comment: 'x' })).status).toBe(403);
    expect((await lessonDoc()).review.state).toBe('in_review');
  });

  it('a reviewer who last edited the lesson cannot approve it, even when someone else submitted', async () => {
    await db.doc('lessons/l1').update({ lastEditedById: 'cr_reviewer' });
    await act('cr_inst', 'submit');
    expect((await act('cr_reviewer', 'approve')).status).toBe(403);
    expect((await act('cr_reviewer2', 'approve')).status).toBe(200);
  });

  it('a reviewer who last edited the answer key cannot approve the lesson', async () => {
    await db.doc('lessons/l1/answerKey/current').update({ updatedById: 'cr_reviewer' });
    await act('cr_author', 'submit');
    expect((await act('cr_reviewer', 'approve')).status).toBe(403);
  });

  it('approval after an edit: reopening, editing and resubmitting makes the editor ineligible', async () => {
    await act('cr_author', 'submit');
    await act('cr_reviewer', 'approve');
    await act('cr_author', 'reopen');
    // The reviewer edits the reopened draft (as an instructor-reviewer could), then it is resubmitted.
    await db.doc('lessons/l1').update({ title: 'Edited', lastEditedById: 'cr_reviewer2' });
    await act('cr_author', 'submit');
    expect((await act('cr_reviewer2', 'approve')).status).toBe(403);
    expect((await act('cr_reviewer', 'approve')).status).toBe(200);
  });

  it('the Super Admin cannot approve their own submission; overriding needs a reason instead', async () => {
    await act('cr_super', 'submit');
    expect((await act('cr_super', 'approve')).status).toBe(403);
  });
});

describe('scope, account status and organization', () => {
  it('out-of-scope, suspended, label-only and non-reviewer staff cannot review', async () => {
    await act('cr_author', 'submit');
    for (const uid of ['cr_reviewer_c2', 'cr_reviewer_sus', 'cr_label', 'cr_uni', 'cr_inst', 'cr_lead', 'cr_assess', 'cr_stu']) {
      expect((await act(uid, 'approve')).status, uid).toBe(403);
    }
    expect((await lessonDoc()).review.state).toBe('in_review');
  });

  it('a reviewer of another organization gets 404, even with org-wide scope', async () => {
    await act('cr_author', 'submit');
    expect((await act('cr_reviewer_b', 'approve')).status).toBe(404);
  });

  it('a reviewer suspended after assignment loses authority immediately', async () => {
    await act('cr_author', 'submit');
    await db.doc('users/cr_reviewer').update({ status: 'suspended' });
    expect((await act('cr_reviewer', 'approve')).status).toBe(403);
  });

  it('students and reviewers cannot submit', async () => {
    expect((await act('cr_stu', 'submit')).status).toBe(403);
    expect((await act('cr_reviewer', 'submit')).status).toBe(403);
  });
});

describe('publication is Super Admin only (D3)', () => {
  it('nobody else publishes, unpublishes or archives, even approved content', async () => {
    await act('cr_author', 'submit');
    await act('cr_reviewer', 'approve');
    for (const uid of ['cr_uni', 'cr_inst', 'cr_lead', 'cr_author', 'cr_reviewer', 'cr_assess', 'cr_stu']) {
      for (const action of ['publish', 'archive']) expect((await act(uid, action, { reason: 'I would like to publish this' })).status, `${uid} ${action}`).toBe(403);
    }
    await db.doc('lessons/l1').update({ status: 'published' });
    expect((await act('cr_uni', 'unpublish')).status).toBe(403);
    expect((await auditEntries()).map((e) => e.action).sort()).toEqual(['approve', 'submit']);
  });

  it('a Super Admin override without a reason, or with a too-short one, is refused', async () => {
    const none = await act('cr_super', 'publish');
    expect(none).toMatchObject({ status: 400, json: { error: 'reason_required' } });
    expect((await act('cr_super', 'publish', { reason: 'urgent' })).json.error).toBe('reason_required');
    expect((await lessonDoc()).status).toBe('draft');
    expect(await auditEntries()).toEqual([]);
  });

  it('a Super Admin override with a reason publishes and is audited as an override', async () => {
    await act('cr_author', 'submit');
    const r = await act('cr_super', 'publish', { reason: 'Live cohort needs this lesson today' });
    expect(r.json).toMatchObject({ status: 'published', override: true });
    const entry = (await auditEntries()).find((e) => e.action === 'publish')!;
    expect(entry).toMatchObject({ override: true, reason: 'Live cohort needs this lesson today', actorId: 'cr_super', fromReview: 'in_review', toStatus: 'published' });
  });

  it('concurrent reviews of one submission: exactly one decision lands', async () => {
    await act('cr_author', 'submit');
    const results = await Promise.all([
      act('cr_reviewer', 'approve'),
      act('cr_reviewer2', 'request_changes', { comment: 'Needs work.' }),
      act('cr_super', 'approve'),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await auditEntries()).filter((e) => e.action !== 'submit')).toHaveLength(1);
  });
});

describe('assessment authoring route', () => {
  it('an in-scope Assessment Designer replaces quiz questions and the key; other blocks are untouched', async () => {
    const before = await lessonDoc();
    const r = await call(assessmentPOST, 'cr_assess', { lessonId: 'l1', questions: [authored('q1', 'b'), authored('q2')] });
    expect(r).toMatchObject({ status: 200, json: { questionCount: 2, keyVersion: 2 } });
    const after = await lessonDoc();
    expect(after.blocks.filter((b: { type: string }) => b.type !== 'quiz')).toEqual(before.blocks.filter((b: { type: string }) => b.type !== 'quiz'));
    expect(after.blocks.map((b: { id: string }) => b.id)).toEqual(['t1', 'q1', 't2', 'q2']);
    expect(JSON.stringify(after.blocks)).not.toContain('correctOptionId');
    expect(after).toMatchObject({ lastEditedById: 'cr_assess', title: 'L1' });
    const k = (await db.doc('lessons/l1/answerKey/current').get()).data()!;
    expect(k).toMatchObject({ keyVersion: 2, updatedById: 'cr_assess', items: [{ blockId: 'q1', correctOptionId: 'b' }, { blockId: 'q2', correctOptionId: 'a' }] });
    expect((await auditEntries())[0]).toMatchObject({ action: 'assessment_update', actorId: 'cr_assess', targetId: 'l1' });
  });

  it('cannot smuggle non-quiz content or questions without answers', async () => {
    const text = { id: 't9', type: 'text', content: 'Injected' };
    expect((await call(assessmentPOST, 'cr_assess', { lessonId: 'l1', questions: [text] })).status).toBe(400);
    expect((await call(assessmentPOST, 'cr_assess', { lessonId: 'l1', questions: [quiz('q1')] })).status).toBe(400);
    expect((await call(assessmentPOST, 'cr_assess', { lessonId: 'l1', questions: [authored('q1'), authored('q1')] })).status).toBe(400);
    expect((await call(assessmentPOST, 'cr_assess', { lessonId: 'l1', questions: [authored('q1')], title: 'x' })).status).toBe(400);
    expect((await lessonDoc()).blocks).toHaveLength(3);
  });

  it('is refused while the lesson is in review or approved, and for reviewers, students, other scopes and orgs', async () => {
    for (const uid of ['cr_reviewer', 'cr_stu', 'cr_reviewer_c2', 'cr_label']) {
      expect((await call(assessmentPOST, uid, { lessonId: 'l1', questions: [authored('q1')] })).status, uid).toBe(403);
    }
    expect((await call(assessmentPOST, 'cr_reviewer_b', { lessonId: 'l1', questions: [authored('q1')] })).status).toBe(404);
    await act('cr_author', 'submit');
    expect((await call(assessmentPOST, 'cr_assess', { lessonId: 'l1', questions: [authored('q1')] })).json.error).toBe('content_frozen');
  });

  it('Course Design members lose assessment authority once the course is published; instructors keep it', async () => {
    await db.doc('courses/c1').update({ status: 'published' });
    expect((await call(assessmentPOST, 'cr_assess', { lessonId: 'l1', questions: [authored('q1')] })).status).toBe(403);
    expect((await call(assessmentPOST, 'cr_inst', { lessonId: 'l1', questions: [authored('q1')] })).status).toBe(200);
  });

  it('the Assessment Designer who edited the key cannot approve it', async () => {
    await db.doc('users/cr_assess').update({ courseDesign: cd(['assessment_designer', 'reviewer']) });
    await call(assessmentPOST, 'cr_assess', { lessonId: 'l1', questions: [authored('q1')] });
    await act('cr_author', 'submit');
    expect((await act('cr_assess', 'approve')).status).toBe(403);
  });
});

describe('C1 regression', () => {
  it('a lesson reviewed and published through the route is graded on the server for enrolled students', async () => {
    await db.doc('courses/c1').update({ status: 'published' });
    await db.doc('enrollments/c1_cr_stu').set({ orgId: 'org_a', branchId: 'b1', courseId: 'c1', batchId: 'bt1', studentId: 'cr_stu', status: 'active' });
    // Course Design authors lose authority once the course is published; staff authors keep it.
    expect((await act('cr_inst', 'submit')).status).toBe(200);
    expect((await act('cr_reviewer', 'approve')).status).toBe(200);
    expect((await act('cr_super', 'publish')).status).toBe(200);
    const fail = await call(quizPOST, 'cr_stu', { courseId: 'c1', lessonId: 'l1', answers: { q1: 'b' } });
    expect(fail).toMatchObject({ status: 200, json: { passed: false } });
    expect(fail.json.feedback).toBeUndefined();
    expect(JSON.stringify(fail.json)).not.toContain('Because a.');
  });
});

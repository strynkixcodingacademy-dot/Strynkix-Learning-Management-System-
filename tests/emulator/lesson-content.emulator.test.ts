/**
 * Milestone G50 — POST /api/content/lesson (Block Studio saves) on the Auth +
 * Firestore emulators with real ID tokens. Answers are stripped into the
 * confidential key, drafts and revisions are written with the key in one
 * transaction with an audit entry (counts only), published content is never
 * touched, and authority, freezing and validation match the rules.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST } from '@/app/api/content/lesson/route';
import { getAdminServices } from '@/lib/server/firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-10-30T00:00:00.000Z';
const SECRET = 'LESSON-SAVE-SECRET';
const USERS = ['lc_inst', 'lc_inst_b', 'lc_stu', 'lc_dev', 'lc_rev', 'lc_assess'];

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();

async function idToken(uid: string): Promise<string> {
  if (tokens.has(uid)) return tokens.get(uid)!;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const t = (await res.json()).idToken;
  tokens.set(uid, t);
  return t;
}
async function save(uid: string, payload: unknown) {
  const res = await POST(new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(uid)}` }, body: JSON.stringify(payload) }));
  return { status: res.status, json: await res.json() };
}
const get = async (p: string) => (await db.doc(p).get()).data();
const audits = async () => (await db.collection('auditLog').get()).docs.map((d) => d.data());
const quiz = (id: string, correct = 'b') => ({ id, type: 'quiz', question: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionId: correct, explanation: `${SECRET} ${id}` });
const text = { id: 't1', type: 'text', content: 'Read this first.' };
const body = (lessonId: string, blocks: unknown[] = [text, quiz('q1')]) => ({ lessonId, title: 'Saved title', estimatedMinutes: 15, blocks });

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  for (const uid of USERS) {
    await auth.deleteUser(uid).catch(() => undefined);
    await auth.createUser({ uid, email: `${uid}@lc.test` });
  }
});

beforeEach(async () => {
  tokens.clear();
  await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const cd = (r: string[], c: string[]) => ({ department: 'course_design', responsibilities: r, assignedCourseIds: c, assignedAt: NOW, assignedByUserId: 'x' });
  const u = (uid: string, role: string, extra: Record<string, unknown> = {}) => put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@lc.test`, displayName: uid, ...extra });
  await u('lc_inst', 'instructor', { branchId: 'b1' });
  await u('lc_inst_b', 'instructor', { orgId: 'org_b', branchId: 'bx' });
  await u('lc_stu', 'student', { branchId: 'b1' });
  await u('lc_dev', 'content_designer', { courseDesign: cd(['content_developer'], ['c1']) });
  await u('lc_rev', 'content_designer', { courseDesign: cd(['reviewer'], ['c1']) });
  await u('lc_assess', 'content_designer', { courseDesign: cd(['assessment_designer'], ['c1']) });
  await put('courses/c1', { orgId: 'org_a', title: 'C1', status: 'draft' });
  const lesson = (id: string, status: string, extra: Record<string, unknown> = {}) =>
    put(`lessons/${id}`, { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: id, status, blocks: [text], lastEditedById: 'lc_inst', ...extra });
  await lesson('l_draft', 'draft');
  await lesson('l_keyed', 'draft');
  await put('lessons/l_keyed/answerKey/current', { orgId: 'org_a', courseId: 'c1', lessonId: 'l_keyed', keyVersion: 3, release: 'after_pass', items: [], updatedById: 'lc_inst', updatedAt: NOW });
  await lesson('l_frozen', 'draft', { review: { state: 'in_review', submittedById: 'lc_dev', submittedAt: NOW } });
  await lesson('l_pub', 'published', { publishedVersion: 2, blocks: [text, { id: 'q1', type: 'quiz', question: 'Live?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }] });
  await put('lessons/l_pub/answerKey/current', { orgId: 'org_a', courseId: 'c1', lessonId: 'l_pub', keyVersion: 4, release: 'after_pass', items: [{ blockId: 'q1', correctOptionId: 'a', explanation: 'Live answer.' }], updatedById: 'lc_inst', updatedAt: NOW });
  await lesson('l_arch', 'archived');
});

describe('G50 — Block Studio saves through the audited server route', () => {
  it('saves a draft: answers move into the key (next version), the lesson carries none, audit has counts only', async () => {
    const res = await save('lc_inst', body('l_keyed'));
    expect(res).toMatchObject({ status: 200, json: { revision: false, questionCount: 1, keyVersion: 4 } });
    const lesson = (await get('lessons/l_keyed'))!;
    expect(lesson).toMatchObject({ title: 'Saved title', estimatedMinutes: 15, lastEditedById: 'lc_inst' });
    expect(JSON.stringify(lesson)).not.toContain(SECRET);
    expect(await get('lessons/l_keyed/answerKey/current')).toMatchObject({ keyVersion: 4, updatedById: 'lc_inst', items: [{ blockId: 'q1', correctOptionId: 'b' }] });
    const [entry] = await audits();
    expect(entry).toMatchObject({ action: 'lesson_content_update', targetId: 'l_keyed', actorId: 'lc_inst', revision: false, questionCount: 1, keyVersion: 4 });
    expect(JSON.stringify(entry)).not.toContain(SECRET);
    // First key for a lesson that had none: version 1.
    expect((await save('lc_inst', body('l_draft'))).json.keyVersion).toBe(1);
  });

  it('a published lesson is saved as its working revision; live content and live key stay untouched', async () => {
    const res = await save('lc_inst', body('l_pub', [text, quiz('q1', 'b')]));
    expect(res).toMatchObject({ status: 200, json: { revision: true, keyVersion: 5 } });
    expect(await get('lessons/l_pub')).toMatchObject({ title: 'l_pub', publishedVersion: 2 });
    expect((await get('lessons/l_pub/answerKey/current'))!.items[0].correctOptionId).toBe('a');
    expect(await get('lessons/l_pub/revisions/working')).toMatchObject({ title: 'Saved title', baseVersion: 2, lastEditedById: 'lc_inst' });
    expect(await get('lessons/l_pub/answerKey/working')).toMatchObject({ keyVersion: 5, items: [{ blockId: 'q1', correctOptionId: 'b' }] });
    // A second save keeps the version the working key will have once published.
    expect((await save('lc_inst', body('l_pub', [text, quiz('q1', 'a')]))).json.keyVersion).toBe(5);
  });

  it('authority matches the rules: in-scope content developers yes; reviewers, assessment designers, students, other academies no', async () => {
    expect((await save('lc_dev', body('l_draft'))).status).toBe(200);
    expect((await save('lc_rev', body('l_draft'))).status).toBe(403);
    expect((await save('lc_assess', body('l_draft'))).status).toBe(403);
    expect((await save('lc_stu', body('l_draft'))).status).toBe(403);
    expect((await save('lc_inst_b', body('l_draft'))).status).toBe(404);
  });

  it('refuses frozen and archived lessons, incomplete questions and malformed bodies, writing nothing', async () => {
    expect((await save('lc_inst', body('l_frozen'))).status).toBe(409);
    expect((await save('lc_inst', body('l_arch'))).status).toBe(409);
    const { correctOptionId: _c, ...noAnswer } = quiz('q1');
    void _c;
    expect((await save('lc_inst', body('l_draft', [noAnswer]))).status).toBe(400);
    expect((await save('lc_inst', body('l_draft', [{ id: 'x', type: 'script', content: 'alert(1)' }]))).status).toBe(400);
    expect((await save('lc_inst', { ...body('l_draft'), status: 'published' })).status).toBe(400);
    expect((await save('lc_inst', { ...body('l_draft'), title: '' })).status).toBe(400);
    expect(await audits()).toEqual([]);
    expect((await get('lessons/l_draft'))!.title).toBe('l_draft');
  });
});

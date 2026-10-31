/**
 * Milestone G28–G30 — POST /api/content/structure on the Auth + Firestore
 * emulators with real ID tokens: course details, module details/order/deletion,
 * draft lesson order/move/deletion. Authorized and validated on the server,
 * audited atomically, and never altering published content or progress.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST } from '@/app/api/content/structure/route';
import { getAdminServices } from '@/lib/server/firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-10-30T00:00:00.000Z';
const USERS = ['cs_super', 'cs_inst', 'cs_inst_b', 'cs_stu', 'cs_lead', 'cs_dev'];

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
async function act(uid: string, payload: unknown) {
  const res = await POST(new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(uid)}` }, body: JSON.stringify(payload) }));
  return { status: res.status, json: await res.json() };
}
const get = async (p: string) => (await db.doc(p).get()).data();
const audits = async () => (await db.collection('auditLog').get()).docs.map((d) => d.data());
const order = async (coll: string, field: string, value: string) =>
  (await db.collection(coll).where(field, '==', value).get()).docs.map((d) => ({ id: d.id, o: d.data().orderIndex })).sort((a, b) => a.o - b.o).map((x) => x.id);

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  for (const uid of USERS) {
    await auth.deleteUser(uid).catch(() => undefined);
    await auth.createUser({ uid, email: `${uid}@cs.test` });
  }
});

beforeEach(async () => {
  tokens.clear();
  await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const u = (uid: string, role: string, extra: Record<string, unknown> = {}) => put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@cs.test`, displayName: uid, ...extra });
  const cd = (r: string[], c: string[]) => ({ department: 'course_design', responsibilities: r, assignedCourseIds: c, assignedAt: NOW, assignedByUserId: 'cs_super' });
  await u('cs_super', 'super_admin');
  await u('cs_inst', 'instructor', { branchId: 'b1' });
  await u('cs_inst_b', 'instructor', { orgId: 'org_b', branchId: 'bx' });
  await u('cs_stu', 'student', { branchId: 'b1' });
  await u('cs_lead', 'content_lead', { courseDesign: cd(['lead'], ['c1']) });
  await u('cs_dev', 'content_designer', { courseDesign: cd(['content_developer'], ['c1']) });
  const course = (id: string, status: string, extra: Record<string, unknown> = {}) => put(`courses/${id}`, { orgId: 'org_a', title: id, tagline: '', description: 'About it.', level: 'beginner', tags: [], prerequisites: [], estimatedWeeks: 4, status, createdById: 'cs_inst', ...extra });
  await course('c1', 'draft');
  await course('c_pub', 'published', { publishedVersion: 1 });
  await course('c_rev', 'draft', { review: { state: 'in_review', submittedById: 'cs_inst', submittedAt: NOW } });
  const mod = (id: string, courseId: string, orderIndex: number) => put(`modules/${id}`, { orgId: 'org_a', courseId, title: id, slug: id, summary: '', orderIndex, status: 'published' });
  await mod('m1', 'c1', 1); await mod('m2', 'c1', 2); await mod('m3', 'c1', 3); await mod('m_empty', 'c1', 4);
  await mod('mp1', 'c_pub', 1); await mod('mp2', 'c_pub', 2);
  const lesson = (id: string, moduleId: string, courseId: string, orderIndex: number, status: string, extra: Record<string, unknown> = {}) =>
    put(`lessons/${id}`, { orgId: 'org_a', courseId, moduleId, title: id, slug: id, type: 'concept', orderIndex, estimatedMinutes: 10, blocks: [], status, lastEditedById: 'cs_inst', ...extra });
  await lesson('l1', 'm1', 'c1', 1, 'draft'); await lesson('l2', 'm1', 'c1', 2, 'draft'); await lesson('l3', 'm1', 'c1', 3, 'published', { publishedVersion: 1 });
  await lesson('l_rev', 'm2', 'c1', 1, 'draft', { review: { state: 'approved' } });
  await lesson('l_was_pub', 'm2', 'c1', 2, 'draft', { publishedVersion: 2 });
  await lesson('lp', 'mp1', 'c_pub', 1, 'published', { publishedVersion: 1 });
  await put('lessons/l1/answerKey/current', { orgId: 'org_a', courseId: 'c1', lessonId: 'l1', keyVersion: 1, items: [] });
  await put('progress/s_c_pub_lp', { orgId: 'org_a', courseId: 'c_pub', lessonId: 'lp', moduleId: 'mp1', studentId: 'cs_stu', status: 'completed' });
});

describe('G28 — course details', () => {
  it('an author edits a draft course; the change and its audit entry are written together', async () => {
    const res = await act('cs_inst', { action: 'update_course', courseId: 'c1', fields: { title: 'Course One', level: 'advanced', tags: ['ts'] } });
    expect(res.status).toBe(200);
    expect(await get('courses/c1')).toMatchObject({ title: 'Course One', level: 'advanced', tags: ['ts'], lastEditedById: 'cs_inst', status: 'draft' });
    // Regression: fields not sent are left alone (schema defaults must not wipe them).
    await db.doc('courses/c1').update({ prerequisites: ['HTML'] });
    expect((await act('cs_inst', { action: 'update_course', courseId: 'c1', fields: { tagline: 'New' } })).status).toBe(200);
    expect(await get('courses/c1')).toMatchObject({ prerequisites: ['HTML'], tags: ['ts'], tagline: 'New' });
    expect((await audits()).map((a) => a.fields).sort()).toEqual([['level', 'tags', 'title'], ['tagline']]);
    expect(await audits()).toContainEqual(expect.objectContaining({ action: 'update_course', targetId: 'c1', actorId: 'cs_inst', courseId: 'c1' }));
  });

  it('published, in-review and out-of-scope courses are refused; privileged fields are rejected', async () => {
    expect((await act('cs_inst', { action: 'update_course', courseId: 'c_pub', fields: { title: 'XY' } })).status).toBe(409);
    expect((await act('cs_inst', { action: 'update_course', courseId: 'c_rev', fields: { title: 'XY' } })).status).toBe(409);
    expect((await act('cs_stu', { action: 'update_course', courseId: 'c1', fields: { title: 'XY' } })).status).toBe(403);
    expect((await act('cs_dev', { action: 'update_course', courseId: 'c1', fields: { title: 'XY' } })).status).toBe(403);
    expect((await act('cs_inst_b', { action: 'update_course', courseId: 'c1', fields: { title: 'XY' } })).status).toBe(404);
    expect((await act('cs_inst', { action: 'update_course', courseId: 'c1', fields: { status: 'published' } })).status).toBe(400);
    expect((await act('cs_inst', { action: 'update_course', courseId: 'c1', fields: { title: '' } })).status).toBe(400);
    expect((await act('cs_lead', { action: 'update_course', courseId: 'c1', fields: { tagline: 'Led' } })).status).toBe(200);
    expect((await audits()).map((a) => a.actorId)).toEqual(['cs_lead']);
  });
});

describe('G29 — modules', () => {
  it('edits and reorders modules of a draft course, renumbering consistently', async () => {
    expect((await act('cs_inst', { action: 'update_module', moduleId: 'm2', fields: { title: 'Second', summary: 'Two' } })).status).toBe(200);
    expect(await get('modules/m2')).toMatchObject({ title: 'Second', summary: 'Two' });
    expect((await act('cs_inst', { action: 'reorder_module', moduleId: 'm3', direction: 'up' })).status).toBe(200);
    expect(await order('modules', 'courseId', 'c1')).toEqual(['m1', 'm3', 'm2', 'm_empty']);
    expect((await act('cs_inst', { action: 'reorder_module', moduleId: 'm1', direction: 'up' })).status).toBe(409);
    expect((await act('cs_inst', { action: 'reorder_module', moduleId: 'mp2', direction: 'up' })).status).toBe(409);
    expect((await act('cs_dev', { action: 'reorder_module', moduleId: 'm2', direction: 'up' })).status).toBe(403);
  });

  it('only the Super Admin deletes a module, and only an empty one', async () => {
    expect((await act('cs_inst', { action: 'delete_module', moduleId: 'm_empty' })).status).toBe(403);
    expect((await act('cs_super', { action: 'delete_module', moduleId: 'm1' })).status).toBe(409);
    expect((await act('cs_super', { action: 'delete_module', moduleId: 'm_empty' })).status).toBe(200);
    expect(await get('modules/m_empty')).toBeUndefined();
    expect((await audits()).map((a) => a.action)).toEqual(['delete_module']);
  });
});

describe('G30 — lessons', () => {
  it('reorders draft lessons, refusing to move a published one or swap with it', async () => {
    expect((await act('cs_inst', { action: 'reorder_lesson', lessonId: 'l2', direction: 'up' })).status).toBe(200);
    expect(await order('lessons', 'moduleId', 'm1')).toEqual(['l2', 'l1', 'l3']);
    expect((await act('cs_inst', { action: 'reorder_lesson', lessonId: 'l1', direction: 'down' })).status).toBe(409);
    expect((await act('cs_inst', { action: 'reorder_lesson', lessonId: 'l3', direction: 'up' })).status).toBe(409);
    expect(await get('lessons/l3')).toMatchObject({ orderIndex: 3, status: 'published' });
  });

  it('moves a draft lesson to the end of another module of the same course', async () => {
    expect((await act('cs_inst', { action: 'move_lesson', lessonId: 'l1', toModuleId: 'm2' })).status).toBe(200);
    expect(await get('lessons/l1')).toMatchObject({ moduleId: 'm2', orderIndex: 3 });
    expect((await act('cs_inst', { action: 'move_lesson', lessonId: 'l2', toModuleId: 'mp1' })).status).toBe(400);
    expect((await act('cs_inst', { action: 'move_lesson', lessonId: 'l_rev', toModuleId: 'm1' })).status).toBe(409);
    expect((await act('cs_inst', { action: 'move_lesson', lessonId: 'lp', toModuleId: 'mp2' })).status).toBe(409);
  });

  it('deletes only never-published drafts, with their answer key, and only as the Super Admin', async () => {
    expect((await act('cs_inst', { action: 'delete_lesson', lessonId: 'l1' })).status).toBe(403);
    expect((await act('cs_super', { action: 'delete_lesson', lessonId: 'l_was_pub' })).status).toBe(409);
    expect((await act('cs_super', { action: 'delete_lesson', lessonId: 'lp' })).status).toBe(409);
    expect((await act('cs_super', { action: 'delete_lesson', lessonId: 'l1' })).status).toBe(200);
    expect(await get('lessons/l1')).toBeUndefined();
    expect(await get('lessons/l1/answerKey/current')).toBeUndefined();
    // Published content and student progress are untouched by any of it.
    expect(await get('lessons/lp')).toMatchObject({ status: 'published', moduleId: 'mp1' });
    expect(await get('progress/s_c_pub_lp')).toMatchObject({ status: 'completed' });
  });

  it('rejects unknown actions and extra fields', async () => {
    expect((await act('cs_super', { action: 'delete_course', courseId: 'c1' })).status).toBe(400);
    expect((await act('cs_super', { action: 'reorder_lesson', lessonId: 'l1', direction: 'sideways' })).status).toBe(400);
    expect((await act('cs_super', { action: 'move_lesson', lessonId: 'l1', toModuleId: 'm2', orderIndex: 0 })).status).toBe(400);
    expect(await audits()).toEqual([]);
  });
});

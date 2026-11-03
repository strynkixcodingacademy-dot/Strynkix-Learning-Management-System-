/**
 * Academy operations, Batch 6 — portfolio and resume builder through the real
 * route on the emulators: ownership, instructor recommendations, verified
 * certificates only, limits.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST as career } from '@/app/api/career/route';
import { getAdminServices } from '@/lib/server/firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-01-01T00:00:00.000Z';
const USERS = ['ac_stu', 'ac_stu2', 'ac_inst', 'ac_inst2', 'ac_ba2'];
let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();

async function idToken(uid: string) {
  if (tokens.has(uid)) return tokens.get(uid)!;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const t = (await res.json()).idToken;
  tokens.set(uid, t);
  return t;
}
async function C(uid: string, body: unknown) {
  const res = await career(new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(uid)}` }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const entry = { title: 'Todo app', description: 'A todo app with React and a REST API.', technologies: ['React'], repoUrl: 'https://github.com/x/todo' };
const resume = (certs: unknown[] = []) => ({ action: 'save_resume', name: 'Main', template: 'modern', data: { fullName: 'Asha Patil', certifications: certs } });

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  for (const uid of USERS) { await auth.deleteUser(uid).catch(() => undefined); await auth.createUser({ uid, email: `${uid}@ac.test` }); }
});

beforeEach(async () => {
  tokens.clear();
  await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const u = (uid: string, role: string, branchId: string) => put(`users/${uid}`, { role, orgId: 'org_a', branchId, status: 'active', email: `${uid}@ac.test`, displayName: uid, createdAt: NOW, updatedAt: NOW });
  await u('ac_stu', 'student', 'b1'); await u('ac_stu2', 'student', 'b1'); await u('ac_inst', 'instructor', 'b1'); await u('ac_inst2', 'instructor', 'b1'); await u('ac_ba2', 'branch_admin', 'b2');
  await put('batches/bt1', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', instructorUserIds: ['ac_inst'], status: 'in_progress' });
  await put('enrollments/c1_ac_stu', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', batchId: 'bt1', studentId: 'ac_stu', status: 'active' });
  await put('certificates/c1_ac_stu', { orgId: 'org_a', studentId: 'ac_stu', courseTitle: 'Full-Stack Web', academyName: 'Strynkix', completedOn: '2026-06-01', verificationCode: 'CODE12345', status: 'issued' });
  await put('certificates/c1_ac_stu2', { orgId: 'org_a', studentId: 'ac_stu2', courseTitle: 'Other', academyName: 'Strynkix', completedOn: '2026-06-01', verificationCode: 'CODE99999', status: 'issued' });
});

describe('portfolio', () => {
  it('only the owner edits; the batch’s instructor views and recommends; others can’t', async () => {
    const saved = await C('ac_stu', { action: 'save_entry', entry });
    const id = saved.json.entryId;
    expect((await C('ac_stu2', { action: 'save_entry', entryId: id, entry })).status).toBe(404);
    expect((await C('ac_stu2', { action: 'delete_entry', entryId: id })).status).toBe(404);
    expect((await C('ac_inst', { action: 'save_entry', entry })).status).toBe(403);
    expect((await C('ac_inst', { action: 'student_portfolio', studentId: 'ac_stu' })).json.entries).toHaveLength(1);
    expect((await C('ac_inst2', { action: 'student_portfolio', studentId: 'ac_stu' })).status).toBe(404);
    expect((await C('ac_ba2', { action: 'student_portfolio', studentId: 'ac_stu' })).status).toBe(404);
    expect((await C('ac_inst', { action: 'recommend', entryId: id, note: 'Clean code.' })).status).toBe(200);
    expect((await C('ac_stu', { action: 'portfolio' })).json.entries[0].recommendation).toMatchObject({ byId: 'ac_inst', note: 'Clean code.' });
    // Changing the work drops the recommendation.
    await C('ac_stu', { action: 'save_entry', entryId: id, entry: { ...entry, repoUrl: 'https://github.com/x/other' } });
    expect((await C('ac_stu', { action: 'portfolio' })).json.entries[0].recommendation).toBeUndefined();
    expect((await C('ac_stu', { action: 'save_entry', entry: { ...entry, repoUrl: 'http://insecure.test' } })).status).toBe(400);
    expect((await C('ac_stu', { action: 'save_entry', entry: { ...entry, attemptId: 'someone_else' } })).status).toBe(400);
  });
});

describe('resumes', () => {
  it('a verified certificate must be the student’s own; the verify link is set by the server', async () => {
    const ok = await C('ac_stu', resume([{ name: 'Fake name', issuer: 'Fake', certificateId: 'c1_ac_stu', verifyUrl: 'https://evil.test' }]));
    expect(ok.status).toBe(200);
    const stored = (await db.doc(`resumes/${ok.json.resumeId}`).get()).data()!;
    expect(stored.data.certifications[0]).toEqual({ name: 'Full-Stack Web', issuer: 'Strynkix', date: '2026-06-01', certificateId: 'c1_ac_stu', verifyUrl: '/verify/CODE12345' });
    expect((await C('ac_stu', resume([{ name: 'X', issuer: 'Y', certificateId: 'c1_ac_stu2' }]))).status).toBe(400);
    // Free-text certifications can't carry a verify link.
    const free = await C('ac_stu', resume([{ name: 'AWS', issuer: 'Amazon', verifyUrl: '/verify/CODE12345' }]));
    expect((await db.doc(`resumes/${free.json.resumeId}`).get()).data()!.data.certifications[0].verifyUrl).toBeUndefined();
    expect((await C('ac_stu2', { action: 'save_resume', resumeId: ok.json.resumeId, name: 'Hijack', template: 'classic', data: { fullName: 'X Y' } })).status).toBe(404);
    expect((await C('ac_inst', { action: 'resumes' })).status).toBe(403);
    const sugg = await C('ac_stu', { action: 'suggestions' });
    expect(sugg.json.certificates).toEqual([{ certificateId: 'c1_ac_stu', name: 'Full-Stack Web', issuer: 'Strynkix', date: '2026-06-01' }]);
  });
});

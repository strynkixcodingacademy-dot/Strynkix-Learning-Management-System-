/**
 * Stage C4 — legacy quiz migration and complete server-side grading on the
 * Auth + Firestore emulators. Fixtures cover every discovered format; the
 * migration runs through the real applier (and once through the CLI), and the
 * real rules are checked for direct-write bypasses before and after.
 */

import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Firestore as ClientFirestore } from 'firebase/firestore';
import { POST as quizPOST } from '@/app/api/quiz/attempt/route';
import { getAdminServices } from '@/lib/server/firebase-admin';
import { applyQuizKeyMigration, loadQuizInventory } from '@/lib/migration/apply-quiz-key-migration';
import { summarizeQuizMigration } from '@/lib/migration/quiz-key-migration';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-10-29T00:00:00.000Z';
const REPO = path.resolve(__dirname, '../..');

let db: Firestore;
let auth: Auth;
let testEnv: RulesTestEnvironment;
let token = '';
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as ClientFirestore;

const EXPLANATION = 'Secret explanation for migration tests.';
const q = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'quiz', question: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], ...extra });
const inline = (id: string, correct = 'b') => q(id, { correctOptionId: correct, explanation: EXPLANATION });

const attempt = async (lessonId: string, answers: Record<string, string>) => {
  const res = await quizPOST(new Request('http://localhost/api/quiz/attempt', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ courseId: 'c1', lessonId, answers }),
  }));
  return { status: res.status, text: await res.text() };
};
const lesson = async (id: string) => (await db.doc(`lessons/${id}`).get()).data()!;

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8'), host: FIRESTORE_HOST.split(':')[0], port: Number(FIRESTORE_HOST.split(':')[1]) },
  });
  await auth.deleteUser('qm_stu').catch(() => undefined);
  await auth.createUser({ uid: 'qm_stu', email: 'qm_stu@migration.test' });
  const custom = await auth.createCustomToken('qm_stu');
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  token = (await res.json()).idToken;
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  const res = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error('clear failed');
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  await put('users/qm_stu', { role: 'student', orgId: 'org_a', branchId: 'b1', status: 'active', email: 'qm_stu@migration.test', displayName: 'S' });
  await put('users/qm_inst', { role: 'instructor', orgId: 'org_a', branchId: 'b1', status: 'active', email: 'i@x.test', displayName: 'I' });
  await put('organizations/org_a', { name: 'Org A' });
  await put('courses/c1', { orgId: 'org_a', title: 'C1', status: 'published', createdById: 'qm_inst' });
  await put('enrollments/c1_qm_stu', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', batchId: 'bt1', studentId: 'qm_stu', status: 'active' });
  const les = (id: string, blocks: unknown[], extra: Record<string, unknown> = {}) =>
    put(`lessons/${id}`, { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: id, estimatedMinutes: 10, status: 'published', blocks, ...extra });
  await les('legacy', [{ id: 't1', type: 'text', content: 'Read.' }, inline('q1'), inline('q2', 'a')], { publishedVersion: 1 });
  await les('legacy_draft', [inline('q1')], { status: 'draft', review: { state: 'approved', submittedById: 'qm_inst', reviewedById: 'r' } });
  await les('keyed', [q('q1')]);
  await put('lessons/keyed/answerKey/current', { orgId: 'org_a', courseId: 'c1', lessonId: 'keyed', keyVersion: 2, release: 'after_pass', items: [{ blockId: 'q1', correctOptionId: 'a', explanation: EXPLANATION }], updatedById: 'qm_inst', updatedAt: NOW });
  await les('conflict', [inline('q1', 'b')]);
  await put('lessons/conflict/answerKey/current', { orgId: 'org_a', courseId: 'c1', lessonId: 'conflict', keyVersion: 1, release: 'after_pass', items: [{ blockId: 'q1', correctOptionId: 'a', explanation: EXPLANATION }], updatedById: 'qm_inst', updatedAt: NOW });
  await les('malformed', [inline('q1'), q('q2')]);
  await les('plain', [{ id: 't1', type: 'text', content: 'No quiz.' }]);
  // History that the migration must leave alone.
  await put('lessons/legacy/versions/000001', { version: 1, orgId: 'org_a', courseId: 'c1', lessonId: 'legacy', blocks: [inline('q1')], baseline: true });
  await put('progress/qm_stu_c1_plain', { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', lessonId: 'plain', studentId: 'qm_stu', batchId: 'bt1', status: 'completed', timeSpentSeconds: 60, completedAt: NOW });
});

describe('before migration: every quiz format is graded on the server', () => {
  it('a legacy inline quiz is graded by the route from its inline answers, releasing nothing before a pass', async () => {
    const fail = await attempt('legacy', { q1: 'a', q2: 'b' });
    expect(fail.status).toBe(200);
    expect(JSON.parse(fail.text)).toMatchObject({ correct: 0, passed: false });
    expect(fail.text).not.toContain(EXPLANATION);
    expect(fail.text).not.toContain('correctOptionId');
    const att = (await db.doc('progress/qm_stu_c1_legacy/quizAttempts/000001').get()).data();
    expect(att).toMatchObject({ keyVersion: 0, correct: 0 });
  });

  it('a malformed legacy quiz is not graded at all (404), rather than graded wrongly', async () => {
    expect((await attempt('malformed', { q1: 'b' })).status).toBe(404);
  });

  it('the remaining pre-migration gap: a keyless legacy lesson can still be completed by a direct write', async () => {
    await assertSucceeds(setDoc(doc(as('qm_stu'), 'progress/qm_stu_c1_legacy'), {
      orgId: 'org_a', courseId: 'c1', moduleId: 'm1', lessonId: 'legacy', studentId: 'qm_stu', batchId: 'bt1',
      status: 'completed', timeSpentSeconds: 30, completedAt: NOW, createdAt: NOW, updatedAt: NOW,
    }));
  });
});

describe('migration', () => {
  it('dry-run inventory classifies every fixture without writing', async () => {
    const before = JSON.stringify((await db.doc('lessons/legacy').get()).data());
    const inv = await loadQuizInventory(db);
    const s = summarizeQuizMigration(inv.decisions);
    expect(s.byFormat).toMatchObject({ legacy_inline: 2, keyed: 1, conflict: 1, malformed: 1, no_quiz: 1 });
    expect(s.manual.map((m) => m.lessonId).sort()).toEqual(['conflict', 'malformed']);
    expect(s.approvalsInvalidated).toEqual(['legacy_draft']);
    expect(inv.versionsWithAnswers).toEqual(['lessons/legacy/versions/000001']);
    expect(JSON.stringify((await db.doc('lessons/legacy').get()).data())).toBe(before);
    expect(JSON.stringify(s)).not.toContain(EXPLANATION);
  });

  it('migrates valid lessons, leaves manual ones untouched, backs up, audits and preserves history', async () => {
    const conflictBefore = await lesson('conflict');
    const inv = await loadQuizInventory(db);
    const r = await applyQuizKeyMigration(db, inv.decisions.filter((d) => d.action === 'migrate').map((d) => d.lessonId), 'c4_test');
    expect(r).toEqual({ migrated: ['legacy', 'legacy_draft'], skipped: [], failed: [] });

    const migrated = await lesson('legacy');
    expect(JSON.stringify(migrated.blocks)).not.toContain(EXPLANATION);
    expect(migrated.blocks.map((b: { id: string }) => b.id)).toEqual(['t1', 'q1', 'q2']);
    expect(migrated.blocks[1]).toEqual(q('q1'));
    expect(migrated).toMatchObject({ status: 'published', publishedVersion: 1, title: 'legacy' });
    expect((await db.doc('lessons/legacy/answerKey/current').get()).data()).toMatchObject({
      keyVersion: 1, release: 'after_pass', items: [{ blockId: 'q1', correctOptionId: 'b' }, { blockId: 'q2', correctOptionId: 'a' }],
    });
    const backup = (await db.doc('lessons/legacy/legacyBackup/c4').get()).data()!;
    expect(backup.blocks[1]).toMatchObject({ correctOptionId: 'b' });
    const audit = (await db.collection('auditLog').where('targetId', '==', 'legacy').get()).docs.map((d) => d.data());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'assessment_migration', actorId: 'migration:c4_test', actorRole: 'system' });
    expect(JSON.stringify(audit)).not.toContain(EXPLANATION);

    expect(await lesson('conflict')).toEqual(conflictBefore);
    expect((await db.doc('lessons/keyed/answerKey/current').get()).data()).toMatchObject({ keyVersion: 2 });
    expect((await db.doc('lessons/legacy/versions/000001').get()).data()).toMatchObject({ baseline: true });
    expect((await db.doc('progress/qm_stu_c1_plain').get()).data()).toMatchObject({ status: 'completed', completedAt: NOW });
  });

  it('is idempotent: a second run migrates nothing and changes nothing', async () => {
    const ids = (await loadQuizInventory(db)).decisions.filter((d) => d.action === 'migrate').map((d) => d.lessonId);
    await applyQuizKeyMigration(db, ids, 'run1');
    const snapshot = JSON.stringify(await lesson('legacy')) + JSON.stringify((await db.doc('lessons/legacy/answerKey/current').get()).data());
    const second = await loadQuizInventory(db);
    expect(summarizeQuizMigration(second.decisions).toMigrate).toBe(0);
    // Even forcing the same ids through again is a no-op.
    expect(await applyQuizKeyMigration(db, ids, 'run2')).toMatchObject({ migrated: [], skipped: [{ reason: 'now_keyed' }, { reason: 'now_keyed' }] });
    expect(JSON.stringify(await lesson('legacy')) + JSON.stringify((await db.doc('lessons/legacy/answerKey/current').get()).data())).toBe(snapshot);
    expect((await db.collection('auditLog').get()).size).toBe(2);
  });

  it('after migration: students cannot read answers, cannot complete by a direct write, and are graded the same', async () => {
    await applyQuizKeyMigration(db, ['legacy'], 'run1');
    const stu = as('qm_stu');
    const read = await assertSucceeds(getDoc(doc(stu, 'lessons/legacy')));
    expect(JSON.stringify(read.data())).not.toContain(EXPLANATION);
    await assertFails(getDoc(doc(stu, 'lessons/legacy/answerKey/current')));
    await assertFails(getDoc(doc(stu, 'lessons/legacy/legacyBackup/c4')));
    await assertFails(getDoc(doc(as('qm_inst'), 'lessons/legacy/legacyBackup/c4')));
    await assertFails(setDoc(doc(stu, 'progress/qm_stu_c1_legacy'), {
      orgId: 'org_a', courseId: 'c1', moduleId: 'm1', lessonId: 'legacy', studentId: 'qm_stu', batchId: 'bt1',
      status: 'completed', timeSpentSeconds: 30, completedAt: NOW, createdAt: NOW, updatedAt: NOW,
    }));
    const pass = await attempt('legacy', { q1: 'b', q2: 'a' });
    expect(JSON.parse(pass.text)).toMatchObject({ correct: 2, passed: true, lessonCompleted: true });
    expect((await db.doc('progress/qm_stu_c1_legacy/quizAttempts/000001').get()).data()).toMatchObject({ keyVersion: 1 });
  });

  it('no-quiz lessons keep student completion', async () => {
    await assertSucceeds(updateDoc(doc(as('qm_stu'), 'progress/qm_stu_c1_plain'), { timeSpentSeconds: 90, updatedAt: NOW }));
  });

  it('a lesson edited between plan and apply is re-checked inside its transaction', async () => {
    const ids = (await loadQuizInventory(db)).decisions.filter((d) => d.action === 'migrate').map((d) => d.lessonId);
    await db.doc('lessons/legacy').update({ blocks: [inline('q1'), q('q2')] });
    const r = await applyQuizKeyMigration(db, ids, 'run1');
    expect(r.skipped).toEqual([{ lessonId: 'legacy', reason: 'now_malformed' }]);
    expect(JSON.stringify((await lesson('legacy')).blocks)).toContain(EXPLANATION);
  });
});

describe('CLI', () => {
  it('dry-run then apply against the emulator, printing ids and codes only', async () => {
    const env = { ...process.env, FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST, FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST };
    const run = (args: string[]) => execFileSync('npx', ['tsx', 'scripts/migration/quiz-key-migration.ts', '--target', 'emulator', '--project', PROJECT, ...args], { cwd: REPO, env, encoding: 'utf8' });
    const dry = run([]);
    expect(dry).toContain('DRY RUN');
    expect(dry).toContain('MANUAL conflict: conflict [inline_conflicts_with_key]');
    expect((await lesson('legacy')).blocks[1]).toMatchObject({ correctOptionId: 'b' });
    const applied = run(['--apply', '--run-id', 'cli_run']);
    expect(applied).toContain('Migrated: 2');
    expect(applied).toContain('Post-check: 0 lesson(s) still to migrate, 2 for manual remediation.');
    for (const out of [dry, applied]) {
      expect(out).not.toContain(EXPLANATION);
      expect(out).not.toMatch(/correctOptionId/);
    }
    expect(() => execFileSync('npx', ['tsx', 'scripts/migration/quiz-key-migration.ts', '--target', 'emulator', '--project', 'learning-management-syst-b9bf3', '--apply'], { cwd: REPO, env, encoding: 'utf8', stdio: 'pipe' })).toThrow();
  }, 120_000);
});

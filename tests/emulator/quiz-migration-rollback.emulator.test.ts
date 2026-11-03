/**
 * G24 — the legacy quiz migration validated against a backup, end to end with
 * the real CLIs on the local emulator only (project demo-strynkix-rollback):
 *   seed legacy lessons + student history → export (backup) → migration dry run
 *   → apply → history preserved, answers gone from lessons → restore the backup
 *   with --clear-first → lessons are exactly as before the migration.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { serializeValue } from '@/lib/backup/firestore-export';
import { runObserved } from '../backup/sandbox';

const PROJECT = 'demo-strynkix-rollback';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const SECRET = 'ROLLBACK-SECRET-EXPLANATION';
const env = {
  FIRESTORE_EMULATOR_HOST: HOST, FIREBASE_AUTH_EMULATOR_HOST: undefined, FIREBASE_ADMIN_PROJECT_ID: undefined,
  GCLOUD_PROJECT: undefined, GOOGLE_CLOUD_PROJECT: undefined, GOOGLE_APPLICATION_CREDENTIALS: undefined,
  FIREBASE_ADMIN_CLIENT_EMAIL: undefined, FIREBASE_ADMIN_PRIVATE_KEY: undefined,
};

let app: App;
let db: Firestore;
let out: string;

const legacyQuiz = (id: string) => ({ id, type: 'quiz', question: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionId: 'b', explanation: `${SECRET} ${id}` });
const snapshot = async (p: string) => serializeValue((await db.doc(p).get()).data());

beforeAll(async () => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'strynkix-rollback-'));
  process.env.FIRESTORE_EMULATOR_HOST = HOST;
  app = getApps().find((a) => a.name === 'rollback') ?? initializeApp({ projectId: PROJECT }, 'rollback');
  db = getFirestore(app);
  db.settings({ useBigInt: true });
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const b = db.batch();
  b.set(db.doc('lessons/legacy1'), { orgId: 'o1', courseId: 'c1', moduleId: 'm1', title: 'Legacy 1', status: 'published', blocks: [{ id: 't1', type: 'text', content: 'Read.' }, legacyQuiz('q1'), legacyQuiz('q2')] });
  b.set(db.doc('lessons/legacy2'), { orgId: 'o1', courseId: 'c1', moduleId: 'm1', title: 'Legacy 2', status: 'draft', blocks: [legacyQuiz('q1')] });
  b.set(db.doc('progress/s1_c1_legacy1'), { orgId: 'o1', courseId: 'c1', lessonId: 'legacy1', studentId: 's1', status: 'completed', timeSpentSeconds: BigInt(120), quiz: { attemptCount: BigInt(2), passed: true } });
  b.set(db.doc('progress/s1_c1_legacy1/quizAttempts/000001'), { attemptNumber: BigInt(1), correct: BigInt(1), total: BigInt(2), passed: false });
  b.set(db.doc('progress/s1_c1_legacy1/quizAttempts/000002'), { attemptNumber: BigInt(2), correct: BigInt(2), total: BigInt(2), passed: true });
  b.set(db.doc('enrollments/c1_s1'), { orgId: 'o1', courseId: 'c1', studentId: 's1', status: 'active' });
  await b.commit();
});

afterAll(async () => {
  if (app) await deleteApp(app);
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

describe('G24 — migration with a verified backup and a proven rollback', () => {
  it('backup → dry run → apply → restore', async () => {
    const before = {
      legacy1: await snapshot('lessons/legacy1'), legacy2: await snapshot('lessons/legacy2'),
      progress: await snapshot('progress/s1_c1_legacy1'), a1: await snapshot('progress/s1_c1_legacy1/quizAttempts/000001'),
      a2: await snapshot('progress/s1_c1_legacy1/quizAttempts/000002'), enrollment: await snapshot('enrollments/c1_s1'),
    };

    // 1. Backup (read-only export) and offline verification.
    const exp = runObserved('scripts/backup/firestore-export.ts', ['--target', 'emulator', '--project', PROJECT, '--out', out, '--export'], env, out);
    expect(exp.status, exp.stderr).toBe(0);
    const backup = path.join(out, fs.readdirSync(out).find((d) => d.startsWith('firestore-export_'))!);
    expect(runObserved('scripts/backup/firestore-export.ts', ['--verify', backup], env, out).status).toBe(0);

    // 2. Dry run writes nothing.
    const dry = runObserved('scripts/migration/quiz-key-migration.ts', ['--target', 'emulator', '--project', PROJECT], env, out);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain('To migrate: 2');
    expect(await snapshot('lessons/legacy1')).toEqual(before.legacy1);

    // 3. Apply: answers leave the lessons; student history is untouched.
    const apply = runObserved('scripts/migration/quiz-key-migration.ts', ['--target', 'emulator', '--project', PROJECT, '--apply'], env, out);
    expect(apply.status, apply.stderr).toBe(0);
    expect(apply.stdout).toContain('Post-check: 0 lesson(s) still to migrate');
    expect(apply.stdout + apply.stderr).not.toContain(SECRET);
    for (const id of ['legacy1', 'legacy2']) {
      expect(JSON.stringify((await db.doc(`lessons/${id}`).get()).data())).not.toContain(SECRET);
      expect((await db.doc(`lessons/${id}/answerKey/current`).get()).exists).toBe(true);
    }
    expect(await snapshot('progress/s1_c1_legacy1')).toEqual(before.progress);
    expect(await snapshot('progress/s1_c1_legacy1/quizAttempts/000001')).toEqual(before.a1);
    expect(await snapshot('progress/s1_c1_legacy1/quizAttempts/000002')).toEqual(before.a2);
    expect(await snapshot('enrollments/c1_s1')).toEqual(before.enrollment);

    // 4. Roll back from the backup: the pre-migration lessons return exactly.
    const restore = runObserved('scripts/backup/firestore-restore.ts', ['--from', backup, '--project', PROJECT, '--restore', '--confirm-emulator-overwrite', '--clear-first'], env, out);
    expect(restore.status, restore.stderr).toBe(0);
    expect(restore.stdout).toContain('Restore COMPLETE.');
    expect(await snapshot('lessons/legacy1')).toEqual(before.legacy1);
    expect(await snapshot('lessons/legacy2')).toEqual(before.legacy2);
    expect((await db.doc('lessons/legacy1/answerKey/current').get()).exists).toBe(false);
    expect((await db.doc('lessons/legacy1/legacyBackup/c4').get()).exists).toBe(false);
    expect(await snapshot('progress/s1_c1_legacy1')).toEqual(before.progress);
    for (const o of [exp, dry, apply, restore]) for (const c of o.connects) expect(['127.0.0.1', 'localhost', '::1']).toContain(c.host);
  }, 300_000);
});

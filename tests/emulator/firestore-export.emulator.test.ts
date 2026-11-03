/**
 * Rehearsal of the read-only Firestore export CLI against the local Firestore
 * emulator only (project `demo-strynkix-backup`, disposable fixtures). Every
 * CLI run is observed by tests/backup/sandbox-hook.cjs, which records every
 * Firebase module load and every outbound socket or DNS lookup, so the test
 * proves what each mode touches:
 *   plan   → no Firebase module, no network, nothing written;
 *   export → Firebase loaded, sockets only to the local emulator;
 *   verify → no Firebase module, no network.
 * The exported JSON is decoded again and compared with the live emulator data.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, GeoPoint, Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { deserializeValue, serializeValue, verifyExport, type ExportManifest } from '@/lib/backup/firestore-export';
import { runObserved, type Observed } from '../backup/sandbox';

const PROJECT = 'demo-strynkix-backup';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const EMU_PORT = FIRESTORE_HOST.split(':')[1];
const REPO = path.resolve(__dirname, '../..');
const SECRET = 'REHEARSAL-SECRET-EXPLANATION';
const BIG = BigInt('9223372036854775807');
const NEG_BIG = BigInt('-9007199254740993');

let app: App;
let db: Firestore;
let out: string;

const cli = (args: string[], env: Record<string, string | undefined> = {}): Observed => runObserved('scripts/backup/firestore-export.ts', args, env, out);

const emulatorEnv = { FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST, FIREBASE_AUTH_EMULATOR_HOST: undefined, FIREBASE_ADMIN_PROJECT_ID: undefined };
const exportArgs = (extra: string[] = []) => ['--target', 'emulator', '--project', PROJECT, '--out', out, ...extra];
const exportDirs = () => fs.readdirSync(out).filter((d) => d.startsWith('firestore-export_'));
const expectLocalOnly = (o: Observed) => {
  for (const c of o.connects) {
    expect(['127.0.0.1', 'localhost', '::1'], JSON.stringify(c)).toContain(c.host);
    expect(c.port, JSON.stringify(c)).toBe(Number(EMU_PORT));
  }
  for (const h of o.dns) expect(['127.0.0.1', 'localhost', '::1'], h).toContain(h);
};

beforeAll(async () => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'strynkix-export-rehearsal-'));
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  app = getApps().find((a) => a.name === 'rehearsal') ?? initializeApp({ projectId: PROJECT }, 'rehearsal');
  db = getFirestore(app);
  db.settings({ useBigInt: true });
  const res = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error('clear failed');

  const b = db.batch();
  b.set(db.doc('courses/c1'), { title: 'Course', status: 'published' });
  b.set(db.doc('lessons/l1'), {
    title: 'Lesson with every type', blocks: [{ id: 'q1', type: 'quiz', correctOptionId: 'b', explanation: SECRET }],
    big: BIG, negBig: NEG_BIG, small: BigInt(42), ratio: 0.25, nan: NaN, inf: Infinity, negInf: -Infinity,
    when: new Timestamp(1761782400, 123456789), where: new GeoPoint(18.52, 73.85), course: db.doc('courses/c1'),
    raw: Buffer.from([0, 1, 2, 250, 255]), vec: FieldValue.vector([0.5, 1.5]),
    nested: { list: [BigInt(1), 'two', { three: [new Timestamp(1, 2)] }], empty: {}, emptyList: [] },
    // Adversarial but valid: a map that looks like our tag format, and a string that looks like JSON.
    looksTagged: { __fs: 'timestamp', seconds: BigInt(5) }, looksLikeJson: '{"__fs":"integer","value":"1"}',
    'dotted.key': 'x', 'ключ': 'unicode key', nul: null, yes: true,
  });
  b.set(db.doc('lessons/l1/answerKey/current'), { keyVersion: BigInt(2), items: [{ blockId: 'q1', correctOptionId: 'b', explanation: SECRET }] });
  b.set(db.doc('lessons/l1/legacyBackup/c4'), { runId: 'c4_rehearsal', blocks: [{ id: 'q1', explanation: SECRET }] });
  b.set(db.doc('lessons/l1/versions/000001'), { version: BigInt(1) });
  // Deleted parents: children whose parent document was never written.
  b.set(db.doc('lessons/deleted_lesson/answerKey/current'), { keyVersion: BigInt(1), items: [] });
  b.set(db.doc('ghostroot/g1/sub/s1'), { orphan: true });
  b.set(db.doc('progress/p1/quizAttempts/000001'), { attemptNumber: BigInt(1), correct: BigInt(0) });
  await b.commit();
  // More documents than one batch, to exercise paging (--batch-size 100).
  const bulk = db.batch();
  for (let i = 0; i < 250; i++) bulk.set(db.doc(`bulk/d${String(i).padStart(3, '0')}`), { i: BigInt(i) });
  await bulk.commit();
});

afterAll(async () => {
  if (app) await deleteApp(app);
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

describe('plan mode', () => {
  it('loads no Firebase module, opens no connection and creates nothing', () => {
    const o = cli(exportArgs(), emulatorEnv);
    expect(o.status).toBe(0);
    expect(o.stdout).toContain('PLAN (nothing read)');
    expect(o.stdout).toContain('No Firebase client was created.');
    expect(o.modules).toEqual([]);
    expect(o.connects).toEqual([]);
    expect(o.dns).toEqual([]);
    expect(exportDirs()).toEqual([]);
  }, 60_000);
});

describe('target safety', () => {
  it('no remote configuration can be selected; each refusal happens before Firebase loads', () => {
    const cases: Array<[string[], Record<string, string | undefined>, RegExp]> = [
      [['--target', 'emulator', '--project', PROJECT, '--out', out, '--export'], { FIRESTORE_EMULATOR_HOST: undefined }, /local emulator/],
      [['--target', 'emulator', '--project', PROJECT, '--out', out, '--export'], { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }, /local emulator/],
      [['--target', 'emulator', '--project', 'strynkix-live-books-staging', '--out', out, '--export'], emulatorEnv, /demo-/],
      [['--target', 'staging', '--project', 'strynkix-live-books-staging', '--out', out, '--export', '--confirm-staging-read'], emulatorEnv, /FIRESTORE_EMULATOR_HOST is set/],
      [['--target', 'staging', '--project', 'strynkix-live-books-staging', '--out', out, '--export'], { FIRESTORE_EMULATOR_HOST: undefined }, /--confirm-staging-read/],
      [['--target', 'staging', '--project', 'learning-management-syst-b9bf3', '--out', out, '--export', '--confirm-staging-read'], { FIRESTORE_EMULATOR_HOST: undefined }, /production/],
      [['--target', 'emulator', '--project', PROJECT, '--out', REPO, '--export'], emulatorEnv, /outside the repository/],
    ];
    for (const [args, env, msg] of cases) {
      const o = cli(args, env);
      expect(o.status, args.join(' ')).toBe(1);
      expect(o.stderr, args.join(' ')).toMatch(msg);
      expect(o.modules, args.join(' ')).toEqual([]);
      expect(o.connects, args.join(' ')).toEqual([]);
    }
    expect(exportDirs()).toEqual([]);
  }, 180_000);
});

describe('export against the local emulator', () => {
  let dir = '';
  let manifest: ExportManifest;

  it('exports everything, reading only from the local emulator, even with unrelated credentials in the environment', () => {
    const o = cli(exportArgs(['--export', '--batch-size', '100']), {
      ...emulatorEnv,
      // Decoys: must be ignored in emulator mode and never cause a remote connection.
      FIREBASE_ADMIN_CLIENT_EMAIL: 'decoy@example.invalid', FIREBASE_ADMIN_PRIVATE_KEY: 'not-a-key', GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/decoy.json',
    });
    expect(o.status, o.stderr).toBe(0);
    expect(o.stdout).toContain('EXPORT (read-only)');
    expect(o.stdout).toContain('Export COMPLETE');
    expect(o.modules.length).toBeGreaterThan(0);
    expect(o.connects.length).toBeGreaterThan(0);
    expectLocalOnly(o);
    expect(o.stdout + o.stderr).not.toContain(SECRET);
    [dir] = exportDirs().map((d) => path.join(out, d));
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ complete: true, errors: [], projectId: PROJECT, target: 'emulator', integerEncoding: 'bigint', missingDocumentCount: 3 });
    expect(manifest.countsByCollection).toEqual({
      bulk: 250, courses: 1, 'ghostroot/*/sub': 1, lessons: 1, 'lessons/*/answerKey': 2, 'lessons/*/legacyBackup': 1,
      'lessons/*/versions': 1, 'progress/*/quizAttempts': 1,
    });
    expect(manifest.documentCount).toBe(258);
    expect(manifest.rootCollections).toEqual(['bulk', 'courses', 'ghostroot', 'lessons', 'progress']);
    expect(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).not.toContain(SECRET);
  }, 120_000);

  it('records deleted parents and the subcollections beneath them', () => {
    const lines = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const lessons = lines(manifest.files.find((f) => f.collectionId === 'lessons')!.name);
    expect(lessons.find((l) => l.path === 'lessons/deleted_lesson')).toEqual({ path: 'lessons/deleted_lesson', exists: false });
    expect(lessons.find((l) => l.path === 'lessons/deleted_lesson/answerKey/current')).toMatchObject({ exists: true });
    const ghost = lines(manifest.files.find((f) => f.collectionId === 'ghostroot')!.name);
    expect(ghost.map((l) => l.path)).toEqual(['ghostroot/g1', 'ghostroot/g1/sub/s1']);
    const progress = lines(manifest.files.find((f) => f.collectionId === 'progress')!.name);
    expect(progress.find((l) => l.path === 'progress/p1')).toEqual({ path: 'progress/p1', exists: false });
  });

  it('round-trips every value: the decoded export equals the live emulator data', async () => {
    const factories = {
      timestamp: (s: number, n: number) => new Timestamp(s, n), geopoint: (la: number, lo: number) => new GeoPoint(la, lo),
      reference: (p: string) => db.doc(p), bytes: (b: Buffer) => b, vector: (v: number[]) => FieldValue.vector(v),
    };
    let checked = 0;
    for (const f of manifest.files) {
      for (const line of fs.readFileSync(path.join(dir, f.name), 'utf8').trim().split('\n')) {
        const rec = JSON.parse(line);
        if (!rec.exists) continue;
        const live = (await db.doc(rec.path).get()).data();
        // The live document serializes to exactly what was exported…
        expect(serializeValue(live), rec.path).toEqual(rec.data);
        // …and decoding the export yields values that serialize identically again.
        expect(serializeValue(deserializeValue(rec.data, factories)), rec.path).toEqual(rec.data);
        checked++;
      }
    }
    expect(checked).toBe(258);
    const l1 = JSON.parse(fs.readFileSync(path.join(dir, manifest.files.find((f) => f.collectionId === 'lessons')!.name), 'utf8').split('\n').find((l) => l.includes('"lessons/l1"'))!);
    const decoded = deserializeValue(l1.data, factories) as Record<string, unknown>;
    expect(decoded.big).toBe(BIG);
    expect(decoded.negBig).toBe(NEG_BIG);
    expect(l1.data.big).toEqual({ __fs: 'integer', value: '9223372036854775807' });
    // Firestore keeps microseconds: the 123456789 ns written is stored (and exported) as 123456000.
    expect((decoded.when as Timestamp).nanoseconds).toBe(123456000);
    expect((decoded.course as { path: string }).path).toBe('courses/c1');
    expect(Buffer.compare(decoded.raw as Buffer, Buffer.from([0, 1, 2, 250, 255]))).toBe(0);
    expect(l1.data.looksTagged).toEqual({ __fs: 'map', value: { __fs: 'timestamp', seconds: 5 } });
    expect(l1.data.looksLikeJson).toBe('{"__fs":"integer","value":"1"}');
  }, 120_000);

  it('verifies offline with no Firebase module and no network, and detects tampering', () => {
    const ok = cli(['--verify', dir], { FIRESTORE_EMULATOR_HOST: undefined });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('Verify: OK — 258 document(s), complete export');
    expect(ok.modules).toEqual([]);
    expect(ok.connects).toEqual([]);
    expect(ok.dns).toEqual([]);
    expect(verifyExport(dir).ok).toBe(true);

    // Tamper with a copy, never the original.
    const copy = `${dir}-tampered`;
    fs.cpSync(dir, copy, { recursive: true });
    const victim = path.join(copy, manifest.files.find((f) => f.collectionId === 'bulk')!.name);
    fs.chmodSync(victim, 0o600);
    fs.appendFileSync(victim, '{"path":"bulk/zzz","exists":true,"data":{}}\n');
    const bad = cli(['--verify', copy], { FIRESTORE_EMULATOR_HOST: undefined });
    expect(bad.status).toBe(2);
    expect(bad.stdout).toMatch(/PROBLEMS FOUND/);
    expect(bad.stdout).toMatch(/hash mismatch/);
    expect(bad.modules).toEqual([]);
    expect(bad.connects).toEqual([]);
  }, 120_000);

  it('never overwrites: a second export creates a new directory and the first is unchanged', () => {
    const before = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    const again = cli(exportArgs(['--export']), emulatorEnv);
    expect(again.status, again.stderr).toBe(0);
    expect(exportDirs().filter((d) => !d.endsWith('-tampered'))).toHaveLength(2);
    expect(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).toBe(before);
  }, 120_000);
});

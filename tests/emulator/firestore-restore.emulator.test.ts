/**
 * Restore rehearsal on the LOCAL Firestore emulator only (disposable `demo-`
 * projects). Seed → export → verify → damage → restore → compare every
 * document path and value with the original, plus refusal, partial-restore,
 * rerun and network-confinement checks. Every CLI run is observed by
 * tests/backup/sandbox-hook.cjs (module loads, sockets, DNS).
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, GeoPoint, Timestamp, getFirestore, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { serializeValue } from '@/lib/backup/firestore-export';
import { runObserved, type Observed } from '../backup/sandbox';

const PROJECT = 'demo-strynkix-restore';
const NZ_PROJECT = 'demo-strynkix-restore-nz';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const EMU_PORT = Number(FIRESTORE_HOST.split(':')[1]);
const REPO = path.resolve(__dirname, '../..');
const SECRET = 'RESTORE-REHEARSAL-SECRET';

let app: App;
let db: Firestore;
let out: string;
let exportDir = '';
let ORIGINAL: Map<string, string>;

const env = (extra: Record<string, string | undefined> = {}) => ({
  FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST, FIREBASE_AUTH_EMULATOR_HOST: undefined, FIREBASE_ADMIN_PROJECT_ID: undefined,
  GCLOUD_PROJECT: undefined, GOOGLE_CLOUD_PROJECT: undefined, GOOGLE_APPLICATION_CREDENTIALS: undefined,
  FIREBASE_ADMIN_CLIENT_EMAIL: undefined, FIREBASE_ADMIN_PRIVATE_KEY: undefined, ...extra,
});
const restoreCli = (args: string[], e: Record<string, string | undefined> = env()) => runObserved('scripts/backup/firestore-restore.ts', args, e, out);
const exportCli = (project: string) =>
  runObserved('scripts/backup/firestore-export.ts', ['--target', 'emulator', '--project', project, '--out', out, '--export', '--batch-size', '100'], env(), out);
const restore = (from: string, extra: string[] = [], project = PROJECT) => restoreCli(['--from', from, '--project', project, '--restore', '--confirm-emulator-overwrite', ...extra]);

const expectEmulatorOnly = (o: Observed) => {
  for (const c of o.connects) {
    expect(['127.0.0.1', 'localhost', '::1'], JSON.stringify(c)).toContain(c.host);
    expect(c.port, JSON.stringify(c)).toBe(EMU_PORT);
  }
  for (const h of o.dns) expect(['127.0.0.1', 'localhost', '::1'], h).toContain(h);
};
const expectNoNetworkNoFirebase = (o: Observed) => {
  expect(o.connects).toEqual([]);
  expect(o.dns).toEqual([]);
  expect(o.modules).toEqual([]);
};

/** Every existing document in the project: path → canonical serialized data. */
async function snapshot(target: Firestore = db): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (refs: DocumentReference[]) => {
    if (!refs.length) return;
    const snaps = await target.getAll(...refs);
    for (const s of snaps) if (s.exists) out.set(s.ref.path, JSON.stringify(serializeValue(s.data())));
    for (const r of refs) for (const c of await r.listCollections()) await walk(await c.listDocuments());
  };
  for (const c of await target.listCollections()) await walk(await c.listDocuments());
  return out;
}
const diff = (a: Map<string, string>, b: Map<string, string>) => {
  const problems: string[] = [];
  for (const [p, v] of a) if (b.get(p) !== v) problems.push(b.has(p) ? `changed ${p}` : `missing ${p}`);
  for (const p of b.keys()) if (!a.has(p)) problems.push(`extra ${p}`);
  return problems;
};

async function restCommit(project: string, writes: unknown[]) {
  const res = await fetch(`http://${FIRESTORE_HOST}/v1/projects/${project}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ writes }),
  });
  if (!res.ok) throw new Error(`seed failed: ${res.status}`);
}
const clearProject = async (project: string) => {
  const res = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error('clear failed');
};

const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
/** A damaged copy of the verified export: `change` edits files, then (optionally) the copy is re-signed. */
function damagedCopy(name: string, change: (dir: string) => void, resign = false): string {
  const copy = path.join(out, `copy-${name}`);
  fs.cpSync(exportDir, copy, { recursive: true });
  for (const f of fs.readdirSync(copy, { recursive: true }) as string[]) fs.chmodSync(path.join(copy, f), fs.statSync(path.join(copy, f)).isDirectory() ? 0o700 : 0o600);
  change(copy);
  if (resign) {
    const mf = path.join(copy, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    for (const f of m.files) {
      const full = path.join(copy, f.name);
      f.sha256 = sha(full); f.bytes = fs.statSync(full).size; f.lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).length;
    }
    fs.writeFileSync(mf, JSON.stringify(m));
    fs.writeFileSync(path.join(copy, 'manifest.json.sha256'), `${sha(mf)}  manifest.json\n`);
  }
  return copy;
}
function editRecord(dir: string, docPath: string, change: (data: Record<string, unknown>) => void) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const f of m.files) {
    const full = path.join(dir, f.name);
    const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const rec = lines.find((l) => l.path === docPath);
    if (rec) { change(rec.data); fs.writeFileSync(full, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`); }
  }
}

beforeAll(async () => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'strynkix-restore-rehearsal-'));
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  app = getApps().find((a) => a.name === 'restore-rehearsal') ?? initializeApp({ projectId: PROJECT }, 'restore-rehearsal');
  db = getFirestore(app);
  db.settings({ useBigInt: true });
  await clearProject(PROJECT);
  await clearProject(NZ_PROJECT);

  const b = db.batch();
  b.set(db.doc('courses/c1'), { title: 'Course', status: 'published' });
  b.set(db.doc('lessons/l1'), {
    title: 'Every type', blocks: [{ id: 'q1', type: 'quiz', correctOptionId: 'b', explanation: SECRET }],
    big: BigInt('9223372036854775807'), negBig: BigInt('-9223372036854775808'), justOver: BigInt('9007199254740993'), small: BigInt(42),
    ratio: 0.25, nan: NaN, inf: Infinity, negInf: -Infinity,
    when: new Timestamp(1761782400, 123456000), early: new Timestamp(-86400, 0), where: new GeoPoint(-33.86, 151.2),
    course: db.doc('courses/c1'), raw: Buffer.from([0, 1, 2, 250, 255]), vec: FieldValue.vector([0.5, 1.5, -2]),
    nested: { list: [BigInt(1), 'two', { three: [new Timestamp(1, 2000)] }], empty: {}, emptyList: [] },
    looksTagged: { __fs: 'timestamp', seconds: BigInt(5) }, looksLikeJson: '{"__fs":"integer","value":"1"}',
    'dotted.key': 'x', 'ключ 🔑': 'unicode', nul: null, yes: true,
  });
  b.set(db.doc('lessons/l1/answerKey/current'), { keyVersion: BigInt(2), items: [{ blockId: 'q1', correctOptionId: 'b', explanation: SECRET }] });
  b.set(db.doc('lessons/l1/legacyBackup/c4'), { runId: 'c4_rehearsal' });
  b.set(db.doc('lessons/l1/versions/000001'), { version: BigInt(1) });
  b.set(db.doc('lessons/deleted_lesson/answerKey/current'), { keyVersion: BigInt(1), items: [] });
  b.set(db.doc('ghostroot/g1/sub/s1'), { orphan: true });
  b.set(db.doc('progress/p1/quizAttempts/000001'), { attemptNumber: BigInt(1) });
  await b.commit();
  const bulk = db.batch();
  for (let i = 0; i < 250; i++) bulk.set(db.doc(`bulk/d${String(i).padStart(3, '0')}`), { i: BigInt(i) });
  await bulk.commit();
  // Integral doubles can only be written through the REST API (the Admin SDK writes them as integers).
  await restCommit(PROJECT, [{ update: { name: `projects/${PROJECT}/databases/(default)/documents/doubles/d1`, fields: { three: { doubleValue: 3 }, large: { doubleValue: 1e15 } } } }]);
  ORIGINAL = await snapshot();
});

afterAll(async () => {
  if (app) await deleteApp(app);
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

describe('restore rehearsal (local emulator only)', () => {
  it('1. fixture covers the required cases', () => {
    expect(ORIGINAL.size).toBe(259);
    expect(ORIGINAL.get('doubles/d1')).toBe(JSON.stringify({ three: { __fs: 'double', value: 3 }, large: { __fs: 'double', value: 1e15 } }));
    expect(JSON.parse(ORIGINAL.get('lessons/l1')!).negBig).toEqual({ __fs: 'integer', value: '-9223372036854775808' });
  });

  it('2. exports and verifies the fixture', () => {
    const o = exportCli(PROJECT);
    expect(o.status, o.stderr).toBe(0);
    expect(o.stdout).toContain('Export COMPLETE');
    expectEmulatorOnly(o);
    exportDir = path.join(out, fs.readdirSync(out).find((d) => d.startsWith(`firestore-export_${PROJECT}_`))!);
    const v = runObserved('scripts/backup/firestore-export.ts', ['--verify', exportDir], env(), out);
    expect(v.stdout).toContain('Verify: OK — 259 document(s)');
    expectNoNetworkNoFirebase(v);
  }, 180_000);

  it('3. plan mode validates without any network access, Firebase module or write', async () => {
    const o = restoreCli(['--from', exportDir, '--project', PROJECT]);
    expect(o.status, o.stderr).toBe(0);
    expect(o.stdout).toContain('Export verified: 259 document(s), 3 missing parent(s)');
    expect(o.stdout).toContain('No network request was made.');
    expectNoNetworkNoFirebase(o);
    expect(diff(ORIGINAL, await snapshot())).toEqual([]);
  }, 60_000);

  it('4. damage, then restore (overwrite): every original document is back, values exact', async () => {
    await db.doc('lessons/l1').update({ big: BigInt(1), ratio: FieldValue.delete(), title: 'damaged' });
    await db.doc('lessons/l1/answerKey/current').delete();
    await db.doc('ghostroot/g1/sub/s1').delete();
    await db.doc('doubles/d1').set({ three: 3 }); // now an integer
    const del = db.batch();
    for (let i = 0; i < 50; i++) del.delete(db.doc(`bulk/d${String(i).padStart(3, '0')}`));
    await del.commit();
    await db.doc('lessons/l1/answerKey/extra').set({ createdAfterExport: true });
    expect(diff(ORIGINAL, await snapshot()).length).toBeGreaterThan(50);

    const o = restore(exportDir, ['--batch-size', '100']);
    expect(o.status, o.stdout + o.stderr).toBe(0);
    expect(o.stdout).toContain('Restored 259/259 document(s) in 3 batch(es).');
    expect(o.stdout).toContain('Restore COMPLETE.');
    expectEmulatorOnly(o);
    expect(o.modules).toEqual([]); // no Firebase SDK at all, even while writing
    expect(o.stdout + o.stderr).not.toContain(SECRET);
    // Overwrite mode restores every exported document; a document created after the export is left alone.
    expect(diff(ORIGINAL, await snapshot())).toEqual(['extra lessons/l1/answerKey/extra']);
  }, 180_000);

  it('5. restore with --clear-first reproduces the export exactly', async () => {
    const o = restore(exportDir, ['--clear-first']);
    expect(o.status, o.stdout + o.stderr).toBe(0);
    expectEmulatorOnly(o);
    expect(diff(ORIGINAL, await snapshot())).toEqual([]);
    const l1 = (await db.doc('lessons/l1').get()).data()!;
    expect(l1.big).toBe(BigInt('9223372036854775807'));
    expect(l1.negBig).toBe(BigInt('-9223372036854775808'));
    expect(typeof (await db.doc('doubles/d1').get()).data()!.three).toBe('number'); // a double again, not an integer
    expect((l1.course as DocumentReference).path).toBe('courses/c1');
    expect((await db.doc('lessons/deleted_lesson').get()).exists).toBe(false); // the deleted parent stays deleted
    expect((await db.doc('lessons/deleted_lesson/answerKey/current').get()).exists).toBe(true);
  }, 180_000);

  it('6. damaged or unsupported exports are refused before any write', async () => {
    const before = await snapshot();
    const cases: Array<[string, string, RegExp]> = [
      [damagedCopy('checksum', (d) => fs.writeFileSync(path.join(d, 'manifest.json.sha256'), `${'0'.repeat(64)}  manifest.json\n`)), 'tampered checksum', /manifest\.json hash mismatch/],
      [damagedCopy('manifest', (d) => fs.writeFileSync(path.join(d, 'manifest.json'), '{"format":')), 'malformed manifest', /not valid JSON/],
      [damagedCopy('missing', (d) => fs.rmSync(path.join(d, 'collections/000_bulk.ndjson'))), 'missing file', /000_bulk\.ndjson missing/],
      [damagedCopy('extra', (d) => fs.writeFileSync(path.join(d, 'collections/005_injected.ndjson'), '{"path":"x/y","exists":true,"data":{}}\n')), 'extra file', /unexpected file/],
      [damagedCopy('data', (d) => fs.appendFileSync(path.join(d, 'collections/000_bulk.ndjson'), '{"path":"bulk/zzz","exists":true,"data":{}}\n')), 'tampered data', /hash mismatch/],
      [damagedCopy('reserved', (d) => editRecord(d, 'bulk/d010', (data) => { data.__name__ = 'x'; }), true), 'reserved field (re-signed)', /reserved field name/],
      [damagedCopy('badtag', (d) => editRecord(d, 'bulk/d011', (data) => { data.v = { __fs: 'integer', value: '1e9' }; }), true), 'unsupported value (re-signed)', /malformed value/],
      [damagedCopy('encoding', (d) => {
        const mf = path.join(d, 'manifest.json');
        fs.writeFileSync(mf, JSON.stringify({ ...JSON.parse(fs.readFileSync(mf, 'utf8')), integerEncoding: 'number' }));
      }, true), 'inexact integer encoding (re-signed)', /integerEncoding/],
    ];
    for (const [dir, name, msg] of cases) {
      const o = restore(dir);
      expect(o.status, name).toBe(1);
      expect(o.stderr, name).toMatch(msg);
      expectNoNetworkNoFirebase(o);
    }
    expect(diff(before, await snapshot())).toEqual([]);
  }, 240_000);

  it('7. unsafe environments and targets are refused before anything else', async () => {
    const before = await snapshot();
    const base = ['--from', exportDir, '--restore', '--confirm-emulator-overwrite'];
    const cases: Array<[string[], Record<string, string | undefined>, RegExp]> = [
      [[...base, '--project', 'learning-management-syst-b9bf3'], env(), /staging and production are refused/],
      [[...base, '--project', 'strynkix-live-books-staging'], env(), /staging and production are refused/],
      [[...base, '--project', 'my-project'], env(), /demo-/],
      [[...base, '--project', PROJECT], env({ FIRESTORE_EMULATOR_HOST: undefined }), /local emulator/],
      [[...base, '--project', PROJECT], env({ FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }), /local emulator/],
      [[...base, '--project', PROJECT], env({ GOOGLE_APPLICATION_CREDENTIALS: '/tmp/decoy.json' }), /Ambiguous configuration/],
      [[...base, '--project', PROJECT], env({ FIREBASE_ADMIN_PRIVATE_KEY: 'decoy' }), /Ambiguous configuration/],
      [[...base, '--project', PROJECT], env({ GCLOUD_PROJECT: 'strynkix-live-books-staging' }), /different project/],
      [['--from', exportDir, '--restore', '--project', PROJECT], env(), /--confirm-emulator-overwrite/],
      [['--from', path.join(REPO, 'docs'), '--restore', '--confirm-emulator-overwrite', '--project', PROJECT], env(), /outside the repository/],
    ];
    for (const [args, e, msg] of cases) {
      const o = restoreCli(args, e);
      expect(o.status, args.join(' ')).toBe(1);
      expect(o.stderr, args.join(' ')).toMatch(msg);
      expectNoNetworkNoFirebase(o);
    }
    expect(diff(before, await snapshot())).toEqual([]);
  }, 240_000);

  it('8. an interrupted restore is reported precisely, and a rerun converges', async () => {
    // A document the emulator will reject mid-run (over 1 MiB), in the third batch of 50.
    const bad = damagedCopy('oversize', (d) => editRecord(d, 'bulk/d120', (data) => { data.blob = 'x'.repeat(1_100_000); }), true);
    const o = restore(bad, ['--clear-first', '--batch-size', '50']);
    expect(o.status).toBe(2);
    expect(o.stdout).toContain('Restored 100/259 document(s) in 2 batch(es).');
    expect(o.stdout).toMatch(/Restore INCOMPLETE: batch 3 \(bulk\/d100 … bulk\/d149\) failed: HTTP 400/);
    expectEmulatorOnly(o);
    const partial = await snapshot();
    expect(partial.size).toBe(100);
    expect([...partial.keys()].every((p) => /^bulk\/d0\d\d$/.test(p))).toBe(true); // batches 1–2 only; batch 3 was atomic
    // Rerunning the same broken export fails at the same place and writes nothing new.
    const again = restore(bad, ['--batch-size', '50']);
    expect(again.status).toBe(2);
    expect(diff(partial, await snapshot())).toEqual([]);
    // Rerunning with the good export completes and matches the original exactly.
    const fixed = restore(exportDir, ['--batch-size', '50']);
    expect(fixed.status, fixed.stdout + fixed.stderr).toBe(0);
    expect(diff(ORIGINAL, await snapshot())).toEqual([]);
  }, 240_000);

  it('9. negative zeros (not representable over REST) are refused unless explicitly accepted', async () => {
    const nzApp = initializeApp({ projectId: NZ_PROJECT }, 'restore-nz');
    const nz = getFirestore(nzApp);
    nz.settings({ useBigInt: true });
    await nz.doc('n/z').set({ v: -0, w: 1.5 });
    const ex = exportCli(NZ_PROJECT);
    expect(ex.status, ex.stderr).toBe(0);
    const dir = path.join(out, fs.readdirSync(out).find((d) => d.startsWith(`firestore-export_${NZ_PROJECT}_`))!);
    const refused = restore(dir, ['--clear-first'], NZ_PROJECT);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/negative-zero/);
    expect(refused.connects).toEqual([]);
    expect(Object.is((await nz.doc('n/z').get()).data()!.v, -0)).toBe(true); // untouched
    const accepted = restore(dir, ['--clear-first', '--accept-negative-zero-as-zero'], NZ_PROJECT);
    expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
    const v = (await nz.doc('n/z').get()).data()!;
    expect(Object.is(v.v, 0)).toBe(true);
    expect(v.w).toBe(1.5);
    await deleteApp(nzApp);
  }, 240_000);

  it('10. the migration CLI (dry run, emulator) now stays on the local emulator: no metadata server', async () => {
    const before = await snapshot();
    const o = runObserved('scripts/migration/quiz-key-migration.ts', ['--target', 'emulator', '--project', PROJECT], env(), out);
    expect(o.status, o.stdout + o.stderr).toBe(0);
    expect(o.stdout).toContain('DRY RUN');
    expect(o.stdout).toContain('nothing was written');
    expect(o.connects.length).toBeGreaterThan(0);
    expectEmulatorOnly(o);
    expect(diff(before, await snapshot())).toEqual([]);
  }, 120_000);
});

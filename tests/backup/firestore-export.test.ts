/**
 * Read-only Firestore JSON export — offline tests. An in-memory ReadOnlyFirestore
 * stands in for the database; no Firebase app is initialized and nothing
 * leaves the machine. Firestore value classes are constructed directly.
 * (The emulator rehearsal is tests/emulator/firestore-export.emulator.test.ts.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FieldValue, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import {
  CollectionRef, DocRef, DocSnapshot, MalformedValueError, ReadOnlyFirestore, ValueFactories,
  assertExportTarget, collectionPattern, deserializeValue, exportFirestore, fileNameFor, resolveExportDir, serializeValue, verifyExport,
} from '@/lib/backup/firestore-export';

const REPO = path.resolve(__dirname, '../..');
const SECRET = 'SECRET-ANSWER-EXPLANATION';
let tmp: string;

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strynkix-export-test-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** Firestore's DocumentReference needs a client to construct; this stand-in has the same shape and class name. */
class DocumentReference { constructor(public path: string) {} }
const FACTORIES: ValueFactories = {
  timestamp: (s, n) => new Timestamp(s, n),
  geopoint: (la, lo) => new GeoPoint(la, lo),
  reference: (p) => new DocumentReference(p),
  bytes: (b) => b,
  vector: (v) => FieldValue.vector(v),
};

// -----------------------------------------------------------------------------
// In-memory read-only source
// -----------------------------------------------------------------------------
type Tree = Record<string, { data?: Record<string, unknown>; sub?: Record<string, Tree> }>; // data undefined = missing parent

function memorySource(
  root: Record<string, Tree>,
  faults: Partial<Record<keyof ReadOnlyFirestore, (arg: unknown) => boolean>> = {},
  countSkew: Record<string, number> = {}
) {
  const calls: Record<string, number> = { listRootCollections: 0, listDocumentRefs: 0, getDocuments: 0, listSubcollections: 0, countDocuments: 0 };
  const getBatchSizes: number[] = [];
  const nodes = new Map<string, { data?: Record<string, unknown>; sub?: Record<string, Tree> }>();
  const collections = new Map<string, Tree>();
  const walk = (colPath: string, tree: Tree) => {
    collections.set(colPath, tree);
    for (const [id, node] of Object.entries(tree)) {
      nodes.set(`${colPath}/${id}`, node);
      for (const [subId, subTree] of Object.entries(node.sub ?? {})) walk(`${colPath}/${id}/${subId}`, subTree);
    }
  };
  for (const [id, tree] of Object.entries(root)) walk(id, tree);
  const fail = (k: keyof ReadOnlyFirestore, arg: unknown) => {
    if (faults[k]?.(arg)) throw Object.assign(new Error(`simulated ${k} failure\nwith a second line`), { code: 14 });
  };
  const source: ReadOnlyFirestore = {
    async listRootCollections() { calls.listRootCollections++; fail('listRootCollections', null); return Object.keys(root).map((id) => ({ id, path: id })); },
    async listDocumentRefs(col: CollectionRef) {
      calls.listDocumentRefs++; fail('listDocumentRefs', col);
      return Object.keys(collections.get(col.path) ?? {}).map((id) => ({ id, path: `${col.path}/${id}` }));
    },
    async getDocuments(refs: DocRef[]) {
      calls.getDocuments++; getBatchSizes.push(refs.length); fail('getDocuments', refs);
      return refs.map((r): DocSnapshot => {
        const n = nodes.get(r.path);
        return n?.data ? { path: r.path, exists: true, data: n.data, createTime: '2026-10-01T00:00:00.000Z', updateTime: '2026-10-02T00:00:00.000Z' } : { path: r.path, exists: false };
      });
    },
    async listSubcollections(d: DocRef) {
      calls.listSubcollections++; fail('listSubcollections', d);
      return Object.keys(nodes.get(d.path)?.sub ?? {}).map((id) => ({ id, path: `${d.path}/${id}` }));
    },
    async countDocuments(col: CollectionRef) {
      calls.countDocuments++; fail('countDocuments', col);
      return Object.values(collections.get(col.path) ?? {}).filter((n) => n.data).length + (countSkew[col.path] ?? 0);
    },
  };
  return { source, calls, getBatchSizes };
}

const lmsTree = (): Record<string, Tree> => ({
  lessons: {
    l1: {
      data: { title: 'Lesson 1', blocks: [{ id: 'q1', type: 'quiz', correctOptionId: 'b', explanation: SECRET }] },
      sub: {
        answerKey: { current: { data: { keyVersion: BigInt(2), items: [{ blockId: 'q1', correctOptionId: 'b', explanation: SECRET }] } } },
        legacyBackup: { c4: { data: { runId: 'c4_x', blocks: [{ id: 'q1', explanation: SECRET }] } } },
        versions: { '000001': { data: { version: BigInt(1) } } },
      },
    },
    l2: { data: { title: 'Lesson 2', blocks: [] } },
    l3: { data: { title: 'Lesson 3', blocks: [] } },
    // A deleted lesson whose answer key still exists: must still be exported.
    ghost: { sub: { answerKey: { current: { data: { keyVersion: BigInt(1), items: [] } } } } },
  },
  users: { u1: { data: { role: 'student', email: 'student@example.test' } } },
});

const EXPORT_DIR = () => path.join(tmp, 'export');
const run = (source: ReadOnlyFirestore, extra: Partial<Parameters<typeof exportFirestore>[0]> = {}) =>
  exportFirestore({ source, dir: EXPORT_DIR(), projectId: 'demo-test', target: 'emulator', retryDelayMs: 0, now: () => new Date('2026-10-30T00:00:00.000Z'), ...extra });
const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Edits the manifest and re-signs it, so verification must catch the edit itself. */
function editManifest(dir: string, change: (m: Record<string, unknown>) => void) {
  const file = path.join(dir, 'manifest.json');
  fs.chmodSync(file, 0o600);
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(m);
  fs.writeFileSync(file, JSON.stringify(m));
  const sum = path.join(dir, 'manifest.json.sha256');
  fs.chmodSync(sum, 0o600);
  fs.writeFileSync(sum, `${sha(file)}  manifest.json\n`);
}

// -----------------------------------------------------------------------------
describe('assertExportTarget', () => {
  const opts = (o: Partial<Parameters<typeof assertExportTarget>[0]>) => ({ execute: false, confirmStagingRead: false, ...o });
  it('refuses the production project for every target, before anything else', () => {
    for (const target of ['staging', 'emulator', undefined]) {
      expect(() => assertExportTarget(opts({ target, projectId: 'learning-management-syst-b9bf3', execute: true, confirmStagingRead: true }), {})).toThrow(/production/);
    }
  });
  it('requires an explicit project and target', () => {
    expect(() => assertExportTarget(opts({ target: 'staging' }), {})).toThrow(/--project/);
    expect(() => assertExportTarget(opts({ projectId: 'strynkix-live-books-staging' }), {})).toThrow(/--target/);
  });
  it('staging: only the staging project, never with an emulator host, and reading needs confirmation', () => {
    expect(assertExportTarget(opts({ target: 'staging', projectId: 'strynkix-live-books-staging' }), {})).toEqual({ target: 'staging', projectId: 'strynkix-live-books-staging', execute: false });
    expect(() => assertExportTarget(opts({ target: 'staging', projectId: 'other-project' }), {})).toThrow(/only accepts/);
    expect(() => assertExportTarget(opts({ target: 'staging', projectId: 'strynkix-live-books-staging' }), { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toThrow(/FIRESTORE_EMULATOR_HOST/);
    expect(() => assertExportTarget(opts({ target: 'staging', projectId: 'strynkix-live-books-staging', execute: true }), {})).toThrow(/--confirm-staging-read/);
    expect(assertExportTarget(opts({ target: 'staging', projectId: 'strynkix-live-books-staging', execute: true, confirmStagingRead: true }), {}).execute).toBe(true);
  });
  it('emulator: demo- projects and a local emulator host only', () => {
    expect(assertExportTarget(opts({ target: 'emulator', projectId: 'demo-x', execute: true }), { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }).execute).toBe(true);
    expect(() => assertExportTarget(opts({ target: 'emulator', projectId: 'strynkix-live-books-staging' }), { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toThrow(/demo-/);
    expect(() => assertExportTarget(opts({ target: 'emulator', projectId: 'demo-x' }), {})).toThrow(/local emulator/);
    expect(() => assertExportTarget(opts({ target: 'emulator', projectId: 'demo-x' }), { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' })).toThrow(/local emulator/);
  });
});

describe('resolveExportDir', () => {
  const now = new Date('2026-10-30T01:02:03.456Z');
  it('requires an existing output directory', () => {
    expect(() => resolveExportDir({ repoRoot: REPO, projectId: 'p', now })).toThrow(/--out/);
    expect(() => resolveExportDir({ out: path.join(tmp, 'missing'), repoRoot: REPO, projectId: 'p', now })).toThrow(/existing directory/);
  });
  it('refuses the repository and anything inside it, including through a symlink', () => {
    expect(() => resolveExportDir({ out: REPO, repoRoot: REPO, projectId: 'p', now })).toThrow(/outside the repository/);
    expect(() => resolveExportDir({ out: path.join(REPO, 'docs'), repoRoot: REPO, projectId: 'p', now })).toThrow(/outside the repository/);
    const link = path.join(tmp, 'link-into-repo');
    fs.symlinkSync(path.join(REPO, 'docs'), link);
    expect(() => resolveExportDir({ out: link, repoRoot: REPO, projectId: 'p', now })).toThrow(/outside the repository/);
  });
  it('names a new timestamped directory and never reuses an existing one', () => {
    const dir = resolveExportDir({ out: tmp, repoRoot: REPO, projectId: 'strynkix-live-books-staging', now });
    expect(path.basename(dir)).toBe('firestore-export_strynkix-live-books-staging_2026-10-30T01-02-03-456Z');
    fs.mkdirSync(dir);
    expect(() => resolveExportDir({ out: tmp, repoRoot: REPO, projectId: 'strynkix-live-books-staging', now })).toThrow(/refusing to overwrite/);
  });
  it('the exporter itself also refuses an existing directory', async () => {
    fs.mkdirSync(EXPORT_DIR());
    await expect(run(memorySource(lmsTree()).source)).rejects.toThrow(/EEXIST/);
  });
});

describe('serializeValue / deserializeValue keep Firestore types', () => {
  it('encodes special types as tagged JSON', () => {
    expect(serializeValue(new Timestamp(1761782400, 123456789))).toEqual({ __fs: 'timestamp', seconds: 1761782400, nanoseconds: 123456789 });
    expect(serializeValue(new GeoPoint(18.52, 73.85))).toEqual({ __fs: 'geopoint', latitude: 18.52, longitude: 73.85 });
    expect(serializeValue(new DocumentReference('courses/c1'))).toEqual({ __fs: 'reference', path: 'courses/c1' });
    expect(serializeValue(Buffer.from([0, 1, 254, 255]))).toEqual({ __fs: 'bytes', base64: 'AAH+/w==' });
    expect(serializeValue(new Uint8Array([7]))).toEqual({ __fs: 'bytes', base64: 'Bw==' });
    expect(serializeValue(FieldValue.vector([0.5, 1]))).toEqual({ __fs: 'vector', values: [0.5, 1] });
    expect([NaN, Infinity, -Infinity, -0].map(serializeValue)).toEqual(['NaN', 'Infinity', '-Infinity', '-0'].map((value) => ({ __fs: 'double', value })));
  });

  it('integers are exact, including beyond JavaScript’s safe range (regression: precision loss)', () => {
    const big = [BigInt(2) ** BigInt(63) - BigInt(1), -(BigInt(2) ** BigInt(63)), BigInt(9007199254740993), -BigInt(9007199254740993)];
    for (const n of big) {
      const enc = serializeValue(n);
      expect(enc).toEqual({ __fs: 'integer', value: n.toString() });
      const back = deserializeValue(JSON.parse(JSON.stringify(enc)), FACTORIES);
      expect(back).toBe(n);
    }
    // Safe integers stay compact plain JSON numbers and still decode as integers.
    expect(serializeValue(BigInt(42))).toBe(42);
    expect(serializeValue(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(deserializeValue(42, FACTORIES)).toBe(BigInt(42));
    expect(deserializeValue(serializeValue(BigInt(Number.MIN_SAFE_INTEGER)), FACTORIES)).toBe(BigInt(Number.MIN_SAFE_INTEGER));
  });

  it('doubles stay doubles: integral doubles are tagged, fractions stay plain', () => {
    expect(serializeValue(3)).toEqual({ __fs: 'double', value: 3 });
    expect(serializeValue(1.5)).toBe(1.5);
    expect(deserializeValue({ __fs: 'double', value: 3 }, FACTORIES)).toBe(3);
    expect(deserializeValue(1.5, FACTORIES)).toBe(1.5);
    expect(Object.is(deserializeValue({ __fs: 'double', value: '-0' }, FACTORIES), -0)).toBe(true);
    expect(Number.isNaN(deserializeValue({ __fs: 'double', value: 'NaN' }, FACTORIES) as number)).toBe(true);
  });

  it('round-trips a document with every type through JSON', () => {
    const doc = {
      text: 'x', flag: true, none: null, count: BigInt(7), huge: BigInt(2) ** BigInt(62) * BigInt(3), ratio: 0.25, whole: 10,
      when: new Timestamp(1761782400, 987654321), where: new GeoPoint(-33.86, 151.2), ref: new DocumentReference('lessons/l1'),
      raw: Buffer.from('bytes'), vec: FieldValue.vector([1, 2.5]), list: [BigInt(1), 'a', { deep: [new Timestamp(1, 2)] }],
      tricky: { __fs: 'timestamp', seconds: BigInt(5) }, empty: {}, emptyList: [],
    };
    const back = deserializeValue(JSON.parse(JSON.stringify(serializeValue(doc))), FACTORIES) as Record<string, unknown>;
    expect(back.huge).toBe(doc.huge);
    expect(back.count).toBe(BigInt(7));
    expect(back.whole).toBe(10);
    expect((back.when as Timestamp).isEqual(doc.when)).toBe(true);
    expect((back.where as GeoPoint).isEqual(doc.where)).toBe(true);
    expect((back.ref as DocumentReference).path).toBe('lessons/l1');
    expect(Buffer.compare(back.raw as Buffer, doc.raw)).toBe(0);
    expect((back.vec as { toArray(): number[] }).toArray()).toEqual([1, 2.5]);
    expect(back.tricky).toEqual({ __fs: 'timestamp', seconds: BigInt(5) });
    expect(back).toMatchObject({ text: 'x', flag: true, none: null, ratio: 0.25, empty: {}, emptyList: [] });
  });

  it('wraps a map that already uses the reserved key, so decoding stays unambiguous', () => {
    expect(serializeValue({ __fs: 'timestamp', seconds: BigInt(1) })).toEqual({ __fs: 'map', value: { __fs: 'timestamp', seconds: 1 } });
  });

  it('refuses unknown types instead of corrupting them', () => {
    expect(() => serializeValue(new Map([['a', 1]]))).toThrow(/unsupported/);
    expect(() => serializeValue(new Date())).toThrow(/unsupported/);
    expect(() => serializeValue(() => 1)).toThrow(/unsupported/);
    expect(() => serializeValue(Symbol('s'))).toThrow(/unsupported/);
  });

  it('rejects malformed tagged values when decoding', () => {
    const bad: unknown[] = [
      { __fs: 'integer', value: 12 }, { __fs: 'integer', value: '1.5' }, { __fs: 'double', value: 1.5 }, { __fs: 'double', value: 'huge' },
      { __fs: 'timestamp', seconds: 1 }, { __fs: 'timestamp', seconds: 1, nanoseconds: 1e9 }, { __fs: 'reference', path: 'a' },
      { __fs: 'bytes', base64: '***' }, { __fs: 'vector', values: ['x'] }, { __fs: 'map', value: { a: 1 } }, { __fs: 'nope' },
      { __fs: 'timestamp', seconds: 1, nanoseconds: 0, extra: 1 }, 9007199254740993,
    ];
    for (const v of bad) expect(() => deserializeValue(v, FACTORIES), JSON.stringify(v)).toThrow(MalformedValueError);
  });
});

describe('exportFirestore', () => {
  it('exports every collection and nested subcollection, including under missing parents, in batches', async () => {
    const { source, getBatchSizes, calls } = memorySource(lmsTree());
    const m = await run(source, { batchSize: 2 });
    expect(m).toMatchObject({ complete: true, documentCount: 8, missingDocumentCount: 1, rootCollections: ['lessons', 'users'], errors: [], integerEncoding: 'bigint' });
    expect(m.countsByCollection).toEqual({
      lessons: 3, 'lessons/*/answerKey': 2, 'lessons/*/legacyBackup': 1, 'lessons/*/versions': 1, users: 1,
    });
    expect(Math.max(...getBatchSizes)).toBe(2);
    // Every collection visited is also counted by the server: 2 roots + 3 under l1 + 1 under ghost.
    expect(calls.countDocuments).toBe(6);
    const lines = fs.readFileSync(path.join(EXPORT_DIR(), 'collections/000_lessons.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.path).sort()).toEqual(['lessons/ghost', 'lessons/ghost/answerKey/current', 'lessons/l1', 'lessons/l1/answerKey/current', 'lessons/l1/legacyBackup/c4', 'lessons/l1/versions/000001', 'lessons/l2', 'lessons/l3']);
    expect(lines.find((l) => l.path === 'lessons/ghost')).toEqual({ path: 'lessons/ghost', exists: false });
    // The original lesson data, quiz keys and migration recovery copies are all in the backup.
    expect(lines.find((l) => l.path === 'lessons/l1/answerKey/current').data).toMatchObject({ keyVersion: 2, items: [{ correctOptionId: 'b' }] });
    expect(lines.find((l) => l.path === 'lessons/l1/legacyBackup/c4').data.runId).toBe('c4_x');
    expect(lines.find((l) => l.path === 'lessons/l1')).toMatchObject({ exists: true, createTime: '2026-10-01T00:00:00.000Z', updateTime: '2026-10-02T00:00:00.000Z' });
  });

  it('every page of a large collection is exported (no silent truncation)', async () => {
    const big: Tree = {};
    for (let i = 0; i < 1234; i++) big[`d${String(i).padStart(4, '0')}`] = { data: { i: BigInt(i) } };
    const { source, getBatchSizes } = memorySource({ big });
    const m = await run(source, { batchSize: 500 });
    expect(m).toMatchObject({ complete: true, documentCount: 1234 });
    expect(getBatchSizes).toEqual([500, 500, 234]);
    expect(verifyExport(EXPORT_DIR()).ok).toBe(true);
  });

  it('a server count that disagrees with the export marks it partial', async () => {
    const m = await run(memorySource(lmsTree(), {}, { 'lessons/l1/answerKey': 1 }).source);
    expect(m.complete).toBe(false);
    expect(m.errors).toEqual([{ path: 'lessons/l1/answerKey', stage: 'count_mismatch', message: 'server counts 2 document(s), exported 1' }]);
  });

  it('uses safe, fixed file names whatever the collection id', async () => {
    expect(fileNameFor(3, 'weird id/../x')).toBe('collections/003_weird_id____x.ndjson');
    const m = await run(memorySource({ 'odd collection.id': { a: { data: { v: BigInt(1) } } } }).source);
    expect(m.files).toMatchObject([{ name: 'collections/000_odd_collection_id.ndjson', collectionId: 'odd collection.id', lines: 1 }]);
    expect(verifyExport(EXPORT_DIR()).ok).toBe(true);
  });

  it('writes private files and a manifest that holds counts and hashes but no document contents', async () => {
    const m = await run(memorySource(lmsTree()).source);
    const dir = EXPORT_DIR();
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(dir, 'collections/000_lessons.ndjson')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(dir, 'manifest.json')).mode & 0o777).toBe(0o600);
    expect(m.files.map((f) => f.name)).toEqual(['collections/000_lessons.ndjson', 'collections/001_users.ndjson']);
    expect(m.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(dir, 'manifest.json.sha256'), 'utf8')).toMatch(/^[0-9a-f]{64} {2}manifest\.json\n$/);
    const manifestText = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    expect(manifestText).not.toContain(SECRET);
    expect(manifestText).not.toContain('student@example.test');
    expect(m.expectedCollectionsMissing).toContain('progress');
    expect(m.limitations.join(' ')).toMatch(/atomic/);
  });

  it('retries transient failures', async () => {
    let failures = 1;
    const { source, calls } = memorySource(lmsTree(), { getDocuments: () => failures-- > 0 });
    const m = await run(source);
    expect(m.complete).toBe(true);
    expect(calls.getDocuments).toBeGreaterThan(1);
  });

  it('reports a partial export when reads fail, with sanitized one-line errors', async () => {
    const { source } = memorySource(lmsTree(), {
      getDocuments: (refs) => (refs as DocRef[]).some((r) => r.path === 'lessons/l2'),
      listSubcollections: (d) => (d as DocRef).path === 'lessons/l1',
    });
    const m = await run(source, { batchSize: 1 });
    expect(m.complete).toBe(false);
    expect(m.errors).toEqual(expect.arrayContaining([
      { path: 'lessons/l2', stage: 'get_documents', message: '14: simulated getDocuments failure' },
      { path: 'lessons/l1', stage: 'list_subcollections', message: '14: simulated listSubcollections failure' },
    ]));
    expect(m.countsByCollection['lessons/*/answerKey']).toBe(1); // only the ghost's key; l1's subcollections were not listed
    const v = verifyExport(EXPORT_DIR());
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/partial/);
  });

  it('records a document it cannot serialize as an error instead of writing corrupted data', async () => {
    const tree = lmsTree();
    tree.users.u2 = { data: { when: new Date() } };
    const m = await run(memorySource(tree).source);
    expect(m.complete).toBe(false);
    expect(m.errors).toEqual([{ path: 'users/u2', stage: 'serialize', message: 'unsupported value type Date' }]);
    expect(fs.readFileSync(path.join(EXPORT_DIR(), 'collections/001_users.ndjson'), 'utf8')).not.toContain('users/u2');
  });

  it('failures to list root collections or count are reported as partial', async () => {
    expect(await run(memorySource(lmsTree(), { listRootCollections: () => true }).source)).toMatchObject({ complete: false, documentCount: 0, errors: [{ path: '/', stage: 'list_collections' }] });
    fs.rmSync(EXPORT_DIR(), { recursive: true });
    const m = await run(memorySource(lmsTree(), { countDocuments: (c) => (c as CollectionRef).path === 'users' }).source);
    expect(m.errors).toEqual([{ path: 'users', stage: 'count', message: '14: simulated countDocuments failure' }]);
  });

  it('collectionPattern hides document ids', () => {
    expect(collectionPattern('lessons/l1/answerKey/current')).toBe('lessons/*/answerKey');
    expect(collectionPattern('progress/stu_c1_l1/quizAttempts/000001')).toBe('progress/*/quizAttempts');
  });
});

describe('verifyExport (offline)', () => {
  beforeEach(async () => { await run(memorySource(lmsTree()).source); });
  const problems = () => verifyExport(EXPORT_DIR()).problems.join(' | ');

  it('accepts an untouched export', () => {
    expect(verifyExport(EXPORT_DIR())).toEqual({ ok: true, problems: [], documentCount: 8, complete: true });
  });

  it('detects a changed data file and a tampered manifest', () => {
    const file = path.join(EXPORT_DIR(), 'collections/001_users.ndjson');
    fs.chmodSync(file, 0o600);
    fs.appendFileSync(file, '{"path":"users/u2","exists":true,"data":{}}\n');
    expect(problems()).toMatch(/001_users\.ndjson hash mismatch.*size mismatch.*line count mismatch/);
    fs.appendFileSync(path.join(EXPORT_DIR(), 'manifest.json'), ' ');
    expect(problems()).toMatch(/manifest\.json hash mismatch/);
  });

  it('detects missing and extra files', () => {
    fs.rmSync(path.join(EXPORT_DIR(), 'collections/001_users.ndjson'));
    fs.writeFileSync(path.join(EXPORT_DIR(), 'collections/002_extra.ndjson'), '');
    fs.writeFileSync(path.join(EXPORT_DIR(), 'notes.txt'), 'x');
    expect(problems()).toMatch(/001_users\.ndjson missing/);
    expect(problems()).toMatch(/unexpected file: collections\/002_extra\.ndjson/);
    expect(problems()).toMatch(/unexpected file: notes\.txt/);
  });

  it('rejects path traversal and unsafe names in the manifest, even when re-signed', () => {
    for (const name of ['../../etc/passwd', '/etc/passwd', 'collections/../manifest.json', 'collections/000_lessons.ndjson/../x', 'collections/abc.ndjson']) {
      editManifest(EXPORT_DIR(), (m) => { (m.files as Array<{ name: string }>)[0].name = name; });
      expect(problems(), name).toMatch(/unsafe file name/);
    }
  });

  it('rejects a duplicated file entry and inconsistent counts, even when re-signed', () => {
    editManifest(EXPORT_DIR(), (m) => { (m.files as unknown[]).push((m.files as unknown[])[0]); });
    expect(problems()).toMatch(/listed twice/);
  });

  it('rejects count tampering, even when re-signed', () => {
    editManifest(EXPORT_DIR(), (m) => { m.documentCount = 7; (m.countsByCollection as Record<string, number>).lessons = 2; });
    expect(problems()).toMatch(/document count does not match.*per-collection counts do not match/);
  });

  it('fails safely on malformed manifests and checksum files', () => {
    const sum = path.join(EXPORT_DIR(), 'manifest.json.sha256');
    fs.chmodSync(sum, 0o600);
    fs.writeFileSync(sum, `${fs.readFileSync(sum, 'utf8').split(' ')[0]} manifest.json\n`); // one space: ambiguous format
    expect(problems()).toMatch(/not in "<sha256>  manifest\.json" format/);
    const file = path.join(EXPORT_DIR(), 'manifest.json');
    fs.chmodSync(file, 0o600);
    fs.writeFileSync(file, '{not json');
    expect(verifyExport(EXPORT_DIR())).toMatchObject({ ok: false, problems: expect.arrayContaining(['manifest.json is not valid JSON']) });
    fs.writeFileSync(file, JSON.stringify({ format: 'strynkix-firestore-export', formatVersion: 2 }));
    expect(problems()).toMatch(/missing required fields/);
    fs.writeFileSync(file, JSON.stringify([1, 2]));
    expect(problems()).toMatch(/unknown export format/);
    expect(verifyExport(path.join(tmp, 'nope')).problems).toEqual(['export directory not found']);
  });

  it('rejects malformed, duplicated, misplaced and badly typed records, even when re-signed', () => {
    const file = path.join(EXPORT_DIR(), 'collections/001_users.ndjson');
    fs.chmodSync(file, 0o600);
    const lines = [
      '{"path":"users/u1","exists":false}',
      '{"path":"users/u1","exists":true,"data":{}}',
      '{"path":"lessons/l9","exists":true,"data":{}}',
      '{"path":"users/u3","exists":true,"data":{"n":{"__fs":"integer","value":12}}}',
      '{"path":"users/u4"}',
      'not json',
      '{"path":"users","exists":true,"data":{}}',
    ];
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    editManifest(EXPORT_DIR(), (m) => {
      const f = (m.files as Array<Record<string, unknown>>)[1];
      f.sha256 = sha(file); f.bytes = fs.statSync(file).size; f.lines = lines.length;
    });
    const p = problems();
    expect(p).toMatch(/:2 duplicate document/);
    expect(p).toMatch(/:3 path outside its collection/);
    expect(p).toMatch(/:4 malformed value/);
    expect(p).toMatch(/:5 malformed record/);
    expect(p).toMatch(/:6 invalid JSON/);
    expect(p).toMatch(/:7 path outside its collection/);
  });
});

describe('the exporter is read-only by construction', () => {
  const sources = ['src/lib/backup/firestore-export.ts', 'scripts/backup/firestore-export.ts'].map((f) => [f, fs.readFileSync(path.join(REPO, f), 'utf8')] as const);
  it('contains no Firestore write, delete, transaction, batch or migration calls', () => {
    const forbidden = [/\.set\(/, /\.update\(/, /\.delete\(/, /\.create\(/, /\.add\(/, /\.commit\(/, /runTransaction/, /\.batch\(/, /bulkWriter/i, /recursiveDelete/, /applyQuizKeyMigration/, /FieldValue\./];
    for (const [file, src] of sources) {
      // Allowed: the SHA-256 hash's `.update(` and the verifier's local Sets.
      const code = src.replace(/createHash\('sha256'\)\.update\(/g, 'HASH(').replace(/\b(seenPaths|listed)\.add\(/g, 'SET(');
      for (const re of forbidden) expect(re.test(code), `${file} matches ${re}`).toBe(false);
    }
  });
  it('the library imports no Firebase module; the CLI loads Firebase only after every guard, via a dynamic import', () => {
    const [lib, cli] = [sources[0][1], sources[1][1]];
    expect(lib).not.toMatch(/from ['"](firebase|firebase-admin|@google-cloud)[^'"]*['"]/);
    expect(lib).not.toMatch(/server\/firebase-admin|migration\//);
    expect(cli).not.toMatch(/^import (?!type )[^\n]*['"](firebase-admin[^'"]*|[^'"]*server\/firebase-admin)['"]/m);
    const guard = cli.indexOf('assertExportTarget(');
    const load = cli.indexOf("await import('../../src/lib/server/firebase-admin')");
    expect(guard).toBeGreaterThan(0);
    expect(load).toBeGreaterThan(guard);
    expect(cli.indexOf('getAdminServices()')).toBeGreaterThan(cli.indexOf('if (!opts.execute)'));
  });
});

/**
 * Emulator-only restore — offline tests. Exports are built with the real
 * exporter from an in-memory source; restores use a mock `commit`, so nothing
 * touches the network. (The end-to-end rehearsal is
 * tests/emulator/firestore-restore.emulator.test.ts.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FieldValue, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { DocRef, ReadOnlyFirestore, exportFirestore } from '@/lib/backup/firestore-export';
import { RestWrite, RestoreRefusedError, assertRestoreTarget, planRestore, resolveRestoreInput, restoreExport, rfc3339 } from '@/lib/backup/firestore-restore';
import { pinAdminEnvironment } from '@/lib/server/admin-env';

const REPO = path.resolve(__dirname, '../..');
let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strynkix-restore-test-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

class DocumentReference { constructor(public path: string) {} }

/** Flat in-memory source: `docs` maps full document paths to data (undefined = missing parent). */
function source(docs: Record<string, Record<string, unknown> | undefined>): ReadOnlyFirestore {
  const paths = Object.keys(docs);
  const childCollections = (prefix: string) => [...new Set(paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split('/')[0]))];
  const docsIn = (col: string) => [...new Set(paths.filter((p) => p.startsWith(`${col}/`)).map((p) => `${col}/${p.slice(col.length + 1).split('/')[0]}`))];
  return {
    listRootCollections: async () => childCollections('').map((id) => ({ id, path: id })),
    listDocumentRefs: async (c) => docsIn(c.path).map((p) => ({ id: p.split('/').pop()!, path: p })),
    getDocuments: async (refs: DocRef[]) => refs.map((r) => (docs[r.path] ? { path: r.path, exists: true, data: docs[r.path] } : { path: r.path, exists: false })),
    listSubcollections: async (d) => childCollections(`${d.path}/`).map((id) => ({ id, path: `${d.path}/${id}` })),
    countDocuments: async (c) => docsIn(c.path).filter((p) => docs[p]).length,
  };
}

const FIXTURE = () => ({
  'lessons/l1': {
    big: BigInt('9223372036854775807'), negBig: BigInt('-9007199254740993'), small: BigInt(42), ratio: 0.25, whole: 3, nan: NaN, inf: Infinity,
    when: new Timestamp(1761782400, 123456000), where: new GeoPoint(18.52, 73.85), ref: new DocumentReference('courses/c1'),
    raw: Buffer.from([0, 255]), vec: FieldValue.vector([0.5, 2]), list: [BigInt(1), 'two'], empty: {}, emptyList: [],
    looksTagged: { __fs: 'timestamp', seconds: BigInt(5) }, 'dotted.key': 'x', 'ключ': 'unicode', nul: null,
  },
  'lessons/l1/answerKey/current': { keyVersion: BigInt(2) },
  'lessons/gone/answerKey/current': { keyVersion: BigInt(1) }, // parent missing
  ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`bulk/d${i}`, { i: BigInt(i) }])),
} as Record<string, Record<string, unknown> | undefined>);

async function makeExport(docs = FIXTURE()): Promise<string> {
  const dir = path.join(tmp, `export-${Math.random().toString(36).slice(2)}`);
  const m = await exportFirestore({ source: source(docs), dir, projectId: 'demo-src', target: 'emulator', retryDelayMs: 0 });
  expect(m.complete).toBe(true);
  return dir;
}
const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
/** Re-signs an edited export (file hashes, sizes, line counts, manifest checksum). */
function resign(dir: string) {
  const mf = path.join(dir, 'manifest.json');
  fs.chmodSync(mf, 0o600);
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  for (const f of m.files) {
    const full = path.join(dir, f.name);
    f.sha256 = sha(full); f.bytes = fs.statSync(full).size; f.lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).length;
  }
  fs.writeFileSync(mf, JSON.stringify(m));
  const sum = path.join(dir, 'manifest.json.sha256');
  fs.chmodSync(sum, 0o600);
  fs.writeFileSync(sum, `${sha(mf)}  manifest.json\n`);
}
function editRecord(dir: string, docPath: string, change: (rec: Record<string, unknown>) => void) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const f of m.files) {
    const full = path.join(dir, f.name);
    const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const rec = lines.find((l) => l.path === docPath);
    if (!rec) continue;
    change(rec);
    fs.chmodSync(full, 0o600);
    fs.writeFileSync(full, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  }
  resign(dir);
}
const recorder = (failAt?: number) => {
  const batches: RestWrite[][] = [];
  return { batches, commit: async (w: RestWrite[]) => { if (failAt !== undefined && batches.length + 1 === failAt) throw new Error('HTTP 400: simulated rejection\nsecond line'); batches.push(w); } };
};

// -----------------------------------------------------------------------------
describe('assertRestoreTarget', () => {
  const env = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
  const ok = (o: Partial<Parameters<typeof assertRestoreTarget>[0]>, e: Record<string, string | undefined> = env) =>
    assertRestoreTarget({ write: false, confirmOverwrite: false, ...o }, e);
  it('accepts only a demo- project on a local emulator', () => {
    expect(ok({ projectId: 'demo-x' })).toEqual({ projectId: 'demo-x', host: '127.0.0.1:8080', write: false });
    expect(ok({ projectId: 'demo-x' }, { FIRESTORE_EMULATOR_HOST: '[::1]:8080' }).host).toBe('[::1]:8080');
  });
  it('refuses staging, production, non-demo and missing projects', () => {
    for (const projectId of ['learning-management-syst-b9bf3', 'strynkix-live-books-staging', 'my-project', 'demo-', 'demo-UPPER', undefined]) {
      expect(() => ok({ projectId }), String(projectId)).toThrow(RestoreRefusedError);
    }
  });
  it('refuses remote or missing emulator hosts', () => {
    for (const host of [undefined, '', 'firestore.googleapis.com:443', '10.0.0.5:8080', '127.0.0.1', 'localhost:8080/x']) {
      expect(() => ok({ projectId: 'demo-x' }, { FIRESTORE_EMULATOR_HOST: host }), String(host)).toThrow(/local emulator/);
    }
  });
  it('refuses ambiguous configuration: credentials present or a different project named', () => {
    for (const v of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY']) {
      expect(() => ok({ projectId: 'demo-x' }, { ...env, [v]: 'set' }), v).toThrow(/Ambiguous configuration/);
    }
    for (const v of ['FIREBASE_ADMIN_PROJECT_ID', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
      expect(() => ok({ projectId: 'demo-x' }, { ...env, [v]: 'strynkix-live-books-staging' }), v).toThrow(/different project/);
      expect(ok({ projectId: 'demo-x' }, { ...env, [v]: 'demo-x' }).projectId).toBe('demo-x');
    }
  });
  it('writing needs explicit confirmation', () => {
    expect(() => ok({ projectId: 'demo-x', write: true })).toThrow(/--confirm-emulator-overwrite/);
    expect(ok({ projectId: 'demo-x', write: true, confirmOverwrite: true }).write).toBe(true);
  });
});

describe('resolveRestoreInput', () => {
  it('requires an existing real directory outside the repository', async () => {
    expect(() => resolveRestoreInput(undefined, REPO)).toThrow(/--from/);
    expect(() => resolveRestoreInput(path.join(tmp, 'missing'), REPO)).toThrow(/existing export directory/);
    expect(() => resolveRestoreInput(path.join(REPO, 'docs'), REPO)).toThrow(/outside the repository/);
    const dir = await makeExport();
    const link = path.join(tmp, 'link');
    fs.symlinkSync(dir, link);
    expect(() => resolveRestoreInput(link, REPO)).toThrow(/not a symlink/);
    expect(resolveRestoreInput(dir, REPO)).toBe(fs.realpathSync(dir));
  });
});

describe('REST encoding', () => {
  it('formats timestamps with nanoseconds, before and after 1970', () => {
    expect(rfc3339(1761782400, 123456000)).toBe('2025-10-30T00:00:00.123456000Z');
    expect(rfc3339(-1, 5)).toBe('1969-12-31T23:59:59.000000005Z');
  });
  it('encodes every type explicitly, keeping integers exact and doubles as doubles', async () => {
    const dir = await makeExport();
    const { batches, commit } = recorder();
    const r = await restoreExport({ dir, projectId: 'demo-target', commit, batchSize: 500 });
    expect(r).toMatchObject({ complete: true, documentsPlanned: 10, documentsRestored: 10, batchesCommitted: 1 });
    const l1 = batches[0].find((w) => w.update.name.endsWith('/documents/lessons/l1'))!.update;
    expect(l1.name).toBe('projects/demo-target/databases/(default)/documents/lessons/l1');
    expect(l1.fields).toMatchObject({
      big: { integerValue: '9223372036854775807' }, negBig: { integerValue: '-9007199254740993' }, small: { integerValue: '42' },
      ratio: { doubleValue: 0.25 }, whole: { doubleValue: 3 }, nan: { doubleValue: 'NaN' }, inf: { doubleValue: 'Infinity' },
      when: { timestampValue: '2025-10-30T00:00:00.123456000Z' }, where: { geoPointValue: { latitude: 18.52, longitude: 73.85 } },
      ref: { referenceValue: 'projects/demo-target/databases/(default)/documents/courses/c1' }, raw: { bytesValue: 'AP8=' },
      vec: { mapValue: { fields: { __type__: { stringValue: '__vector__' }, value: { arrayValue: { values: [{ doubleValue: 0.5 }, { doubleValue: 2 }] } } } } },
      list: { arrayValue: { values: [{ integerValue: '1' }, { stringValue: 'two' }] } }, empty: { mapValue: { fields: {} } }, emptyList: { arrayValue: {} },
      looksTagged: { mapValue: { fields: { __fs: { stringValue: 'timestamp' }, seconds: { integerValue: '5' } } } },
      'dotted.key': { stringValue: 'x' }, 'ключ': { stringValue: 'unicode' }, nul: { nullValue: null },
    });
    // The child of a missing parent is written; the missing parent itself is not.
    const names = batches[0].map((w) => w.update.name.split('/documents/')[1]).sort();
    expect(names).toContain('lessons/gone/answerKey/current');
    expect(names).not.toContain('lessons/gone');
  });
});

describe('validation happens before any write', () => {
  const refuses = async (dir: string, msg: RegExp, extra: Partial<Parameters<typeof restoreExport>[0]> = {}) => {
    const { batches, commit } = recorder();
    let cleared = false;
    await expect(restoreExport({ dir, projectId: 'demo-t', commit, clear: async () => { cleared = true; }, ...extra })).rejects.toThrow(msg);
    expect(batches).toEqual([]);
    expect(cleared).toBe(false);
  };
  it('tampered checksum, malformed manifest, missing and extra files', async () => {
    const a = await makeExport();
    fs.chmodSync(path.join(a, 'manifest.json.sha256'), 0o600);
    fs.writeFileSync(path.join(a, 'manifest.json.sha256'), `${'0'.repeat(64)}  manifest.json\n`);
    await refuses(a, /manifest\.json hash mismatch/);
    const b = await makeExport();
    fs.chmodSync(path.join(b, 'manifest.json'), 0o600);
    fs.writeFileSync(path.join(b, 'manifest.json'), '{broken');
    await refuses(b, /not valid JSON/);
    const c = await makeExport();
    fs.rmSync(path.join(c, 'collections/000_bulk.ndjson'));
    await refuses(c, /missing/);
    const d = await makeExport();
    fs.writeFileSync(path.join(d, 'collections/extra.ndjson'), '');
    await refuses(d, /unexpected file/);
  });
  it('a partial export, an inexact integer encoding, a reserved field or an undecodable value', async () => {
    const a = await makeExport();
    const mf = path.join(a, 'manifest.json');
    fs.chmodSync(mf, 0o600);
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.complete = false; m.errors = [{ path: 'bulk', stage: 'count', message: 'x' }];
    fs.writeFileSync(mf, JSON.stringify(m));
    resign(a);
    await refuses(a, /partial/);
    const b = await makeExport();
    const mb = path.join(b, 'manifest.json');
    fs.chmodSync(mb, 0o600);
    fs.writeFileSync(mb, JSON.stringify({ ...JSON.parse(fs.readFileSync(mb, 'utf8')), integerEncoding: 'number' }));
    resign(b);
    await refuses(b, /integerEncoding/);
    const c = await makeExport();
    editRecord(c, 'bulk/d3', (rec) => { (rec.data as Record<string, unknown>).__name__ = 'reserved'; });
    await refuses(c, /reserved field name/);
    const d = await makeExport();
    editRecord(d, 'bulk/d4', (rec) => { (rec.data as Record<string, unknown>).bad = { __fs: 'integer', value: 'NaN' }; });
    await refuses(d, /malformed value/);
  });
  it('negative zeros are refused unless explicitly accepted', async () => {
    const dir = await makeExport({ 'n/z': { v: -0 } });
    expect(planRestore(dir, 'demo-t').negativeZeros).toBe(1);
    await refuses(dir, /negative-zero/);
    const { batches, commit } = recorder();
    const r = await restoreExport({ dir, projectId: 'demo-t', commit, acceptNegativeZeroAsZero: true });
    expect(r.complete).toBe(true);
    expect(batches).toHaveLength(1);
  });
});

describe('batching, partial restore and reruns', () => {
  it('writes bounded batches in a stable order', async () => {
    const dir = await makeExport();
    const { batches, commit } = recorder();
    await restoreExport({ dir, projectId: 'demo-t', commit, batchSize: 3 });
    // Batches run across file boundaries: 10 documents in batches of 3.
    expect(batches.map((b) => b.length)).toEqual([3, 3, 3, 1]);
    const again = recorder();
    await restoreExport({ dir, projectId: 'demo-t', commit: again.commit, batchSize: 3 });
    expect(again.batches).toEqual(batches);
  });
  it('stops at the first failed batch and reports exactly what was not written', async () => {
    const dir = await makeExport();
    const { batches, commit } = recorder(2);
    const r = await restoreExport({ dir, projectId: 'demo-t', commit, batchSize: 3 });
    expect(r).toMatchObject({ complete: false, documentsRestored: 3, batchesCommitted: 1, failure: { batch: 2, firstPath: 'bulk/d3', lastPath: 'bulk/d5', message: 'HTTP 400: simulated rejection' } });
    expect(batches).toHaveLength(1);
    // A rerun writes everything again (idempotent full-document writes).
    const rerun = recorder();
    expect(await restoreExport({ dir, projectId: 'demo-t', commit: rerun.commit, batchSize: 3 })).toMatchObject({ complete: true, documentsRestored: 10 });
  });
  it('clear-first runs only after validation, then writes everything', async () => {
    const dir = await makeExport();
    const order: string[] = [];
    await restoreExport({ dir, projectId: 'demo-t', batchSize: 500, clear: async () => { order.push('clear'); }, commit: async () => { order.push('commit'); } });
    expect(order).toEqual(['clear', 'commit']);
  });
});

describe('the restore path uses no Firebase SDK and writes nowhere else', () => {
  const files = ['src/lib/backup/firestore-restore.ts', 'scripts/backup/firestore-restore.ts'].map((f) => [f, fs.readFileSync(path.join(REPO, f), 'utf8')] as const);
  it('imports no Firebase or Google Cloud module and no Admin helper', () => {
    for (const [f, src] of files) {
      expect(src, f).not.toMatch(/from ['"](firebase|firebase-admin|@google-cloud|@firebase)[^'"]*['"]/);
      expect(src, f).not.toMatch(/server\/firebase-admin|getAdminServices|admin-env/);
    }
  });
  it('the CLI only contacts the validated emulator host', () => {
    const cli = files[1][1];
    expect(cli.match(/fetch\(/g)).toHaveLength(1);
    expect(cli).toContain('fetch(`http://${host}${urlPath}`');
    expect(cli.indexOf('assertRestoreTarget(')).toBeLessThan(cli.indexOf('emulatorRequest(target.host'));
  });
});

describe('pinAdminEnvironment (export and migration CLIs)', () => {
  it('disables metadata probing, drops ambient credentials and pins the project', () => {
    const env: NodeJS.ProcessEnv = { GOOGLE_APPLICATION_CREDENTIALS: '/x.json', FIREBASE_ADMIN_CLIENT_EMAIL: 'a', FIREBASE_ADMIN_PRIVATE_KEY: 'b', GCLOUD_PROJECT: 'other' } as unknown as NodeJS.ProcessEnv;
    pinAdminEnvironment('emulator', 'demo-x', env);
    expect(env).toMatchObject({ METADATA_SERVER_DETECTION: 'none', FIREBASE_ADMIN_PROJECT_ID: 'demo-x', GCLOUD_PROJECT: 'demo-x', GOOGLE_CLOUD_PROJECT: 'demo-x', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' });
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(env.FIREBASE_ADMIN_CLIENT_EMAIL).toBeUndefined();
    expect(env.FIREBASE_ADMIN_PRIVATE_KEY).toBeUndefined();
  });
  it('staging keeps the explicit FIREBASE_ADMIN_* credentials but still drops ADC', () => {
    const env: NodeJS.ProcessEnv = { GOOGLE_APPLICATION_CREDENTIALS: '/x.json', FIREBASE_ADMIN_CLIENT_EMAIL: 'a', FIREBASE_ADMIN_PRIVATE_KEY: 'b' } as unknown as NodeJS.ProcessEnv;
    pinAdminEnvironment('staging', 'strynkix-live-books-staging', env);
    expect(env).toMatchObject({ METADATA_SERVER_DETECTION: 'none', FIREBASE_ADMIN_CLIENT_EMAIL: 'a', FIREBASE_ADMIN_PRIVATE_KEY: 'b', FIREBASE_ADMIN_PROJECT_ID: 'strynkix-live-books-staging' });
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(env.FIREBASE_AUTH_EMULATOR_HOST).toBeUndefined();
  });
  it('both Admin CLIs call it before getAdminServices()', () => {
    for (const f of ['scripts/backup/firestore-export.ts', 'scripts/migration/quiz-key-migration.ts']) {
      const src = fs.readFileSync(path.join(REPO, f), 'utf8');
      const pin = src.indexOf('pinAdminEnvironment(');
      expect(pin, f).toBeGreaterThan(0);
      expect(src.indexOf('getAdminServices()'), f).toBeGreaterThan(pin);
    }
  });
});

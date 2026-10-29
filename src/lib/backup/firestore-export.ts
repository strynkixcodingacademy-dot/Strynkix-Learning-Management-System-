/**
 * Strynkix LMS — read-only Firestore JSON export (pre-migration backup, no billing).
 *
 * The exporter only ever sees ReadOnlyFirestore: five read operations and
 * nothing that could write. It walks every root collection and every nested
 * subcollection (including subcollections under documents that no longer
 * exist), batches document reads, cross-checks each collection against a
 * server-side count, and writes NDJSON files plus a manifest with per-file
 * SHA-256 hashes into a new private directory outside the repository.
 *
 * Values keep their Firestore type through tagged JSON. Integers must arrive
 * as `bigint` (the CLI enables the Admin SDK's `useBigInt`), so 64-bit
 * integers are exact and integers and doubles stay distinguishable.
 *
 * This is a logical copy, not a managed backup: it is not a single atomic
 * snapshot, and it does not include Auth users, IAM, indexes, rules or hosting
 * configuration. See docs/STAGING_READINESS.md §20.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
// A dependency-free module: plan and verify modes load no Firebase code at all.
import { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from '@/lib/firebase/project-ids';

export const EXPORT_FORMAT = 'strynkix-firestore-export';
export const EXPORT_FORMAT_VERSION = 2;
/** Collections the LMS expects; an absent one is reported (it may simply be empty). */
export const EXPECTED_ROOT_COLLECTIONS = [
  'organizations', 'branches', 'users', 'courses', 'modules', 'lessons', 'batches', 'enrollments', 'progress', 'auditLog',
];

// -----------------------------------------------------------------------------
// Read-only source
// -----------------------------------------------------------------------------
export interface CollectionRef { id: string; path: string }
export interface DocRef { id: string; path: string }
export interface DocSnapshot {
  path: string;
  exists: boolean;
  /** Field values as the Admin SDK returns them, with integers as `bigint`. */
  data?: Record<string, unknown>;
  createTime?: string;
  updateTime?: string;
}

/** Everything the exporter may do to the database. There is deliberately no write. */
export interface ReadOnlyFirestore {
  listRootCollections(): Promise<CollectionRef[]>;
  /** Every document reference in the collection, including missing documents that only hold subcollections. */
  listDocumentRefs(collection: CollectionRef): Promise<DocRef[]>;
  /** Batched read; returns one snapshot per ref, in order. */
  getDocuments(refs: DocRef[]): Promise<DocSnapshot[]>;
  listSubcollections(doc: DocRef): Promise<CollectionRef[]>;
  /** Server-side count of existing documents in the collection (aggregation query). */
  countDocuments(collection: CollectionRef): Promise<number>;
}

// -----------------------------------------------------------------------------
// Target and output guards (pure; run before any Firebase module is loaded)
// -----------------------------------------------------------------------------
export interface ExportOptions {
  target: 'staging' | 'emulator';
  projectId: string;
  /** Perform the export; without it the CLI only prints the plan. */
  execute: boolean;
}

export function assertExportTarget(
  opts: { target?: string; projectId?: string; execute: boolean; confirmStagingRead: boolean },
  env: Record<string, string | undefined>
): ExportOptions {
  const { target, projectId, execute } = opts;
  if (!projectId) throw new Error('--project is required (it is never inferred from .env files).');
  if (projectId === PRODUCTION_PROJECT_ID) throw new Error('Refusing to export the production project.');
  if (target === 'staging') {
    if (projectId !== STAGING_PROJECT_ID) throw new Error(`--target staging only accepts ${STAGING_PROJECT_ID}.`);
    if (env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is set; unset it for a staging export, or use --target emulator.');
    if (execute && !opts.confirmStagingRead) throw new Error('Reading staging needs --confirm-staging-read (approved runs only).');
    return { target, projectId, execute };
  }
  if (target === 'emulator') {
    if (!projectId.startsWith('demo-')) throw new Error('--target emulator only accepts a demo- project id.');
    const host = env.FIRESTORE_EMULATOR_HOST ?? '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) throw new Error('--target emulator requires FIRESTORE_EMULATOR_HOST to point at a local emulator.');
    return { target, projectId, execute };
  }
  throw new Error('--target must be "staging" or "emulator".');
}

/**
 * Resolves the new export directory: `<out>/firestore-export_<project>_<stamp>`.
 * `<out>` must already exist and lie outside the repository (symlinks resolved);
 * the export directory itself must not exist yet, so nothing is ever overwritten.
 */
export function resolveExportDir(params: { out?: string; repoRoot: string; projectId: string; now: Date }): string {
  if (!params.out) throw new Error('--out <directory> is required (choose a private location outside the repository).');
  const outAbs = path.resolve(params.out);
  if (!fs.existsSync(outAbs) || !fs.statSync(outAbs).isDirectory()) throw new Error('--out must be an existing directory.');
  const outReal = fs.realpathSync(outAbs);
  const repoReal = fs.realpathSync(params.repoRoot);
  const rel = path.relative(repoReal, outReal);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error('--out must be outside the repository, so exported student and assessment data can never be committed.');
  }
  const stamp = params.now.toISOString().replace(/[:.]/g, '-');
  const dir = path.join(outReal, `firestore-export_${params.projectId}_${stamp}`);
  if (fs.existsSync(dir)) throw new Error('The export directory already exists; refusing to overwrite an existing backup.');
  return dir;
}

// -----------------------------------------------------------------------------
// Type-preserving serialization
// -----------------------------------------------------------------------------
export class UnsupportedValueError extends Error {}

const ctorName = (v: object) => (v as { constructor?: { name?: string } }).constructor?.name;

/**
 * Converts a Firestore value to JSON without losing its type.
 * - integers (`bigint`): a plain JSON number when within ±(2^53−1), otherwise
 *   `{__fs:'integer', value:'<decimal>'}`; always exact.
 * - doubles (`number`): a plain JSON number when non-integral; integral,
 *   non-finite and −0 doubles are tagged `{__fs:'double', …}` so they are never
 *   mistaken for integers.
 * - timestamps, references, bytes, geopoints, vectors: tagged.
 * - a map that itself has a `__fs` key is wrapped, so decoding is unambiguous.
 * Unknown object types are an error, never silently stringified.
 */
export function serializeValue(v: unknown): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') {
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : { __fs: 'integer', value: v.toString() };
  }
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { __fs: 'double', value: 'NaN' };
    if (v === Infinity) return { __fs: 'double', value: 'Infinity' };
    if (v === -Infinity) return { __fs: 'double', value: '-Infinity' };
    if (Object.is(v, -0)) return { __fs: 'double', value: '-0' };
    return Number.isInteger(v) ? { __fs: 'double', value: v } : v;
  }
  if (Array.isArray(v)) return v.map(serializeValue);
  if (v instanceof Uint8Array) return { __fs: 'bytes', base64: Buffer.from(v).toString('base64') };
  if (typeof v === 'object') {
    const name = ctorName(v);
    const o = v as Record<string, unknown>;
    if (name === 'Timestamp' && typeof o.seconds === 'number' && typeof o.nanoseconds === 'number') {
      return { __fs: 'timestamp', seconds: o.seconds, nanoseconds: o.nanoseconds };
    }
    if (name === 'GeoPoint' && typeof o.latitude === 'number' && typeof o.longitude === 'number') {
      return { __fs: 'geopoint', latitude: o.latitude, longitude: o.longitude };
    }
    if (name === 'DocumentReference' && typeof o.path === 'string') return { __fs: 'reference', path: o.path };
    if (name === 'VectorValue' && typeof (o as { toArray?: unknown }).toArray === 'function') {
      return { __fs: 'vector', values: (o as unknown as { toArray(): number[] }).toArray() };
    }
    if (name === 'Object' || name === undefined) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(o)) out[k] = serializeValue(val);
      return '__fs' in o ? { __fs: 'map', value: out } : out;
    }
    throw new UnsupportedValueError(`unsupported value type ${name}`);
  }
  throw new UnsupportedValueError(`unsupported value type ${typeof v}`);
}

/** Builds Firestore values while decoding; the caller supplies the SDK's classes. */
export interface ValueFactories {
  timestamp(seconds: number, nanoseconds: number): unknown;
  geopoint(latitude: number, longitude: number): unknown;
  reference(path: string): unknown;
  bytes(data: Buffer): unknown;
  vector(values: number[]): unknown;
}

export class MalformedValueError extends Error {}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const SPECIAL_DOUBLES: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0 };

/**
 * Inverse of serializeValue (no I/O): plain JSON integers become `bigint`,
 * non-integral numbers stay doubles, and tagged values are rebuilt through
 * `f`. Throws MalformedValueError on anything serializeValue cannot produce.
 */
export function deserializeValue(v: unknown, f: ValueFactories): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new MalformedValueError('non-finite number in JSON');
    if (Number.isInteger(v)) {
      if (!Number.isSafeInteger(v)) throw new MalformedValueError('unsafe plain integer');
      return BigInt(v);
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => deserializeValue(x, f));
  if (!isPlainObject(v)) throw new MalformedValueError('unexpected JSON value');
  if (!('__fs' in v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = deserializeValue(val, f);
    return out;
  }
  const keys = Object.keys(v).sort().join(',');
  const need = (expected: string) => { if (keys !== expected) throw new MalformedValueError(`malformed ${String(v.__fs)} tag`); };
  switch (v.__fs) {
    case 'integer':
      need('__fs,value');
      if (typeof v.value !== 'string' || !/^-?\d+$/.test(v.value)) throw new MalformedValueError('malformed integer');
      return BigInt(v.value);
    case 'double':
      need('__fs,value');
      if (typeof v.value === 'string' && v.value in SPECIAL_DOUBLES) return SPECIAL_DOUBLES[v.value];
      if (typeof v.value === 'number' && Number.isInteger(v.value)) return v.value;
      throw new MalformedValueError('malformed double');
    case 'timestamp':
      need('__fs,nanoseconds,seconds');
      if (!Number.isInteger(v.seconds) || !Number.isInteger(v.nanoseconds) || (v.nanoseconds as number) < 0 || (v.nanoseconds as number) > 999_999_999) {
        throw new MalformedValueError('malformed timestamp');
      }
      return f.timestamp(v.seconds as number, v.nanoseconds as number);
    case 'geopoint':
      need('__fs,latitude,longitude');
      if (typeof v.latitude !== 'number' || typeof v.longitude !== 'number') throw new MalformedValueError('malformed geopoint');
      return f.geopoint(v.latitude, v.longitude);
    case 'reference':
      need('__fs,path');
      if (typeof v.path !== 'string' || v.path.split('/').length % 2 !== 0) throw new MalformedValueError('malformed reference');
      return f.reference(v.path);
    case 'bytes':
      need('__fs,base64');
      if (typeof v.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(v.base64)) throw new MalformedValueError('malformed bytes');
      return f.bytes(Buffer.from(v.base64, 'base64'));
    case 'vector':
      need('__fs,values');
      if (!Array.isArray(v.values) || !v.values.every((n) => typeof n === 'number')) throw new MalformedValueError('malformed vector');
      return f.vector(v.values as number[]);
    case 'map': {
      need('__fs,value');
      if (!isPlainObject(v.value) || !('__fs' in v.value)) throw new MalformedValueError('malformed map wrapper');
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v.value)) out[k] = deserializeValue(val, f);
      return out;
    }
    default:
      throw new MalformedValueError('unknown tag');
  }
}

/** Factories that check structure only (offline verification). */
const CHECK_ONLY: ValueFactories = {
  timestamp: () => null, geopoint: () => null, reference: () => null, bytes: () => null, vector: () => null,
};

// -----------------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------------
export interface ExportError {
  path: string;
  stage: 'list_collections' | 'list_documents' | 'get_documents' | 'serialize' | 'list_subcollections' | 'count' | 'count_mismatch';
  message: string;
}

export interface ExportFile { name: string; collectionId: string; sha256: string; bytes: number; lines: number }

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  checksumAlgorithm: 'sha256';
  integerEncoding: 'bigint';
  projectId: string;
  target: 'staging' | 'emulator';
  startedAt: string;
  finishedAt: string;
  complete: boolean;
  documentCount: number;
  /** Missing parent documents recorded because they hold subcollections. */
  missingDocumentCount: number;
  /** Documents per collection, with document ids replaced by `*` (for example `lessons/*\/answerKey`). */
  countsByCollection: Record<string, number>;
  rootCollections: string[];
  expectedCollectionsMissing: string[];
  files: ExportFile[];
  errors: ExportError[];
  limitations: string[];
}

export const EXPORT_LIMITATIONS = [
  'Logical JSON copy, not a managed Firestore backup or export.',
  'Not an atomic point-in-time snapshot: documents written during the export may be captured before or after the change, and per-collection count checks may then report a mismatch. Freeze writes while exporting.',
  'Contains Firestore documents only: no Firebase Authentication users, IAM, indexes, security rules or Vercel configuration.',
];

/** `lessons/l1/answerKey/current` → `lessons/*\/answerKey`. */
export function collectionPattern(docPath: string): string {
  const segs = docPath.split('/');
  return segs.slice(0, -1).map((s, i) => (i % 2 === 1 ? '*' : s)).join('/');
}

/** `collections/003_lessons.ndjson`: a fixed, safe name; the real id is in the manifest. */
export function fileNameFor(index: number, collectionId: string): string {
  const safe = collectionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
  return `collections/${String(index).padStart(3, '0')}_${safe}.ndjson`;
}
const FILE_NAME = /^collections\/\d{3}_[A-Za-z0-9_-]{0,100}\.ndjson$/;

function safeMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown };
  const first = typeof e?.message === 'string' ? e.message.split('\n')[0] : 'unknown error';
  return `${e?.code !== undefined ? `${String(e.code)}: ` : ''}${first}`.slice(0, 200);
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs * 2 ** i));
    }
  }
  throw last;
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export async function exportFirestore(params: {
  source: ReadOnlyFirestore;
  dir: string;
  projectId: string;
  target: 'staging' | 'emulator';
  batchSize?: number;
  retries?: number;
  retryDelayMs?: number;
  now?: () => Date;
  /** Progress callback: counts only, never contents. */
  onProgress?: (collectionPattern: string, exported: number) => void;
}): Promise<ExportManifest> {
  const { source, dir, projectId, target } = params;
  const batchSize = Math.min(Math.max(params.batchSize ?? 200, 1), 500);
  const retries = params.retries ?? 3;
  const delay = params.retryDelayMs ?? 500;
  const now = params.now ?? (() => new Date());
  const startedAt = now().toISOString();

  // New private directory; mkdir without `recursive` fails if it already exists.
  fs.mkdirSync(dir, { mode: 0o700 });
  fs.mkdirSync(path.join(dir, 'collections'), { mode: 0o700 });

  const errors: ExportError[] = [];
  const counts: Record<string, number> = {};
  const files: Array<Omit<ExportFile, 'sha256' | 'bytes'>> = [];
  let documentCount = 0;
  let missingDocumentCount = 0;

  let roots: CollectionRef[] = [];
  try {
    roots = (await withRetry(() => source.listRootCollections(), retries, delay)).slice().sort((a, b) => a.id.localeCompare(b.id));
  } catch (err) {
    errors.push({ path: '/', stage: 'list_collections', message: safeMessage(err) });
  }

  for (const [index, root] of roots.entries()) {
    const name = fileNameFor(index, root.id);
    const fileEntry = { name, collectionId: root.id, lines: 0 };
    files.push(fileEntry);
    const fd = fs.openSync(path.join(dir, name), 'wx', 0o600);
    const writeLine = (obj: unknown) => {
      fs.writeSync(fd, `${JSON.stringify(obj)}\n`);
      fileEntry.lines += 1;
    };
    try {
      const stack: CollectionRef[] = [root];
      while (stack.length) {
        const col = stack.pop()!;
        let refs: DocRef[];
        try {
          refs = await withRetry(() => source.listDocumentRefs(col), retries, delay);
        } catch (err) {
          errors.push({ path: col.path, stage: 'list_documents', message: safeMessage(err) });
          continue;
        }
        let exportedHere = 0;
        let unreadable = false;
        for (let i = 0; i < refs.length; i += batchSize) {
          const chunk = refs.slice(i, i + batchSize);
          let snaps: DocSnapshot[] = [];
          try {
            snaps = await withRetry(() => source.getDocuments(chunk), retries, delay);
            if (snaps.length !== chunk.length) throw new Error(`expected ${chunk.length} snapshots, got ${snaps.length}`);
          } catch (err) {
            for (const ref of chunk) errors.push({ path: ref.path, stage: 'get_documents', message: safeMessage(err) });
            snaps = [];
            unreadable = true;
          }
          for (const snap of snaps) {
            if (!snap.exists) {
              writeLine({ path: snap.path, exists: false });
              missingDocumentCount += 1;
              continue;
            }
            let data: unknown;
            try {
              data = serializeValue(snap.data ?? {});
            } catch (err) {
              errors.push({ path: snap.path, stage: 'serialize', message: safeMessage(err) });
              unreadable = true;
              continue;
            }
            writeLine({ path: snap.path, exists: true, createTime: snap.createTime ?? null, updateTime: snap.updateTime ?? null, data });
            documentCount += 1;
            exportedHere += 1;
            const pattern = collectionPattern(snap.path);
            counts[pattern] = (counts[pattern] ?? 0) + 1;
            params.onProgress?.(pattern, counts[pattern]);
          }
          // Subcollections are listed for every ref, so data under missing parents is kept too.
          for (const ref of chunk) {
            try {
              stack.push(...(await withRetry(() => source.listSubcollections(ref), retries, delay)));
            } catch (err) {
              errors.push({ path: ref.path, stage: 'list_subcollections', message: safeMessage(err) });
            }
          }
        }
        // Independent completeness check: the server's own count for this collection.
        if (!unreadable) {
          try {
            const expected = await withRetry(() => source.countDocuments(col), retries, delay);
            if (expected !== exportedHere) {
              errors.push({ path: col.path, stage: 'count_mismatch', message: `server counts ${expected} document(s), exported ${exportedHere}` });
            }
          } catch (err) {
            errors.push({ path: col.path, stage: 'count', message: safeMessage(err) });
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  const rootIds = roots.map((r) => r.id);
  const manifest: ExportManifest = {
    format: EXPORT_FORMAT, formatVersion: EXPORT_FORMAT_VERSION, checksumAlgorithm: 'sha256', integerEncoding: 'bigint',
    projectId, target, startedAt, finishedAt: now().toISOString(),
    complete: errors.length === 0,
    documentCount, missingDocumentCount,
    countsByCollection: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
    rootCollections: rootIds,
    expectedCollectionsMissing: EXPECTED_ROOT_COLLECTIONS.filter((c) => !rootIds.includes(c)),
    files: files.map((f) => {
      const full = path.join(dir, f.name);
      return { ...f, sha256: sha256File(full), bytes: fs.statSync(full).size };
    }),
    errors, limitations: EXPORT_LIMITATIONS,
  };
  const manifestFile = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  // sha256sum format: "<64 hex>  manifest.json\n".
  fs.writeFileSync(path.join(dir, 'manifest.json.sha256'), `${sha256File(manifestFile)}  manifest.json\n`, { mode: 0o600, flag: 'wx' });
  return manifest;
}

// -----------------------------------------------------------------------------
// Offline verification (no Firebase, no network)
// -----------------------------------------------------------------------------
export interface VerifyResult { ok: boolean; problems: string[]; documentCount: number; complete: boolean }

const MANIFEST_SUM = /^([0-9a-f]{64}) {2}manifest\.json\n$/;

/**
 * Checks an export using only the local files. Never throws for bad input:
 * every problem is returned. Fails on a changed or reformatted checksum file,
 * a malformed manifest, unsafe or duplicate file names, missing or extra
 * files, hash, size or line mismatches, malformed records or values, records
 * outside their collection, duplicate paths, count mismatches, or a partial export.
 */
export function verifyExport(dir: string): VerifyResult {
  const problems: string[] = [];
  const fail = (p: string): VerifyResult => ({ ok: false, problems: [...problems, p], documentCount: 0, complete: false });
  let root: string;
  try {
    root = fs.realpathSync(dir);
  } catch {
    return fail('export directory not found');
  }
  const manifestFile = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return fail('manifest.json missing');
  const sumFile = path.join(root, 'manifest.json.sha256');
  if (!fs.existsSync(sumFile)) problems.push('manifest.json.sha256 missing');
  else {
    const m = MANIFEST_SUM.exec(fs.readFileSync(sumFile, 'utf8'));
    if (!m) problems.push('manifest.json.sha256 is not in "<sha256>  manifest.json" format');
    else if (m[1] !== sha256File(manifestFile)) problems.push('manifest.json hash mismatch');
  }

  let manifest: ExportManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch {
    return fail('manifest.json is not valid JSON');
  }
  if (!isPlainObject(manifest) || manifest.format !== EXPORT_FORMAT || manifest.formatVersion !== EXPORT_FORMAT_VERSION) return fail('unknown export format or version');
  if (!Array.isArray(manifest.files) || !Number.isInteger(manifest.documentCount) || !Number.isInteger(manifest.missingDocumentCount) ||
      !isPlainObject(manifest.countsByCollection) || !Array.isArray(manifest.errors) || typeof manifest.complete !== 'boolean') {
    return fail('manifest.json is missing required fields');
  }

  const listed = new Set<string>();
  const seenPaths = new Set<string>();
  const counts: Record<string, number> = {};
  let existing = 0;
  let missing = 0;
  for (const f of manifest.files as unknown[]) {
    if (!isPlainObject(f) || typeof f.name !== 'string' || typeof f.collectionId !== 'string' || typeof f.sha256 !== 'string') { problems.push('malformed file entry in manifest'); continue; }
    if (!FILE_NAME.test(f.name)) { problems.push(`unsafe file name in manifest: ${JSON.stringify(f.name).slice(0, 80)}`); continue; }
    if (listed.has(f.name)) { problems.push(`${f.name} listed twice`); continue; }
    listed.add(f.name);
    const full = path.join(root, f.name);
    if (path.relative(root, full).startsWith('..')) { problems.push(`${f.name} escapes the export directory`); continue; }
    if (!fs.existsSync(full) || !fs.lstatSync(full).isFile()) { problems.push(`${f.name} missing`); continue; }
    if (sha256File(full) !== f.sha256) problems.push(`${f.name} hash mismatch`);
    if (fs.statSync(full).size !== f.bytes) problems.push(`${f.name} size mismatch`);
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    if (lines.pop() !== '') problems.push(`${f.name} does not end with a newline`);
    if (lines.length !== f.lines) problems.push(`${f.name} line count mismatch`);
    for (const [i, line] of lines.entries()) {
      const where = `${f.name}:${i + 1}`;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line);
      } catch {
        problems.push(`${where} invalid JSON`);
        continue;
      }
      if (!isPlainObject(rec) || typeof rec.path !== 'string' || typeof rec.exists !== 'boolean') { problems.push(`${where} malformed record`); continue; }
      const segs = rec.path.split('/');
      if (segs.length % 2 !== 0 || segs.some((s) => s === '') || segs[0] !== f.collectionId) { problems.push(`${where} path outside its collection`); continue; }
      if (seenPaths.has(rec.path)) { problems.push(`${where} duplicate document`); continue; }
      seenPaths.add(rec.path);
      if (!rec.exists) { missing += 1; continue; }
      try {
        deserializeValue(rec.data, CHECK_ONLY);
      } catch (err) {
        problems.push(`${where} malformed value (${(err as Error).message})`);
        continue;
      }
      existing += 1;
      const pattern = collectionPattern(rec.path);
      counts[pattern] = (counts[pattern] ?? 0) + 1;
    }
  }
  // Every file in the directory must be accounted for.
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : [path.relative(root, p).split(path.sep).join('/')];
  });
  for (const f of walk(root)) {
    if (f !== 'manifest.json' && f !== 'manifest.json.sha256' && !listed.has(f)) problems.push(`unexpected file: ${f}`);
  }

  if (existing !== manifest.documentCount) problems.push('document count does not match the manifest');
  if (missing !== manifest.missingDocumentCount) problems.push('missing-parent count does not match the manifest');
  const sorted = (o: Record<string, unknown>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  if (sorted(counts) !== sorted(manifest.countsByCollection)) problems.push('per-collection counts do not match the manifest');
  if (!manifest.complete || manifest.errors.length) problems.push(`export is partial: ${manifest.errors.length} error(s) recorded`);
  return { ok: problems.length === 0, problems, documentCount: existing, complete: manifest.complete === true && manifest.errors.length === 0 };
}

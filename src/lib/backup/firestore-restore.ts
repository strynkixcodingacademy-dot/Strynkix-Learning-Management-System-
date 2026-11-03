/**
 * Strynkix LMS — restore a verified JSON export into a LOCAL Firestore emulator
 * (recovery rehearsal only). There is no staging or production restore mode.
 *
 * Writes go to the emulator's REST API with explicit Firestore `Value`
 * encodings rather than through the Admin SDK, for two reasons: the Admin SDK
 * writes every safe-integer JS number as an integer (so integral doubles would
 * silently change type), and no Firebase SDK means no credentials, no
 * Application Default Credentials and no metadata-server lookups at all.
 *
 * Order of operations: validate the target → verify the export (hashes,
 * manifest, every record) → decode every document into REST form → only then
 * write, in bounded atomic batches. Restoring is idempotent: every document is
 * written in full (set semantics), so a rerun after a partial restore converges
 * on the export. See docs/STAGING_READINESS.md §21.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from '@/lib/firebase/project-ids';
import { ExportManifest, ValueFactories, deserializeValue, verifyExport } from '@/lib/backup/firestore-export';

export class RestoreRefusedError extends Error {}

// -----------------------------------------------------------------------------
// Target and input guards (no network, no Firebase)
// -----------------------------------------------------------------------------
export interface RestoreTarget { projectId: string; host: string; write: boolean }

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
const CREDENTIAL_VARS = ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY'];
const PROJECT_VARS = ['FIREBASE_ADMIN_PROJECT_ID', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT'];

export function assertRestoreTarget(
  opts: { projectId?: string; write: boolean; confirmOverwrite: boolean },
  env: Record<string, string | undefined>
): RestoreTarget {
  const { projectId, write } = opts;
  if (!projectId) throw new RestoreRefusedError('--project is required.');
  if (projectId === PRODUCTION_PROJECT_ID || projectId === STAGING_PROJECT_ID) throw new RestoreRefusedError('Restore only targets a disposable demo- emulator project; staging and production are refused.');
  if (!/^demo-[a-z0-9-]{1,50}$/.test(projectId)) throw new RestoreRefusedError('--project must be a demo- emulator project id.');
  const host = env.FIRESTORE_EMULATOR_HOST ?? '';
  if (!LOCAL_HOST.test(host)) throw new RestoreRefusedError('FIRESTORE_EMULATOR_HOST must point at a local emulator (127.0.0.1, localhost or [::1]).');
  const creds = CREDENTIAL_VARS.filter((v) => env[v]);
  if (creds.length) throw new RestoreRefusedError(`Ambiguous configuration: unset ${creds.join(', ')} (a restore rehearsal uses no credentials).`);
  const other = PROJECT_VARS.filter((v) => env[v] && env[v] !== projectId);
  if (other.length) throw new RestoreRefusedError(`Ambiguous configuration: ${other.join(', ')} names a different project.`);
  if (write && !opts.confirmOverwrite) throw new RestoreRefusedError('Restoring overwrites emulator data; add --confirm-emulator-overwrite.');
  return { projectId, host, write };
}

/** The export directory must exist, be a real directory and lie outside the repository. */
export function resolveRestoreInput(from: string | undefined, repoRoot: string): string {
  if (!from) throw new RestoreRefusedError('--from <export directory> is required.');
  const abs = path.resolve(from);
  if (!fs.existsSync(abs) || !fs.lstatSync(abs).isDirectory()) throw new RestoreRefusedError('--from must be an existing export directory (not a symlink).');
  const real = fs.realpathSync(abs);
  const rel = path.relative(fs.realpathSync(repoRoot), real);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new RestoreRefusedError('--from must be outside the repository.');
  return real;
}

// -----------------------------------------------------------------------------
// Decoding to Firestore REST values
// -----------------------------------------------------------------------------
export type RestValue = Record<string, unknown>;

class Tagged { constructor(public readonly kind: string, public readonly payload: unknown) {} }
const FACTORIES: ValueFactories = {
  timestamp: (seconds, nanoseconds) => new Tagged('timestamp', { seconds, nanoseconds }),
  geopoint: (latitude, longitude) => new Tagged('geopoint', { latitude, longitude }),
  reference: (p) => new Tagged('reference', p),
  bytes: (b) => new Tagged('bytes', b.toString('base64')),
  vector: (values) => new Tagged('vector', values),
};

/** Firestore rejects these field names; refuse them before any write. */
const RESERVED_FIELD = /^__.*__$/;

/** RFC 3339 with nanoseconds, as the REST API expects. */
export function rfc3339(seconds: number, nanoseconds: number): string {
  const base = new Date(seconds * 1000).toISOString().slice(0, 19);
  return `${base}.${String(nanoseconds).padStart(9, '0')}Z`;
}

interface EncodeCtx { projectId: string; negativeZeros: number }

function doubleValue(n: number, ctx: EncodeCtx): RestValue {
  if (Number.isNaN(n)) return { doubleValue: 'NaN' };
  if (n === Infinity) return { doubleValue: 'Infinity' };
  if (n === -Infinity) return { doubleValue: '-Infinity' };
  // JSON has no negative zero; the emulator's REST path stores it as +0.
  if (Object.is(n, -0)) ctx.negativeZeros += 1;
  return { doubleValue: n };
}

export function toRestValue(v: unknown, ctx: EncodeCtx): RestValue {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'bigint') return { integerValue: v.toString() };
  if (typeof v === 'number') return doubleValue(v, ctx);
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map((x) => toRestValue(x, ctx)) } : {} };
  if (v instanceof Tagged) {
    switch (v.kind) {
      case 'timestamp': { const t = v.payload as { seconds: number; nanoseconds: number }; return { timestampValue: rfc3339(t.seconds, t.nanoseconds) }; }
      case 'geopoint': return { geoPointValue: v.payload };
      case 'reference': return { referenceValue: `projects/${ctx.projectId}/databases/(default)/documents/${v.payload as string}` };
      case 'bytes': return { bytesValue: v.payload };
      case 'vector': return {
        mapValue: { fields: { __type__: { stringValue: '__vector__' }, value: { arrayValue: { values: (v.payload as number[]).map((n) => doubleValue(n, ctx)) } } } },
      };
    }
  }
  if (typeof v === 'object') return { mapValue: { fields: toRestFields(v as Record<string, unknown>, ctx) } };
  throw new RestoreRefusedError(`cannot encode value of type ${typeof v}`);
}

function toRestFields(o: Record<string, unknown>, ctx: EncodeCtx): Record<string, RestValue> {
  const out: Record<string, RestValue> = {};
  for (const [k, val] of Object.entries(o)) {
    if (RESERVED_FIELD.test(k)) throw new RestoreRefusedError(`reserved field name ${JSON.stringify(k).slice(0, 60)}`);
    out[k] = toRestValue(val, ctx);
  }
  return out;
}

export interface RestWrite { update: { name: string; fields: Record<string, RestValue> } }

// -----------------------------------------------------------------------------
// Plan and restore
// -----------------------------------------------------------------------------
export interface RestorePlan {
  manifest: ExportManifest;
  documents: number;
  missingParents: number;
  negativeZeros: number;
}

interface Record_ { path: string; exists: boolean; data?: unknown }

function* records(dir: string, manifest: ExportManifest): Generator<{ rec: Record_; where: string }> {
  for (const f of manifest.files) {
    const lines = fs.readFileSync(path.join(dir, f.name), 'utf8').split('\n').filter(Boolean);
    for (const [i, line] of lines.entries()) yield { rec: JSON.parse(line) as Record_, where: `${f.name}:${i + 1}` };
  }
}

function encodeDocument(rec: Record_, ctx: EncodeCtx): RestWrite {
  const decoded = deserializeValue(rec.data, FACTORIES);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || decoded instanceof Tagged) throw new RestoreRefusedError('document data is not a map');
  return { update: { name: `projects/${ctx.projectId}/databases/(default)/documents/${rec.path}`, fields: toRestFields(decoded as Record<string, unknown>, ctx) } };
}

/**
 * Validates everything a restore would write, without writing: the export must
 * verify cleanly (complete, untampered) and every document must decode and
 * encode. Throws RestoreRefusedError listing the first problems otherwise.
 */
export function planRestore(dir: string, projectId: string): RestorePlan {
  const v = verifyExport(dir);
  if (!v.ok) throw new RestoreRefusedError(`Export failed verification: ${v.problems.slice(0, 5).join('; ')}${v.problems.length > 5 ? ` (+${v.problems.length - 5} more)` : ''}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as ExportManifest;
  if (manifest.integerEncoding !== 'bigint') throw new RestoreRefusedError('Unsupported export: integers were not exported exactly (integerEncoding must be "bigint").');
  const ctx: EncodeCtx = { projectId, negativeZeros: 0 };
  let documents = 0;
  let missingParents = 0;
  const problems: string[] = [];
  for (const { rec, where } of records(dir, manifest)) {
    if (!rec.exists) { missingParents += 1; continue; }
    try {
      encodeDocument(rec, ctx);
      documents += 1;
    } catch (err) {
      problems.push(`${where}: ${(err as Error).message}`);
    }
  }
  if (problems.length) throw new RestoreRefusedError(`Export contains values this restore cannot write exactly: ${problems.slice(0, 5).join('; ')}`);
  return { manifest, documents, missingParents, negativeZeros: ctx.negativeZeros };
}

export interface RestoreResult {
  complete: boolean;
  documentsPlanned: number;
  documentsRestored: number;
  batchesCommitted: number;
  failure?: { batch: number; firstPath: string; lastPath: string; message: string };
}

/**
 * Restores a verified export. Writes nothing unless planRestore succeeds (and
 * negative zeros, which the emulator's REST path cannot store, were accepted).
 * Each batch is one atomic commit; on the first failed batch it stops and
 * reports which documents were not written. Rerunning is safe.
 */
export async function restoreExport(params: {
  dir: string;
  projectId: string;
  commit: (writes: RestWrite[]) => Promise<void>;
  /** Optional: wipe the emulator project first, for an exact copy of the export. */
  clear?: () => Promise<void>;
  batchSize?: number;
  acceptNegativeZeroAsZero?: boolean;
  onProgress?: (restored: number, total: number) => void;
}): Promise<RestoreResult> {
  const { dir, projectId } = params;
  const batchSize = Math.min(Math.max(params.batchSize ?? 200, 1), 500);
  const plan = planRestore(dir, projectId);
  if (plan.negativeZeros > 0 && !params.acceptNegativeZeroAsZero) {
    throw new RestoreRefusedError(`Export contains ${plan.negativeZeros} negative-zero double(s), which the emulator REST API stores as +0. Re-run with --accept-negative-zero-as-zero to accept that.`);
  }
  if (params.clear) await params.clear();

  const ctx: EncodeCtx = { projectId, negativeZeros: 0 };
  const result: RestoreResult = { complete: false, documentsPlanned: plan.documents, documentsRestored: 0, batchesCommitted: 0 };
  let batch: { write: RestWrite; path: string }[] = [];
  const flush = async (): Promise<boolean> => {
    if (!batch.length) return true;
    try {
      await params.commit(batch.map((b) => b.write));
    } catch (err) {
      const e = err as Error;
      result.failure = { batch: result.batchesCommitted + 1, firstPath: batch[0].path, lastPath: batch[batch.length - 1].path, message: (e.message ?? 'commit failed').split('\n')[0].slice(0, 200) };
      return false;
    }
    result.batchesCommitted += 1;
    result.documentsRestored += batch.length;
    params.onProgress?.(result.documentsRestored, plan.documents);
    batch = [];
    return true;
  };
  for (const { rec } of records(dir, plan.manifest)) {
    if (!rec.exists) continue; // a missing parent has no fields; its subcollections are written on their own
    batch.push({ write: encodeDocument(rec, ctx), path: rec.path });
    if (batch.length >= batchSize && !(await flush())) return result;
  }
  if (!(await flush())) return result;
  result.complete = result.documentsRestored === plan.documents;
  return result;
}

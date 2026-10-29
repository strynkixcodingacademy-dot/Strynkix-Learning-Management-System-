/**
 * Strynkix LMS — restore a verified JSON export into a LOCAL Firestore emulator
 * (recovery rehearsal only; there is no staging or production mode).
 *
 *   plan (default)   verify the export and check every document can be written; no network.
 *   --restore --confirm-emulator-overwrite [--clear-first]   write it to the emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run backup:firestore-restore -- --from <export dir> --project demo-<name>
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run backup:firestore-restore -- --from <export dir> --project demo-<name> --restore --confirm-emulator-overwrite [--clear-first]
 *
 * Talks only to http://$FIRESTORE_EMULATOR_HOST (validated to be local) using
 * the emulator's "owner" token. No Firebase SDK, credentials or metadata server.
 * Output is counts and document paths of a failed batch only — never contents.
 */

import * as path from 'node:path';
import { RestoreRefusedError, RestWrite, assertRestoreTarget, planRestore, resolveRestoreInput, restoreExport } from '../../src/lib/backup/firestore-restore';

const REPO_ROOT = path.resolve(__dirname, '../..');
const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const hasFlag = (flag: string) => process.argv.includes(flag);

async function emulatorRequest(host: string, method: 'GET' | 'POST' | 'DELETE', urlPath: string, body?: unknown): Promise<string> {
  const res = await fetch(`http://${host}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message += `: ${JSON.parse(text).error?.message ?? ''}`; } catch { /* non-JSON error body */ }
    throw new Error(message);
  }
  return text;
}

async function main() {
  const target = assertRestoreTarget({ projectId: argValue('--project'), write: hasFlag('--restore'), confirmOverwrite: hasFlag('--confirm-emulator-overwrite') }, process.env);
  const dir = resolveRestoreInput(argValue('--from'), REPO_ROOT);
  const batchSize = Number(argValue('--batch-size') ?? 200);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new RestoreRefusedError('--batch-size must be an integer from 1 to 500.');

  console.log('================================================================');
  console.log(`  Firestore restore rehearsal — ${target.write ? 'RESTORE' : 'PLAN (nothing written)'} (emulator ${target.host}: ${target.projectId})`);
  console.log('================================================================');
  const plan = planRestore(dir, target.projectId);
  console.log(`Export verified: ${plan.documents} document(s), ${plan.missingParents} missing parent(s), source project ${plan.manifest.projectId}`);
  if (plan.negativeZeros) console.log(`  Negative-zero doubles: ${plan.negativeZeros} (stored as +0 by the emulator REST API)`);
  if (target.write && plan.negativeZeros && !hasFlag('--accept-negative-zero-as-zero')) {
    // Refuse before any request, not only before writes.
    throw new RestoreRefusedError(`Export contains ${plan.negativeZeros} negative-zero double(s), which the emulator REST API stores as +0. Re-run with --accept-negative-zero-as-zero to accept that.`);
  }
  if (!target.write) {
    console.log('Re-run with --restore --confirm-emulator-overwrite [--clear-first] to write. No network request was made.');
    return;
  }

  const base = `/v1/projects/${target.projectId}/databases/(default)/documents`;
  // Make sure an emulator (not some other local service) is answering before any write.
  if ((await emulatorRequest(target.host, 'GET', '/')).trim() !== 'Ok') throw new RestoreRefusedError('The host did not answer like a Firestore emulator.');
  const result = await restoreExport({
    dir, projectId: target.projectId, batchSize, acceptNegativeZeroAsZero: hasFlag('--accept-negative-zero-as-zero'),
    commit: async (writes: RestWrite[]) => { await emulatorRequest(target.host, 'POST', `${base}:commit`, { writes }); },
    clear: hasFlag('--clear-first') ? async () => { await emulatorRequest(target.host, 'DELETE', `/emulator/v1/projects/${target.projectId}/databases/(default)/documents`); } : undefined,
    onProgress: (n, total) => { if (n === total || n % 1000 === 0) console.log(`  restored ${n}/${total}`); },
  });
  console.log(`Restored ${result.documentsRestored}/${result.documentsPlanned} document(s) in ${result.batchesCommitted} batch(es).`);
  if (result.failure) {
    console.log(`Restore INCOMPLETE: batch ${result.failure.batch} (${result.failure.firstPath} … ${result.failure.lastPath}) failed: ${result.failure.message}`);
    console.log('Earlier batches were written; that batch and everything after it were not. Fix the cause and re-run (writes are idempotent).');
    process.exitCode = 2;
    return;
  }
  console.log(result.complete ? 'Restore COMPLETE.' : 'Restore INCOMPLETE.');
  if (!result.complete) process.exitCode = 2;
}

main().catch((err) => {
  console.error(`Restore aborted: ${err instanceof Error ? err.message.split('\n')[0] : 'unknown error'}`);
  process.exit(1);
});

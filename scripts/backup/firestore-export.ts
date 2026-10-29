/**
 * Strynkix LMS — read-only Firestore JSON export CLI (no billing needed).
 *
 * Modes:
 *   plan (default)   validate flags and print what would happen; no Firebase client, no reads.
 *   --export         read every collection and subcollection into a new private directory.
 *   --verify <dir>   check an export offline (hashes, line counts, record shape); no Firebase.
 *
 *   npm run backup:firestore-export -- --target staging --project strynkix-live-books-staging --out <dir outside repo>
 *   npm run backup:firestore-export -- --target staging --project strynkix-live-books-staging --out <dir> --export --confirm-staging-read
 *   npm run backup:firestore-export -- --verify <export dir>
 *
 * The production project is refused before any Firebase module is loaded.
 * Console output is counts, collection patterns and error codes only — never
 * document contents, answers, student data or credentials.
 */

import * as path from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { pinAdminEnvironment } from '../../src/lib/server/admin-env';
import { ReadOnlyFirestore, assertExportTarget, exportFirestore, resolveExportDir, verifyExport } from '../../src/lib/backup/firestore-export';

const REPO_ROOT = path.resolve(__dirname, '../..');
const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const hasFlag = (flag: string) => process.argv.includes(flag);

/** The only Firestore access the exporter gets: five reads, no writes. */
function readOnly(db: Firestore): ReadOnlyFirestore {
  const iso = (t: { toDate(): Date } | undefined) => (t ? t.toDate().toISOString() : undefined);
  return {
    // With useBigInt the aggregate count is a bigint too.
    countDocuments: async (col) => Number((await db.collection(col.path).count().get()).data().count),
    listRootCollections: async () => (await db.listCollections()).map((c) => ({ id: c.id, path: c.path })),
    listDocumentRefs: async (col) => (await db.collection(col.path).listDocuments()).map((r) => ({ id: r.id, path: r.path })),
    getDocuments: async (refs) => (await db.getAll(...refs.map((r) => db.doc(r.path)))).map((s) => ({
      path: s.ref.path, exists: s.exists, data: s.exists ? s.data() : undefined, createTime: iso(s.createTime), updateTime: iso(s.updateTime),
    })),
    listSubcollections: async (d) => (await db.doc(d.path).listCollections()).map((c) => ({ id: c.id, path: c.path })),
  };
}

async function main() {
  const verifyDir = argValue('--verify');
  if (verifyDir) {
    const r = verifyExport(path.resolve(verifyDir));
    console.log(`Verify: ${r.ok ? 'OK' : 'PROBLEMS FOUND'} — ${r.documentCount} document(s), ${r.complete ? 'complete' : 'partial'} export`);
    for (const p of r.problems) console.log(`  - ${p}`);
    process.exitCode = r.ok ? 0 : 2;
    return;
  }

  const opts = assertExportTarget({
    target: argValue('--target'), projectId: argValue('--project'),
    execute: hasFlag('--export'), confirmStagingRead: hasFlag('--confirm-staging-read'),
  }, process.env);
  const dir = resolveExportDir({ out: argValue('--out'), repoRoot: REPO_ROOT, projectId: opts.projectId, now: new Date() });
  const batchSize = Number(argValue('--batch-size') ?? 200);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('--batch-size must be an integer from 1 to 500.');

  console.log('================================================================');
  console.log(`  Firestore JSON export — ${opts.execute ? 'EXPORT (read-only)' : 'PLAN (nothing read)'} (${opts.target}: ${opts.projectId})`);
  console.log('================================================================');
  console.log(`Output directory (created new, mode 700): ${dir}`);
  if (!opts.execute) {
    console.log('Would read: every root collection and nested subcollection, batches of ' + batchSize + ' documents.');
    console.log(`Re-run with --export${opts.target === 'staging' ? ' --confirm-staging-read' : ''} to export. No Firebase client was created.`);
    return;
  }

  // Pin the environment before Firebase loads (src/lib/server/admin-env.ts).
  pinAdminEnvironment(opts.target, opts.projectId);

  // Firebase is loaded only now, after every guard has passed.
  const { getAdminServices } = await import('../../src/lib/server/firebase-admin');
  const { db } = getAdminServices();
  // Integers arrive as BigInt, so 64-bit values are exact and never confused with doubles.
  db.settings({ useBigInt: true });

  let last = '';
  const manifest = await exportFirestore({
    source: readOnly(db), dir, projectId: opts.projectId, target: opts.target, batchSize,
    onProgress: (pattern, n) => {
      if (pattern !== last || n % 500 === 0) console.log(`  ${pattern}: ${n}`);
      last = pattern;
    },
  });
  console.log(`Documents: ${manifest.documentCount}   Missing parents: ${manifest.missingDocumentCount}   Errors: ${manifest.errors.length}`);
  for (const [pattern, n] of Object.entries(manifest.countsByCollection)) console.log(`  ${pattern.padEnd(40)} ${n}`);
  if (manifest.expectedCollectionsMissing.length) console.log(`  Expected collections not found (empty?): ${manifest.expectedCollectionsMissing.join(', ')}`);
  for (const e of manifest.errors.slice(0, 20)) console.log(`  ERROR ${e.stage} ${e.path.split('/').map((s, i) => (i % 2 ? '*' : s)).join('/')}: ${e.message}`);
  console.log(manifest.complete ? 'Export COMPLETE. Verify offline with --verify <dir>.' : 'Export PARTIAL — do not rely on it; see manifest.json errors.');
  if (!manifest.complete) process.exitCode = 2;
}

main().catch((err) => {
  console.error(`Export aborted: ${err instanceof Error ? err.message.split('\n')[0] : 'unknown error'}`);
  process.exit(1);
});

/**
 * Strynkix LMS — Stage C4 legacy quiz migration CLI (dry-run by default).
 *
 * Usage (local emulator; the project must be named explicitly and is never the production project):
 *   firebase emulators:exec --project demo-strynkix-lms --only firestore \
 *     "tsx scripts/migration/quiz-key-migration.ts --target emulator --project demo-strynkix-lms [--apply] [--report out.json]"
 *
 * Staging is reserved for an approved run (docs/STAGING_READINESS.md §16):
 *   tsx scripts/migration/quiz-key-migration.ts --target staging --project strynkix-live-books-staging [--apply --confirm-staging-write]
 *
 * Output and reports contain lesson ids, formats and reason codes only — never answers, explanations or credentials.
 */

import * as fs from 'node:fs';
import { assertMigrationTarget, summarizeQuizMigration } from '../../src/lib/migration/quiz-key-migration';
import { applyQuizKeyMigration, loadQuizInventory } from '../../src/lib/migration/apply-quiz-key-migration';
import { getAdminServices } from '../../src/lib/server/firebase-admin';
import { pinAdminEnvironment } from '../../src/lib/server/admin-env';

const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const hasFlag = (flag: string) => process.argv.includes(flag);

async function main() {
  const target = assertMigrationTarget({
    target: argValue('--target'), projectId: argValue('--project'),
    apply: hasFlag('--apply'), confirmStagingWrite: hasFlag('--confirm-staging-write'),
  }, process.env);
  const reportPath = argValue('--report');
  const runId = argValue('--run-id') || `c4_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;

  // No metadata-server probing, no ambient credentials, project pinned (src/lib/server/admin-env.ts).
  pinAdminEnvironment(target.target, target.projectId);
  const { db } = getAdminServices();

  console.log('================================================================');
  console.log(`  Stage C4 legacy quiz migration — ${target.apply ? 'APPLY' : 'DRY RUN'} (${target.target}: ${target.projectId})`);
  console.log('================================================================');

  const before = await loadQuizInventory(db);
  const summary = summarizeQuizMigration(before.decisions);
  console.log(`Lessons scanned: ${summary.lessons}`);
  for (const [format, n] of Object.entries(summary.byFormat)) console.log(`  ${format.padEnd(20)} ${n}`);
  console.log(`To migrate: ${summary.toMigrate}   Manual remediation: ${summary.manual.length}`);
  for (const m of summary.manual) console.log(`  MANUAL ${m.lessonId}: ${m.format} [${m.issues.join(', ')}]`);
  if (summary.approvalsInvalidated.length) console.log(`  Approvals to renew after migration: ${summary.approvalsInvalidated.join(', ')}`);
  if (before.revisionsWithAnswers.length) console.log(`  Revisions still carrying answers (manual): ${before.revisionsWithAnswers.length}`);
  if (before.versionsWithAnswers.length) console.log(`  Published versions carrying answers (staff-only history, unchanged): ${before.versionsWithAnswers.length}`);

  const report: Record<string, unknown> = {
    runId, target: target.target, projectId: target.projectId, mode: target.apply ? 'apply' : 'dry-run', summary,
    planned: before.decisions.filter((d) => d.action === 'migrate').map((d) => ({ lessonId: d.lessonId, format: d.format, questionCount: d.questionCount, keyVersion: d.plan!.keyVersion, writeKey: d.plan!.writeKey })),
    revisionsWithAnswers: before.revisionsWithAnswers, versionsWithAnswers: before.versionsWithAnswers,
  };

  if (target.apply) {
    const result = await applyQuizKeyMigration(db, before.decisions.filter((d) => d.action === 'migrate').map((d) => d.lessonId), runId);
    console.log(`Migrated: ${result.migrated.length}   Skipped: ${result.skipped.length}   Failed: ${result.failed.length}`);
    for (const f of result.failed) console.log(`  FAILED ${f.lessonId}: ${f.error}`);
    const after = summarizeQuizMigration((await loadQuizInventory(db)).decisions);
    console.log(`Post-check: ${after.toMigrate} lesson(s) still to migrate, ${after.manual.length} for manual remediation.`);
    report.result = result;
    report.postCheck = after;
    if (result.failed.length) process.exitCode = 1;
  } else {
    console.log('Dry run: nothing was written. Re-run with --apply to migrate.');
  }
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(`Migration aborted: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exit(1);
});

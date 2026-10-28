/**
 * Strynkix LMS — Stage 6 Enrollment Migration CLI (dry-run by default)
 *
 * Usage:
 *   tsx scripts/migration/enrollment-migration.ts --input snapshot.json [--decisions d.json] [--report out.json]
 *   tsx scripts/migration/enrollment-migration.ts --emulator [--decisions d.json] [--report out.json] [--apply]
 *
 * --input     Read an ID-level snapshot JSON (see docs/ENROLLMENT_MIGRATION.md).
 * --emulator  Read from the local Firestore emulator (FIRESTORE_EMULATOR_HOST must be localhost).
 * --apply     Write the plan. Allowed ONLY with --emulator. There is no production write path.
 * --report    Write the full plan (document IDs only) to this file.
 *
 * Console output is aggregate counts and reason codes only: no names, emails or credentials.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Firestore } from 'firebase/firestore';
import {
  ManualDecision,
  MigrationSnapshot,
  planEnrollmentMigration,
} from '../../src/lib/migration/enrollment-migration';
import { applyEnrollmentMigration } from '../../src/lib/migration/apply-enrollment-migration';
import { loadMigrationSnapshot } from '../../src/lib/migration/load-snapshot';

const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'learning-management-syst-b9bf3';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (flag: string) => process.argv.includes(flag);

async function main() {
  const inputPath = argValue('--input');
  const useEmulator = hasFlag('--emulator');
  const apply = hasFlag('--apply');
  const decisionsPath = argValue('--decisions');
  const reportPath = argValue('--report');
  const runId = argValue('--run-id') || `stage6_migration_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;

  if (Boolean(inputPath) === useEmulator) throw new Error('Specify exactly one of --input <file> or --emulator.');
  if (apply && !useEmulator) throw new Error('--apply is only permitted with --emulator. There is no production write path.');

  const decisions: ManualDecision[] = decisionsPath ? JSON.parse(fs.readFileSync(decisionsPath, 'utf8')) : [];

  console.log('================================================================');
  console.log(`  Stage 6 Enrollment Migration — ${apply ? 'APPLY (emulator)' : 'DRY RUN'}`);
  console.log('================================================================');

  let snapshot: MigrationSnapshot;
  let testEnv: Awaited<ReturnType<typeof initializeTestEnvironment>> | null = null;

  if (inputPath) {
    snapshot = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    console.log(`Source: snapshot file ${path.basename(inputPath)}`);
  } else {
    const [host, port] = FIRESTORE_HOST.split(':');
    if (!['127.0.0.1', 'localhost'].includes(host)) {
      throw new Error(`Refusing to run: Firestore emulator host must be local (got ${FIRESTORE_HOST}).`);
    }
    testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host, port: parseInt(port, 10) } });
    snapshot = await new Promise<MigrationSnapshot>((resolve, reject) => {
      testEnv!.withSecurityRulesDisabled(async (ctx) => {
        resolve(await loadMigrationSnapshot(ctx.firestore() as unknown as Firestore));
      }).catch(reject);
    });
    console.log(`Source: local Firestore emulator (${FIRESTORE_HOST})`);
  }

  try {
    const plan = planEnrollmentMigration(snapshot, decisions);
    const s = plan.summary;
    console.log(`\nStudents: ${s.students}   Manual decisions supplied: ${decisions.length}`);
    console.log('\nMigratable');
    console.log(`  Enrollments to create (canonical ID):  ${s.enrollmentsToCreate}`);
    console.log(`  Legacy enrollments to archive:         ${s.legacyEnrollmentsToArchive}`);
    console.log(`  Progress records to tag with batchId:  ${s.progressToRetag}`);
    console.log(`  Already migrated (canonical, valid):   ${s.alreadyMigrated}`);
    console.log('\nNot migrated automatically');
    console.log(`  Needs manual review:                   ${s.manualReview}`);
    console.log(`  Ambiguous:                             ${s.ambiguous}`);
    console.log(`  Active students with no evidence:      ${s.studentsWithoutEvidence}`);
    console.log(`  Profile issues:                        ${s.profileIssues}`);
    const reasons = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]);
    if (reasons.length) {
      console.log('\nReason codes');
      for (const [reason, count] of reasons) console.log(`  ${reason.padEnd(48)} ${count}`);
    }
    const warnings = plan.actions.flatMap((a) => (a.type === 'create_enrollment' ? a.warnings : []));
    if (warnings.length) console.log(`\nWarnings on planned enrollments: ${warnings.length} (see report)`);

    if (reportPath) {
      fs.writeFileSync(reportPath, JSON.stringify({ runId, generatedAt: new Date().toISOString(), plan }, null, 2));
      console.log(`\nFull plan (IDs only) written to ${reportPath}`);
    }

    if (apply && testEnv) {
      const results = await new Promise<Awaited<ReturnType<typeof applyEnrollmentMigration>>>((resolve, reject) => {
        testEnv!.withSecurityRulesDisabled(async (ctx) => {
          resolve(await applyEnrollmentMigration(ctx.firestore() as unknown as Firestore, plan, runId));
        }).catch(reject);
      });
      const outcomes: Record<string, number> = {};
      for (const r of results) outcomes[`${r.action}:${r.outcome}`] = (outcomes[`${r.action}:${r.outcome}`] ?? 0) + 1;
      console.log(`\nApplied run ${runId} (audit: migrationAudit/${runId})`);
      for (const [k, v] of Object.entries(outcomes)) console.log(`  ${k.padEnd(48)} ${v}`);
      if (results.some((r) => r.outcome === 'conflict')) process.exitCode = 2;
    } else {
      console.log('\nDry run only: no data was written.');
    }
  } finally {
    if (testEnv) await testEnv.cleanup();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Migration tool failed:', (err as Error).message);
    process.exit(1);
  });
}

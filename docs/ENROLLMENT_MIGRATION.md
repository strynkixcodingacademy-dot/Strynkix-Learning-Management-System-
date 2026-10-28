# Stage 6 Enrollment Migration & Rules Cutover Runbook

> Status: **designed and tested locally only.** Nothing in this document has been run against production. Every production step below needs explicit approval.

## 1. Why a migration is needed

Stage 6 rules give students course access only through an enrollment stored at `/enrollments/{courseId}_{studentId}` with status `active` or `completed`. Under the pre-Stage 6 rules, any active student could read every published course in their organization. Deploying the Stage 6 rules without enrollments therefore **removes course access for every existing student**.

The Stage 6 web app also gates students in the UI: the catalog lists only enrolled courses, and lesson pages require an enrollment. Deploying the app is a cutover for students even before the rules change.

## 2. What the data can and cannot tell us

| Evidence in production | Reliable mapping? | Tool behaviour |
| :--- | :--- | :--- |
| Enrollment with canonical ID, valid relationships | Yes | Counted as already migrated |
| Enrollment with any other ID (legacy), one batch, valid relationships | Yes | Migrated to canonical ID; legacy record archived |
| Legacy enrollment without `courseId` but with a valid `batchId` | Yes (a batch defines its course) | Migrated |
| Legacy enrollments in two or more batches of the same course | No | `ambiguous` |
| Legacy enrollment whose batch, course, org, branch or student does not validate | No | `manualReview` with a reason code |
| Progress records but no enrollment | Course yes, **batch no** | Always `manualReview`, listing candidate batches. Never auto-enrolled, even with one candidate |
| Active student with no enrollment and no progress | Nothing to map | `studentsWithoutEvidence` |

**Expected production reality (assumption, unverified):** the pre-Stage 6 code had no UI or service that created batches or enrollments, and the emulator seed created none. Production most likely has **no batches and no enrollments**. In that case the tool will migrate nothing automatically. Every student will be either "progress without enrollment" or "no evidence", and humans must decide batch assignment.

**This is a product decision the tool cannot make:** which batches to create, and which students belong in each.

## 3. The tool

- Planner: `src/lib/migration/enrollment-migration.ts` (pure, unit-tested).
- Applier: `src/lib/migration/apply-enrollment-migration.ts` (one transaction per action, idempotent, writes `/migrationAudit/{runId}`).
- CLI: `npm run migration:enrollments -- <options>`

```
# Dry run from an ID-level snapshot file (no Firestore access)
npm run migration:enrollments -- --input snapshot.json --report plan.json

# Dry run / apply against the LOCAL emulator only
npm run migration:enrollments -- --emulator [--decisions decisions.json] [--report plan.json] [--apply]
```

`--apply` is refused unless `--emulator` is used and `FIRESTORE_EMULATOR_HOST` is localhost. **There is no production write path in this repository.**

### Snapshot format (`--input`)
```json
{
  "users":       [{ "id": "", "role": "", "orgId": "", "branchId": "", "status": "" }],
  "branches":    [{ "id": "", "orgId": "" }],
  "courses":     [{ "id": "", "orgId": "", "status": "" }],
  "batches":     [{ "id": "", "orgId": "", "branchId": "", "courseId": "", "status": "" }],
  "enrollments": [{ "id": "", "orgId": "", "branchId": "", "courseId": "", "batchId": "", "studentId": "", "status": "", "enrolledAt": "", "completedAt": "" }],
  "progress":    [{ "id": "", "orgId": "", "studentId": "", "courseId": "", "batchId": "" }]
}
```
The snapshot holds IDs and relationship fields only. Do not include names, emails, or credentials. `tests/fixtures/migration/sample-snapshot.json` covers every classification path.

### Manual decisions (`--decisions`)
```json
[{ "studentId": "", "courseId": "", "batchId": "", "decidedBy": "<approver uid>", "note": "optional" }]
```
Every decision is re-validated exactly like a legacy enrollment: the batch must exist, match the course and org, and the student must be an active student in the batch's branch. A decision without `decidedBy`, a duplicate decision, or one that contradicts an existing enrollment is rejected and reported.

### Idempotency and safety guarantees (tested on the emulator)
- `create_enrollment` skips if the canonical record already exists with the same batch, and reports a conflict if it exists with a different batch. It never overwrites.
- `archive_legacy_enrollment` copies the record to `/enrollmentLegacyArchive/{id}` and deletes it, only if the canonical record exists. Otherwise it reports a conflict and keeps the legacy record.
- `retag_progress` sets `batchId` only where it is absent, and reports a conflict if it is set to a different batch.
- A re-run of the dry run after apply plans zero actions. Re-applying an old plan skips every action.
- `/migrationAudit` and `/enrollmentLegacyArchive` fall under the default-deny rule (clients cannot read them).
- Console output and reports contain document IDs and reason codes only.

## 4. Order of operations for a future approved cutover

**Before the window**
1. **Product decisions** (see the Stage 6.1 report): which batches exist; whether active enrollments in archived batches keep access; who may edit courses.
2. **Get a production snapshot, read-only.** Options:
   - (a) A read-only Admin SDK script run locally with a service account holding only `roles/datastore.viewer`. Not written yet; needs approval and a credential.
   - (b) Firestore managed export. **Requires the Blaze plan.**
   - (c) At pilot scale (a handful of users), transcribe IDs manually from the Firebase console.
3. **Dry run** on the snapshot: `--input snapshot.json --report plan.json`. Review every `manualReview`, `ambiguous`, `studentsWithoutEvidence` and `profileIssues` entry.
4. **Audit `profileIssues` and unexpected students.** The pre-Stage 6 rules let anyone self-register as an *active* student in any org. Any student you cannot account for should be suspended, not enrolled.
5. **Write `decisions.json`** for every student who should have access, with an approver in `decidedBy`.
6. **Rehearse on the emulator:** load the snapshot plus the batches you will create, then run with `--emulator --decisions decisions.json --apply`. Run it twice: the second run must report only `skipped_already_done`. Then run the full test suite.

**In the maintenance window**
7. Deploy the Stage 6 web app (Vercel) while the **old** rules are still live. *Assumption to verify in rehearsal:* the Stage 6 client works under the old, more permissive rules. Students without an enrollment lose course access in the UI from this point.
8. Create the agreed batches, then create enrollments:
   - Pilot scale: use `/dashboard/batches/{batchId}` → *Enroll a Student*. This is validated by the client service and accepted by the old rules.
   - Larger scale: an approved Admin SDK port of the applier (not in this repo).
9. Run the dry run again against fresh data. `studentsWithoutEvidence` must contain only students you intentionally left out, and `enrollmentsToCreate` must be 0.
10. Deploy `firestore.rules`.
11. Smoke test with one account per role: student opens course and completes a lesson; instructor sees roster and progress; branch admin enrolls and withdraws.

**Rollback**
- Rules: republish the previous ruleset from the Firebase console (Firestore → Rules → history).
- App: Vercel instant rollback to the previous deployment.
- Enrollment documents are additive and harmless under the old rules. Legacy enrollments archived by the tool can be restored from `/enrollmentLegacyArchive`.

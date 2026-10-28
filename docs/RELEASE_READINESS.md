# Release Readiness — Phase 8

Status: **superseded by `STAGING_READINESS.md` (Phase 8.1): READY FOR STAGING PREPARATION.** There is no separate staging Firebase project yet. Verified locally against Firebase emulators only. Nothing has been committed, deployed or migrated.

This document covers the security findings, the product decisions the owner must make, and the release checklist. Day-to-day architecture is in `ARCHITECTURE.md`. The migration procedure is in `ENROLLMENT_MIGRATION.md`, and server-side options are in `SERVER_SIDE_OPERATIONS.md`.

---

## 1. Two rule sets, one deploy hazard

| File | Contents | Deployable when |
|---|---|---|
| `firestore.rules` (working tree) | Stage 6–7 rules: enrollment-gated content, batches, plans, submissions, grading | **Only after** the enrollment migration has run (students without an enrollment lose content access) |
| `firestore.hotfix.rules` | Committed rules (`799e596`) plus two fixes only | Now, independently of the migration |

If production is running the committed rules, it is exposed to the two issues fixed by the hotfix (S1, S2 below). Deploy the hotfix first, then run the migration, then deploy the full rules.

The hotfix is verified by `tests/rules/hotfix.rules.test.ts`. Against the committed rules, both security tests fail, which shows the holes are real and the tests detect them. Against the hotfix rules, all 5 tests pass.

## 2. Security findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| S1 | **Critical** (committed rules) | Cross-tenant overwrite. An instructor or admin of org B can overwrite a module, lesson or assignment owned by org A by writing `orgId: 'org_b'`. Rules only checked the incoming `orgId`, never the stored one. | Fixed in `firestore.rules` and `firestore.hotfix.rules`. Not deployed. |
| S2 | **High** (committed rules) | Self-signup could create an `active` student, which skips verification. | Fixed in both rule files (must be `student` + `pending_verification`). Not deployed. |
| S3 | High | Batch capacity is not atomic. Two concurrent enrollments both succeed past `maxStudents` (proven by the "known gap" test in `tests/rules/phase8-release-audit.rules.test.ts`). | Open — needs owner decision D2. |
| S4 | Medium | No security headers. | Fixed: `next.config.ts` sends frame-ancestors/X-Frame-Options, nosniff, referrer policy, permissions policy and HSTS, and drops `X-Powered-By`. A full script CSP is deferred (needs nonces and staging tests). |
| S5 | Medium | Lesson studio saved blocks without schema validation, so malformed content could reach students. | Fixed: every block is validated against `lessonBlockSchema` before saving. |
| S6 | Low | Password reset did not exist; it now never reveals whether an account exists. | Fixed (`/login` → "Forgot password?"). |
| S8 | Medium | A `branch_admin` profile with no `branchId` matched all unscoped users in its org (it could read staff profiles and mint unscoped instructors). | Fixed in `firestore.rules` (Phase 8.1, `isScopedBranchAdminRole()`). Not in the hotfix; see `STAGING_READINESS.md` §2. |
| S7 | Low | Restricted admin pages ran their Firestore queries for unauthorised roles. Rules denied them (no data exposed), but the console filled with errors. | Fixed: the organizations and courses pages skip the query for roles that can't use it. |

Audited with no defect found:
- tenant isolation for every collection;
- instructor reassignment and removal (access is lost immediately);
- suspended and pending accounts;
- profile privacy;
- forged progress or submissions for another student;
- branch-admin scoping;
- archived plans hidden from students;
- XSS sinks (none use `dangerouslySetInnerHTML` with user content);
- every admin route has a `RequireRole` guard.

These are covered by `tests/rules/phase8-release-audit.rules.test.ts`, which has 17 tests.

## 3. Product defects fixed in Phase 8

| ID | Pri | Defect | Fix | Regression test |
|---|---|---|---|---|
| P1-a | P1 | **Branch and organization creation always failed when an optional field (City/State, Website/Logo) was blank.** Firestore rejects `undefined` values, and Zod passes them through. | `src/lib/admin/service.ts` drops undefined fields before writing | `tests/admin/admin-service-writes.test.ts` |
| P1-b | P1 | **A failed save in the lesson studio replaced the whole editor with "Lesson Not Found", and unsaved blocks were lost.** Load and save errors shared one state. | Separate `loadError`. Save and publish errors now show inline. | browser QA (`roles.js`: invalid save keeps the editor, then the corrected save succeeds) |
| P1-c | P1 | No password recovery for any user | Neutral reset flow on `/login` | browser QA |
| P2 | P2 | Login inputs had no programmatic labels | `id`/`htmlFor` + `autoComplete` | browser QA |
| P2 | P2 | Missing composite index for the instructor batch query (`orgId` + `instructorUserIds`) | `firestore.indexes.json` | — (the emulator doesn't enforce indexes; check on staging) |

## 4. Owner decisions (not implemented — each changes business policy)

**D1 — Staff provisioning.** There is no in-app way to create instructor or admin accounts. Today it takes a Firebase console user plus a hand-written `users/{uid}` document.
- *Recommendation:* for launch, use a written runbook that only a super admin follows. After launch, add an Admin SDK route or Cloud Function (see `SERVER_SIDE_OPERATIONS.md`).

**D2 — Capacity enforcement (S3).**
- *Recommendation:* keep an `activeEnrollmentCount` on the batch, update it in the same client transaction as the enrollment, and add a rules check that `count <= maxStudents` and that it changes by exactly ±1 alongside an enrollment write. The alternative is to accept a small overshoot risk while batches are small and enrollment is manual.

**D3 — Course governance.** Current behaviour, pinned by the "policy:" tests:
- any instructor in an org can edit or unpublish any course in that org;
- a branch admin can delete any course in the org;
- instructors can't delete.

*Recommendation:* restrict publish and unpublish to the course owner and admins, and restrict deletion to university and super admins. Prefer archiving to deleting.

**D4 — Time zones.** Plan dates use the instructor's browser date, while a student's "today" uses the student's browser. `organizations.settings.defaultTimezone` is stored but unused.
- *Recommendation:* compute plan and "today" dates in the org's time zone.

**D5 — Instructor names for students.** Students can't read staff profiles, so they see no instructor name.
- *Recommendation:* store instructor display names on the batch document, validated by the rules.

**D6 — Attachments.** Firebase Storage isn't configured, and submissions are text and code only.
- *Recommendation:* launch without attachments.

**D7 — Archived batches and reassigned instructors.** Removing an instructor revokes their access immediately. Archived plans are hidden from students.
- *Confirm* that this is the intended policy, and whether students should still see archived batch history.

**D8 — Migration approval.** The enrollment migration needs:
- a reviewed dry-run report against a production export;
- a named approver;
- a backup.

See `ENROLLMENT_MIGRATION.md`.

## 5. Release checklist

1. [ ] Owner decides D1–D8 (at minimum D1, D2, D3 and D8 before production).
2. [ ] Confirm which rules production is running. If they are the committed rules, deploy `firestore.hotfix.rules` first.
3. [ ] Deploy `firestore.indexes.json` to staging and wait for indexes to build.
4. [ ] Deploy the full app and `firestore.rules` to **staging**. Run the role journeys there against a staging project, never production.
5. [ ] Export production → run the migration dry-run → review → approve → back up → apply → audit.
6. [ ] Deploy `firestore.rules` to production right after the migration.
7. [ ] Provision staff accounts using the approved D1 runbook.
8. [ ] Configure the password-reset email template and authorised domains in Firebase Auth.
9. [ ] Check the security headers on the production domain. Plan the nonce-based CSP.
10. [ ] Turn on monitoring for rules denials and client errors.

## 6. Verification evidence (local)

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build` | exit 0 |
| `npm run test:unit` | all pass, exit 0 |
| `npm run test:emulator` | all pass, exit 0. Includes the 17 audit tests and 5 hotfix tests. |
| `npm run verify:emulator` | student journey + batch workflow, exit 0 (isolated project IDs) |
| Browser QA against emulators | `roles.js` 24/24 · `stage7.js` 48/48 · `smoke.js` 32/32 · responsive survey at 1280/820/390 |

Exact counts are in the Phase 8 final report.

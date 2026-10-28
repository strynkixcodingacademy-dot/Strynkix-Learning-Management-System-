# Staging Readiness — Phase 8.1 (Strynkix Coding Academy pilot)

Status: **READY FOR STAGING PREPARATION.** This is not yet ready for staging deployment, because no separate staging Firebase project exists (§4).

Scope: the academy's franchise workflow (Super Admin → Branch Admin → Instructor → Student). University customers are a separate, future product (§1.3). Findings and evidence carried over from Phase 8 are in `RELEASE_READINESS.md`.

---

## 1. Role model and the data that enforces it

### 1.1 How the data represents the academy

| Concept | Representation | Notes |
|---|---|---|
| Academy platform | One `organizations/{orgId}` document (`strynkix`) | `organization` is the **tenant**. It is not a university. |
| Branch / franchise | `branches/{branchId}` with `orgId` | A branch belongs to exactly one organization. |
| User and role | `users/{uid}` with `role`, `orgId`, optional `branchId`, `status` | The document ID must be the Firebase Auth UID. A missing profile means no access (`AuthContext` never creates one automatically). |
| Branch scope | `users.branchId`, compared with the record's `branchId` | Branch admins and branch-scoped instructors and students. |
| Batch | `batches/{id}` with immutable `orgId`, `branchId`, `courseId` | The unit of teaching and enrollment. |
| Enrollment | `enrollments/{courseId}_{studentId}` with `branchId`, `batchId` | Deterministic ID: one enrollment per student per course. |
| Plans, assignments, submissions, progress | Each carries `batchId` | Rules scope them through the batch's `branchId` and `instructorUserIds`. |
| Courses, modules, lessons | `orgId` only, **no branch** | Content is shared across the whole academy. Governance is in §6. |

### 1.2 Enforcement in Firestore rules (not the UI)

| Role | Enforced scope |
|---|---|
| Super Admin | Everything (`isSuperAdmin()`). The only role that can hard-delete batches, enrollments, lessons, modules, plans, submissions, users and branches. |
| Branch Admin | Batches, enrollments, plans, assignments, submissions and progress whose batch is in **their** branch, and users whose `branchId` equals theirs. Can create or edit only `instructor` and `student` users in their own branch. Cannot change a record's `orgId` or `branchId`, or anyone's role to an admin role. |
| Instructor | Plans, assignments, submissions, progress and roster for batches that list them in `instructorUserIds`. Access ends as soon as they are removed. Cannot read student profiles (rosters use the enrollment snapshot). |
| Student | Their own profile, enrollments, progress and submissions, plus published content of courses they are actively enrolled in, through their batch. |

Evidence:
- `tests/rules/academy-branch-isolation.rules.test.ts` (21 tests): two branches; every denial is paired with a positive control; covers forged `orgId`, `branchId`, `role`, `createdById`, `enrolledById` and enrollment relationships.
- `tests/rules/phase8-release-audit.rules.test.ts`.
- A browser and REST check against local emulators (Pune vs Mumbai, using real ID tokens): 21/21.

### 1.3 Coupling with the future University Admin

In the current rules, `university_admin` is effectively **the parent of Branch Admin inside its organization**:
- `canManageBranch()`, `canTeachBatch()` and `canReviewSubmission()` all grant `isUniversityAdmin(orgId)` authority over every branch.
- The `users` rules let it create and edit branch admins in its organization.
- The emulator seed puts `uniadmin@strynkix.com` (a `university_admin`) inside the **academy** organization.

The `coupling:` test in the isolation suite pins this behaviour.

**Smallest safe correction (owner decision U1, not implemented):**
1. *Now, operational and zero code:* do not provision any `university_admin` account in the academy organization. Before staging, run a read-only check that none exists.
2. *Before any university customer is onboarded:* add `organizations.type: 'academy' | 'university'`. Restrict `isUniversityAdmin()` to organizations where `type == 'university'`, and backfill `type: 'academy'` on the Strynkix organization. This is additive, but changes the rules for existing data, so it needs approval and a staging run.
3. Remove the university admin from the academy seed and fixtures when (2) lands.

---

## 2. Rules deployment analysis (S1/S2)

1. **What a normal deploy targets.** `firebase.json` → `"rules": "firestore.rules"`, and `.firebaserc` → default project `learning-management-syst-b9bf3`. So a plain `firebase deploy` or `firebase deploy --only firestore:rules` pushes the **full, enrollment-gated ruleset to the only Firebase project on the account**. Doing that before the enrollment migration would cut every student off from content. **Never run a bare deploy until a staging alias exists and the migration is done.**
2. **Does the hotfix fully close S1 and S2?**
   - **S1 (orgId relabel):** yes, for modules, lessons and assignments. Updates check the stored `orgId` against both the caller and the incoming value, and only super admins can delete.
   - **S2 (self-signup activation):** yes. Self-created profiles must be `role == 'student'` and `status == 'pending_verification'`.
   - `tests/rules/hotfix.rules.test.ts`: 5/5 pass, and both security tests fail against the committed rules.
   - **Not in the hotfix:** the branch-admin-without-`branchId` gap (S8, fixed only in `firestore.rules`). While the hotfix is live, compensate with the read-only check in §8, gate G2.
3. **Hotfix first, full rules second.** This does not reintroduce S1 or S2: `firestore.rules` contains both fixes and adds more checks. The risk is functional. The full rules gate students on enrollments, so deploying them before the migration interrupts learning. They also require the Phase 8 composite index (`batches`: `orgId` + `instructorUserIds`) to be built first, or instructors' batch lists fail. Order: hotfix → indexes → migration → full rules.
4. **Academy rules vs future university rules.** Everything in the rules serves the academy, except the `isUniversityAdmin(...)` branches (§1.3). Those are the future university model, and today they also grant authority over academy branches.
5. **Branch boundaries in rules.** See §1.2. Batch, enrollment, plan and assignment authority all resolve through `batches/{id}.branchId` and `users/{uid}.branchId`, and `orgId`, `branchId` and `courseId` are immutable on updates.
6. **Read-only evidence of what is deployed:**
   - Firebase console → Firestore → Rules → **History**, which shows the timestamp and content of the active release.
   - Or `GET https://firebaserules.googleapis.com/v1/projects/<project>/releases` with a viewer credential, then fetch the referenced ruleset.
   - Compare against `git show 799e596:firestore.rules`, `firestore.hotfix.rules` and `firestore.rules`. Do this before any deploy, and record the result.

---

## 3. Fixes made in Phase 8.1

| ID | Severity | Finding | Fix |
|---|---|---|---|
| S8 | Medium (high impact, needs a provisioning mistake) | A `branch_admin` profile without `branchId` matched every unscoped user in its organization: it could read org-wide staff profiles and create **unscoped instructors**, who are assignable to any branch and can author all organization content. Super-admin user creation does no shape validation, so one console typo creates this. | `firestore.rules`: new `isScopedBranchAdminRole()` (a non-empty `branchId` is required) used in `isBranchAdmin()`, every `users` branch-admin clause, submission review and progress read. Regression: the "no branchId" group in the isolation suite failed 2/3 before the fix and passes after. |

There is no change in behaviour for correctly provisioned branch admins: all existing suites and the browser journeys still pass.

---

## 4. Staging: blocker and isolation plan

**Blocker B1: there is no separate staging Firebase project.** The signed-in Firebase account can see exactly one project, `learning-management-syst-b9bf3`, which is also the `.firebaserc` default. Whether it is the live academy's project could not be determined without a write or console access. Treat it as **production** until the owner confirms otherwise. There is no `.vercel` link in the repository, so the Vercel environments could not be inspected.

Creating the staging project is an owner action (no billing is needed for Auth + Firestore on Spark). Once it exists:

| Area | Requirement |
|---|---|
| Identity | Add a `staging` alias in `.firebaserc`. Every deploy names `--project staging` explicitly. Confirm the project ID in the console before each deploy. |
| Auth | Email/Password enabled. Authorized domains limited to the staging Vercel domain and `localhost`. Customize the password-reset template and test it with a staging-only inbox. |
| Rules | Deploy `firestore.rules` to staging (no migration needed: staging starts with canonical data). |
| Indexes | `firebase deploy --only firestore:indexes --project staging`, then wait until every index shows *Enabled*. |
| Env vars | Vercel **Preview** or a dedicated staging environment gets the staging `NEXT_PUBLIC_FIREBASE_*` values. Production values stay in the Production scope only. `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` must be unset or false. The `FIREBASE_ADMIN_*` variables in `.env.example` are **not used by any code**; leave them unset. |
| Fixtures | One Super Admin. Two academy branches (e.g. `branch_stg_a`, `branch_stg_b`), each with a Branch Admin, one instructor assigned to one batch, and two students enrolled. All identities use a test-only domain. Never reuse real student data. |
| Isolation tests | Repeat the Pune/Mumbai REST and UI checks (`cross-branch.js` pattern) against staging with the staging tokens: Branch Admin A vs B for reads, writes, forged `branchId`/`orgId`/`role`. |
| Browser QA | The role journeys, daily-learning, batch/enrollment and the responsive survey at 1280/820/390. |
| Monitoring | Vercel runtime logs. Firestore usage dashboard (watch rules-denied reads). Browser console errors during QA. |
| Rollback | Rules: republish the previous release from Rules History. App: Vercel "Promote previous deployment". Data: staging is disposable; reseed. |

---

## 5. Batch capacity (S3)

**Current behaviour:** `enrollStudent()` counts active enrollments on the client ([`src/lib/batches/service.ts`](../src/lib/batches/service.ts), `if (activeCount >= batch.maxStudents)`), and then writes. The rules never count. Two admins enrolling at once, or one admin calling Firestore directly, can exceed `maxStudents`. This is proven by the `known gap` test in `tests/rules/phase8-release-audit.rules.test.ts`.

**Why a client counter alone is not enough:** a client can skip the check or the counter. Enforcement has to sit in rules that tie the enrollment write and the counter change together, or in trusted server code.

**Recommended design (D2): a rules-enforced counter inside a client transaction, with no new infrastructure.**
1. Add `activeEnrollmentCount` (int) to `batches`. Backfill it from the active enrollments during the migration and in a reconciliation script.
2. Every enrollment write that changes "is active in batch X" runs in a Firestore **transaction**. The transaction writes the enrollment and updates the counter on every affected batch, plus `lastEnrollmentChange: <enrollmentId>` on the batch.
3. Rules:
   - The enrollment create/update requires `getAfter(batch).activeEnrollmentCount == get(batch).activeEnrollmentCount ± 1`, matching the transition, and `<= maxStudents`.
   - A batch update that changes the counter requires `getAfter(enrollments/<lastEnrollmentChange>)` to show the matching transition.
   - Counter changes are therefore impossible without a real enrollment change, and vice versa.
4. **Concurrency:** both transactions read the same batch document. Firestore commits only one against that version and the other retries with the new count. A client that skips the transaction cannot satisfy the `getAfter` equality.
5. **Transitions:**
   - create active: +1
   - active → dropped/suspended/completed: −1
   - reactivation: +1, re-checked against `maxStudents`
   - batch move: −1 on the old batch, +1 on the new one
   - duplicate create: impossible (deterministic ID; it becomes an update)
   - retries: idempotent, because the transaction re-reads
   - console or super-admin edits outside the app: caught by the reconciliation script
6. **Cost:** a few extra document reads per enrollment write. Rules `get`/`getAfter` calls are billed as reads. Stays within the 10-access limit per single write and 20 per transaction; verify this with the emulator profiler.
7. **Alternative:** a trusted server route (Vercel + Admin SDK) is simpler to reason about, but needs a service-account secret and new backend code. Cloud Functions need the Blaze plan. Defer both.

The existing `known gap` test becomes the regression test (it must flip to `assertFails` for the second enrollment), plus tests for every transition above. **Not implemented:** it changes the batch schema and the enrollment write path and needs a data backfill, so it needs approval (D2).

---

## 6. Staff provisioning and course governance

### 6.1 Provisioning runbook (D1, recommended for the pilot)

Today, **no account of any role can be created in the app**: there is no sign-up page and no user-management screen. Branch admins can enroll existing student profiles, but can't add students. For the pilot, a super admin follows this runbook:

1. **Identity.** Firebase console → Authentication → *Add user* with the person's real email and a long random password that is never shared. Copy the generated **UID**.
2. **Profile.** Firestore console → `users/<UID>` (the document ID must equal the UID) with exactly these fields:
   - `role`: `branch_admin`, `instructor` or `student` (never `university_admin` in the academy organization)
   - `orgId: 'strynkix'`
   - `branchId`: **required** for branch admins and students; for instructors, set it unless the owner approves an academy-wide instructor
   - `status: 'active'`
   - `email`: identical to the Auth email
   - `displayName`

   Console writes bypass rules, so a second person checks the document against this list.
3. **Hand-over.** The person uses **Forgot password?** on `/login` to set their own password. The password is never sent through chat or email.
4. **Verification.** The person signs in and sees only their branch. Branch admins: the batch list shows only their branch. Instructors: only their assigned batches.
5. **Offboarding.**
   - Set `status: 'suspended'`. Rules deny access immediately; the test suite proves this.
   - Remove instructors from `instructorUserIds`.
   - Disable the user in Authentication.
   - Do not delete profiles: rosters and grading history reference them.
6. **Recovery.** The person uses Forgot password. If the email address changes, update it in both Auth and the profile.

Branch admins *are* allowed by the rules to create and edit instructor and student profiles in their branch, so an in-app "add student" screen is a small follow-up. It still needs the Auth account, which a client cannot create for someone else without a trusted route. Recommended after the pilot: a Vercel route using the Admin SDK that creates the Auth user and the profile together.

### 6.2 Course governance

**Current rules:** any `university_admin`, `branch_admin` or `instructor` in the organization can create and update **any** course, module or lesson in the organization, including publishing and unpublishing. Branch admins and university admins can **delete** courses. Only super admins can delete modules and lessons. The UI has no delete control. The `policy:` tests pin this.

For the academy, this means one branch's staff can change or remove content every franchise teaches.

**Recommended matrix (D3, needs approval; not implemented):**

| Action | Super Admin | Branch Admin | Instructor | Student | University Admin (future) |
|---|---|---|---|---|---|
| Read content | all | org, published + drafts | org, published + drafts | enrolled courses, published only | own university org |
| Create course or lesson draft | ✓ | — | ✓ (as author) | — | own org |
| Edit draft | ✓ | — | own drafts | — | own org |
| Edit published content | ✓ | — | — (propose changes) | — | own org |
| Publish / unpublish | ✓ | — | — | — | own org |
| Archive (status `archived`) | ✓ | — | — | — | own org |
| Hard delete | ✓, only if never used by a batch | — | — | — | — |

Archive instead of delete wherever batches, progress or submissions reference the course.

---

## 7. Migration safeguards and approval sequence (D8)

**Verified in code:**
- `--input` and `--emulator` dry runs are read-only (the optional `--report` writes a local file containing IDs only).
- `--apply` is refused unless `--emulator` is set, and the emulator host must be `localhost`/`127.0.0.1`. There is **no production write path**.
- Ambiguous or malformed records go to `manualReview` / `ambiguous` / `profileIssues` with reason codes; nothing is guessed.
- One transaction per action, and every action is idempotent: an existing canonical enrollment with a different batch is reported as a `conflict` and never overwritten.
- A legacy enrollment is archived only after its canonical replacement exists, and it is copied to `enrollmentLegacyArchive` before deletion.
- An ID-only audit is written to `migrationAudit/{runId}`.

These are covered by `tests/emulator/enrollment-migration.emulator.test.ts` and the unit tests.

**Missing for production:**
- (a) A read-only snapshot exporter: an Admin SDK script with a `roles/datastore.viewer` credential, or a managed export, which needs Blaze.
- (b) A backup: the managed export again needs Blaze. On Spark, a read-only Admin SDK dump of `users`, `enrollments`, `progress` and `batches` serves as the backup, with a tested restore script.
- (c) An approved production applier: an Admin SDK port of `applyEnrollmentMigration`.
- (d) A counter backfill, if D2 is approved.

**Approval sequence:**
1. Identify the target project from read-only console evidence. Record the project ID and the current rules release.
2. Take a read-only snapshot using the approved exporter.
3. Dry run: `--input snapshot.json --report plan.json`.
4. The owner reviews every create, archive, retag, skip, `manualReview`, `ambiguous`, `studentsWithoutEvidence` and `profileIssues` entry and supplies `decisions.json` (each entry has `decidedBy`).
5. Take a backup, and rehearse the restore on the emulator.
6. Rehearse on the emulator: load snapshot + decisions, `--apply` twice (the second run must be all `skipped_already_done`), then run the full test suite.
7. **The owner signs off on the exact plan file (hash) and run ID.**
8. Apply in the approved environment with the approved applier.
9. Reconcile: canonical enrollments per student and course equal the plan; no `conflict` outcomes are left unexplained; the audit record is stored.
10. Deploy `firestore.rules` (indexes built first), then smoke-test every role.

---

## 8. Time zones and instructor names

**Time zones (D4).**
- Deadlines (`deadline`, `learningDueAt`) are entered in the instructor's local time and stored as ISO instants, so late and overdue detection is correct everywhere.
- Date keys are taken from each viewer's **browser** time zone (`toLocalDateKey`): "today", the plan's `date`, and the daily completion metrics.
- `organizations.settings.defaultTimezone` is stored but unused, and branches have no time zone.
- For a pilot where every branch and every device is in IST, the behaviour is consistent.
- Risks: a device with the wrong time zone, or a franchise in another time zone, sees the wrong "today", and plans can appear a day early or late.
- *Recommendation:* add `branches.timezone`, defaulting to the organization's `defaultTimezone`, set to `Asia/Kolkata` for the academy. Compute date keys with `Intl.DateTimeFormat(…, { timeZone })` in that zone for plans, "today" and metrics. Needed before the first franchise outside IST; not a staging blocker.

**Instructor names (D5).** Students can't read staff profiles, by design, so they see no instructor name.
- *Recommendation:* if the pilot wants names, add `instructorNames: string[]` (display names only) to the batch, kept in step with `instructorUserIds`. Rules would check it on every batch write against `users/{uid}.displayName`, using the same pattern as the roster snapshot.
- Nothing else from the staff profile (email, phone) becomes visible.

**Enhancements, not blockers:** attachments (D6; Storage is unconfigured; text and code submissions work), achievements and streaks (not built; don't invent them), advanced syntax highlighting.

---

## 9. Decision register

| ID | Decision | Recommendation | Implementation impact | Security | Cost | Blocks staging | Blocks production |
|---|---|---|---|---|---|---|---|
| D1 | Staff and student provisioning | Console runbook (§6.1) for the pilot; Admin SDK route later | None now; later a server route + secret | Console writes bypass rules → two-person check | Free | No (staging accounts use the runbook) | **Yes**, until the runbook is approved and rehearsed |
| D2 | Atomic batch capacity | Rules-enforced counter in a transaction (§5) | Batch schema, enrollment service, rules, backfill, tests | Closes S3 | A few reads per enrollment | No | **Yes**, if batches have hard limits; otherwise accept manual enrollment with a reconciliation report |
| D3 | Course governance | Matrix in §6.2; archive over delete | Rules for courses/modules/lessons + UI affordances | Stops cross-branch content tampering | Free | No | **Yes** |
| D4 | Time-zone policy | Branch time zone (IST default), zoned date keys | `branches.timezone`, metrics, plan editor | None | Free | No | No for an IST-only pilot; yes before a non-IST franchise |
| D5 | Instructor names | Denormalized `instructorNames` on the batch, rule-checked | Batch schema, rules, UI | Exposes display names only | Free | No | No |
| D6 | Attachments | Launch with text and code only | None | Avoids an upload attack surface | Storage would add cost | No | No |
| D7 | Archived batches and removed instructors | Keep current behaviour (immediate revocation; archived plans hidden from students); confirm whether students keep read access to graded work after archiving | Possibly a student "history" view | Current behaviour is the safest | Free | No | Confirm before production |
| D8 | Enrollment migration | Sequence in §7 with owner sign-off on the plan hash | Exporter, backup, applier (Admin SDK, read-only and trusted) | Needs a scoped service account | Blaze for managed export (or Spark with an SDK dump) | No | **Yes** |
| U1 | University Admin separation | §1.3: no university admins in the academy organization now; `organizations.type` later | Rules + org backfill | Removes the implicit parent authority | Free | No (operational check) | Operational check required |

---

## 10. Staged release checklist with approval gates

**G0 — Owner approvals (before anything leaves this machine)**
- [ ] Confirm whether `learning-management-syst-b9bf3` is the live academy project.
- [ ] Approve D1 (runbook), D3 (governance matrix) and U1 (step 1).
- [ ] Decide D2 (implement before production, or accept the risk for the pilot).

**G1 — Staging preparation (owner creates the staging project)**
- [ ] Staging Firebase project created (Spark); `staging` alias added to `.firebaserc`.
- [ ] Staging Vercel environment with staging-only variables; production scope untouched.
- [ ] Auth Email/Password + authorized domains + reset template configured on staging.

**G2 — Production hotfix window (explicit approval required; this changes a live environment)**
- [ ] Read-only: record the current production rules release.
- [ ] Read-only: confirm every `branch_admin` profile has a non-empty `branchId` and no `university_admin` exists in the academy organization (compensates for S8 and U1 while the hotfix is live).
- [ ] Deploy `firestore.hotfix.rules` to production (`--project <prod>`, the file named explicitly). Smoke-test student and staff sign-in.

**G3 — Staging deployment**
- [ ] Deploy indexes, wait until they are *Enabled*; deploy `firestore.rules`; deploy the app to staging.
- [ ] Provision staging fixtures with the D1 runbook (two branches).
- [ ] Run: branch isolation (UI + REST), role journeys, daily learning, batch/enrollment, responsive survey. Record results.

**G4 — Production review prerequisites**
- [ ] D2 implemented and tested (or the risk formally accepted).
- [ ] D3 implemented in rules and tested.
- [ ] Migration tooling (exporter, backup, applier) written, reviewed and rehearsed on the emulator.

**G5 — Production cutover (explicit approval of the migration plan hash)**
- [ ] Snapshot → dry run → owner review → backup → apply → reconcile.
- [ ] Deploy indexes, then `firestore.rules`; provision staff; monitor rules denials and errors for 48 h.
- [ ] Rollback is ready: previous rules release, previous Vercel deployment, legacy enrollment archive.

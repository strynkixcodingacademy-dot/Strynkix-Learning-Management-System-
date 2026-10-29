# Staging Readiness — Phase 8.1 (Strynkix Coding Academy pilot)

Status: **Phase 9 update (2026-10-28): staging project `strynkix-live-books-staging` exists (alias `staging` in `.firebaserc`). The owner approved D2, D3, D4 and D5 and staging-only deployment; see §11.** Production is unchanged.

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
| Env vars | Vercel **Preview** or a dedicated staging environment gets the staging `NEXT_PUBLIC_FIREBASE_*` values. Production values stay in the Production scope only. `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` must be unset or false. The `FIREBASE_ADMIN_*` variables are used by every trusted server route (quiz grading, review/publishing, assessment authoring, Course Design membership, account status) and by the legacy quiz migration CLI (§13); they belong in **Preview/staging scope only**, never Production. |
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

---

## 11. Phase 9 — owner decisions implemented (2026-10-28)

| Decision | Owner choice | Implementation | Tests |
|---|---|---|---|
| D2 capacity | Enforce with a counter | Capped batches carry `activeEnrollmentCount`. Every enrollment write that adds or removes an active seat moves it by exactly ±1 in the same atomic write (`seatChangeOk` / `seatTransitionOk` in `firestore.rules`), never past `maxStudents`. Clients use `writeBatch` + `increment`. Managers re-count legacy batches on opening them (`reconcileSeatCount`); changing `maxStudents` re-counts too. Uncapped batches are unaffected. | `tests/rules/capacity.rules.test.ts`, Phase 8 "fixed" race test |
| D3 course governance | Recommended matrix | Super Admin publishes, unpublishes, archives and deletes courses and lessons. Other staff create draft courses, edit a course while it is a draft, and create/edit lessons and modules without changing their status. Publish buttons are hidden for non-Super-Admins. | Phase 8 audit "Course governance" suite; Stage 5 test updated deliberately |
| D4 time zones | Organization time zone | `settings.defaultTimezone` is loaded at sign-in (`setAcademyTimeZone`); `toLocalDateKey` and analytics day windows use it. New organizations default to `Asia/Kolkata`, with a selector on the form. Deadline *times* typed in plan forms still use the instructor's device clock. | `tests/learning/timezone.test.ts` |
| D5 instructor names | Show to students | Batches store `instructorNames` (display names only, validated as ≤ 5 short strings matching `instructorUserIds`), written whenever instructors change. Shown on the student's course "About" tab. | rules shape checks; browser QA |
| D6 attachments | Not chosen | Text/code submissions only; documented in the User Guide. | — |

### Security fixes in this phase
- **Reverted `resource == null` on `/enrollments` and `/progress` reads** (commit `966f21b`). It let any active user probe whether a given enrollment or progress record exists. The underlying bug (enrolling a brand-new student failed because `enrollStudent` read a missing document) is fixed in the service with a branch-scoped query. Regression test in `academy-branch-isolation.rules.test.ts`.
- **Account provisioning hardened** (`src/lib/admin/service.ts`): one `provisionAccount` path for managers, instructors and students; the new login is deleted again if the profile write is refused; "email already exists" reuses only a same-role account in the same branch; minimum password length 8; temporary passwords come from `crypto.getRandomValues` (14 characters). The profile write still runs under the admin's own session, so `firestore.rules` decide who may create which role where.


---

## 12. Stage B — Course Design membership (2026-10-29)

**Model.** `users/{uid}.courseDesign` (`department`, `responsibilities`, `assignedCourseIds`, `assignedAt`, `assignedByUserId`) is the only source of Course Design authority. `content_lead` / `content_designer` are role labels; with no valid membership they grant nothing. Members may be Content Leads, Content Designers or Instructors. `assignedCourseIds` is explicit course IDs or exactly `['*']` (every course in the member's own org), chosen explicitly — never defaulted.

**Administration.** Only an active Super Admin may grant, update or revoke membership; never on their own profile; only to an active, eligible account; `assignedByUserId` must be the Super Admin. University Admins, Branch Admins and members cannot change `courseDesign` (rules check the field is unchanged on every other write path, and on self-signup and admin-created profiles it must be absent).

**Authority (rules: `hasCourseDesignAuthority`).** Active account, same org as the content, eligible role, well-formed membership, matching responsibility, course in scope. Drafts only; no status changes (publishing remains Super Admin only, D3).

| Responsibility | Courses | Modules | Lessons |
|---|---|---|---|
| `lead`, `curriculum_architect` | read; edit/create while draft | create/edit in draft courses | create/edit in draft courses |
| `content_developer` | read | read | create/edit in draft courses |
| `reviewer`, `assessment_designer` | read | read | read |

Instructor and branch-admin draft authoring is unchanged (covered by regression tests).

**Removed from Antigravity's partial work:** Content Lead publish authority, branch-admin authoring loss, University Admin role-promotion to `content_designer`, content-lead read of team profiles, the unused `assignments/{id}/keys` area, and premature Stage C fields (`reviewStatus`, `ReviewNote`, `version`, `assignedDesignerIds`, `assignedReviewerIds`, `learningOutcomes`, `assessmentStrategy`, `learningObjectives`).

**Known high-priority issue for Stage C — quiz answers are readable.** Quiz blocks store `correctOptionId` (and explanations) inside lesson documents, and enrolled students can read published lessons, so a student can read correct answers before answering. Course Design members who can read a lesson see them too. Stage B does **not** fix this. Stage C must move answer keys out of student-readable documents (for example a restricted subcollection or server-side checking), migrate existing lessons, and keep current lesson rendering and the end-of-lesson quiz working.

## 13. Stage C1 — server-graded quizzes (2026-10-29)

**Where answers live.** Lesson documents carry questions and options only. Correct answers and explanations are in `lessons/{lessonId}/answerKey/current` (`orgId`, `courseId`, `lessonId`, `keyVersion`, `release: 'after_pass'`, `items[{blockId, correctOptionId, explanation}]`, `updatedById`, `updatedAt`). Students can never read it. Authors (Super Admin, University Admin, Branch Admin, Instructor in the org) read and write it. In-scope Course Design members read it; `lead`, `curriculum_architect`, `content_developer` and `assessment_designer` write it only while the course is a draft; `reviewer` reads only. Every key change bumps `keyVersion` by one. The Block Studio writes the stripped lesson and the key in one batch.

**Grading.** `POST /api/quiz/attempt` (`src/app/api/quiz/attempt/route.ts`), body `{courseId, lessonId, answers}` and `Authorization: Bearer <Firebase ID token>`. The server verifies the token (revoked and disabled accounts are refused), checks an active student, active/completed enrollment in the same org, and a published course and lesson, then grades against the key in one Firestore transaction. It writes an immutable `progress/{id}/quizAttempts/{000001…}` record and the `progress.quiz` summary, and marks the lesson completed on a pass (never downgraded). Before the student has passed, responses carry only the score and pass/fail; after passing, they include correct answers and explanations. Pass mark 60%; at least 30 s between attempts; at most 10 attempts per lesson per day, counted in the academy time zone (`organizations/{orgId}.settings.defaultTimezone`, UTC fallback) on the server clock. Completed lessons can be retaken without limits.

**Rules.** Clients cannot write `progress.quiz` or `quizAttempts`, and cannot set a keyed quiz lesson to completed. Lessons without a key (no quiz, or a quiz removed) keep client completion.

**Remaining exposure until C4.** Lessons saved before C1 still carry inline answers and keep client grading and completion until the C4 migration rewrites them. Opening and saving a lesson in the Block Studio converts it.

**Where the `FIREBASE_ADMIN_*` variables are used (updated after C7).** They are read only by `src/lib/server/firebase-admin.ts`, which every trusted route uses:

| Route / tool | Purpose | Admin access it needs |
|---|---|---|
| `POST /api/quiz/attempt` | grade quizzes, write attempts and progress (C1, C4) | Firestore read/write; Auth token verification |
| `POST /api/content/review` | submit, review, publish, unpublish, archive; versions; audit (C2, C3) | Firestore read/write; token verification |
| `POST /api/content/assessment` | assessment-only authoring (C2, C3) | Firestore read/write; token verification |
| `POST /api/admin/course-design` | grant/update/revoke Course Design membership (C5) | Firestore read/write; token verification |
| `POST /api/admin/account-status` | approve/suspend/reactivate; ends a suspended user's sessions (C5) | Firestore read/write; token verification; **Auth user update** (`revokeRefreshTokens`) |
| `npm run migration:quiz-keys` (CLI, C4) | inventory and migrate legacy quizzes | Firestore read (dry run) / read-write (apply); run from an operator's local shell only |

**Local development.** No credentials. Under `firebase emulators:exec --only auth,firestore` the routes use the emulators (`FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` must both be set; it refuses to run with only one). Set `FIREBASE_ADMIN_PROJECT_ID` to the emulator project.

**Staging credentials (not configured yet — the owner configures them; nothing has been created).**
1. In the **staging** Firebase project (`strynkix-live-books-staging`) only, create a dedicated service account for the server routes with the least roles that allow Firestore read/write, ID-token verification and revoking a user's refresh tokens (for example *Cloud Datastore User* plus *Firebase Authentication Admin*; *Firebase Authentication Viewer* is not enough for `/api/admin/account-status`), and create one JSON key.
2. In Vercel, add to the **Preview/staging** environment only, marked Sensitive: `FIREBASE_ADMIN_PROJECT_ID=strynkix-live-books-staging`, `FIREBASE_ADMIN_CLIENT_EMAIL=<service account email>`, `FIREBASE_ADMIN_PRIVATE_KEY=<private_key from the JSON, with newlines as \n>`. Do not add them to Production. Do not commit them, paste them into tickets or chat, or keep the JSON file in the repository; delete the downloaded file after entering it.
3. Deploy the updated `firestore.rules` to staging together with the code (the rules and the route ship as one change).
4. Without these variables **every** trusted route answers 503 and logs a configuration error server-side: quizzes can't be graded, content can't be reviewed or published, assessments can't be edited by Assessment Designers, and membership and account status can't be changed. Treat the variables as a release prerequisite.
5. The production project is refused by the server unless `ALLOW_PRODUCTION_ADMIN=true` is set. That is reserved for an approved production rollout and is not set anywhere. The migration CLI refuses the production project unconditionally, whatever this variable says.
6. For the migration CLI, put the same three variables in a local shell only (never in a file in the repository) and make sure `FIRESTORE_EMULATOR_HOST` is unset; see §16.

## 14. Stage C2 — content review and approval (2026-10-29)

**Lifecycle.** `Draft → In review → Changes requested / Approved → Published → Archived` on the existing course and lesson documents. `status` (draft/published/archived) stays the publication axis; a `review` map (`state`, `submittedById`, `submittedAt`, `reviewedById`, `reviewedAt`, `comment`) holds the review cycle of a draft. Modules have no review step.

**Trusted route.** `POST /api/content/review` (`{targetType, targetId, action, comment?, reason?}`, Firebase ID token). Actions: `submit`, `reopen` (withdraw or reopen an approved draft), `approve`, `request_changes` (comment required), `publish`, `unpublish`, `archive`. The server derives identity, role, org, scope and current state, decides with `src/lib/review/workflow.ts`, and in one transaction updates the target and creates an `auditLog` entry whose `at` is a Firestore server timestamp.

**Who may do what.**

| Action | Allowed |
|---|---|
| submit, reopen | anyone who may author the item: Super Admin; University Admin, Branch Admin, Instructor of the org (courses only while draft); in-scope Course Design `lead`/`curriculum_architect` (courses), `lead`/`curriculum_architect`/`content_developer`/`assessment_designer` (lessons), draft courses only |
| approve, request changes | Super Admin or an active in-scope `reviewer` of the same org — never the submitter, the last editor of the content, or the last editor of the lesson's answer key |
| publish, unpublish, archive | Super Admin only (D3). Publishing without a current approval is an override: reason of at least 10 characters, audited with `override: true` |

**Rules.** No client — Super Admin included — can change `status` or `review`. New courses and lessons must be plain drafts. Every client write must set `lastEditedById` to the writer. Content (and the lesson's answer key) is frozen while in review or approved; "Reopen for editing" unlocks it. `auditLog` is never client-writable; it is readable by the Super Admin, authors of the org and in-scope Course Design members.

**Assessment Designers.** Rules cannot tell quiz blocks from other blocks inside a lesson, so Assessment Designers do not get lesson write access. `POST /api/content/assessment` replaces only a lesson's quiz questions and answer key (other blocks untouched), bumps `keyVersion`, records `lastEditedById` and writes an `assessment_update` audit entry. The Block Studio switches to an assessment-only mode for them.

**Behaviour changes.**
- The Super Admin can no longer publish or archive with a direct Firestore write; the dashboard uses the route. Existing rules tests that asserted the old client path now assert the refusal.
- Staff can still edit **published** lesson content in place; publishing resets the review cycle. Reviewing edits to published content needs C3 versioning.
- Legacy content without `lastEditedById` is attributed to its `createdById` for the self-review check (lessons have none, so only the submitter and key editor are excluded until someone edits them).

**Audit dependencies.** Review, publication and assessment decisions are audited server-side. Course Design membership changes and answer-key edits made from the full Block Studio are still client writes and are not in `auditLog` (they record `updatedById`/`assignedByUserId` only). Moving them under the audit is a later-stage item.

**Security checklist — open items (not resolved by C2).**
1. Legacy quizzes with inline answers still expose answers until the C4 migration. The LMS is **not** fully assessment-secure yet.
2. No automated end-to-end browser coverage of the Block Studio save, assessment mode, review controls or the student reader quiz flow.
3. No per-IP rate limiting on the server routes.
4. `npm audit` has not been rerun.

## 15. Stage C3 — versioning and immutable published snapshots (2026-10-29)

**Model (smallest extension of the existing documents).**
- `lessons/{id}` is the **active published version** students read; nothing about the reader, curriculum, daily plans or grading routes changes. Once published it is immutable for every client, Super Admin included (rules: content edits only while `status == 'draft'`).
- `lessons/{id}/revisions/working` — the one working copy of a published lesson (title, minutes, blocks, `baseVersion`, `review`, `lastEditedById`). Its answers live in `lessons/{id}/answerKey/working`. Staff and in-scope Course Design members read them; students never do. Authors write them only while the lesson is published and the revision isn't in review or approved; they may discard an unfrozen revision.
- `lessons/{id}/versions/{000001…}` and `courses/{id}/versions/{…}` — immutable snapshots written only by the review route (`write: false`). Lesson versions carry the published blocks and the exact answer key graded for them, so they are readable only by people who may read answer keys. `publishedVersion` on the lesson/course points at the active one.
- Published course details are read-only for clients. There is no course-details editor in the app, so course revisions are not implemented; course versions record each publish.
- Modules are unchanged (structure, no review or versions).

**Review integration (C2 state machine unchanged).** On a published lesson, `submit`, `reopen`, `approve`, `request_changes` and `publish` act on the working revision; `unpublish`/`archive` act on the lesson and are refused while a revision is pending. Approval stores `approvedContentHash`, a server-computed SHA-256 fingerprint of the reviewed content and answer key; publish recomputes it and refuses a stale approval (`409 stale_approval`) unless the Super Admin overrides with a reason (audited). Rules additionally freeze approved content, so an approval can't be invalidated by client edits without reopening it, which resets the review. Requesting changes leaves the revision editable. Concurrent publishes serialise in the transaction: exactly one version is created.

**Publishing (one transaction).** Write the lesson's new content, `publishedVersion = n`; promote the working answers to `answerKey/current` (key version advances only when the answers change); create `versions/n`; delete the revision and working key; write the audit entry (`version: n`). Every quiz question must have a valid answer or the publish is refused (`409 assessment_incomplete`). Inline (legacy) answers in published content are moved into the key on publish.

**Assessment alignment.** Students are graded against `answerKey/current`, which a client can no longer change on a published lesson; it changes only together with the lesson content in the publish transaction. The assessment route writes to the revision and working key for published lessons. Quiz submissions send the version the reader displayed; if a newer version went live in between, grading returns `409 lesson_updated` instead of scoring the wrong questions. Attempts record `lessonVersion` beside `keyVersion`.

**Existing students and progress.** Progress, completion, enrollments and attempt history are untouched by publishing. A completed lesson stays completed when a new version goes live; retakes are graded against the new version. Attempts made before C3 have no `lessonVersion` (null).

**Existing content (backward-compatible fallback, no migration run).** Lessons published before C3 have no `publishedVersion`. They behave as version "unrecorded"; the first revision publish records their live content as a `baseline: true` version 1 and the new content as version 2. Draft lessons get version 1 on first publish. No data migration is required for C3.

**Behaviour change.** Staff can no longer edit published lesson content or live answer keys in place; the Block Studio saves a revision instead and shows "Students see version n". Tests that asserted in-place edits of published lessons now assert the refusal.

**Open items carried forward.** Legacy inline quiz answers (C4); no browser end-to-end coverage; no per-IP rate limiting; `npm audit` not rerun; membership changes and draft key edits are not in `auditLog`.

## 16. Stage C4 — legacy quiz security and migration (2026-10-29)

**Inventory (verified in code).**

| Format / path | Where | Exposure before C4 | Status |
|---|---|---|---|
| Keyed (C1) | answer-free `lessons/{id}.blocks` + `answerKey/current` | none | graded by the server |
| Legacy inline | `correctOptionId` + `explanation` inside `lessons/{id}.blocks`, no key | students could read answers; graded and completed in the browser | **migrated** by `migration:quiz-keys`; until then graded on the server from the inline answers (key version 0) |
| Inline + identical key | both | answers readable | migrated (strip only, key version kept) |
| Partly inline, partly keyed | both | answers readable | migrated into one key (next key version) |
| Inline conflicting with key; missing/partial/invalid answers; duplicate ids; >20 questions; key of another lesson; key for removed questions; key without questions | — | — | **reported for manual remediation, never changed**; the route refuses to grade malformed quizzes (404) |
| Working revisions with inline answers | `revisions/working` (staff-only) | none for students | reported (the studio never writes them) |
| Baseline versions with inline answers | `versions/*` (staff-only, immutable) | none for students | reported, never modified |
| Client grading `QuizTime` legacy mode + `quizScore` | browser | score decided by the client, completion by a client write | **removed**; every quiz posts to `/api/quiz/attempt` |
| `QuizBlockView` self-check | Block Studio preview only (the reader never renders quiz blocks inline) | authors only, with answers they already hold | kept |
| Client completion of a keyless quiz lesson | `progress` | quiz could be skipped | closed for every migrated lesson (rules deny completion once a key exists); remains open only for lessons left in manual remediation |
| Worked-example `solutionCode` | lesson blocks | intentional learning content, not graded | unchanged |

**Migration design.** Pure planner `src/lib/migration/quiz-key-migration.ts`; Admin-SDK applier `src/lib/migration/apply-quiz-key-migration.ts`; CLI `scripts/migration/quiz-key-migration.ts` (`npm run migration:quiz-keys -- …`).
- Dry run by default. `--target` and `--project` are required and never inferred from `.env`. The production project is refused for every target. `--apply` needs a local emulator, or `--target staging --project strynkix-live-books-staging --confirm-staging-write`.
- One transaction per lesson: re-read and re-classify, then strip the answers, write `answerKey/current`, store the original blocks in `lessons/{id}/legacyBackup/c4` (rules: no client read or write), and write an `assessment_migration` audit entry with counts only. Every key is validated with `lessonAnswerKeySchema` before writing.
- Idempotent: migrated lessons classify as `keyed`; a rerun writes nothing. A lesson changed between plan and apply is skipped and reported.
- Not atomic across lessons: failures are listed per lesson and can be retried. Published versions, revisions, progress, enrollments and attempts are never written. `publishedVersion` is not bumped (questions and answers are unchanged).
- Drafts that were in review or approved get a new content fingerprint, so their approval must be renewed (listed in the report).
- Output and `--report` files contain lesson ids, formats and reason codes only.

**Recovery.** `legacyBackup/c4` holds each migrated lesson's original blocks; restoring them (and deleting the created key) returns the lesson to its pre-migration state. This needs Admin access and is a manual procedure; the migration does not delete any source data.

**Emulator rehearsal (done in tests).** `tests/emulator/quiz-migration.emulator.test.ts` seeds every format, dry-runs, applies, re-runs, checks rules before and after, and runs the CLI end to end. A dry run over the full seeded emulator dataset found 27 lessons, all already keyed.

**Staging runbook (not executed; needs approval and staging credentials configured by the owner).**
1. Deploy the C1–C4 code and rules to staging (rules first is safe: they accept both formats).
2. `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` in a local shell only (never committed, never pasted). Unset `FIRESTORE_EMULATOR_HOST`.
3. Dry run: `npm run migration:quiz-keys -- --target staging --project strynkix-live-books-staging --report c4-staging-dry.json`. Review the counts and every MANUAL line.
4. Remediate manual lessons in the Block Studio (or accept they stay as reported).
5. Apply: add `--apply --confirm-staging-write --report c4-staging-apply.json`. Then re-run the dry run: it must report 0 to migrate.
6. Browser-check a migrated lesson as a student (quiz graded, answers absent from the network payload).
7. Production: not covered by this runbook; requires a separate approved plan and a backup.

**Residual risk.** Lessons left in manual remediation keep their inline answers and remain completable by a direct client write until fixed.

## 17. Stage C5 — authorization hardening and audit completeness (2026-10-29)

**Findings (verified in code before changes).**
1. Membership survived suspension and ineligible role changes. It was inert (rules require an active account and eligible role) but came back on reactivation or a role change back.
2. Membership grants/revocations and account status changes (approve/suspend/reactivate) were client writes with no audit trail.
3. The audit log would have exposed account events to every author of the org once they existed.

**Changes.**
- `POST /api/admin/course-design` (Super Admin only; assign/update/revoke) and `POST /api/admin/account-status` (approve/suspend/reactivate), in `src/lib/server/account-admin.ts`. Each change and its `auditLog` entry commit in one transaction with a server timestamp. Refused or failed requests write nothing.
- Status authority mirrors the old rules: Super Admin for any non-Super-Admin account; University Admin for branch admins, instructors and students of their org; a scoped Branch Admin for instructors and students of their branch; never one's own account. Suspension revokes Course Design membership in the same transaction and revokes the user's refresh tokens (every server route checks revocation). Reactivation restores neither.
- Rules: no client (Super Admin included) changes `courseDesign` or `status` on an existing profile, or creates a profile with membership; membership is refused on any role outside Content Lead / Content Designer / Instructor, so an ineligible role change on a member requires revoking membership first. Account audit entries (`courseId: null`) are readable only by the Super Admin and the org's University Admin; content entries keep their C2 visibility.
- The People page and the Course Design dialogs call the routes; account provisioning creates the profile, then grants membership through the route.

**Authorization matrix (sensitive actions).**

| Action | Who | Enforced in | Audited |
|---|---|---|---|
| Grant/update/revoke Course Design membership | active Super Admin, not on self, eligible active target, courses of the target's org | route + rules (client writes refused) | yes (`membership_*`, `orgWide` flagged) |
| Approve/suspend/reactivate account | see above | route + rules | yes (`account_*`, membership revocation recorded) |
| Role, branch and profile edits | Super Admin; University Admin (org, limited roles); Branch Admin (branch, instructor/student); self (presentation fields) | rules | no — client writes (limitation) |
| Content authoring (drafts) | staff of the org; in-scope Course Design members for draft courses | rules | content changes record `lastEditedById`; not individually audited |
| Assessment-only authoring | + in-scope assessment designers | assessment route | yes (`assessment_update`) |
| Review, publish, unpublish, archive, override | C2/C3 matrix | review route + rules | yes |
| Quiz grading and completion of quiz lessons | enrolled active students | quiz route + rules | immutable attempt history |
| Legacy migration | operator with Admin access, emulator or confirmed staging | CLI guards | yes (`assessment_migration`) |

**Remaining limitations.** Role/branch edits and draft answer-key edits saved from the full Block Studio are client writes without audit entries (keys record `updatedById`, `updatedAt` and `keyVersion`; every published key is captured in its immutable version). Moving them behind routes is a follow-up.

## 18. Stage C6 — browser end-to-end tests (2026-10-29)

**Tooling.** `@playwright/test` 1.64.1 (dev dependency, pinned exactly; the repository had no browser framework). It drives the locally installed Google Chrome (`channel: 'chrome'`), so no browser download is needed; on a machine without Chrome run `npx playwright install chromium` and remove `channel` from `playwright.config.ts`.

**Run:** `npm run test:e2e`. This starts the Auth + Firestore emulators under the dedicated `demo-strynkix-e2e` project, builds the app with emulator settings and serves it with `next start` on port 3201 (it works alongside a running `next dev`), then runs `e2e/*.spec.ts` serially. **It rebuilds `.next` with emulator settings — run `npm run build` afterwards before using `.next` for anything else.** Failures keep a trace and screenshot in `test-results/` (git-ignored).

**Fixtures** (`e2e/fixtures.ts`): Super Admin, University Admin, Branch Admin, Instructor, Course Design content developer and reviewer, enrolled student, a student of a second organization, a suspended student and a login without a profile; a published course with keyed quiz lessons, a no-quiz lesson and a draft, plus an out-of-scope draft course. Each spec resets only the suite's own emulator project. The test password is an emulator-only value.

**Journeys covered (22 tests, all passing):**
- A — auth: unauthenticated access, sign-in and sign-out, suspended and unprovisioned accounts, direct navigation by a student to staff pages.
- B — authoring: instructor saves a draft in the Block Studio; Branch Admin authoring; Course Design scope in Course Authoring; reviewer read-only.
- C — review & publishing: submit → approve → publish with students seeing the lesson only after publishing and the audit trail recorded; request changes with a required comment and resubmission; Super Admin cannot approve their own submission and must give a reason to publish without approval; editing a published lesson saves a revision while students keep the published version.
- D — quiz security: a failed attempt graded on the server with no answers in the page or in any Firestore/API response; cooldown on a quick retake; a pass completes the lesson and only then shows explanations; no-quiz completion; API probes for forged scores, stale versions, invalid options and missing tokens.
- E — errors: missing lesson, cross-organization student, double-clicked submission graded once, network failure with recovery, review conflict reported without an audit entry.

**Defects found and fixed by the browser suite.**
1. *High (availability):* instructors, Branch Admins and Course Design members could not open the Block Studio on a lesson without an answer key — the rules denied reading a missing key. Fixed (lesson staff may read a missing key; students still can't), with a rules regression test that fails on the old rule.
2. *Low (UX):* staff-only pages showed "This area isn't available to you" to signed-out, paused or unprovisioned visitors instead of the matching state. Fixed in `RequireRole`.

**Not covered in the browser (covered by emulator tests instead):** reading another student's attempt history (rules suites), concurrent publishing races, attempt daily limits (10/day would need 10 cooled-down attempts), account-status and membership administration screens, assessment-only mode, version history UI, mobile viewports.

## 19. Stage C7 — security audit, quality gates and release readiness (2026-10-29)

**Status: READY FOR STAGING REVIEW.** Not production-ready: nothing has been deployed, no migration has run outside the local emulator, and the items under "Open risks" remain. Production deployment and migration have **not** been performed.

**Final verification (this working tree).**

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run test:unit` | 21 files, 255 tests passed |
| `npm run test:emulator` | 20 files, 397 tests passed |
| `npm run test:e2e` | 23 browser tests passed (Chrome) |
| `npm run build` | pass; no Admin SDK / server-only code and no e2e settings in client bundles |
| `npm run verify:emulator` | 46 checks passed |
| `npm audit --omit=dev` | 12 advisories (4 high, 8 moderate), 0 critical — see below |

**Dependency audit.** Runtime: 4 high via `@grpc/grpc-js` (under `firebase` → `@firebase/firestore`; the advisories concern gRPC *server* behaviour — `getAuthContext` and server error messages — which this app does not run) and 8 moderate via `uuid` (buffer bounds check in v3/v5/v6 when a buffer is passed; reached through `firebase-admin` → Google Cloud libraries). Dev only: `@firebase/rules-unit-testing` (high, via `firebase`). Every fix npm offers is a breaking major upgrade (`firebase`, `firebase-admin` 14.5); none was applied. Recommended: schedule `firebase` and `firebase-admin` major upgrades on a branch with the full suites. `@playwright/test` 1.64.1 added no advisories.

**Application security findings (static inspection + tests; not a penetration test).**

| Severity | Finding | Status |
|---|---|---|
| High | Legacy inline quiz answers readable by students; client grading and completion | C4: client grading removed, server grades every format, migration tooling ready (run pending on staging) |
| High | Block Studio unusable for staff on lessons without a key (rules denied reading a missing key) | Fixed in C6, regression test |
| Medium | Stale Course Design membership revived on reactivation/role change; membership and status changes unaudited | Fixed in C5 (server routes, audit, rules invariants) |
| Medium | Open redirect: `/login?redirect=//evil.example` | Fixed (`safeRedirectPath`), unit + browser tests |
| Medium | No per-IP rate limiting on `/api/*` | Open — per-student attempt limits exist; add Vercel Firewall rate limits or a shared store (e.g. Upstash) before production |
| Medium | Modules of published courses are editable in place and unversioned; published course details have no revision editor | Open (documented) |
| Low | Role/branch edits and draft answer-key edits from the full Block Studio are not in `auditLog` | Open (documented in §17) |
| Low | Staff pages showed "not available" instead of sign-in/paused states | Fixed in C6 |
| Low | CSP is limited to `frame-ancestors` | Open (see RELEASE_READINESS) |
| Info | Public staging web-client config is a fallback in `src/lib/firebase/config.ts` (pre-existing; public by design) | Unchanged |

Checked without findings: server-only Admin code is absent from client bundles; no private env vars are read by client code; every `/api` route verifies the ID token with revocation, validates a strict body schema, caps body size and returns generic errors; scores, roles, status and timestamps are never taken from the client; review, publication, grading, membership and status changes are transactional; audit entries cannot be written, edited or deleted by clients; published versions and live keys are immutable to clients; migration defaults to dry-run and refuses production.

**Data integrity and recovery.** Published versions and attempt history are immutable (rules `write: false`, server `create`). Progress never downgrades (rules + server). Migration is idempotent and per-lesson atomic; it keeps original blocks in `legacyBackup/c4`, from which a lesson can be restored manually with Admin access. There is no automated rollback, and nothing restores data overwritten outside these paths — take a Firestore export before any staging or production migration.

**Required before staging validation (owner actions).**
1. Configure staging Admin credentials in Vercel Preview only (variable names: `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`; §13). Never Production; never `ALLOW_PRODUCTION_ADMIN`.
2. Approve committing and deploying this branch (code + `firestore.rules`) to staging.
3. Take a staging Firestore export, then follow the §16 migration runbook (dry run first).
4. Run the browser journeys of §18 manually on staging (the automated suite targets the emulator only).
5. Decide on rate limiting and the dependency upgrades above.

## 20. No-billing staging backup: read-only JSON export (2026-10-30; rehearsed on the local emulator only, never run against staging)

**Purpose.** A Spark-compatible logical copy of staging Firestore, taken right before the C4 migration, for when a managed export (Blaze) is not available. Script: `scripts/backup/firestore-export.ts` (`npm run backup:firestore-export -- …`); logic in `src/lib/backup/firestore-export.ts`.

**Safety guarantees (enforced in code and covered by `tests/backup/firestore-export.test.ts`).**
- *Plan mode by default:* without `--export` it validates the flags, prints the plan and exits; no Firebase module is loaded and nothing is read.
- *Target guard first:* `--target` and `--project` are required. The production project is refused for every target. `--target staging` accepts only `strynkix-live-books-staging`, refuses to run with `FIRESTORE_EMULATOR_HOST` set, and `--export` additionally needs `--confirm-staging-read`. `--target emulator` accepts only `demo-` projects and a local emulator host. The Admin SDK is imported dynamically only after these checks, and the Admin layer refuses production on its own as well.
- *Read-only by construction:* the exporter receives a five-method read-only interface (list collections, list document refs, batched get, list subcollections, server-side count). A test fails if either file contains a Firestore write, delete, transaction, batch, bulk writer or migration call. The library imports no Firebase module at all (project ids come from the dependency-free `src/lib/firebase/project-ids.ts`), so plan and verify modes load none.
- *Pinned environment (export mode):* before the Admin SDK loads, the CLI disables GCE metadata-server detection (`METADATA_SERVER_DETECTION=none`; without it google-auth probed `169.254.169.254` / `metadata.google.internal` even against the emulator — found in the rehearsal), drops `GOOGLE_APPLICATION_CREDENTIALS`, pins the project id variables to the validated target, and for the emulator target clears `FIREBASE_ADMIN_*`.
- *Complete traversal:* every root collection and nested subcollection, including subcollections under documents that no longer exist (recorded as `exists: false`; `listDocuments()` asks the server for missing documents and pages through all results). After each collection the server's own `count()` is compared with the number exported; any difference is an error. That covers `lessons/*` (original blocks), `lessons/*/answerKey/*` (current and working keys), `lessons/*/legacyBackup/*`, `revisions`, `versions`, `progress/*/quizAttempts` and `auditLog`. Reads are batched (`--batch-size`, default 200, max 500) with three retries and backoff.
- *Type preservation:* the Admin SDK runs with `useBigInt`, so integers are exact: safe integers are plain JSON numbers, larger ones `{__fs:'integer', value:'<decimal>'}`. Doubles stay doubles (integral, non-finite and −0 doubles are tagged `{__fs:'double'}`). Tagged JSON for timestamps (seconds + nanoseconds), document references, bytes (base64), geopoints and vectors; a map that already uses `__fs` is wrapped. Unknown types are recorded as errors, never stringified. `deserializeValue` is the exact inverse (used by verification and by a future restore).
- *No overwrite, private output:* `--out` must be an existing directory **outside the repository** (symlinks resolved). Each run creates a new `firestore-export_<project>_<timestamp>` directory (mode 700, files 600) and fails if it already exists.
- *Manifest and integrity:* data files have fixed names (`collections/NNN_<sanitized id>.ndjson`; the real collection id is in the manifest). `manifest.json` (format version 2) records project, target, start and finish time, completeness, document and missing-parent counts per collection pattern (ids replaced by `*`), expected collections not found, every file's SHA-256, size and line count, errors and limitations; `manifest.json.sha256` uses the exact `sha256sum` format (`<64 hex>␣␣manifest.json\n`). Any error ⇒ `complete: false` and exit code 2.
- *No sensitive output:* the console shows counts, collection patterns and one-line error codes only; the manifest holds no document contents.

**Commands (examples — NOT executed).**
```
# 1. Plan only (no Firebase, no reads):
npm run backup:firestore-export -- --target staging --project strynkix-live-books-staging --out "$HOME/strynkix-backups"
# 2. Export (read-only; needs the staging Admin credentials in the local shell, FIRESTORE_EMULATOR_HOST unset, and approval):
npm run backup:firestore-export -- --target staging --project strynkix-live-books-staging --out "$HOME/strynkix-backups" --export --confirm-staging-read
# 3. Verify offline (no Firebase, no network):
npm run backup:firestore-export -- --verify "$HOME/strynkix-backups/firestore-export_strynkix-live-books-staging_<timestamp>"
```
The emulator rehearsal is automated: `tests/emulator/firestore-export.emulator.test.ts` (part of `npm run test:emulator`).
Expected export output: per-collection counts, `Documents: N   Missing parents: M   Errors: 0`, then `Export COMPLETE`. Anything else (exit code 2, `Export PARTIAL`) means the backup must not be relied on.

**Verifying without remote access.** `--verify` never loads Firebase or opens a connection (proved by the rehearsal). It fails on: a missing or reformatted checksum file or manifest hash mismatch; a manifest that isn't valid JSON, has the wrong format/version or lacks required fields; unsafe file names (path traversal, absolute paths, anything not matching the fixed pattern) or a file listed twice; missing, extra or unexpected files anywhere in the directory; file hash, size, line-count or trailing-newline mismatches; invalid JSON lines, malformed records, records outside their collection, odd-length paths or duplicate documents; any value that does not decode; document, missing-parent or per-collection counts that differ from the manifest; and a partial export. Additionally compare `countsByCollection` with the migration dry-run (lesson count) and spot-check that `lessons/*/answerKey` and, after migration, `lessons/*/legacyBackup` counts look right.

**Emulator rehearsal (2026-10-30, local only, project `demo-strynkix-backup`).** Disposable fixtures: every value type (64-bit integers beyond 2^53, doubles incl. NaN/±Infinity, timestamps, references, bytes, geopoints, vectors, nested maps and arrays, empty maps/lists, dotted and unicode keys), a map that imitates the tag format and a string that looks like a tag, nested subcollections, a deleted parent under `lessons` and a root collection that exists only through a deleted parent, `answerKey`, `legacyBackup`, `versions` and `quizAttempts`, and 250 documents exported in batches of 100. Results (7/7 tests, with a `--require` observer recording module loads, sockets and DNS):
- plan mode: no Firebase module, no socket, no DNS lookup, nothing written;
- seven unsafe configurations (missing or remote emulator host, non-demo emulator project, staging with an emulator host, staging without confirmation, production, output inside the repository): all refused before any Firebase module loads;
- export: 258 documents + 3 missing parents, `complete: true`; every socket went to the local emulator port, even with decoy credentials in the environment; no secret in console output or manifest;
- round trip: every exported document re-serializes from the live emulator data to exactly the exported JSON, and decoding the export reproduces it again; 2^63−1 and −(2^53+1) decode to the exact `bigint`;
- verify: OK offline with no Firebase module or network; a tampered copy fails with exit code 2;
- a second export creates a new directory and leaves the first unchanged.
Defects the rehearsal found and that are fixed: metadata-server probing (above), and the BigInt aggregate count being compared with a number (it made every export report itself partial — the fail-safe worked, the comparison was wrong).

**Remaining work for a restore rehearsal (separate task, not started).**
1. Write a restore tool that reads a *verified* export, decodes it with `deserializeValue` and the SDK's classes, and writes documents with the Admin SDK — emulator-only first, dry-run by default, refusing production, with path filters (for example only `lessons/{id}` and `lessons/{id}/answerKey/current`) and a report of what it would change.
2. Rehearse on the emulator: seed fixtures → export → change and delete data (including running the C4 migration) → restore → compare every document with the original export (re-export and diff the decoded values, ignoring `createTime`/`updateTime`).
3. Prove a migration rollback: restore migrated lessons from the export (and, separately, from `legacyBackup/c4`) and confirm grading and reader behaviour match the pre-migration state.
4. Decide how restore treats documents created after the export (keep, report or delete) and missing parents (they need no write).
5. Only after review: a staging restore drill on a disposable copy, never on live staging data.

**Restore (not implemented).** A restore would read the NDJSON files, decode the `__fs` tags back into Firestore types (Timestamp, GeoPoint, DocumentReference, Bytes, VectorValue) and write each document with the Admin SDK to the **same paths in the staging project only**, after a dry-run and approval. For a migration rollback only `lessons/{id}` and `lessons/{id}/answerKey/current` (and deleting `legacyBackup/c4`) need restoring. A restore overwrites documents with the same path and does not remove documents created after the export. Writing a restore tool is a separate, reviewed task.

**Limitations.**
- Not a managed Firestore backup or export and not restorable with `gcloud firestore import`.
- Not an atomic point-in-time snapshot: freeze authoring and student activity while it runs; `updateTime` per document shows what changed.
- Firestore documents only: **not** Firebase Authentication users, IAM, indexes, security rules, Vercel configuration or Storage files.
- Timestamps carry Firestore's own precision (microseconds): nanoseconds written by a client are already truncated when stored, and the export reproduces the stored value exactly.
- `listDocuments()` loads a collection's document references into memory; fine for staging sizes, untested at large scale.
- Reads count against the Spark free quota; if it is exhausted the export reports errors and is partial (no billing is incurred).

**Protecting the export at rest.** It contains student profiles, progress, attempts and confidential answer keys.
- Choose `--out` on an encrypted disk (macOS FileVault on) in a folder that is **not synced** (avoid iCloud-synced Desktop/Documents, Dropbox, Google Drive), or inside an encrypted disk image (`hdiutil create -encryption AES-256 -size 1g -fs APFS -volname StrynkixBackup ~/StrynkixBackup.dmg`).
- Keep the directory permissions (700/600); never attach it to chats, tickets or email; never copy it into the repository (the tool refuses that location).
- Delete it once the migration is accepted and the retention period you choose ends.

## 21. Emulator-only restore rehearsal (2026-10-30; local emulator only)

**Tool.** `scripts/backup/firestore-restore.ts` (`npm run backup:firestore-restore -- …`), logic in `src/lib/backup/firestore-restore.ts`. It reuses the §20 export format, verifier and decoder. **There is no staging or production mode.**

**Safety design.**
- *Target:* `--project` must match `demo-[a-z0-9-]+` (staging and production ids are refused explicitly); `FIRESTORE_EMULATOR_HOST` must be `127.0.0.1`, `localhost` or `[::1]` with a port. Refused as ambiguous: any of `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` set, or `FIREBASE_ADMIN_PROJECT_ID` / `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` naming another project. `--from` must be a real directory (not a symlink) outside the repository.
- *No Firebase SDK:* writes go to the emulator's REST API (`…/documents:commit`, emulator `owner` token) with explicit Firestore `Value` encodings. No credentials, no Application Default Credentials and no metadata server are involved at any point. Before writing, the CLI checks that the host answers `Ok` like the emulator.
- *Validate everything first:* plan mode (the default) verifies the export with `verifyExport` (complete, checksums, manifest, every record) and decodes and encodes every document, with no network request. It refuses an export that isn't `integerEncoding: "bigint"`, contains Firestore-reserved field names (`__…__`) or undecodable values. Writing additionally needs `--restore --confirm-emulator-overwrite`.
- *Destructive behaviour is explicit:* by default the restore overwrites every exported document in full (set semantics) and leaves documents that were created after the export. `--clear-first` wipes the emulator project first (emulator-only endpoint) for an exact copy.
- *Batches:* up to `--batch-size` (default 200, max 500) writes per atomic commit, in a stable order (manifest file order, then line order). Missing parents are not written (they have no fields); their subcollections are.
- *Partial restore:* the run stops at the first rejected batch. Earlier batches are written; the failed batch is atomic and wrote nothing; nothing after it was attempted. The CLI prints the batch number and its first and last document path and exits with code 2. *Rerun semantics:* writes are idempotent full-document sets, so rerunning (after fixing the cause) converges on the export; with `--clear-first` a rerun starts from empty.

**Fidelity.** Exact for strings, booleans, nulls, 64-bit integers (both extremes), doubles including integral doubles, NaN and ±Infinity, timestamps (Firestore's microsecond precision, including pre-1970), references (rewritten to the target project, same path), bytes, geopoints, vectors, nested maps and arrays (including empty ones), and dotted, unicode and emoji keys. **One known exception:** negative zero cannot be expressed over the REST/JSON path (the emulator stores it as +0; the Admin SDK's gRPC path keeps it). Exports containing −0 are refused before any request unless `--accept-negative-zero-as-zero` is given; the plan reports how many there are.

**Rehearsal (automated: `tests/emulator/firestore-restore.emulator.test.ts`, 10/10, projects `demo-strynkix-restore` and `demo-strynkix-restore-nz`).**
1. Seeded 259 documents: every type above, integral doubles written over REST, tag-like values, unicode/dotted keys, nested subcollections, a deleted parent under `lessons` and a root collection that exists only beneath a deleted parent, `answerKey`, `legacyBackup`, `versions`, `quizAttempts`, and 250 bulk documents.
2. Exported (complete) and verified offline.
3. Plan mode: no network, no Firebase module, no change.
4. Damaged the data (changed and deleted fields, deleted documents and subcollection documents, turned a double into an integer, added a new document), then restored: every exported document matched the original exactly; the added document remained (documented overwrite semantics).
5. Restored with `--clear-first`: the project matched the original exactly, document set and every value, including the deleted parent staying absent.
6. Refused before any write or request: tampered checksum, malformed manifest, missing file, extra file, tampered data, reserved field (re-signed), undecodable value (re-signed), inexact integer encoding (re-signed).
7. Refused before anything else: production, staging, non-demo projects, missing or remote emulator host, credentials in the environment, a conflicting project variable, missing confirmation, input inside the repository.
8. Interrupted restore (a 1.1 MB value the emulator rejects in batch 3 of 50): exit 2, exactly 100 documents written, report names `bulk/d100 … bulk/d149`; rerunning the broken export wrote nothing new; rerunning the good export restored the original exactly.
9. Negative zero refused (no request made, data untouched), then accepted explicitly and stored as +0.
10. Migration CLI dry run on the emulator: only local emulator connections (see below).
Every CLI run was observed with `tests/backup/sandbox-hook.cjs`: all sockets went to the local emulator port; the restore CLI never loaded a Firebase module.
Comparison method: a recursive Admin SDK walk (with `useBigInt`) of every collection and subcollection, compared as the canonical tagged JSON.

**Migration CLI environment (reviewed).** It used the same Admin setup as the exporter and, like it, would probe the GCE metadata server. Both CLIs now call `pinAdminEnvironment` (`src/lib/server/admin-env.ts`) before `getAdminServices()`: metadata detection off, ADC ignored, project variables pinned, `FIREBASE_ADMIN_*` cleared for the emulator. The rehearsal proves the migration dry run now stays on the emulator, and a mutation test shows it fails without the call. Clearing `GOOGLE_APPLICATION_CREDENTIALS` is defence in depth that the emulator cannot exercise. The Next.js server routes are unchanged.

**Defect found and fixed.** The C4 migration classifier threw on a quiz block without an `options` list, aborting the whole inventory (safe — nothing written — but not reported). It now reports `invalid_question_block` for manual remediation; regression test added.

**Remaining limitations.**
- Recovery is proven on the emulator only. A staging restore tool does not exist and is out of scope; staging recovery would need a separate, reviewed design (credentials, rules, a disposable target).
- Negative zero is coerced (explicit opt-in only).
- Restore holds one batch in memory but reads each data file into memory; untested on very large exports.
- Firestore-only, like the export: no Auth users, IAM, indexes, rules or Storage.
- Documents larger than Firestore's limits, or other values the server rejects, are only detected at commit time (reported as a partial restore).


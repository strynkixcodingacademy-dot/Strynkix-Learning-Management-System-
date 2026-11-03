# Academy operations: architecture plan (Batch 0)

Scope: student experience, examinations, admissions and people, course pricing and finance, expenses and reports, portfolio and resume. Local only. Nothing is deployed, committed or migrated.

## What already exists and is reused

| Area | Existing module | Reused as |
|---|---|---|
| Trusted writes | `handleContentRoute`, `verifyCaller`, `ReviewError` (src/lib/server/content-route.ts) | Every new API route: body limit, ID-token check with revocation, Zod, error mapping |
| Accounts | `createAccount` (src/lib/server/account-provisioning.ts) | Admission confirmation and staff onboarding create logins through the same flow |
| Enrollment | `enrollments/{courseId}_{studentId}`, seat counter on batches | Admission confirmation writes the same enrollment shape on the server |
| Learning | courses, modules, lessons (blocks), progress, quiz keys, daily plans, assignments and submissions | Unchanged. Lessons gain a `document` block (PDF, slides, documents) |
| Notifications | `notify()` | Evaluations, returned work and certificates notify the student |
| Audit | `auditLog` | Every new privileged write adds an entry in the same transaction |
| UI | AppShell, PageHeader, Card, KpiTile, Tabs, StatusPill, States, Field | All new pages |

## Architecture decisions

1. **New collections are server-only.** The existing default-deny rule already refuses every client read and write on collections without their own match block. All new data is read and written through authenticated API routes using the Admin SDK. These routes authorize from the caller's stored profile, never from the request body. This is the strongest option for finance and personal data. It also means totals are computed on the server instead of in the browser. Rules tests assert the denial.
2. **One assessment engine** (`assessments`, `assessments/{id}/key/current`, `assessmentAttempts`) covers:
   - lesson and module activities: MCQ, short answer, long answer, practical;
   - demo, practice and final examinations.

   Answer keys never leave the server until the assessment's release condition is met. Every attempt is a new document, so earlier attempts are never replaced. The existing in-lesson knowledge-check quiz (server-graded) is kept as it is.
3. **Money is stored as integer paise.** Fee balances come from immutable ledger entries (`feeTransactions`: payment, refund, adjustment, reversal). Each fee account keeps cached totals that are updated in the same transaction as each entry, and they can be recomputed from the ledger at any time. Duplicate payments are refused with a request key (`tx.create` on a deterministic id) and a same-reference check.
4. **Installment status is derived, never stored.** Payments are allocated oldest-first against the schedule, so partial, paid, due and overdue states can't drift from the ledger.
5. **Sequential numbers** (admission number, receipt number, certificate number) come from per-branch or per-academy counter documents, incremented inside the same transaction as the record.
6. **Personal data lives outside `users`.** Date of birth, address, emergency contact and compensation go in `personProfiles/{uid}` (server-only). The widely readable `users` document keeps only what it holds today.
7. **PDF output uses print-ready pages** (browser print or "Save as PDF") built on one shared printable layout. CSV export is one shared helper with spreadsheet formula-injection protection. No new dependencies are added.
8. **File uploads are deferred.** Firebase Storage isn't configured, so attachments are links: GitHub repositories, live URLs and document URLs.

## New collections

`assessments`, `assessments/{id}/key`, `assessmentAttempts`, `attendance`, `certificatePolicies`, `certificates`, `admissions`, `personProfiles`, `counters`, `coursePricing`, `feeAccounts`, `feeTransactions`, `discountRequests`, `expenseCategories`, `expenses`, `recurringExpenses`, `portfolioEntries`, `resumes`.

## Dependencies

Admissions need course pricing to set the fee. Finance needs admissions to create fee accounts. Reports need finance and expenses. Certificates need progress, assessments and attendance. The batches are built in that order.

## Implemented (Batches 1–7)

| Route | Module | Purpose |
|---|---|---|
| `POST /api/assessments` | `src/lib/server/assessments.ts` | Lesson activities and exams: author, publish, start, autosave, submit, evaluate, return, release results |
| `POST /api/attendance` | `attendance.ts` | Take or correct a day's attendance (audited); batch report; student's own attendance |
| `POST /api/certificates` · `GET /api/certificates/verify` | `certificates.ts` | Eligibility rules, eligibility check, issue once, revoke, public verification |
| `POST /api/student` | `student-records.ts` | Student dashboard, My Courses, My Scores |
| `POST /api/admissions` | `admissions.ts` | Admission drafts and confirmation, staff onboarding, people search, profiles |
| `POST /api/finance` | `finance.ts` | Course pricing, fee accounts, ledger entries, receipts, discount approval, rescheduling, reconciliation |
| `POST /api/expenses` | `expenses.ts` | Categories, expenses (void, never deleted), recurring schedules |
| `POST /api/reports` | `reports.ts` | Finance summary, course analytics, academic summary, export rows |
| `POST /api/career` | `career.ts` | Portfolio, recommendations, resumes |

### How fees behave (ledger)

All amounts are integer paise.

- **Fee terms:**
  - `gross` = standard fee + registration fee + other fees, copied from the pricing version at admission. Later price changes never alter an admitted student's fee.
  - `agreed` = gross − approved discount.
  - `due` = agreed + adjustments. Adjustments are charges (+) or waivers (−); waivers need an academy administrator.
  - `collected` = payments − reversed payments − refunds.
  - `balance` = due − collected. Overpayment is refused.
- **Partial payments:** allocated oldest installment first. Installment states (paid, partly paid, overdue, due today, upcoming) are computed from the ledger and never stored.
- **Discounts above the confirmer's limit:** the account stays at the full fee, marked pending. Payments are capped at what would be due if the discount is approved. On approval, the schedule is reduced from the last installment.
- **Corrections:** a payment or refund is corrected by a reversal (at most one per entry). An adjustment is corrected by another adjustment. Ledger entries are never updated or deleted.
- **Refunds:** limited to the amount collected. A refund raises the balance. When a student withdraws, a waiver closes what is no longer owed.
- **Duplicates:**
  - each entry's document id comes from a client request id, so a retry or double click is recorded once;
  - a payment reusing a transaction reference on the same account is refused.
- **Reconciliation:** `reconcile` recomputes the cached totals from the ledger.
- **Numbering:** admission, receipt and certificate numbers come from transactional counters. One receipt per payment; receipts are never reissued.

## Stage 8: Super Admin Command Centre

- **Route.** `POST /api/command` (`src/lib/server/command-centre.ts`) is Super Admin only, checked from the caller's stored profile. Other roles keep their scoped routes, so isolation is unchanged.
- **One finance computation.** `financeSummary()` in `reports.ts` is shared by Finance, Reports and the Command Centre. It also takes course and batch filters and returns outstanding fees at each month end.
- **Totals by server-side aggregation.** Counts use `count()`. Fee totals use `sum()` over `feeAccounts` (agreedFee, totals.adjustments, totals.paid, totals.refunded) and `expenses`. No snapshot collection was added.
- **Pagination.** People lists are ordered by document id with `startAfter`, so equality filters need no extra index and no account is skipped or repeated. Transactions, audit history and announcements are cursor-paginated.
- **Review indicators** (`financialAnomalies`) never change records:
  - overdue installments;
  - a balance still at least 75% unpaid after 60 days;
  - a discount of at least 25% (approved or pending);
  - 2 or more reversals or refunds on one account;
  - staff with 3 or more reversals;
  - an expense more than 3× its category median;
  - stored totals that don't match the ledger.
- **Academic intelligence** (`academicIntel`) runs one academy at a time, optionally narrowed to a branch or course. It shows neutral "needs attention" reasons and lists at most 200 students, saying when more exist.
- **Announcements.** One new collection, `announcements`, server-only. Recipients fetch theirs through `POST /api/announcements`, matched against their stored academy, branch, role and enrollments. Nothing is copied per user. Dismissals are kept in the user's browser.
- **Admin actions** reuse the audited routes for academy and branch changes, account profile changes (role, branch, email; the branch move also assigns a branch manager) and account status.

## Stage 9: Reporting snapshots and reconciliation

- **One calculation.** `periodMetrics()` (`src/lib/reporting/metrics.ts`) defines collected, payments, payment reversals, refunds (net), extra charges, waivers, discounts, expenses, net, and the period-end expected, collected and outstanding figures. `financeSummary()`, snapshots and reconciliation all call it, so their outputs stay identical.
- **Periods** (`src/lib/reporting/periods.ts`) are daily, monthly and yearly in Asia/Kolkata. Money uses the ledger's local business dates. Timestamped academic records use the UTC instants of local midnight.
- **Snapshots** live at `reportSnapshots/{org|academy|branch}_{scope}_{type}_{key}`. Each one holds:
  - scope and period boundaries, plus timezone;
  - finance and academic figures;
  - schema and calculation versions;
  - a source watermark;
  - job ID, status (`generated`, `reconciled`, `mismatched`, `stale`, `failed`) and version.

  Previous versions are kept under `versions/{n}`. No personal data is stored.
- **Jobs** (`snapshotJobs`) use a lease lock per period (`snapshotLocks`, taken with `create()` so only one run wins). Results and per-scope errors are recorded, and a failed job can be retried; the retry links back to the original.
- **Reconciliation** recomputes each snapshot from its scope's source records and compares every metric. It also checks fee accounts' stored totals against their ledger. A mismatch opens a `reconciliationReviews/{snapshot}_v{n}` record. Nothing is corrected automatically.
- **Historical changes** each write a `snapshotInvalidations` record inside their own transaction:
  - backdated payments and refunds;
  - discount decisions;
  - backdated, voided or recurring expenses;
  - attendance recorded for a past date.

  Applying them marks the affected completed snapshots stale, with the reason. Recalculation writes a new version with the reason and keeps the old one.
- **Reporting:** Reports → Financial → Month by month uses a snapshot only when it is reconciled, on the current calculation version and not affected by a pending change. Otherwise it calculates live, and every row is labelled with its source.

## Stage 10: Student engagement, feedback and academy experience

- **Learning day.** A local date with a recorded learning event: a lesson completed, an assessment or assignment submitted, or a class attended (present or late). Opening pages never counts. Streaks, weekly goals and monthly summaries are pure functions in `src/lib/engagement/streaks.ts`.
- **Achievements.** Ten built-in definitions. Academy administrators can turn them off or change the adjustable targets in `achievementSettings/{orgId}`. Evaluation runs on the server, and each award is created once at `achievements/{studentId}_{key}`. Perfect attendance is awarded once per month.
- **Feedback** (`feedback/{studentId}_{type}_{target}`):
  - students give feedback only on things they are part of;
  - one response per target, correctable for 7 days (at most 3 times) until staff respond, with history kept;
  - "hide my name" hides the student's identity in staff views, but the record is kept (the form says so);
  - averages appear from 3 responses; themes come from the tags students choose.
- **Doubts** (`doubts` plus `messages`): visible to the student, their batch's instructors, branch managers and academy administrators. Every message and status change is kept, and both sides are notified.
- **Activities** (`activities`, `activityRegistrations/{activityId}_{studentId}`): seats are checked and counted in a transaction. Staff can create them within their scope; cancelling notifies registered students.
- **Projects** are portfolio entries with a review status (draft, submitted, under review, changes requested, approved):
  - `verified` is set only by an approving instructor of the student's batch, or by a manager;
  - editing an approved project sends it back to draft.
- **Notifications.** Event-based notifications go through `notify()`. Reminders use fixed IDs, one per student per item: closing assessments, upcoming activities, and monthly low-attendance alerts. Students can mute reminders, achievements, attendance and activity notifications (`notificationPreferences`).

## Consolidation (after Stage 10)

- **Student fee view** (`/dashboard/fees`, finance action `my_fees`): read-only, the signed-in student's own accounts only (by `studentId` from the stored profile). It shows totals, installments, payments and refunds. Reasons, notes and who recorded an entry are left out. Students may open receipts for their own payments; any other receipt returns "not found".
- **Reason dialogs:** every reversal, void, cancellation, withdrawal, recalculation and feedback reply uses the in-app dialog (`useConfirm().prompt`) with inline validation instead of `window.prompt`/`window.alert`. Previously, a too-short reason did nothing, and cancelling a feedback reply still marked the feedback.
- **Navigation check:** `e2e/consolidation.spec.ts` opens every navigation entry for student, instructor, Branch Manager, University Admin and Super Admin. It checks that no page refuses access, no page shows an error and each page has exactly one title.

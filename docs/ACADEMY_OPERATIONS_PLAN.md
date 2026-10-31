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

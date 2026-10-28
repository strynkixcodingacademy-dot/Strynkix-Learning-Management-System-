# Strynkix Live Books — Daily Learning & Assignments (Stage 7)

Instructors plan daily learning per batch. Students complete the assigned lessons and submit the daily assignment. The platform records evidence (progress records, server-timestamped submissions, grades) and derives transparent metrics.

## 1. Reused, not duplicated
| Need | Reused |
| :--- | :--- |
| Course content | Existing `courses` / `modules` / `lessons` and the Live Books block renderer. Plans *reference* lesson IDs; content is never copied. |
| Who may see what | Existing enrollments (`{courseId}_{studentId}`) and batches (`instructorUserIds`). |
| Lesson completion | Existing `progress` records. Only the explicit "Mark as Completed" action completes a lesson; opening a lesson records `in_progress`. |
| Assignment / submission | Existing `assignments` and `submissions` collections and types, extended (see §2). |

## 2. Data model

### New: `dailyPlans/{batchId}_{date}`
The deterministic ID allows one plan per batch per calendar day.

| Field | Notes |
| :--- | :--- |
| `orgId`, `branchId`, `courseId`, `batchId` | Must match the batch. Immutable. |
| `date` | `YYYY-MM-DD`, the batch's calendar day. Immutable. |
| `title`, `objectives[]` (≤ 10) | Learning targets shown to students. |
| `lessonIds[]` (≤ 10, unique) | Published lessons of the course. Validated by the service; lesson reads stay gated by lesson rules. |
| `learningDueAt` | ISO-8601 time by which the lessons should be complete. |
| `assignmentId?` | Equals the plan ID when the plan has a daily assignment. |
| `status` | `draft` → `published` → `archived`. Students see only `published`. |
| `publishedAt?`, `createdById`, `createdAt`, `updatedAt` | |

### Extended: `assignments/{planId}` (daily assignment)
New fields: `batchId`, `planId`, `submissionType` (`text` \| `code` \| `text_and_code`). `moduleId` becomes optional.
- `deadline` (ISO) and `totalPoints` are required.
- `description` holds the instructions.
- Once published, `totalPoints` is frozen so past grades stay comparable.
- Legacy course-level assignments (no `batchId`) remain readable but can no longer be written by non-super-admins.

### Extended: `submissions/{assignmentId}_{studentId}`
The deterministic ID allows one submission record per student per assignment; resubmissions update it.

| Field | Notes |
| :--- | :--- |
| `textAnswer?` (≤ 20k), `codeContent?` (≤ 100k) | Stored as text. Never executed. |
| `attemptCount` | 1 on first submit; +1 on every resubmission. |
| `submittedAt` | **Server timestamp** (`request.time`), so lateness can't be forged. Normalised to ISO when read. |
| `score`, `feedback`, `gradedByUserId`, `gradedAt` | Reviewer-only. `gradedAt` is a server timestamp. |

**No file uploads:** Firebase Storage is not configured in this project.

## 3. Submission state machine
```
(none) ──student submit──▶ submitted ──reviewer grade──▶ graded ──reviewer regrade──▶ graded
            ▲                 │  ▲                          │
            │ student edit    │  └─────────────────────────┐│ reviewer request correction
            └─────────────────┘                            ▼▼
                                          resubmit_requested ──student resubmit──▶ submitted
```
- **Students** may create (`submitted`, attempt 1). They may update only from `submitted` (edit before review) or `resubmit_requested` (correction), always back to `submitted`, with attempt +1 and a fresh server timestamp. They can never touch grading fields or move a graded submission.
- **Reviewers** (university admin of the org, branch admin of the batch's branch, or an instructor assigned to the batch):
  - **`graded`** from `submitted`, `graded`, or `resubmit_requested`, with `0 ≤ score ≤ totalPoints`.
  - **`resubmit_requested`** from `submitted` or `graded`, with feedback required.
  - Reviewers may change only `score`, `feedback`, `status`, `gradedByUserId` (= themselves), `gradedAt` (= server time), and `updatedAt`.
- Late is **derived**, never stored: `submittedAt > deadline`. Late submissions are accepted and labelled.

## 4. Permissions (enforced in `firestore.rules`)
| Action | Who |
| :--- | :--- |
| Create / edit / publish plans and daily assignments | super admin, the org's university admin, the batch branch's branch admin, instructors listed on the batch. Batch must be `upcoming`/`in_progress`; IDs, org/branch/course/batch and creator are immutable. |
| Read plans and assignments | Same staff, plus students actively enrolled **in that batch**, and only once published (and the course is published). |
| Read submissions | The student (own), plus the reviewers above. |
| Grade / request corrections | Reviewers above. |

Students can't publish plans, change deadlines, grade, or read other students' work. Hidden buttons are never the security boundary.

## 5. Metrics (`src/lib/learning/metrics.ts`)
All metrics are computed per enrolled course over the student's batch, from published plans **up to today**, using at most the 90 most recent plans and assignments. Future plans and assignments never count against the student.

| Metric | Formula | Not counted |
| :--- | :--- | :--- |
| **Learning completion** | completed assigned lessons ÷ distinct lessons in plans dated ≤ today | Future plans. Shown as "—" when nothing is assigned. |
| **Assignment submission rate** | due assignments with a submission ÷ assignments whose deadline has passed | Future assignments (shown as upcoming). Assignments due before the student's `enrolledAt`. Withdrawn/suspended enrollments are excluded from the dashboard entirely. There is no "excused" status in this MVP. |
| **Assessment performance** | Σ score ÷ Σ totalPoints over submissions in status `graded` | Ungraded work, which is excluded rather than counted as zero. |
| **Overdue** | assigned lessons past `learningDueAt` and not completed; assignments past deadline with no submission | |

The metrics are shown separately and never combined into one score. Publishing new plans adds future work only, so past values don't move.

## 6. Acceptance tests
- **Rules:** cross-tenant, cross-branch and unassigned-instructor denial; student reads only own-batch published plans and assignments; only valid submission transitions; reviewers bound scores; immutable ownership fields; duplicate submission records impossible; forged timestamps rejected.
- **Unit:** state machine, deadline/lateness, metrics formulas (future work excluded, ungraded excluded, pre-enrollment excluded).
- **Emulator workflow** (real service functions): plan → assignment → publish → student sees → late submit → correction → resubmit → grade → metrics.
- **Browser:** instructor creates and publishes a plan; student sees My Day and submits; instructor grades; student sees marks.

## 7. Known limits
- Lesson membership in a plan is validated by the service, not the rules (rules cannot afford a read per lesson). A forged lesson ID grants nothing, because lesson reads remain enrollment-gated.
- Times display in the viewer's browser timezone. The plan `date` is a calendar label chosen by the instructor.
- There are no file uploads, no rubric-criterion scoring UI (total marks only), no excused-work status, and no notifications.
- Capacity, account provisioning and migration still need the trusted server path (`docs/SERVER_SIDE_OPERATIONS.md`).

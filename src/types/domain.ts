/**
 * Strynkix Coding Academy LMS — Core Domain Models
 * Multi-tenant, role-based education platform inspired by modern engineering academies.
 */

// -----------------------------------------------------------------------------
// Role Hierarchy & Tenancy
// -----------------------------------------------------------------------------

export type UserRole =
  | 'super_admin'
  | 'university_admin'
  | 'branch_admin'
  | 'instructor'
  | 'student'
  // Course Design department labels (academy-wide, no branch). The role is a
  // label only; authority comes from UserProfile.courseDesign (see firestore.rules).
  | 'content_lead'
  | 'content_designer';

/** Roles that can hold Course Design membership. */
export const COURSE_DESIGN_ELIGIBLE_ROLES: UserRole[] = ['content_lead', 'content_designer', 'instructor'];

// -----------------------------------------------------------------------------
// Course Design Department Responsibilities & Profile
// -----------------------------------------------------------------------------

export type CourseDesignResponsibility =
  | 'lead'
  | 'curriculum_architect'
  | 'content_developer'
  | 'assessment_designer'
  | 'reviewer';

/** Course Design membership, stored on users/{uid}. Assigned only by a Super Admin. */
export interface CourseDesignProfile {
  department: 'course_design';
  responsibilities: CourseDesignResponsibility[];
  /** Explicit course IDs, or exactly ['*'] for every course in the member's org (explicit grant only). */
  assignedCourseIds: string[];
  assignedAt: string;
  assignedByUserId: string;
}

export type UserStatus = 'active' | 'suspended' | 'invited' | 'pending_verification';

export type EntityStatus = 'draft' | 'published' | 'archived';

// -----------------------------------------------------------------------------
// Content review (Stage C2). `status` stays the publication axis; `review` is
// the review cycle of a draft. Both change only through the trusted server
// route POST /api/content/review, which writes an auditLog entry each time.
// -----------------------------------------------------------------------------
export type ReviewState = 'none' | 'in_review' | 'changes_requested' | 'approved';

export interface ContentReview {
  state: ReviewState;
  submittedById?: string;
  submittedAt?: string;
  /** Last editor of the content when it was submitted (self-approval check). */
  editedById?: string;
  reviewedById?: string;
  reviewedAt?: string;
  /** Reviewer's note: required when requesting changes. */
  comment?: string;
  /**
   * Fingerprint of exactly the content (and answer key) that was approved,
   * computed by the server (Stage C3). Publishing re-checks it.
   */
  approvedContentHash?: string;
}

export type ContentAction = 'submit' | 'reopen' | 'approve' | 'request_changes' | 'publish' | 'unpublish' | 'archive';

/** auditLog/{id}: written only by the server, never updated or deleted. */
export interface AuditEntry {
  orgId: string;
  courseId: string;
  targetType: 'course' | 'lesson';
  targetId: string;
  action: ContentAction | 'assessment_update' | 'assessment_migration';
  /** A user id, or `migration:<runId>` for trusted migrations. */
  actorId: string;
  actorRole: UserRole | 'system';
  fromStatus: EntityStatus;
  toStatus: EntityStatus;
  fromReview: ReviewState;
  toReview: ReviewState;
  /** Super Admin published without a current approval (reason required). */
  override: boolean;
  /** The action applied to a published lesson's working revision (Stage C3). */
  revision?: boolean;
  /** Version created by a publish (Stage C3). */
  version?: number;
  comment?: string;
  reason?: string;
  /** Firestore server commit time. */
  at: unknown;
}

// -----------------------------------------------------------------------------
// 1. Organization (Tenant Root)
// -----------------------------------------------------------------------------
export interface Organization {
  id: string; // Document ID (slug or generated ID)
  name: string;
  slug: string;
  logoUrl?: string;
  website?: string;
  status: 'active' | 'suspended';
  settings: {
    allowedEmailDomains?: string[];
    defaultTimezone: string;
    features: {
      liveBooksEnabled: boolean;
      interactivePlaygrounds: boolean;
      peerReviews: boolean;
    };
  };
  createdAt: string; // ISO string / Timestamp
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 2. Branch
// -----------------------------------------------------------------------------
export interface Branch {
  id: string;
  orgId: string; // Tenant boundary
  name: string;
  code: string; // e.g. "BLR-01", "PUN-01", "REMOTE"
  location: {
    city?: string;
    state?: string;
    country: string;
    isRemote: boolean;
  };
  branchAdminUserIds: string[]; // UIDs of assigned branch administrators
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 3. User Profile (Firestore Document ID === Firebase Auth UID)
// -----------------------------------------------------------------------------
export interface UserProfile {
  id: string; // Firebase Auth UID
  orgId: string; // Primary tenant
  branchId?: string; // Associated branch (mandatory for branch_admin and student)
  role: UserRole;
  email: string;
  displayName: string;
  photoURL?: string;
  phoneNumber?: string;
  status: UserStatus;
  courseDesign?: CourseDesignProfile;
  metadata?: {
    enrolledAt?: string;
    lastLoginAt?: string;
    studentIdNumber?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 4. Course
// -----------------------------------------------------------------------------
export type CourseLevel = 'beginner' | 'intermediate' | 'advanced';

export interface Course {
  id: string;
  orgId: string;
  title: string;
  slug: string;
  tagline: string;
  description: string;
  level: CourseLevel;
  tags: string[];
  prerequisites: string[];
  estimatedWeeks: number;
  status: EntityStatus;
  review?: ContentReview;
  /** Set by every client write (rules enforce it is the writer). */
  lastEditedById?: string;
  /** Latest immutable version (courses/{id}/versions/{n}); set by the server on publish. */
  publishedVersion?: number;
  publishedAt?: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 5. Batch (Cohort running at a Branch)
// -----------------------------------------------------------------------------
// 'archived' hides a batch from day-to-day operations without deleting history.
export type BatchStatus = 'upcoming' | 'in_progress' | 'completed' | 'cancelled' | 'archived';

export interface Batch {
  id: string;
  orgId: string;
  branchId: string;
  courseId: string;
  name: string; // e.g., "Full-Stack Alpha 2026"
  code: string; // e.g., "FSA-26"
  instructorUserIds: string[];
  /** Display names for students, same order as instructorUserIds (owner decision D5). */
  instructorNames?: string[];
  startDate: string;
  endDate?: string;
  maxStudents?: number;
  /** Active seats on a capped batch, kept in step by every enrollment write (D2). */
  activeEnrollmentCount?: number;
  status: BatchStatus;
  createdById?: string; // UID of the administrator who created the batch (immutable)
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 6. Module (High-level Curriculum Chapter)
// -----------------------------------------------------------------------------
export interface Module {
  id: string;
  orgId: string;
  courseId: string;
  title: string;
  slug: string;
  summary: string;
  orderIndex: number;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 7. Lesson (Live Book Units & Content Blocks)
// -----------------------------------------------------------------------------
export type LessonType = 'concept' | 'interactive_code' | 'exercise' | 'project_milestone';

export interface TextBlock {
  id: string;
  type: 'text';
  content: string; // Formatted / Markdown text
}

export interface HeadingBlock {
  id: string;
  type: 'heading';
  level: 1 | 2 | 3 | 4;
  text: string;
}

export interface CodeExampleBlock {
  id: string;
  type: 'code_example';
  code: string;
  language: string; // e.g., 'typescript', 'javascript', 'html', 'css', 'json'
  filename?: string;
  highlightLines?: number[];
  caption?: string;
}

export interface ImageBlock {
  id: string;
  type: 'image';
  url: string;
  altText: string;
  caption?: string;
}

export interface CalloutBlock {
  id: string;
  type: 'callout';
  variant: 'info' | 'tip' | 'warning' | 'danger';
  title?: string;
  content: string;
}

export interface WorkedExampleBlock {
  id: string;
  type: 'worked_example';
  title: string;
  problem: string;
  solutionCode?: string;
  language?: string;
  explanation: string;
}

export interface QuizOption {
  id: string;
  text: string;
}

/**
 * A quiz question. Keyed lessons (Stage C1) carry no answer here: the correct
 * option and explanation live in lessons/{id}/answerKey/current, which students
 * can never read, and grading happens on the server. Legacy lessons still carry
 * them inline until they are migrated.
 */
export interface QuizBlock {
  id: string;
  type: 'quiz';
  question: string;
  options: QuizOption[];
  /** Legacy inline answer; absent in keyed lessons. */
  correctOptionId?: string;
  /** Legacy inline explanation; absent in keyed lessons. */
  explanation?: string;
  hint?: string;
}

/** When a student may see correct answers and explanations. */
export type AnswerReleasePolicy = 'after_pass';

export interface AnswerKeyItem {
  blockId: string;
  correctOptionId: string;
  explanation: string;
}

/** Confidential answer key: lessons/{lessonId}/answerKey/current. Never readable by students. */
export interface LessonAnswerKey {
  orgId: string;
  courseId: string;
  lessonId: string;
  keyVersion: number;
  release: AnswerReleasePolicy;
  items: AnswerKeyItem[];
  updatedById: string;
  updatedAt: string;
}

export interface PracticeTaskBlock {
  id: string;
  type: 'practice_task';
  title: string;
  instructions: string;
  starterCode?: string;
  language?: string;
  hints?: string[];
  expectedOutcome: string;
}

/** A YouTube video embedded in the lesson. */
export interface VideoBlock {
  id: string;
  type: 'video';
  url: string; // YouTube watch / share / embed URL
  title: string;
  caption?: string;
}

export interface ReferenceLink {
  label: string;
  url: string; // https only
  description?: string;
}

/** Further reading: a titled list of external links. */
export interface ReferencesBlock {
  id: string;
  type: 'references';
  title?: string;
  links: ReferenceLink[];
}

export type LessonBlock =
  | TextBlock
  | HeadingBlock
  | CodeExampleBlock
  | ImageBlock
  | CalloutBlock
  | WorkedExampleBlock
  | QuizBlock
  | PracticeTaskBlock
  | VideoBlock
  | ReferencesBlock;

// Backward-compatible alias for existing imports
export type LessonContentBlock = LessonBlock;

export interface Lesson {
  id: string;
  orgId: string;
  courseId: string;
  moduleId: string;
  title: string;
  slug: string;
  type: LessonType;
  orderIndex: number;
  estimatedMinutes: number;
  blocks: LessonBlock[];
  status: EntityStatus;
  review?: ContentReview;
  /** Set by every client write (rules enforce it is the writer). */
  lastEditedById?: string;
  /** Version students currently see (lessons/{id}/versions/{n}); set by the server on publish. */
  publishedVersion?: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Working copy of a published lesson (lessons/{id}/revisions/working, Stage C3).
 * Students never read it; publishing it replaces the live lesson content.
 * Its answers live in lessons/{id}/answerKey/working.
 */
export interface LessonRevision {
  title: string;
  estimatedMinutes: number;
  blocks: LessonBlock[];
  /** Published version this revision started from. */
  baseVersion: number;
  review?: ContentReview;
  lastEditedById: string;
  createdAt: string;
  updatedAt: string;
}

/** Immutable published snapshot of a lesson (lessons/{id}/versions/{n}); server-written. */
export interface LessonVersion {
  version: number;
  orgId: string;
  courseId: string;
  lessonId: string;
  moduleId: string;
  title: string;
  estimatedMinutes: number;
  blocks: LessonBlock[];
  /** Answer key graded for this version (null when the lesson has no quiz). */
  answerKey: { keyVersion: number; items: AnswerKeyItem[] } | null;
  publishedById: string;
  approvedById: string | null;
  override: boolean;
  /** Content that was live before versioning existed (recorded at the first C3 publish). */
  baseline: boolean;
  auditId: string | null;
  publishedAt: unknown;
}

/** Immutable published snapshot of a course's details (courses/{id}/versions/{n}). */
export interface CourseVersion {
  version: number;
  orgId: string;
  courseId: string;
  title: string;
  slug: string;
  tagline: string;
  description: string;
  level: CourseLevel;
  tags: string[];
  prerequisites: string[];
  estimatedWeeks: number;
  publishedById: string;
  approvedById: string | null;
  override: boolean;
  auditId: string;
  publishedAt: unknown;
}

// -----------------------------------------------------------------------------
// 8. Enrollment (Student mapping to Batch & Course)
// -----------------------------------------------------------------------------
export type EnrollmentStatus = 'active' | 'completed' | 'dropped' | 'suspended';

export interface Enrollment {
  id: string; // deterministic `${courseId}_${studentId}`: one enrollment per student per course
  orgId: string;
  branchId: string;
  courseId: string;
  batchId: string;
  studentId: string; // User Profile UID
  status: EnrollmentStatus;
  enrolledAt: string;
  completedAt?: string;
  // Roster snapshot copied from the student profile at enrollment time so
  // instructors can see names without read access to /users.
  studentDisplayName?: string;
  studentEmail?: string;
  enrolledById?: string; // UID of the administrator who created the enrollment
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 9. Progress (Granular Lesson Tracking)
// -----------------------------------------------------------------------------
export type ProgressStatus = 'not_started' | 'in_progress' | 'completed';

export interface Progress {
  id: string; // typically `${studentId}_${lessonId}`
  orgId: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  studentId: string; // User Profile UID
  batchId?: string; // Enrollment batch at time of activity; absent on pre-Stage 6 records
  status: ProgressStatus;
  timeSpentSeconds: number;
  lastAccessedAt: string;
  completedAt?: string;
  /** Server-written summary of quiz attempts (keyed lessons only). Browsers can never write it. */
  quiz?: QuizSummary;
  createdAt: string;
  updatedAt: string;
}

/** Latest/best results and the counters the server uses for attempt limits. */
export interface QuizSummary {
  attemptCount: number;
  bestCorrect: number;
  bestPercent: number;
  lastCorrect: number;
  lastPercent: number;
  total: number;
  passed: boolean;
  keyVersion: number;
  /** Academy-time-zone calendar day (YYYY-MM-DD) that attemptsToday counts. */
  attemptDay: string;
  attemptsToday: number;
  lastAttemptAt: string;
  firstPassedAt?: string;
}

/** One immutable attempt: progress/{progressId}/quizAttempts/{attemptNumber}. Server-written. */
export interface QuizAttempt {
  attemptNumber: number;
  studentId: string;
  orgId: string;
  courseId: string;
  lessonId: string;
  batchId: string;
  keyVersion: number;
  /** Published lesson version the student answered (Stage C3; absent before). */
  lessonVersion?: number | null;
  answers: Record<string, string>;
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
  attemptedAt: string;
}

/** Per-question review, released only after the student has passed. */
export interface QuestionFeedback {
  blockId: string;
  yourAnswer: string | null;
  correctOptionId: string;
  isCorrect: boolean;
  explanation: string;
}

/** Response of POST /api/quiz/attempt. */
export interface QuizAttemptResult {
  attemptNumber: number;
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
  /** True when the lesson is complete after this attempt (never downgraded). */
  lessonCompleted: boolean;
  /** Attempts left today before completion; null once the lesson is complete (unlimited). */
  attemptsRemainingToday: number | null;
  /** Present only when the answer-release policy allows it (after passing). */
  feedback?: QuestionFeedback[];
}

// -----------------------------------------------------------------------------
// 10. Assignment
// -----------------------------------------------------------------------------
export interface AssignmentRubricCriterion {
  id: string;
  title: string;
  maxPoints: number;
  description?: string;
}

export type AssignmentSubmissionType = 'text' | 'code' | 'text_and_code';

export interface Assignment {
  id: string; // daily assignments use their plan ID
  orgId: string;
  courseId: string;
  moduleId?: string;
  lessonId?: string;
  // Stage 7 daily assignments are scoped to one batch and one daily plan.
  batchId?: string;
  planId?: string;
  submissionType?: AssignmentSubmissionType;
  title: string;
  description: string; // instructions
  starterCodeUrl?: string;
  totalPoints: number;
  rubric: AssignmentRubricCriterion[];
  deadline?: string;
  status: EntityStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 11. Submission
// -----------------------------------------------------------------------------
export type SubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'graded'
  | 'resubmit_requested';

export interface Submission {
  id: string; // deterministic `${assignmentId}_${studentId}`: one record per student per assignment
  orgId: string;
  assignmentId: string;
  batchId: string;
  courseId?: string;
  studentId: string; // User Profile UID
  submissionUrl?: string; // GitHub repository or live URL
  textAnswer?: string;
  codeContent?: string; // stored as text, never executed
  notes?: string;
  status: SubmissionStatus;
  attemptCount?: number;
  score?: number;
  feedback?: string;
  gradedByUserId?: string;
  gradedAt?: string; // server timestamp, normalised to ISO on read
  submittedAt: string; // server timestamp, normalised to ISO on read
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 12. Daily Plan (Stage 7: instructor-planned learning for one batch and day)
// -----------------------------------------------------------------------------
export type DailyPlanStatus = 'draft' | 'published' | 'archived';

export interface DailyPlan {
  id: string; // deterministic `${batchId}_${date}`
  orgId: string;
  branchId: string;
  courseId: string;
  batchId: string;
  date: string; // YYYY-MM-DD
  title: string;
  objectives: string[];
  lessonIds: string[]; // references existing published lessons
  learningDueAt: string;
  assignmentId?: string; // equals the plan ID when a daily assignment exists
  status: DailyPlanStatus;
  publishedAt?: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Multi-Tenant Session Context
// -----------------------------------------------------------------------------
export interface AuthenticatedUserSession {
  uid: string;
  email: string | null;
  profile: UserProfile | null;
  tenant: {
    orgId: string;
    branchId?: string;
    role: UserRole;
  } | null;
  isLoading: boolean;
}

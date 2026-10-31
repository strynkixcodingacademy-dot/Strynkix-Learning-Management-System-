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
  | 'student';

export type UserStatus = 'active' | 'suspended' | 'invited' | 'pending_verification';

export type EntityStatus = 'draft' | 'published' | 'archived';

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

export interface QuizBlock {
  id: string;
  type: 'quiz';
  question: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation: string;
  hint?: string;
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

export type LessonBlock =
  | TextBlock
  | HeadingBlock
  | CodeExampleBlock
  | ImageBlock
  | CalloutBlock
  | WorkedExampleBlock
  | QuizBlock
  | PracticeTaskBlock;

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
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
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
// -----------------------------------------------------------------------------
// 13. Weekly Timetable (Stage 8: Super Admin-approved cohort timetable)
// -----------------------------------------------------------------------------

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type ActivityType =
  | 'lesson'
  | 'practical_exercise'
  | 'assignment'
  | 'revision'
  | 'project_work'
  | 'doubt_solving'
  | 'quiz'
  | 'examination'
  | 'practical_assessment';

export type AssessmentType =
  | 'quiz'
  | 'unit_test'
  | 'weekly_test'
  | 'practical_exam'
  | 'coding_assessment'
  | 'revision_test'
  | 'final_exam';

export type AssessmentFormat = 'mcq' | 'coding' | 'written' | 'practical' | 'hybrid';

export interface AssessmentSchedule {
  assessmentType: AssessmentType;
  maxMarks: number;
  passingMarks?: number;
  format: AssessmentFormat;
  syllabus: string;
  instructions: string;
  rules?: string[];
  availabilityWindow?: {
    start: string; // ISO-8601
    end: string;   // ISO-8601
  };
  submissionDeadline?: string; // ISO-8601
}

export interface ActivityCompletionRequirements {
  type: 'lesson_completion' | 'assignment_submission' | 'assessment_submission' | 'manual_acknowledgement';
  minScore?: number;
}

export interface TimetableActivity {
  id: string;
  orderIndex: number;
  type: ActivityType;
  title: string;
  startTime: string; // "HH:mm" (24-hour)
  endTime: string;   // "HH:mm" (24-hour)
  durationMinutes: number;
  courseId: string;
  moduleId?: string;
  lessonId?: string;
  assignmentId?: string;
  assessment?: AssessmentSchedule;
  objectives: string[];
  instructions?: string;
  completionRequirements?: ActivityCompletionRequirements;
}

export interface DaySchedule {
  date: string; // YYYY-MM-DD
  dayOfWeek: DayOfWeek;
  theme?: string;
  activities: TimetableActivity[];
}

export type TimetableStatus = 'draft' | 'submitted' | 'changes_requested' | 'approved';

export interface TimetableRevision {
  id: string; // e.g. "rev_1"
  timetableId: string;
  revisionNumber: number;
  orgId: string;
  branchId: string;
  batchId: string;
  courseId: string;
  weekStartDate: string; // YYYY-MM-DD (Monday)
  weekEndDate: string;   // YYYY-MM-DD (Sunday)
  status: TimetableStatus;
  days: Record<DayOfWeek, DaySchedule>;
  createdById: string;
  submittedById?: string | null;
  submittedAt?: string | null;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  reviewComment?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyTimetable {
  id: string; // deterministic `timetable_${batchId}_${weekStartDate}`
  orgId: string;
  branchId: string;
  batchId: string;
  courseId: string;
  weekStartDate: string; // YYYY-MM-DD (Monday)
  weekEndDate: string;   // YYYY-MM-DD (Sunday)
  activeRevisionId: string | null;
  currentRevisionId: string;
  latestStatus: TimetableStatus;
  createdAt: string;
  updatedAt: string;
}

export type TimetableAuditAction =
  | 'create_draft'
  | 'submit'
  | 'request_changes'
  | 'resubmit'
  | 'approve';

export interface TimetableAuditLog {
  id: string;
  timetableId: string;
  revisionId: string;
  fromStatus: TimetableStatus;
  toStatus: TimetableStatus;
  action: TimetableAuditAction;
  actorUid: string;
  actorRole: UserRole;
  comment?: string;
  timestamp: string; // server timestamp, normalised to ISO on read
}

export type ActivityProgressState =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'overdue'
  | 'blocked';

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

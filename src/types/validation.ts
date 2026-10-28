/**
 * Strynkix Coding Academy LMS — Domain Validation Schemas
 * Implements strict runtime validation, size boundaries (DoS prevention),
 * and security barriers against privilege escalation.
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// Common Primitives
// -----------------------------------------------------------------------------
export const idSchema = z
  .string()
  .min(1, 'ID is required')
  .max(128, 'ID exceeds maximum length of 128 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'ID must contain only alphanumeric characters, underscores, or dashes');

export const titleSchema = z
  .string()
  .min(2, 'Title must be at least 2 characters')
  .max(160, 'Title exceeds maximum length of 160 characters')
  .trim();

export const slugSchema = z
  .string()
  .min(2, 'Slug must be at least 2 characters')
  .max(80, 'Slug exceeds maximum length of 80 characters')
  .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes')
  .trim();

export const textContentSchema = z
  .string()
  .max(50000, 'Content exceeds maximum permitted length')
  .trim();

// -----------------------------------------------------------------------------
// Roles and Tenancy
// -----------------------------------------------------------------------------
export const userRoleEnum = z.enum([
  'super_admin',
  'university_admin',
  'branch_admin',
  'instructor',
  'student',
]);

export const userStatusEnum = z.enum([
  'active',
  'suspended',
  'invited',
  'pending_verification',
]);

export const entityStatusEnum = z.enum(['draft', 'published', 'archived']);

// -----------------------------------------------------------------------------
// Security Constraint: Public Registration vs Admin Creation
// -----------------------------------------------------------------------------

/**
 * Public Self-Registration Schema
 * SECURITY: Administrative roles (super_admin, university_admin, branch_admin, instructor)
 * CANNOT be self-selected by browser clients during public signup.
 */
export const publicStudentSignupSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  displayName: z.string().min(2).max(100).trim(),
  orgId: idSchema,
  branchId: idSchema.optional(),
});

/**
 * Admin User Provisioning Schema (Trusted server-side / Admin only)
 */
export const adminUserProvisionSchema = z.object({
  uid: idSchema,
  email: z.string().email().max(255),
  displayName: z.string().min(2).max(100).trim(),
  role: userRoleEnum,
  orgId: idSchema,
  branchId: idSchema.optional(),
  status: userStatusEnum.default('active'),
  phoneNumber: z.string().max(30).optional(),
});

// -----------------------------------------------------------------------------
// Organization Schema
// -----------------------------------------------------------------------------
export const organizationSchema = z.object({
  name: z.string().min(2).max(120).trim(),
  slug: slugSchema,
  logoUrl: z.string().url().max(500).optional(),
  website: z.string().url().max(500).optional(),
  status: z.enum(['active', 'suspended']).default('active'),
  settings: z.object({
    allowedEmailDomains: z.array(z.string().max(100)).max(20).optional(),
    defaultTimezone: z.string().min(2).max(50).default('UTC'),
    features: z.object({
      liveBooksEnabled: z.boolean().default(true),
      interactivePlaygrounds: z.boolean().default(true),
      peerReviews: z.boolean().default(false),
    }),
  }),
});

// -----------------------------------------------------------------------------
// Branch Schema
// -----------------------------------------------------------------------------
export const branchSchema = z.object({
  orgId: idSchema,
  name: z.string().min(2).max(100).trim(),
  code: z.string().min(2).max(20).trim().toUpperCase(),
  location: z.object({
    city: z.string().max(80).optional(),
    state: z.string().max(80).optional(),
    country: z.string().min(2).max(80),
    isRemote: z.boolean().default(false),
  }),
  branchAdminUserIds: z.array(idSchema).max(10).default([]),
  status: z.enum(['active', 'inactive']).default('active'),
});

// -----------------------------------------------------------------------------
// Course Schema
// -----------------------------------------------------------------------------
export const courseSchema = z.object({
  orgId: idSchema,
  title: titleSchema,
  slug: slugSchema,
  tagline: z.string().max(240).trim(),
  description: textContentSchema,
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  tags: z.array(z.string().max(40)).max(15).default([]),
  prerequisites: z.array(z.string().max(100)).max(10).default([]),
  estimatedWeeks: z.number().int().min(1).max(52),
  status: entityStatusEnum.default('draft'),
});

// -----------------------------------------------------------------------------
// Batch Schema
// -----------------------------------------------------------------------------
export const batchStatusEnum = z.enum(['upcoming', 'in_progress', 'completed', 'cancelled', 'archived']);

// Firestore rules validate instructors by index, so the list is capped at 5.
export const MAX_BATCH_INSTRUCTORS = 5;

const batchInstructorIdsSchema = z
  .array(idSchema)
  .max(MAX_BATCH_INSTRUCTORS, `A batch can have at most ${MAX_BATCH_INSTRUCTORS} instructors`)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Instructor list contains duplicates' });

// Editable fields carry no defaults so partial updates never overwrite stored values.
const batchEditableFields = {
  name: titleSchema,
  code: z.string().trim().min(2).max(30).toUpperCase(),
  instructorUserIds: batchInstructorIdsSchema,
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  maxStudents: z.number().int().min(1).max(200),
  status: batchStatusEnum,
};

const endDateNotBeforeStart = (data: { startDate?: string; endDate?: string }) =>
  !data.startDate || !data.endDate || data.endDate >= data.startDate;

export const batchSchema = z
  .object({
    orgId: idSchema,
    branchId: idSchema,
    courseId: idSchema,
    ...batchEditableFields,
    instructorUserIds: batchInstructorIdsSchema.default([]),
    endDate: batchEditableFields.endDate.optional(),
    maxStudents: batchEditableFields.maxStudents.optional(),
    status: batchStatusEnum.default('upcoming'),
  })
  .refine(endDateNotBeforeStart, {
    message: 'End date cannot be before the start date',
    path: ['endDate'],
  });

/**
 * Editable batch fields. orgId, branchId and courseId are immutable once created.
 */
export const batchUpdateSchema = z
  .object(batchEditableFields)
  .partial()
  .refine(endDateNotBeforeStart, {
    message: 'End date cannot be before the start date',
    path: ['endDate'],
  });

// -----------------------------------------------------------------------------
// Module & Lesson (Live Books) Schemas
// -----------------------------------------------------------------------------
export const moduleSchema = z.object({
  orgId: idSchema,
  courseId: idSchema,
  title: titleSchema,
  slug: slugSchema,
  summary: z.string().max(500).trim(),
  orderIndex: z.number().int().min(0).max(1000),
  status: entityStatusEnum.default('draft'),
});

export const textBlockSchema = z.object({
  id: idSchema,
  type: z.literal('text'),
  content: z.string().min(1).max(50000),
});

export const headingBlockSchema = z.object({
  id: idSchema,
  type: z.literal('heading'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  text: z.string().min(1).max(200).trim(),
});

export const codeExampleBlockSchema = z.object({
  id: idSchema,
  type: z.literal('code_example'),
  code: z.string().min(1).max(50000),
  language: z.string().min(1).max(30).trim(),
  filename: z.string().max(100).optional(),
  highlightLines: z.array(z.number().int().min(1)).max(100).optional(),
  caption: z.string().max(250).optional(),
});

// Enforce safe image URLs (HTTPS or relative paths)
export const imageBlockSchema = z.object({
  id: idSchema,
  type: z.literal('image'),
  url: z.string().min(1).max(1000).refine(
    (u) => u.startsWith('https://') || u.startsWith('/'),
    { message: 'Image URL must use secure https:// or be a relative asset path' }
  ),
  altText: z.string().min(1).max(300).trim(),
  caption: z.string().max(300).optional(),
});

export const calloutBlockSchema = z.object({
  id: idSchema,
  type: z.literal('callout'),
  variant: z.enum(['info', 'tip', 'warning', 'danger']),
  title: z.string().max(100).optional(),
  content: z.string().min(1).max(10000),
});

export const workedExampleBlockSchema = z.object({
  id: idSchema,
  type: z.literal('worked_example'),
  title: z.string().min(2).max(160).trim(),
  problem: z.string().min(5).max(15000),
  solutionCode: z.string().max(50000).optional(),
  language: z.string().max(30).optional(),
  explanation: z.string().min(5).max(15000),
});

export const quizOptionSchema = z.object({
  id: idSchema,
  text: z.string().min(1).max(400).trim(),
});

export const quizBlockSchema = z.object({
  id: idSchema,
  type: z.literal('quiz'),
  question: z.string().min(5).max(2000).trim(),
  options: z.array(quizOptionSchema).min(2).max(8),
  correctOptionId: idSchema,
  explanation: z.string().min(5).max(3000).trim(),
  hint: z.string().max(1000).optional(),
}).refine(
  (data) => data.options.some((opt) => opt.id === data.correctOptionId),
  { message: 'correctOptionId must match one of the provided quiz option IDs' }
);

export const practiceTaskBlockSchema = z.object({
  id: idSchema,
  type: z.literal('practice_task'),
  title: z.string().min(2).max(160).trim(),
  instructions: z.string().min(5).max(20000),
  starterCode: z.string().max(50000).optional(),
  language: z.string().max(30).optional(),
  hints: z.array(z.string().max(1000)).max(10).optional(),
  expectedOutcome: z.string().min(2).max(5000),
});

export const lessonBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  headingBlockSchema,
  codeExampleBlockSchema,
  imageBlockSchema,
  calloutBlockSchema,
  workedExampleBlockSchema,
  quizBlockSchema,
  practiceTaskBlockSchema,
]);

// Backward-compatible alias
export const lessonContentBlockSchema = lessonBlockSchema;

export const lessonSchema = z.object({
  orgId: idSchema,
  courseId: idSchema,
  moduleId: idSchema,
  title: titleSchema,
  slug: slugSchema,
  type: z.enum(['concept', 'interactive_code', 'exercise', 'project_milestone']),
  orderIndex: z.number().int().min(0).max(1000),
  estimatedMinutes: z.number().int().min(1).max(600),
  blocks: z.array(lessonBlockSchema).max(50),
  status: entityStatusEnum.default('draft'),
});

// -----------------------------------------------------------------------------
// Enrollment & Progress Schemas
// -----------------------------------------------------------------------------
export const enrollmentStatusEnum = z.enum(['active', 'completed', 'dropped', 'suspended']);

export const enrollmentSchema = z.object({
  orgId: idSchema,
  branchId: idSchema,
  courseId: idSchema,
  batchId: idSchema,
  studentId: idSchema,
  status: enrollmentStatusEnum.default('active'),
  enrolledAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  studentDisplayName: z.string().max(100).optional(),
  studentEmail: z.string().max(255).optional(),
  enrolledById: idSchema.optional(),
});

export const progressUpdateSchema = z.object({
  orgId: idSchema,
  courseId: idSchema,
  moduleId: idSchema,
  lessonId: idSchema,
  batchId: idSchema,
  status: z.enum(['not_started', 'in_progress', 'completed']),
  timeSpentSeconds: z.number().int().min(0).max(86400),
});

// -----------------------------------------------------------------------------
// Assignment & Submission Schemas
// -----------------------------------------------------------------------------
export const assignmentSchema = z.object({
  orgId: idSchema,
  courseId: idSchema,
  moduleId: idSchema,
  lessonId: idSchema.optional(),
  title: titleSchema,
  description: textContentSchema,
  starterCodeUrl: z.string().url().max(500).optional(),
  totalPoints: z.number().int().min(1).max(1000),
  rubric: z
    .array(
      z.object({
        id: idSchema,
        title: z.string().min(2).max(100),
        maxPoints: z.number().int().min(1).max(500),
        description: z.string().max(300).optional(),
      })
    )
    .max(20),
  deadline: z.string().datetime().optional(),
  status: entityStatusEnum.default('draft'),
});

// -----------------------------------------------------------------------------
// Stage 7: Daily Plans, Daily Assignments, Submissions & Grading
// -----------------------------------------------------------------------------
export const planDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const dailyPlanSchema = z.object({
  orgId: idSchema,
  branchId: idSchema,
  courseId: idSchema,
  batchId: idSchema,
  date: planDateSchema,
  title: titleSchema,
  objectives: z.array(z.string().trim().min(1).max(200)).max(10, 'At most 10 objectives'),
  lessonIds: z
    .array(idSchema)
    .max(10, 'At most 10 lessons per day')
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Lesson list contains duplicates' }),
  learningDueAt: z.string().datetime(),
  status: z.enum(['draft', 'published', 'archived']),
});

export const submissionTypeEnum = z.enum(['text', 'code', 'text_and_code']);

export const dailyAssignmentSchema = z.object({
  title: titleSchema,
  description: z.string().trim().min(5, 'Instructions are required').max(20000),
  submissionType: submissionTypeEnum,
  totalPoints: z.number().int().min(1).max(1000),
  deadline: z.string().datetime(),
});

export const submissionContentSchema = z.object({
  textAnswer: z.string().max(20000).optional(),
  codeContent: z.string().max(100000).optional(),
});

export const gradeSubmissionSchema = z.object({
  score: z.number().min(0).max(1000),
  feedback: z.string().trim().max(5000),
});

export const correctionRequestSchema = z.object({
  feedback: z.string().trim().min(1, 'Explain what needs to be corrected').max(5000),
});

export const studentSubmissionSchema = z.object({
  orgId: idSchema,
  assignmentId: idSchema,
  batchId: idSchema,
  submissionUrl: z.string().url().max(500).optional(),
  codeContent: z.string().max(100000).optional(),
  notes: z.string().max(2000).optional(),
});

export const instructorGradingSchema = z.object({
  score: z.number().min(0).max(1000),
  feedback: z.string().max(5000),
  status: z.enum(['graded', 'resubmit_requested']),
});

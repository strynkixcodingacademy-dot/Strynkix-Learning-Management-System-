/**
 * Strynkix LMS — Daily Learning Service (plans, daily assignments, submissions)
 * Validated client operations; firestore.rules is the enforcement boundary.
 * Every function accepts an optional Firestore instance so the emulator
 * workflow tests exercise this exact code under the real rules.
 */

import {
  collection,
  doc,
  DocumentData,
  Firestore,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { TenantContext } from '@/types/auth';
import {
  Assignment,
  AssignmentSubmissionType,
  Batch,
  Course,
  DailyPlan,
  DailyPlanStatus,
  Enrollment,
  Lesson,
  Module,
  Progress,
  Submission,
} from '@/types/domain';
import {
  correctionRequestSchema,
  dailyAssignmentSchema,
  dailyPlanSchema,
  gradeSubmissionSchema,
  submissionContentSchema,
} from '@/types/validation';
import { canManageBatchScope, isBatchOpenForEnrollment } from '@/lib/batches/scope';
import {
  canReviewerGrade,
  canReviewerRequestCorrection,
  canStudentSubmit,
  getSubmissionContentError,
} from './submission-state';
import { computeLearningMetrics, LearningMetrics, toLocalDateKey } from './metrics';

/** Bounded windows for dashboard reads (see docs/DAILY_LEARNING.md §5). */
export const PLAN_WINDOW = 90;
export const ASSIGNMENT_WINDOW = 90;
const SUBMISSION_WINDOW = 300;

export const planIdFor = (batchId: string, date: string) => `${batchId}_${date}`;
export const submissionIdFor = (assignmentId: string, studentId: string) => `${assignmentId}_${studentId}`;

function formatZodError(error: { issues: { message: string }[] }): string {
  return error.issues.map((i) => i.message).join('; ');
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  // Pending server timestamps (local writes) read as null until confirmed.
  return undefined;
}

/** Converts server timestamps to ISO strings so the rest of the app sees one shape. */
export function normalizeSubmission(id: string, data: DocumentData): Submission {
  return {
    ...(data as Submission),
    id,
    submittedAt: toIso(data.submittedAt) ?? '',
    gradedAt: toIso(data.gradedAt),
  };
}

/** Teaching authority as enforced by canTeachBatch() in firestore.rules. */
export function canTeachBatch(tenant: TenantContext | null, uid: string, batch: Batch): boolean {
  if (!tenant) return false;
  if (canManageBatchScope(tenant, batch)) return true;
  return tenant.role === 'instructor' && tenant.orgId === batch.orgId && batch.instructorUserIds.includes(uid);
}

async function getPublishedLessons(courseId: string, orgId: string, fs: Firestore): Promise<Lesson[]> {
  const snap = await getDocs(
    query(collection(fs, 'lessons'), where('courseId', '==', courseId), where('orgId', '==', orgId), where('status', '==', 'published'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lesson));
}

// -----------------------------------------------------------------------------
// Plans (staff)
// -----------------------------------------------------------------------------

export interface PlanInput {
  date: string;
  title: string;
  objectives: string[];
  lessonIds: string[];
  learningDueAt: string;
}

export async function getBatchPlans(batch: Batch, fs: Firestore = db): Promise<DailyPlan[]> {
  const snap = await getDocs(
    query(
      collection(fs, 'dailyPlans'),
      where('orgId', '==', batch.orgId),
      where('batchId', '==', batch.id),
      orderBy('date', 'desc'),
      limit(120)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyPlan));
}

export async function getPlan(planId: string, fs: Firestore = db): Promise<DailyPlan | null> {
  const snap = await getDoc(doc(fs, 'dailyPlans', planId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as DailyPlan) : null;
}

/** Creates a draft plan, or updates the editable fields of an existing plan. */
export async function savePlan(
  batch: Batch,
  input: PlanInput,
  tenant: TenantContext | null,
  uid: string,
  existing: DailyPlan | null,
  fs: Firestore = db
): Promise<DailyPlan> {
  if (!canTeachBatch(tenant, uid, batch)) throw new Error('You are not authorized to plan learning for this batch.');
  if (!isBatchOpenForEnrollment(batch.status)) throw new Error(`This batch is ${batch.status.replace('_', ' ')}; plans are read-only.`);

  const parsed = dailyPlanSchema.safeParse({
    orgId: batch.orgId,
    branchId: batch.branchId,
    courseId: batch.courseId,
    batchId: batch.id,
    date: existing?.date ?? input.date,
    title: input.title,
    objectives: input.objectives.map((o) => o.trim()).filter(Boolean),
    lessonIds: input.lessonIds,
    learningDueAt: input.learningDueAt,
    status: existing?.status ?? 'draft',
  });
  if (!parsed.success) throw new Error(`Invalid plan: ${formatZodError(parsed.error)}`);
  const data = parsed.data;

  // Rules cannot afford one read per lesson, so membership is verified here.
  const published = new Set((await getPublishedLessons(batch.courseId, batch.orgId, fs)).map((l) => l.id));
  const foreign = data.lessonIds.filter((id) => !published.has(id));
  if (foreign.length) throw new Error('Some selected lessons are not published lessons of this course.');

  const now = new Date().toISOString();
  if (existing) {
    const changes = {
      title: data.title,
      objectives: data.objectives,
      lessonIds: data.lessonIds,
      learningDueAt: data.learningDueAt,
      updatedAt: now,
    };
    await updateDoc(doc(fs, 'dailyPlans', existing.id), changes);
    return { ...existing, ...changes };
  }

  const id = planIdFor(batch.id, data.date);
  // A getDoc on a missing plan is denied by rules (no resource to authorize
  // against); a batch-scoped query returns empty instead.
  const sameDay = await getDocs(
    query(collection(fs, 'dailyPlans'), where('orgId', '==', batch.orgId), where('batchId', '==', batch.id), where('date', '==', data.date))
  );
  if (!sameDay.empty) {
    throw new Error(`A plan already exists for ${data.date}. Open it to edit.`);
  }
  const record: DailyPlan = { id, ...data, createdById: uid, createdAt: now, updatedAt: now };
  await setDoc(doc(fs, 'dailyPlans', id), record);
  return record;
}

/** Publishes or archives a plan together with its daily assignment (atomic). */
export async function setPlanStatus(
  plan: DailyPlan,
  status: DailyPlanStatus,
  assignment: Assignment | null,
  fs: Firestore = db
): Promise<void> {
  const now = new Date().toISOString();
  const batch = writeBatch(fs);
  batch.update(
    doc(fs, 'dailyPlans', plan.id),
    withoutUndefined({
      status,
      publishedAt: status === 'published' && !plan.publishedAt ? now : undefined,
      updatedAt: now,
    })
  );
  if (assignment) {
    batch.update(doc(fs, 'assignments', assignment.id), { status, updatedAt: now });
  }
  await batch.commit();
}

// -----------------------------------------------------------------------------
// Daily assignments (staff)
// -----------------------------------------------------------------------------

export interface DailyAssignmentInput {
  title: string;
  description: string;
  submissionType: AssignmentSubmissionType;
  totalPoints: number;
  deadline: string;
}

export async function getAssignment(assignmentId: string, fs: Firestore = db): Promise<Assignment | null> {
  const snap = await getDoc(doc(fs, 'assignments', assignmentId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Assignment) : null;
}

/** Creates or updates the plan's daily assignment (ID = plan ID). */
export async function saveDailyAssignment(
  plan: DailyPlan,
  input: DailyAssignmentInput,
  uid: string,
  existing: Assignment | null,
  fs: Firestore = db
): Promise<Assignment> {
  const parsed = dailyAssignmentSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid assignment: ${formatZodError(parsed.error)}`);
  const data = parsed.data;
  const now = new Date().toISOString();

  if (existing) {
    if (existing.status === 'published' && data.totalPoints !== existing.totalPoints) {
      throw new Error('Marks cannot change after the assignment is published.');
    }
    const changes = { ...data, updatedAt: now };
    await updateDoc(doc(fs, 'assignments', existing.id), changes);
    return { ...existing, ...changes };
  }

  const record: Assignment = {
    id: plan.id,
    orgId: plan.orgId,
    courseId: plan.courseId,
    batchId: plan.batchId,
    planId: plan.id,
    ...data,
    rubric: [],
    status: plan.status === 'published' ? 'published' : 'draft',
    createdById: uid,
    createdAt: now,
    updatedAt: now,
  };
  // The assignment rule reads the (already existing) plan, so both writes can be atomic.
  const batch = writeBatch(fs);
  batch.set(doc(fs, 'assignments', record.id), record);
  batch.update(doc(fs, 'dailyPlans', plan.id), { assignmentId: record.id, updatedAt: now });
  await batch.commit();
  return record;
}

// -----------------------------------------------------------------------------
// Student reads
// -----------------------------------------------------------------------------

export async function getStudentPlans(enrollment: Enrollment, fs: Firestore = db): Promise<DailyPlan[]> {
  const snap = await getDocs(
    query(
      collection(fs, 'dailyPlans'),
      where('orgId', '==', enrollment.orgId),
      where('courseId', '==', enrollment.courseId),
      where('batchId', '==', enrollment.batchId),
      where('status', '==', 'published'),
      orderBy('date', 'desc'),
      limit(PLAN_WINDOW)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyPlan));
}

export async function getStudentAssignments(enrollment: Enrollment, fs: Firestore = db): Promise<Assignment[]> {
  const snap = await getDocs(
    query(
      collection(fs, 'assignments'),
      where('orgId', '==', enrollment.orgId),
      where('courseId', '==', enrollment.courseId),
      where('batchId', '==', enrollment.batchId),
      where('status', '==', 'published'),
      orderBy('deadline', 'desc'),
      limit(ASSIGNMENT_WINDOW)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Assignment));
}

export async function getStudentSubmissions(orgId: string, studentId: string, fs: Firestore = db): Promise<Submission[]> {
  const snap = await getDocs(
    query(collection(fs, 'submissions'), where('orgId', '==', orgId), where('studentId', '==', studentId), limit(SUBMISSION_WINDOW))
  );
  return snap.docs.map((d) => normalizeSubmission(d.id, d.data()));
}

/** Owner-scoped query: "not submitted yet" is an empty result rather than a permission error. */
function ownSubmissionQuery(orgId: string, studentId: string, assignmentId: string, fs: Firestore) {
  return query(
    collection(fs, 'submissions'),
    where('orgId', '==', orgId),
    where('studentId', '==', studentId),
    where('assignmentId', '==', assignmentId)
  );
}

export async function getOwnSubmission(orgId: string, studentId: string, assignmentId: string, fs: Firestore = db) {
  const snap = await getDocs(ownSubmissionQuery(orgId, studentId, assignmentId, fs));
  const d = snap.docs.find((x) => x.id === submissionIdFor(assignmentId, studentId));
  return d ? normalizeSubmission(d.id, d.data()) : null;
}

export function listenToOwnSubmission(
  orgId: string,
  studentId: string,
  assignmentId: string,
  onChange: (submission: Submission | null) => void,
  onError: (err: Error) => void,
  fs: Firestore = db
): Unsubscribe {
  return onSnapshot(
    ownSubmissionQuery(orgId, studentId, assignmentId, fs),
    (snap) => {
      const d = snap.docs.find((x) => x.id === submissionIdFor(assignmentId, studentId));
      onChange(d ? normalizeSubmission(d.id, d.data()) : null);
    },
    onError
  );
}

// -----------------------------------------------------------------------------
// Student submission
// -----------------------------------------------------------------------------

export async function submitAssignment(
  params: { assignment: Assignment; studentId: string; textAnswer?: string; codeContent?: string },
  fs: Firestore = db
): Promise<void> {
  const { assignment, studentId } = params;
  if (!assignment.batchId) throw new Error('This assignment is not linked to a batch.');

  const content = submissionContentSchema.safeParse({
    textAnswer: params.textAnswer?.trim() ? params.textAnswer : undefined,
    codeContent: params.codeContent?.trim() ? params.codeContent : undefined,
  });
  if (!content.success) throw new Error(`Invalid submission: ${formatZodError(content.error)}`);
  const contentError = getSubmissionContentError(assignment.submissionType, content.data);
  if (contentError) throw new Error(contentError);

  const existing = await getOwnSubmission(assignment.orgId, studentId, assignment.id, fs);
  if (!canStudentSubmit(existing)) {
    throw new Error('This submission has been graded and can no longer be changed.');
  }

  const now = new Date().toISOString();
  const ref = doc(fs, 'submissions', submissionIdFor(assignment.id, studentId));
  if (!existing) {
    await setDoc(
      ref,
      withoutUndefined({
        id: ref.id,
        orgId: assignment.orgId,
        assignmentId: assignment.id,
        batchId: assignment.batchId,
        courseId: assignment.courseId,
        studentId,
        ...content.data,
        status: 'submitted',
        attemptCount: 1,
        submittedAt: serverTimestamp(),
        createdAt: now,
        updatedAt: now,
      })
    );
    return;
  }

  await updateDoc(
    ref,
    withoutUndefined({
      ...content.data,
      status: 'submitted',
      attemptCount: (existing.attemptCount ?? 1) + 1,
      submittedAt: serverTimestamp(),
      updatedAt: now,
    })
  );
}

// -----------------------------------------------------------------------------
// Review (staff)
// -----------------------------------------------------------------------------

function assignmentSubmissionsQuery(assignment: Assignment, fs: Firestore) {
  return query(
    collection(fs, 'submissions'),
    where('orgId', '==', assignment.orgId),
    where('batchId', '==', assignment.batchId),
    where('assignmentId', '==', assignment.id)
  );
}

export async function getAssignmentSubmissions(assignment: Assignment, fs: Firestore = db): Promise<Submission[]> {
  const snap = await getDocs(assignmentSubmissionsQuery(assignment, fs));
  return snap.docs.map((d) => normalizeSubmission(d.id, d.data()));
}

export function listenToAssignmentSubmissions(
  assignment: Assignment,
  onChange: (submissions: Submission[]) => void,
  onError: (err: Error) => void,
  fs: Firestore = db
): Unsubscribe {
  return onSnapshot(
    assignmentSubmissionsQuery(assignment, fs),
    (snap) => onChange(snap.docs.map((d) => normalizeSubmission(d.id, d.data()))),
    onError
  );
}

export async function gradeSubmission(
  submission: Submission,
  assignment: Assignment,
  input: { score: number; feedback: string },
  uid: string,
  fs: Firestore = db
): Promise<void> {
  const parsed = gradeSubmissionSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid grade: ${formatZodError(parsed.error)}`);
  if (parsed.data.score > assignment.totalPoints) {
    throw new Error(`Score cannot exceed ${assignment.totalPoints} marks.`);
  }
  if (!canReviewerGrade(submission.status)) throw new Error('This submission cannot be graded in its current state.');
  await updateDoc(doc(fs, 'submissions', submission.id), {
    status: 'graded',
    score: parsed.data.score,
    feedback: parsed.data.feedback,
    gradedByUserId: uid,
    gradedAt: serverTimestamp(),
    updatedAt: new Date().toISOString(),
  });
}

export async function requestCorrection(
  submission: Submission,
  input: { feedback: string },
  uid: string,
  fs: Firestore = db
): Promise<void> {
  const parsed = correctionRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error(formatZodError(parsed.error));
  if (!canReviewerRequestCorrection(submission.status)) {
    throw new Error('A correction cannot be requested in the current state.');
  }
  await updateDoc(doc(fs, 'submissions', submission.id), {
    status: 'resubmit_requested',
    feedback: parsed.data.feedback,
    gradedByUserId: uid,
    gradedAt: serverTimestamp(),
    updatedAt: new Date().toISOString(),
  });
}

// -----------------------------------------------------------------------------
// Student course overview (dashboard aggregate)
// -----------------------------------------------------------------------------

export interface StudentCourseOverview {
  enrollment: Enrollment;
  course: Course;
  modules: Module[];
  lessons: Lesson[];
  progress: Progress[];
  plans: DailyPlan[];
  assignments: Assignment[];
  submissions: Submission[];
  metrics: LearningMetrics;
  /** Completed published lessons ÷ published lessons for the whole course. */
  courseCompletion: { completed: number; total: number; percentage: number | null };
}

/**
 * Loads one enrolled course for the student dashboard with bounded queries.
 * `allSubmissions` is the student's own submissions, loaded once for all courses.
 */
export async function loadStudentCourseOverview(
  enrollment: Enrollment,
  studentId: string,
  allSubmissions: Submission[],
  now: Date = new Date(),
  fs: Firestore = db
): Promise<StudentCourseOverview | null> {
  const courseSnap = await getDoc(doc(fs, 'courses', enrollment.courseId));
  if (!courseSnap.exists()) return null;
  const course = { id: courseSnap.id, ...courseSnap.data() } as Course;

  const [lessons, modulesSnap, progressSnap, plans, assignments] = await Promise.all([
    getPublishedLessons(enrollment.courseId, enrollment.orgId, fs),
    getDocs(
      query(collection(fs, 'modules'), where('courseId', '==', enrollment.courseId), where('orgId', '==', enrollment.orgId), where('status', '==', 'published'))
    ),
    getDocs(
      query(
        collection(fs, 'progress'),
        where('orgId', '==', enrollment.orgId),
        where('courseId', '==', enrollment.courseId),
        where('studentId', '==', studentId)
      )
    ),
    getStudentPlans(enrollment, fs),
    getStudentAssignments(enrollment, fs),
  ]);
  const progress = progressSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Progress));
  const modules = modulesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Module));
  const assignmentIds = new Set(assignments.map((a) => a.id));
  const submissions = allSubmissions.filter((s) => assignmentIds.has(s.assignmentId));

  const publishedIds = new Set(lessons.map((l) => l.id));
  const completed = new Set(progress.filter((p) => p.status === 'completed' && publishedIds.has(p.lessonId)).map((p) => p.lessonId)).size;

  return {
    enrollment,
    course,
    modules,
    lessons,
    progress,
    plans,
    assignments,
    submissions,
    metrics: computeLearningMetrics({
      plans,
      assignments,
      submissions,
      progress,
      enrolledAt: enrollment.enrolledAt,
      now,
      today: toLocalDateKey(now),
    }),
    courseCompletion: {
      completed,
      total: lessons.length,
      percentage: lessons.length ? Math.round((completed / lessons.length) * 100) : null,
    },
  };
}

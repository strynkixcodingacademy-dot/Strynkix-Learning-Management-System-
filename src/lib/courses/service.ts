/**
 * Strynkix LMS — Course Authoring & Curriculum Management Service
 * Provides validated creation, modification, ordering, and publishing for
 * courses, modules, and Live Book lessons.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  writeBatch,
  orderBy,
  limit,
  startAfter,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { postWithIdToken } from '@/lib/api/authed';
import type { StructureRequest } from '@/lib/server/content-structure';
import { db } from '@/lib/firebase/client';
import { AuditEntry, ContentAction, ContentReview, Course, Module, Lesson, LessonAnswerKey, LessonBlock, LessonRevision, LessonVersion, CourseLevel, LessonType, EntityStatus, QuizBlock, UserProfile } from '@/types/domain';
import {
  courseSchema,
  moduleSchema,
  lessonSchema,
} from '@/types/validation';

export interface CreateCourseInput {
  id?: string;
  orgId: string;
  title: string;
  slug: string;
  tagline: string;
  description: string;
  level: CourseLevel;
  tags?: string[];
  prerequisites?: string[];
  estimatedWeeks: number;
  status?: EntityStatus;
  createdById: string;
}

export interface CreateModuleInput {
  id?: string;
  orgId: string;
  courseId: string;
  title: string;
  slug: string;
  summary: string;
  orderIndex: number;
  status?: EntityStatus;
}

export interface CreateLessonInput {
  id?: string;
  orgId: string;
  courseId: string;
  moduleId: string;
  title: string;
  slug: string;
  type: LessonType;
  orderIndex: number;
  estimatedMinutes: number;
  blocks: LessonBlock[];
  status?: EntityStatus;
  createdById: string;
}

/**
 * Loads all courses (including drafts) for an administrator or instructor.
 */
export async function getAdminCourses(orgId?: string): Promise<Course[]> {
  const coll = collection(db, 'courses');
  const q = orgId ? query(coll, where('orgId', '==', orgId)) : coll;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Course));
}

export const COURSE_PAGE_SIZE = 24;

export interface CoursePage { courses: Course[]; cursor: QueryDocumentSnapshot | null; hasMore: boolean }

/**
 * One page of the authoring catalogue, title order (milestone G14). Filters
 * run in Firestore, so only one page is ever read. Without orgId (Super
 * Admin) it spans every academy.
 */
export async function getCoursesPage(params: { orgId?: string; status?: EntityStatus; after?: QueryDocumentSnapshot | null; pageSize?: number }): Promise<CoursePage> {
  const size = params.pageSize ?? COURSE_PAGE_SIZE;
  const constraints: QueryConstraint[] = [
    ...(params.orgId ? [where('orgId', '==', params.orgId)] : []),
    ...(params.status ? [where('status', '==', params.status)] : []),
    orderBy('title'),
    ...(params.after ? [startAfter(params.after)] : []),
    limit(size + 1),
  ];
  const snap = await getDocs(query(collection(db, 'courses'), ...constraints));
  const docs = snap.docs.slice(0, size);
  return { courses: docs.map((d) => ({ id: d.id, ...d.data() } as Course)), cursor: docs.length ? docs[docs.length - 1] : null, hasMore: snap.docs.length > size };
}

/**
 * Courses a Course Design member may open. Org-wide scope ('*') lists the org;
 * explicit scope reads each assigned course (an org-wide query would be denied).
 * Courses outside the member's org or unreadable are skipped (fail closed).
 */
export async function getCourseDesignCourses(profile: Pick<UserProfile, 'orgId' | 'courseDesign'>): Promise<Course[]> {
  const scope = profile.courseDesign?.assignedCourseIds ?? [];
  if (scope[0] === '*') return getAdminCourses(profile.orgId);
  const loaded = await Promise.all(scope.map((id) => getCourseById(id).catch(() => null)));
  return loaded.filter((c): c is Course => c !== null && c.orgId === profile.orgId);
}

/**
 * Loads a single course by ID.
 */
export async function getCourseById(courseId: string): Promise<Course | null> {
  const ref = doc(db, 'courses', courseId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Course;
}

/**
 * Creates a new course record in Firestore.
 */
export async function createCourse(input: CreateCourseInput): Promise<Course> {
  // Validate schema
  const parsed = courseSchema.parse({
    orgId: input.orgId,
    title: input.title,
    slug: input.slug,
    tagline: input.tagline,
    description: input.description,
    level: input.level,
    tags: input.tags || [],
    prerequisites: input.prerequisites || [],
    estimatedWeeks: input.estimatedWeeks,
    status: input.status || 'draft',
  });

  const courseId = input.id || `course_${input.slug.replace(/[^a-z0-9_-]/g, '_')}_${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  const newCourse: Course = {
    id: courseId,
    orgId: parsed.orgId,
    title: parsed.title,
    slug: parsed.slug,
    tagline: parsed.tagline,
    description: parsed.description,
    level: parsed.level,
    tags: parsed.tags,
    prerequisites: parsed.prerequisites,
    estimatedWeeks: parsed.estimatedWeeks,
    status: parsed.status,
    lastEditedById: input.createdById,
    createdById: input.createdById,
    createdAt: now,
    updatedAt: now,
  };

  const ref = doc(db, 'courses', courseId);
  await setDoc(ref, newCourse);
  return newCourse;
}

/**
 * Updates an existing course's metadata. Status and review change only through
 * performContentAction (Stage C2).
 */
export async function updateCourse(
  courseId: string,
  updates: Partial<Omit<Course, 'id' | 'orgId' | 'createdAt' | 'createdById' | 'status' | 'review' | 'lastEditedById'>>,
  editorId: string
): Promise<void> {
  const ref = doc(db, 'courses', courseId);
  const now = new Date().toISOString();
  await updateDoc(ref, {
    ...updates,
    lastEditedById: editorId,
    updatedAt: now,
  });
}

/**
 * Loads all modules for a given course.
 */
export async function getModulesForCourse(courseId: string, orgId: string): Promise<Module[]> {
  const q = query(
    collection(db, 'modules'),
    where('courseId', '==', courseId),
    where('orgId', '==', orgId)
  );
  const snap = await getDocs(q);
  const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Module));
  return loaded.sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Creates a module within a course.
 */
export async function createModule(input: CreateModuleInput): Promise<Module> {
  const parsed = moduleSchema.parse({
    orgId: input.orgId,
    courseId: input.courseId,
    title: input.title,
    slug: input.slug,
    summary: input.summary,
    orderIndex: input.orderIndex,
    status: input.status || 'draft',
  });

  const moduleId = input.id || `mod_${input.slug.replace(/[^a-z0-9_-]/g, '_')}_${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  const newModule: Module = {
    id: moduleId,
    orgId: parsed.orgId,
    courseId: parsed.courseId,
    title: parsed.title,
    slug: parsed.slug,
    summary: parsed.summary,
    orderIndex: parsed.orderIndex,
    status: parsed.status,
    createdAt: now,
    updatedAt: now,
  };

  const ref = doc(db, 'modules', moduleId);
  await setDoc(ref, newModule);
  return newModule;
}

/**
 * Updates an existing module.
 */
export async function updateModule(
  moduleId: string,
  updates: Partial<Omit<Module, 'id' | 'orgId' | 'courseId' | 'createdAt'>>
): Promise<void> {
  const ref = doc(db, 'modules', moduleId);
  const now = new Date().toISOString();
  await updateDoc(ref, {
    ...updates,
    updatedAt: now,
  });
}

/**
 * Loads all lessons for a specific course across all modules.
 */
export async function getLessonsForCourse(courseId: string, orgId: string): Promise<Lesson[]> {
  const q = query(
    collection(db, 'lessons'),
    where('courseId', '==', courseId),
    where('orgId', '==', orgId)
  );
  const snap = await getDocs(q);
  const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lesson));
  return loaded.sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Creates a Live Book lesson with validated block content.
 */
export async function createLesson(input: CreateLessonInput): Promise<Lesson> {
  const parsed = lessonSchema.parse({
    orgId: input.orgId,
    courseId: input.courseId,
    moduleId: input.moduleId,
    title: input.title,
    slug: input.slug,
    type: input.type,
    orderIndex: input.orderIndex,
    estimatedMinutes: input.estimatedMinutes,
    blocks: input.blocks,
    status: input.status || 'draft',
  });

  const lessonId = input.id || `les_${input.slug.replace(/[^a-z0-9_-]/g, '_')}_${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  const newLesson: Lesson = {
    id: lessonId,
    orgId: parsed.orgId,
    courseId: parsed.courseId,
    moduleId: parsed.moduleId,
    title: parsed.title,
    slug: parsed.slug,
    type: parsed.type,
    orderIndex: parsed.orderIndex,
    estimatedMinutes: parsed.estimatedMinutes,
    blocks: parsed.blocks,
    status: parsed.status,
    lastEditedById: input.createdById,
    createdAt: now,
    updatedAt: now,
  };

  const ref = doc(db, 'lessons', lessonId);
  await setDoc(ref, newLesson);
  return newLesson;
}

/**
 * Reads a lesson's confidential answer key (authors and reviewers only; the
 * rules deny students). Returns null when the lesson has no key yet.
 */
export async function getLessonAnswerKey(lessonId: string): Promise<LessonAnswerKey | null> {
  const snap = await getDoc(doc(db, 'lessons', lessonId, 'answerKey', 'current'));
  return snap.exists() ? (snap.data() as LessonAnswerKey) : null;
}

/**
 * Saves Block Studio content of a draft lesson (Stage C1, audited since
 * milestone G50). The server strips quiz answers into the confidential answer
 * key and writes both, with an audit entry, in one transaction.
 */
export async function saveLessonContent(
  lesson: Pick<Lesson, 'id' | 'orgId' | 'courseId'>,
  updates: { title: string; estimatedMinutes: number; blocks: LessonBlock[] },
  _authorId?: string
): Promise<void> {
  void _authorId; // identity comes from the ID token
  await postWithIdToken('/api/content/lesson', { lessonId: lesson.id, ...updates });
}

export interface ContentActionInput {
  targetType: 'course' | 'lesson';
  targetId: string;
  action: ContentAction;
  comment?: string;
  reason?: string;
}

export interface ContentActionResult {
  targetType: 'course' | 'lesson';
  targetId: string;
  status: EntityStatus;
  review: ContentReview;
  override: boolean;
  auditId: string;
}

/**
 * Review and publication transitions (Stage C2): submit, reopen, approve,
 * request changes, publish, unpublish, archive. Decided and audited by the
 * server; throws ApiError with the server's reason when refused.
 */
export async function performContentAction(input: ContentActionInput): Promise<ContentActionResult> {
  return postWithIdToken<ContentActionResult>('/api/content/review', input);
}

/**
 * Replaces a lesson's quiz questions and answer key through the server, which
 * leaves every other block untouched (Assessment Designers, Stage C2).
 */
export async function saveLessonAssessment(lessonId: string, questions: QuizBlock[]): Promise<{ questionCount: number; keyVersion: number }> {
  return postWithIdToken('/api/content/assessment', { lessonId, questions });
}

/**
 * Loads the working revision of a published lesson and its answers (Stage C3).
 * Both are null when nobody has started changing the published lesson.
 */
export async function getLessonRevision(lessonId: string): Promise<{ revision: LessonRevision | null; workingKey: LessonAnswerKey | null }> {
  const [rev, key] = await Promise.all([
    getDoc(doc(db, 'lessons', lessonId, 'revisions', 'working')),
    getDoc(doc(db, 'lessons', lessonId, 'answerKey', 'working')),
  ]);
  return { revision: rev.exists() ? (rev.data() as LessonRevision) : null, workingKey: key.exists() ? (key.data() as LessonAnswerKey) : null };
}

/**
 * Saves changes to a published lesson as its working revision (Stage C3).
 * Students keep seeing the published version until the revision is reviewed
 * and the Super Admin publishes it. The server writes the revision and its
 * answers (answerKey/working) with an audit entry (milestone G50).
 */
export async function saveLessonRevision(
  lesson: Pick<Lesson, 'id' | 'orgId' | 'courseId' | 'publishedVersion'>,
  updates: { title: string; estimatedMinutes: number; blocks: LessonBlock[] },
  _authorId?: string
): Promise<void> {
  void _authorId; // identity comes from the ID token
  await postWithIdToken('/api/content/lesson', { lessonId: lesson.id, ...updates });
}

/** Throws away the working revision of a published lesson (not while in review or approved). */
export async function discardLessonRevision(lessonId: string): Promise<void> {
  const { revision, workingKey } = await getLessonRevision(lessonId);
  const batch = writeBatch(db);
  if (revision) batch.delete(doc(db, 'lessons', lessonId, 'revisions', 'working'));
  if (workingKey) batch.delete(doc(db, 'lessons', lessonId, 'answerKey', 'working'));
  await batch.commit();
}

/** Immutable published versions of a lesson, newest first (staff only). */
export async function getLessonVersions(lesson: Pick<Lesson, 'id' | 'orgId' | 'courseId'>): Promise<LessonVersion[]> {
  const snap = await getDocs(query(
    collection(db, 'lessons', lesson.id, 'versions'),
    where('orgId', '==', lesson.orgId),
    where('courseId', '==', lesson.courseId)
  ));
  return snap.docs.map((d) => d.data() as LessonVersion).sort((a, b) => b.version - a.version);
}

/** Review, publication and assessment history of one course or lesson, newest first. */
export async function getContentHistory(target: { orgId: string; courseId: string; targetId: string }): Promise<AuditEntry[]> {
  const snap = await getDocs(query(
    collection(db, 'auditLog'),
    where('orgId', '==', target.orgId),
    where('courseId', '==', target.courseId),
    where('targetId', '==', target.targetId)
  ));
  const at = (e: AuditEntry) => (e.at as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
  return snap.docs.map((d) => d.data() as AuditEntry).sort((a, b) => at(b) - at(a));
}

/**
 * Course details and structure changes (milestone G28–G30): authorized,
 * validated and audited on the server; throws ApiError with the reason if refused.
 */
export async function changeCourseStructure(req: StructureRequest): Promise<void> {
  await postWithIdToken('/api/content/structure', req);
}

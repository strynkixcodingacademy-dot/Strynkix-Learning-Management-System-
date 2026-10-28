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
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { Course, Module, Lesson, LessonBlock, CourseLevel, LessonType, EntityStatus } from '@/types/domain';
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
    createdById: input.createdById,
    createdAt: now,
    updatedAt: now,
  };

  const ref = doc(db, 'courses', courseId);
  await setDoc(ref, newCourse);
  return newCourse;
}

/**
 * Updates an existing course's metadata.
 */
export async function updateCourse(
  courseId: string,
  updates: Partial<Omit<Course, 'id' | 'orgId' | 'createdAt' | 'createdById'>>
): Promise<void> {
  const ref = doc(db, 'courses', courseId);
  const now = new Date().toISOString();
  await updateDoc(ref, {
    ...updates,
    updatedAt: now,
  });
}

/**
 * Toggles or updates the publication status of a course.
 */
export async function setCourseStatus(courseId: string, status: EntityStatus): Promise<void> {
  return updateCourse(courseId, { status });
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
    createdAt: now,
    updatedAt: now,
  };

  const ref = doc(db, 'lessons', lessonId);
  await setDoc(ref, newLesson);
  return newLesson;
}

/**
 * Updates lesson metadata and content blocks.
 */
export async function updateLesson(
  lessonId: string,
  updates: Partial<Omit<Lesson, 'id' | 'orgId' | 'courseId' | 'createdAt'>>
): Promise<void> {
  const ref = doc(db, 'lessons', lessonId);
  const now = new Date().toISOString();
  await updateDoc(ref, {
    ...updates,
    updatedAt: now,
  });
}

/**
 * Updates the publish status of a lesson.
 */
export async function setLessonStatus(lessonId: string, status: EntityStatus): Promise<void> {
  return updateLesson(lessonId, { status });
}

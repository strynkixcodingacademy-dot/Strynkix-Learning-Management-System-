/**
 * Strynkix LMS — Live Books Firestore Service Layer
 * Clean, validated data-access methods for courses, modules, lessons, and student progress telemetry.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  Firestore,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { Course, Module, Lesson, Progress, ProgressStatus } from '@/types/domain';
import { lessonBlockSchema } from '@/types/validation';

export interface CourseWithCurriculum {
  course: Course;
  modules: Module[];
  lessons: Lesson[];
}

/**
 * Loads a single course and its full curriculum (modules + lessons).
 * For students (allowDrafts = false), strictly filters out draft courses and lessons.
 */
export async function getCourseWithCurriculum(
  courseId: string,
  orgId: string,
  allowDrafts = false
): Promise<CourseWithCurriculum | null> {
  // 1. Fetch Course Document
  const courseDocRef = doc(db, 'courses', courseId);
  const courseSnap = await getDoc(courseDocRef);

  if (!courseSnap.exists()) {
    return null;
  }

  const course = { id: courseSnap.id, ...courseSnap.data() } as Course;
  if (course.orgId !== orgId) {
    return null; // Tenant mismatch
  }

  // Publication gate: Non-admin students cannot view draft courses
  if (!allowDrafts && course.status !== 'published') {
    return null;
  }

  // 2. Fetch Modules
  const modulesQuery = allowDrafts
    ? query(
        collection(db, 'modules'),
        where('courseId', '==', courseId),
        where('orgId', '==', orgId)
      )
    : query(
        collection(db, 'modules'),
        where('courseId', '==', courseId),
        where('orgId', '==', orgId),
        where('status', '==', 'published')
      );
  const modulesSnap = await getDocs(modulesQuery);
  const modules = modulesSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Module)
  );

  // 3. Fetch Lessons
  const lessonsQuery = allowDrafts
    ? query(
        collection(db, 'lessons'),
        where('courseId', '==', courseId),
        where('orgId', '==', orgId)
      )
    : query(
        collection(db, 'lessons'),
        where('courseId', '==', courseId),
        where('orgId', '==', orgId),
        where('status', '==', 'published')
      );
  const lessonsSnap = await getDocs(lessonsQuery);
  const lessons = lessonsSnap.docs.map((d) => {
    const raw = { id: d.id, ...d.data() } as Lesson;
    if (Array.isArray(raw.blocks)) {
      raw.blocks = raw.blocks.filter((b) => lessonBlockSchema.safeParse(b).success);
    }
    return raw;
  });

  return { course, modules, lessons };
}

/**
 * Loads a specific lesson by ID with tenant boundary verification.
 * For students (allowDrafts = false), strictly rejects unpublished draft lessons.
 * Filters out any malformed blocks that fail runtime schema validation.
 */
export async function getLesson(
  lessonId: string,
  orgId: string,
  allowDrafts = false
): Promise<Lesson | null> {
  const lessonDocRef = doc(db, 'lessons', lessonId);
  const lessonSnap = await getDoc(lessonDocRef);

  if (!lessonSnap.exists()) {
    return null;
  }

  const lesson = { id: lessonSnap.id, ...lessonSnap.data() } as Lesson;
  if (lesson.orgId !== orgId) {
    return null;
  }

  if (!allowDrafts && lesson.status !== 'published') {
    return null;
  }

  if (Array.isArray(lesson.blocks)) {
    lesson.blocks = lesson.blocks.filter((b) => lessonBlockSchema.safeParse(b).success);
  }

  return lesson;
}

/**
 * Loads all progress records for a given student in a course.
 * Includes tenant orgId constraint for strict query-rule compatibility.
 */
export async function getStudentCourseProgress(
  courseId: string,
  studentId: string,
  orgId: string
): Promise<Progress[]> {
  const progressQuery = query(
    collection(db, 'progress'),
    where('orgId', '==', orgId),
    where('courseId', '==', courseId),
    where('studentId', '==', studentId)
  );

  const snap = await getDocs(progressQuery);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Progress));
}

/**
 * Updates or creates a student progress record in Firestore.
 * Employs collision-resistant compound key: ${studentId}_${courseId}_${lessonId}.
 * batchId must be the student's current enrollment batch for the course; rules
 * reject progress for courses the student is not enrolled in.
 * `firestore` defaults to the app client; tests inject an emulator instance.
 */
export async function recordLessonProgress(
  params: {
    studentId: string;
    orgId: string;
    courseId: string;
    moduleId: string;
    lessonId: string;
    batchId: string;
    status: ProgressStatus;
    timeSpentSeconds?: number;
  },
  firestore: Firestore = db
): Promise<void> {
  const progressId = `${params.studentId}_${params.courseId}_${params.lessonId}`;
  const progressDocRef = doc(firestore, 'progress', progressId);

  const now = new Date().toISOString();
  // A getDoc on a not-yet-created record is denied by rules (there is no
  // resource to prove ownership against); an owner-scoped query returns empty.
  const existingQuery = await getDocs(
    query(
      collection(firestore, 'progress'),
      where('orgId', '==', params.orgId),
      where('studentId', '==', params.studentId),
      where('courseId', '==', params.courseId),
      where('lessonId', '==', params.lessonId)
    )
  );
  const existingSnap = existingQuery.docs.find((d) => d.id === progressId);

  if (!existingSnap) {
    const newRecord: Progress = {
      id: progressId,
      orgId: params.orgId,
      courseId: params.courseId,
      moduleId: params.moduleId,
      lessonId: params.lessonId,
      studentId: params.studentId,
      batchId: params.batchId,
      status: params.status,
      timeSpentSeconds: params.timeSpentSeconds || 60,
      lastAccessedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    // Firestore rejects undefined field values, so completedAt is only set when known.
    if (params.status === 'completed') {
      newRecord.completedAt = now;
    }
    await setDoc(progressDocRef, newRecord);
  } else {
    const existing = existingSnap.data() as Progress;
    const updatedRecord: Partial<Progress> = {
      // Re-tags legacy records and follows the student if they change batches.
      batchId: params.batchId,
      status: params.status === 'completed' ? 'completed' : existing.status,
      timeSpentSeconds: (existing.timeSpentSeconds || 0) + (params.timeSpentSeconds || 30),
      lastAccessedAt: now,
      updatedAt: now,
    };

    if (params.status === 'completed' && !existing.completedAt) {
      updatedRecord.completedAt = now;
    }

    await setDoc(progressDocRef, updatedRecord, { merge: true });
  }
}

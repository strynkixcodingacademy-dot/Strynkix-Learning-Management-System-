/**
 * Strynkix LMS — Live Books Curriculum & Navigation Utilities
 * Manages curriculum sequencing, deterministic lesson ordering,
 * previous/next navigation, progress aggregation, and resume pointers.
 */

import { Module, Lesson, Progress } from '@/types/domain';

export interface FlattenedCurriculumLesson extends Lesson {
  moduleTitle: string;
  moduleOrderIndex: number;
}

export interface AdjacentLessonsResult {
  currentLesson: Lesson | null;
  currentModule: Module | null;
  prevLesson: Lesson | null;
  nextLesson: Lesson | null;
  currentIndex: number;
  totalLessons: number;
}

/**
 * Sorts modules by orderIndex and lessons within each module by orderIndex.
 * Produces a linear sequence for consistent Previous / Next lesson traversal.
 */
export function getSortedCurriculumLessons(
  modules: Module[],
  lessons: Lesson[]
): FlattenedCurriculumLesson[] {
  const sortedModules = [...modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const moduleMap = new Map<string, Module>(sortedModules.map((m) => [m.id, m]));

  const sortedLessons = [...lessons].sort((a, b) => {
    const modA = moduleMap.get(a.moduleId);
    const modB = moduleMap.get(b.moduleId);
    const modOrderA = modA?.orderIndex ?? 999;
    const modOrderB = modB?.orderIndex ?? 999;

    if (modOrderA !== modOrderB) {
      return modOrderA - modOrderB;
    }
    return a.orderIndex - b.orderIndex;
  });

  return sortedLessons.map((lesson) => {
    const mod = moduleMap.get(lesson.moduleId);
    return {
      ...lesson,
      moduleTitle: mod?.title ?? 'General Curriculum',
      moduleOrderIndex: mod?.orderIndex ?? 0,
    };
  });
}

/**
 * Calculates previous and next lesson pointers for a given lesson ID.
 */
export function getAdjacentLessons(
  modules: Module[],
  lessons: Lesson[],
  currentLessonId: string
): AdjacentLessonsResult {
  const linearLessons = getSortedCurriculumLessons(modules, lessons);
  const currentIndex = linearLessons.findIndex((l) => l.id === currentLessonId);

  if (currentIndex === -1) {
    return {
      currentLesson: null,
      currentModule: null,
      prevLesson: null,
      nextLesson: null,
      currentIndex: -1,
      totalLessons: linearLessons.length,
    };
  }

  const currentLesson = linearLessons[currentIndex];
  const currentModule = modules.find((m) => m.id === currentLesson.moduleId) || null;
  const prevLesson = currentIndex > 0 ? linearLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < linearLessons.length - 1 ? linearLessons[currentIndex + 1] : null;

  return {
    currentLesson,
    currentModule,
    prevLesson,
    nextLesson,
    currentIndex,
    totalLessons: linearLessons.length,
  };
}

/**
 * Calculates course completion percentage and statistics.
 */
export function calculateCourseProgress(
  totalLessons: number,
  completedLessonIds: Set<string> | string[]
): { completedCount: number; totalCount: number; percentage: number } {
  if (totalLessons <= 0) {
    return { completedCount: 0, totalCount: 0, percentage: 0 };
  }

  const completedSet = completedLessonIds instanceof Set ? completedLessonIds : new Set(completedLessonIds);
  const completedCount = completedSet.size;
  const percentage = Math.min(100, Math.round((completedCount / totalLessons) * 100));

  return {
    completedCount,
    totalCount: totalLessons,
    percentage,
  };
}

/**
 * Determines the best lesson for a student to resume their learning:
 * 1. The most recently accessed unfinished lesson.
 * 2. If all accessed lessons are completed, the next sequentially unstarted lesson.
 * 3. Falls back to the first lesson in the curriculum.
 */
export function getResumeLesson(
  modules: Module[],
  lessons: Lesson[],
  progressList: Progress[]
): Lesson | null {
  const linear = getSortedCurriculumLessons(modules, lessons);
  if (linear.length === 0) return null;

  const progressMap = new Map<string, Progress>(
    progressList.map((p) => [p.lessonId, p])
  );

  // Check if there is an in_progress lesson sorted by lastAccessedAt descending
  const inProgressRecords = progressList
    .filter((p) => p.status === 'in_progress')
    .sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime());

  if (inProgressRecords.length > 0) {
    const candidate = linear.find((l) => l.id === inProgressRecords[0].lessonId);
    if (candidate) return candidate;
  }

  // Find the first uncompleted lesson in sequential curriculum order
  const firstUncompleted = linear.find((l) => {
    const p = progressMap.get(l.id);
    return !p || p.status !== 'completed';
  });

  if (firstUncompleted) {
    return firstUncompleted;
  }

  // If everything is completed, return the first lesson
  return linear[0];
}

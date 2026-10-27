/**
 * Strynkix LMS — Unit Tests for Live Book Navigation and Curriculum Sequencing
 */

import { describe, it, expect } from 'vitest';
import {
  getSortedCurriculumLessons,
  getAdjacentLessons,
  calculateCourseProgress,
  getResumeLesson,
} from '@/lib/livebook/curriculum';
import { Module, Lesson, Progress } from '@/types/domain';

const mockModules: Module[] = [
  {
    id: 'mod_2',
    orgId: 'strynkix',
    courseId: 'c1',
    title: 'Module 2: Advanced React',
    slug: 'advanced-react',
    summary: 'Hooks and context',
    orderIndex: 2,
    status: 'published',
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
  },
  {
    id: 'mod_1',
    orgId: 'strynkix',
    courseId: 'c1',
    title: 'Module 1: Foundations',
    slug: 'foundations',
    summary: 'Core concepts',
    orderIndex: 1,
    status: 'published',
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
  },
];

const mockLessons: Lesson[] = [
  {
    id: 'l_2_1',
    orgId: 'strynkix',
    courseId: 'c1',
    moduleId: 'mod_2',
    title: 'Lesson 2.1: Context API',
    slug: 'context-api',
    type: 'concept',
    orderIndex: 1,
    estimatedMinutes: 20,
    blocks: [],
    status: 'published',
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
  },
  {
    id: 'l_1_2',
    orgId: 'strynkix',
    courseId: 'c1',
    moduleId: 'mod_1',
    title: 'Lesson 1.2: Functions',
    slug: 'functions',
    type: 'interactive_code',
    orderIndex: 2,
    estimatedMinutes: 25,
    blocks: [],
    status: 'published',
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
  },
  {
    id: 'l_1_1',
    orgId: 'strynkix',
    courseId: 'c1',
    moduleId: 'mod_1',
    title: 'Lesson 1.1: Syntax Basics',
    slug: 'syntax-basics',
    type: 'concept',
    orderIndex: 1,
    estimatedMinutes: 15,
    blocks: [],
    status: 'published',
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
  },
];

describe('Curriculum Sorting & Adjacent Lesson Navigation', () => {
  it('deterministically sorts lessons by module.orderIndex then lesson.orderIndex', () => {
    const sorted = getSortedCurriculumLessons(mockModules, mockLessons);
    expect(sorted.map((l) => l.id)).toEqual(['l_1_1', 'l_1_2', 'l_2_1']);
    expect(sorted[0].moduleTitle).toBe('Module 1: Foundations');
  });

  it('correctly provides prev and next pointers for the first lesson', () => {
    const nav = getAdjacentLessons(mockModules, mockLessons, 'l_1_1');
    expect(nav.currentLesson?.id).toBe('l_1_1');
    expect(nav.currentModule?.id).toBe('mod_1');
    expect(nav.prevLesson).toBeNull();
    expect(nav.nextLesson?.id).toBe('l_1_2');
    expect(nav.currentIndex).toBe(0);
    expect(nav.totalLessons).toBe(3);
  });

  it('correctly provides prev and next pointers across module boundaries', () => {
    const nav = getAdjacentLessons(mockModules, mockLessons, 'l_1_2');
    expect(nav.prevLesson?.id).toBe('l_1_1');
    expect(nav.nextLesson?.id).toBe('l_2_1'); // crosses from mod_1 to mod_2!
  });

  it('correctly provides prev and next pointers for the final lesson', () => {
    const nav = getAdjacentLessons(mockModules, mockLessons, 'l_2_1');
    expect(nav.prevLesson?.id).toBe('l_1_2');
    expect(nav.nextLesson).toBeNull();
  });

  it('handles non-existent lesson ID safely', () => {
    const nav = getAdjacentLessons(mockModules, mockLessons, 'invalid_id');
    expect(nav.currentLesson).toBeNull();
    expect(nav.prevLesson).toBeNull();
    expect(nav.nextLesson).toBeNull();
    expect(nav.currentIndex).toBe(-1);
  });
});

describe('Course Progress & Resume Logic', () => {
  it('calculates progress percentage accurately', () => {
    expect(calculateCourseProgress(4, ['l1', 'l2'])).toEqual({
      completedCount: 2,
      totalCount: 4,
      percentage: 50,
    });

    expect(calculateCourseProgress(0, [])).toEqual({
      completedCount: 0,
      totalCount: 0,
      percentage: 0,
    });
  });

  it('resumes from the most recently accessed in-progress lesson', () => {
    const progressList: Progress[] = [
      {
        id: 'p1',
        orgId: 'strynkix',
        courseId: 'c1',
        moduleId: 'mod_1',
        lessonId: 'l_1_1',
        studentId: 'user_1',
        status: 'completed',
        timeSpentSeconds: 300,
        lastAccessedAt: '2026-10-28T01:00:00Z',
        createdAt: '2026-10-28T01:00:00Z',
        updatedAt: '2026-10-28T01:00:00Z',
      },
      {
        id: 'p2',
        orgId: 'strynkix',
        courseId: 'c1',
        moduleId: 'mod_1',
        lessonId: 'l_1_2',
        studentId: 'user_1',
        status: 'in_progress',
        timeSpentSeconds: 120,
        lastAccessedAt: '2026-10-28T01:10:00Z', // More recent
        createdAt: '2026-10-28T01:10:00Z',
        updatedAt: '2026-10-28T01:10:00Z',
      },
    ];

    const resumeLesson = getResumeLesson(mockModules, mockLessons, progressList);
    expect(resumeLesson?.id).toBe('l_1_2');
  });

  it('resumes from the next unstarted lesson if all previous are completed', () => {
    const progressList: Progress[] = [
      {
        id: 'p1',
        orgId: 'strynkix',
        courseId: 'c1',
        moduleId: 'mod_1',
        lessonId: 'l_1_1',
        studentId: 'user_1',
        status: 'completed',
        timeSpentSeconds: 300,
        lastAccessedAt: '2026-10-28T01:00:00Z',
        createdAt: '2026-10-28T01:00:00Z',
        updatedAt: '2026-10-28T01:00:00Z',
      },
    ];

    const resumeLesson = getResumeLesson(mockModules, mockLessons, progressList);
    expect(resumeLesson?.id).toBe('l_1_2');
  });

  it('resumes from the first lesson if no progress records exist', () => {
    const resumeLesson = getResumeLesson(mockModules, mockLessons, []);
    expect(resumeLesson?.id).toBe('l_1_1');
  });
});

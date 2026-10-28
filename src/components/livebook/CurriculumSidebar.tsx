'use client';

/**
 * Strynkix Live Books — course outline for the lesson reader.
 * Shows where you are in the book (ribbon), what's done, and lets you jump.
 */

import React from 'react';
import Link from 'next/link';
import { Bookmark, CheckCircle2, Circle, CircleDot } from 'lucide-react';
import { Course, Lesson, Module, Progress } from '@/types/domain';
import { getSortedCurriculumLessons, calculateCourseProgress } from '@/lib/livebook/curriculum';
import { ProgressBar } from '@/components/ui/Progress';
import { cx } from '@/components/ui/tones';

interface CurriculumSidebarProps {
  course: Course;
  modules: Module[];
  lessons: Lesson[];
  activeLessonId: string;
  progressList: Progress[];
  onNavigate?: () => void;
}

export function CurriculumOutline({ course, modules, lessons, activeLessonId, progressList, onNavigate }: CurriculumSidebarProps) {
  const completed = new Set(progressList.filter((p) => p.status === 'completed').map((p) => p.lessonId));
  const started = new Set(progressList.filter((p) => p.status === 'in_progress').map((p) => p.lessonId));
  const { percentage, completedCount, totalCount } = calculateCourseProgress(lessons.length, completed);
  const ordered = getSortedCurriculumLessons(modules, lessons);
  const sortedModules = [...modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const position = ordered.findIndex((l) => l.id === activeLessonId) + 1;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link href={`/courses/${course.id}`} onClick={onNavigate} className="block text-sm font-bold leading-snug text-ink hover:text-brand-ink">
          {course.title}
        </Link>
        <ProgressBar value={percentage} label="Course progress" size="sm" />
        <p className="text-xs text-ink-3">{completedCount} of {totalCount} lessons complete{position > 0 ? ` · you’re on lesson ${position}` : ''}</p>
      </div>

      <nav aria-label="Course outline" className="space-y-4">
        {sortedModules.map((m, mi) => {
          const moduleLessons = ordered.filter((l) => l.moduleId === m.id);
          if (moduleLessons.length === 0) return null;
          return (
            <div key={m.id}>
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                {mi + 1}. {m.title}
              </div>
              <ul>
                {moduleLessons.map((lesson) => {
                  const active = lesson.id === activeLessonId;
                  const done = completed.has(lesson.id);
                  const Icon = done ? CheckCircle2 : started.has(lesson.id) ? CircleDot : Circle;
                  return (
                    <li key={lesson.id}>
                      <Link
                        href={`/courses/${course.id}/lessons/${lesson.id}`}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cx(
                          'relative flex items-start gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors',
                          active ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-ink-2 hover:bg-surface-muted hover:text-ink'
                        )}
                      >
                        <Icon className={cx('mt-0.5 w-4 h-4 shrink-0', done ? 'text-success' : active ? 'text-brand' : 'text-ink-4')}
                          aria-label={done ? 'Completed' : started.has(lesson.id) ? 'In progress' : 'Not started'} />
                        <span className="min-w-0 flex-1 leading-snug">{lesson.title}</span>
                        {active && <Bookmark className="mt-0.5 w-3.5 h-3.5 shrink-0 fill-warning text-warning-ink" aria-hidden="true" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

/** Desktop rail wrapper (kept for existing imports). */
export function CurriculumSidebar(props: CurriculumSidebarProps) {
  return (
    <aside className="hidden lg:block w-72 shrink-0 border-r border-line bg-surface">
      <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-4 py-6">
        <CurriculumOutline {...props} />
      </div>
    </aside>
  );
}

'use client';

/**
 * Strynkix Live Books — Learning Path.
 * Modules are chapters; lessons sit on a rail in order. The yellow ribbon marks
 * "you are here" and lessons assigned for today. Every row has an explicit action.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { BookOpen, Bookmark, Check, ChevronDown, Code2, Dumbbell, Flag, Timer, type LucideIcon } from 'lucide-react';
import { Lesson, LessonType, Module, Progress } from '@/types/domain';
import { StatusPill } from '@/components/ui/StatusPill';
import { buttonClasses } from '@/components/ui/Button';
import { cx } from '@/components/ui/tones';
import { LESSON_STATE_LOOK, LessonState } from './LearningBits';
import { lessonExcerpt } from './CoursePanels';

export const LESSON_TYPE_LOOK: Record<LessonType, { label: string; icon: LucideIcon }> = {
  concept: { label: 'Concept', icon: BookOpen },
  interactive_code: { label: 'Interactive code', icon: Code2 },
  exercise: { label: 'Exercise', icon: Dumbbell },
  project_milestone: { label: 'Milestone', icon: Flag },
};

export function lessonStateOf(progress: Progress[], lessonId: string): LessonState {
  const p = progress.find((x) => x.lessonId === lessonId);
  return p?.status === 'completed' ? 'completed' : p?.status === 'in_progress' ? 'in_progress' : 'pending';
}

function Chapter({
  module,
  index,
  lessons,
  courseId,
  progress,
  currentLessonId,
  todayLessonIds,
  defaultOpen,
}: {
  module: Module;
  index: number;
  lessons: Lesson[];
  courseId: string;
  progress: Progress[];
  currentLessonId: string | null;
  todayLessonIds: Set<string>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const done = lessons.filter((l) => lessonStateOf(progress, l.id) === 'completed').length;
  const complete = lessons.length > 0 && done === lessons.length;
  const panelId = `chapter-${module.id}`;

  return (
    <li className="rounded-card border border-line bg-surface shadow-card">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-center gap-4 rounded-card p-4 text-left transition-colors hover:bg-canvas sm:p-5"
        >
          <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-extrabold',
            complete ? 'bg-success-soft text-success-ink' : 'bg-brand-soft text-brand-ink')}>
            {complete ? <Check className="w-5 h-5" strokeWidth={3} aria-hidden="true" /> : index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Module {index + 1}</span>
            <span className="block text-base font-bold leading-snug text-ink">{module.title}</span>
            {module.summary && <span className="mt-0.5 block line-clamp-1 text-sm text-ink-3">{module.summary}</span>}
          </span>
          <span className="hidden text-sm text-ink-3 sm:block">{done}/{lessons.length} done</span>
          <ChevronDown className={cx('w-5 h-5 shrink-0 text-ink-3 transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </h3>

      {open && (
        <ol id={panelId} className="border-t border-line px-4 py-3 sm:px-5 animate-fade">
          {lessons.length === 0 && <li className="py-3 text-sm text-ink-3">No published lessons in this module yet.</li>}
          {lessons.map((lesson, li) => {
            const state = lessonStateOf(progress, lesson.id);
            const look = LESSON_STATE_LOOK[state];
            const type = LESSON_TYPE_LOOK[lesson.type] ?? LESSON_TYPE_LOOK.concept;
            const isCurrent = lesson.id === currentLessonId;
            const isToday = todayLessonIds.has(lesson.id);
            const excerpt = lessonExcerpt(lesson);
            return (
              <li key={lesson.id} className="relative flex gap-4 py-3">
                {li < lessons.length - 1 && <span aria-hidden="true" className={cx('absolute left-[15px] top-11 -bottom-3 w-0.5', state === 'completed' ? 'bg-success-line' : 'bg-line')} />}
                <span aria-hidden="true" className={cx('relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold',
                  state === 'completed' ? 'border-success bg-success text-white' : isCurrent ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface text-ink-3')}>
                  {state === 'completed' ? <Check className="w-4 h-4" strokeWidth={3} /> : `${index + 1}.${li + 1}`}
                </span>
                <div className={cx('flex min-w-0 flex-1 flex-col gap-3 rounded-xl sm:flex-row sm:items-start', isCurrent && 'bg-brand-soft/50 -m-2 p-2')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/courses/${courseId}/lessons/${lesson.id}`} className="text-[15px] font-semibold text-ink hover:text-brand-ink">
                        {lesson.title}
                      </Link>
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-warning px-1.5 py-0.5 text-[11px] font-bold text-ink">
                          <Bookmark className="w-3 h-3 fill-current" aria-hidden="true" /> You are here
                        </span>
                      )}
                      {isToday && !isCurrent && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-bold text-warning-ink">
                          <Bookmark className="w-3 h-3" aria-hidden="true" /> Today
                        </span>
                      )}
                    </div>
                    {excerpt && <p className="mt-1 line-clamp-2 text-sm text-ink-3">{excerpt}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                      <StatusPill tone={look.tone} icon={look.icon} size="sm">{look.label}</StatusPill>
                      <span className="inline-flex items-center gap-1"><type.icon className="w-3.5 h-3.5" aria-hidden="true" /> {type.label}</span>
                      <span className="inline-flex items-center gap-1"><Timer className="w-3.5 h-3.5" aria-hidden="true" /> {lesson.estimatedMinutes} min</span>
                    </div>
                  </div>
                  <Link href={`/courses/${courseId}/lessons/${lesson.id}`}
                    className={buttonClasses(isCurrent ? 'primary' : 'secondary', 'sm', 'self-start')}
                    aria-label={`${state === 'completed' ? 'Review' : state === 'in_progress' ? 'Continue' : 'Start'} ${lesson.title}`}>
                    {state === 'completed' ? 'Review' : state === 'in_progress' ? 'Continue' : 'Start'}
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}

export function LearningPath({
  courseId,
  modules,
  lessons,
  progress,
  currentLessonId,
  todayLessonIds,
}: {
  courseId: string;
  modules: Module[];
  lessons: Lesson[];
  progress: Progress[];
  currentLessonId: string | null;
  todayLessonIds: Set<string>;
}) {
  const sorted = [...modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const currentModuleId = lessons.find((l) => l.id === currentLessonId)?.moduleId;
  return (
    <ol className="space-y-4">
      {sorted.map((m, i) => (
        <Chapter
          key={m.id}
          module={m}
          index={i}
          courseId={courseId}
          progress={progress}
          currentLessonId={currentLessonId}
          todayLessonIds={todayLessonIds}
          defaultOpen={m.id === currentModuleId || (!currentModuleId && i === 0)}
          lessons={lessons.filter((l) => l.moduleId === m.id).sort((a, b) => a.orderIndex - b.orderIndex)}
        />
      ))}
    </ol>
  );
}

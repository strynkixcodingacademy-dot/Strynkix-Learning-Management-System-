'use client';

/**
 * Strynkix Live Books — course Learning Path: "continue where you left off",
 * then modules as accordions with their numbered lessons and status.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Lesson, Module, Progress } from '@/types/domain';
import { lessonStatus, numberCurriculum } from '@/lib/livebook/structure';
import { lessonExcerpt } from '@/components/learning/CoursePanels';
import { cx } from '@/components/ui/tones';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { NumberBadge } from './LearningPathNav';

export function CoursePath({
  courseId,
  modules,
  lessons,
  progress,
  resumeLessonId,
  todayLessonIds,
}: {
  courseId: string;
  modules: Module[];
  lessons: Lesson[];
  progress: Progress[];
  resumeLessonId: string | null;
  todayLessonIds: Set<string>;
}) {
  const numbered = numberCurriculum(modules, lessons);
  const resume = numbered.flatMap((m) => m.lessons).find((l) => l.lesson.id === resumeLessonId);
  const resumeModule = numbered.find((m) => m.lessons.some((l) => l.lesson.id === resumeLessonId))?.module.id ?? numbered[0]?.module.id;
  const [open, setOpen] = useState<Record<string, boolean>>(() => (resumeModule ? { [resumeModule]: true } : {}));

  return (
    <div className="mx-auto max-w-[960px] space-y-0">
      {resume && (
        <Link href={`/courses/${courseId}/units/${resume.lesson.id}`} className="group mb-6 flex items-center gap-5 border border-dashed border-line-strong bg-surface px-6 py-5 transition-colors hover:border-brand-line">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line-strong text-sm font-semibold text-ink-2">{resume.number}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[19px] font-extrabold text-ink">{progress.some((p) => p.status !== 'not_started') ? 'Continue from where you left off' : 'Start your first lesson'}</span>
            <span className="block truncate text-[15px] text-ink-3">{resume.lesson.title}</span>
          </span>
          <ArrowRight className="h-5 w-5 text-brand transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </Link>
      )}

      <ol className="border-t border-line">
        {numbered.map((m) => {
          const isOpen = open[m.module.id] ?? false;
          return (
            <li key={m.module.id} className="border-b border-line">
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [m.module.id]: !isOpen }))}
                aria-expanded={isOpen}
                className={cx('flex w-full items-start gap-6 px-6 py-6 text-left transition-colors', isOpen ? 'bg-canvas' : 'hover:bg-canvas')}
              >
                <span className="flex w-[72px] shrink-0 flex-col border border-line-strong bg-surface text-center">
                  <span className="border-b border-line-strong py-1 text-[12px] text-ink-3">Module</span>
                  <span className="py-1.5 text-[26px] font-bold text-ink">{m.number}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-extrabold text-ink">{m.module.title}</span>
                  {m.module.summary && <span className="mt-1 block text-[14.5px] leading-relaxed text-ink-3">{m.module.summary}</span>}
                  <span className="mt-1.5 block text-[12px] font-semibold text-ink-4">{m.lessons.length} lesson{m.lessons.length === 1 ? '' : 's'} · {m.lessons.filter((l) => lessonStatus(progress, l.lesson.id) === 'completed').length} completed</span>
                </span>
                <ChevronDown className={cx('mt-1 h-5 w-5 shrink-0 text-ink-3 transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
              </button>

              {isOpen && (
                <ol className="relative pb-2">
                  <span aria-hidden="true" className="absolute bottom-6 left-[44px] top-0 border-l-2 border-dashed border-line-strong" />
                  {m.lessons.map(({ lesson, number }) => {
                    const status = lessonStatus(progress, lesson.id);
                    const current = lesson.id === resumeLessonId;
                    const excerpt = lessonExcerpt(lesson);
                    return (
                      <li key={lesson.id}>
                        <Link href={`/courses/${courseId}/units/${lesson.id}`} className="group relative flex items-center gap-5 py-2 pl-6 pr-6">
                          <span className="relative z-10 flex w-10 justify-center"><NumberBadge number={number} status={status} active={current} /></span>
                          <span className={cx('flex min-w-0 flex-1 items-center gap-4 rounded-lg px-5 py-4 transition-colors', current ? 'bg-lavender-soft' : 'group-hover:bg-canvas')}>
                            <span className="min-w-0 flex-1">
                              <span className={cx('flex flex-wrap items-center gap-2 text-[16px] font-bold', current ? 'text-lavender-ink' : 'text-ink')}>
                                {lesson.title}
                                {todayLessonIds.has(lesson.id) && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning-ink">Today</span>}
                              </span>
                              {excerpt && <span className={cx('mt-1 block text-[14px] leading-relaxed', current ? 'text-lavender-ink/90' : 'text-ink-3')}>{excerpt}</span>}
                            </span>
                            <ArrowRight className={cx('h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5', current ? 'text-lavender-ink' : 'text-ink-4')} aria-hidden="true" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ol>

      <ul aria-label="Legend" className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 pt-5 text-[14px] text-ink-2">
        <li className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border border-line-strong" /> Not started</li>
        <li className="flex items-center gap-2"><span className="h-4 w-4 rounded-sm bg-ink-2" /> In progress</li>
        <li className="flex items-center gap-2"><span className="h-4 w-4 rounded-sm bg-success-ink" /> Completed</li>
      </ul>
    </div>
  );
}

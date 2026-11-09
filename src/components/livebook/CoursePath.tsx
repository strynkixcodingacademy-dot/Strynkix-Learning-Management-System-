'use client';

/**
 * Strynkix Live Books — the course as a contents page: chapters in order, each
 * opening onto its numbered lessons on a rail, with the student's place marked
 * by the ribbon. Chapters the student has finished read as finished.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Lesson, Module, Progress } from '@/types/domain';
import { lessonStatus, numberCurriculum } from '@/lib/livebook/structure';
import { lessonExcerpt } from '@/components/learning/CoursePanels';
import { cx } from '@/components/ui/tones';
import { Check, ChevronDown } from 'lucide-react';
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
  const resumeModule = numbered.find((m) => m.lessons.some((l) => l.lesson.id === resumeLessonId))?.module.id ?? numbered[0]?.module.id;
  const [open, setOpen] = useState<Record<string, boolean>>(() => (resumeModule ? { [resumeModule]: true } : {}));

  return (
    <ol className="-mt-3">
      {numbered.map((m) => {
        const isOpen = open[m.module.id] ?? false;
        const completed = m.lessons.filter((l) => lessonStatus(progress, l.lesson.id) === 'completed').length;
        const allDone = m.lessons.length > 0 && completed === m.lessons.length;
        const holdsResume = m.lessons.some((l) => l.lesson.id === resumeLessonId);
        return (
          <li key={m.module.id} className="border-b border-line">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [m.module.id]: !isOpen }))}
              aria-expanded={isOpen}
              className="group grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-5 text-left sm:grid-cols-[4rem_minmax(0,1fr)_auto]"
            >
              <span className={cx('font-display text-[1.75rem] leading-none sm:text-[2.25rem]', holdsResume ? 'text-brand' : 'text-silver')}>{m.number}</span>
              <span className="min-w-0">
                <span className="block text-lg font-semibold leading-snug text-ink group-hover:text-brand-ink">{m.module.title}</span>
                {m.module.summary && <span className="mt-1 block max-w-[62ch] text-sm text-ink-3">{m.module.summary}</span>}
              </span>
              <span className="flex items-center gap-2.5 self-center">
                <span className={cx('hidden items-center gap-1 text-xs tabular-nums sm:inline-flex', allDone ? 'text-success-ink' : 'text-ink-3')}>
                  {allDone && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  {completed} of {m.lessons.length} lessons
                </span>
                <ChevronDown className={cx('h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150', isOpen && 'rotate-180')} aria-hidden="true" />
              </span>
            </button>

            {isOpen && (
              <ol className="pb-5 sm:ml-[4.75rem]">
                {m.lessons.map(({ lesson, number }) => {
                  const status = lessonStatus(progress, lesson.id);
                  const current = lesson.id === resumeLessonId;
                  const excerpt = lessonExcerpt(lesson);
                  return (
                    <li key={lesson.id} className="relative">
                      <span aria-hidden="true" className="absolute bottom-0 left-[23px] top-0 w-px bg-line-strong [li:first-child>&]:top-6 [li:last-child>&]:bottom-auto [li:last-child>&]:h-6" />
                      <Link
                        href={`/courses/${courseId}/units/${lesson.id}`}
                        aria-current={current ? 'step' : undefined}
                        className={cx('group/lesson relative flex items-start gap-3.5 rounded-lg p-2 transition-colors', current ? 'bg-brand-soft' : 'hover:bg-surface-muted/70')}
                      >
                        <NumberBadge number={number} status={status} active={current} />
                        <span className="min-w-0 flex-1 pt-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={cx('text-body font-medium leading-snug', current ? 'text-brand-ink' : 'text-ink group-hover/lesson:text-brand-ink')}>{lesson.title}</span>
                            {current && <span className="text-xs font-medium text-brand-ink">You are here</span>}
                            {todayLessonIds.has(lesson.id) && <span className="rounded-full bg-warning-soft px-2 text-xs font-medium text-warning-ink">Today</span>}
                          </span>
                          {excerpt && <span className="mt-0.5 line-clamp-2 block max-w-[62ch] text-sm text-ink-3">{excerpt}</span>}
                        </span>
                        {lesson.estimatedMinutes ? <span className={cx('shrink-0 pt-1.5 text-xs tabular-nums text-ink-3', current && 'sm:pr-7')}>{lesson.estimatedMinutes} min</span> : null}
                        {current && <span aria-hidden="true" className="ribbon absolute right-3 top-0 hidden sm:block" />}
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
  );
}

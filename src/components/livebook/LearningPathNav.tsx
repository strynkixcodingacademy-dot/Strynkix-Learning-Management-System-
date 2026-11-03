'use client';

/**
 * Strynkix Live Books — "Learning Path" sidebar: modules as collapsible groups,
 * lessons numbered "m.l" with their status. Used on the lesson page.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Lesson, Module, Progress } from '@/types/domain';
import { lessonStatus, numberCurriculum } from '@/lib/livebook/structure';
import { cx } from '@/components/ui/tones';
import { ChevronDown, ListTree } from 'lucide-react';

export function NumberBadge({ number, status, active }: { number: string; status: 'completed' | 'in_progress' | 'not_started'; active?: boolean }) {
  return (
    <span className={cx(
      'flex h-10 w-10 shrink-0 items-center justify-center text-[12px] font-semibold tabular-nums',
      status === 'completed' ? 'rounded-md bg-success-ink text-white'
        : status === 'in_progress' ? 'rounded-md bg-ink-2 text-white'
          : active ? 'rounded-full border-2 border-brand bg-surface text-brand-ink' : 'rounded-full border border-line bg-surface text-ink-2'
    )}>
      {number}
    </span>
  );
}

export function LearningPathNav({
  courseId,
  modules,
  lessons,
  progress,
  activeLessonId,
}: {
  courseId: string;
  modules: Module[];
  lessons: Lesson[];
  progress: Progress[];
  activeLessonId: string;
}) {
  const numbered = numberCurriculum(modules, lessons);
  const activeModule = numbered.find((m) => m.lessons.some((l) => l.lesson.id === activeLessonId))?.module.id;
  const [open, setOpen] = useState<Record<string, boolean>>(() => (activeModule ? { [activeModule]: true } : {}));

  return (
    <nav aria-label="Learning Path" className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-dashed border-line-strong px-6 py-5">
        <ListTree className="h-4 w-4 text-ink-2" aria-hidden="true" />
        <span className="text-[15px] font-extrabold text-ink">Learning Path</span>
      </div>
      <ol className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {numbered.map((m) => {
          const isOpen = open[m.module.id] ?? false;
          return (
            <li key={m.module.id}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [m.module.id]: !isOpen }))}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-canvas"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-line-strong bg-surface text-sm font-semibold text-ink">{m.number}</span>
                <span className="min-w-0 flex-1 text-[14px] font-semibold text-ink">{m.module.title}</span>
                <ChevronDown className={cx('h-4 w-4 text-ink-3 transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
              </button>
              {isOpen && (
                <ol className="mt-1 space-y-1 border-t border-line pt-2 pl-2">
                  {m.lessons.map(({ lesson, number }) => {
                    const active = lesson.id === activeLessonId;
                    return (
                      <li key={lesson.id}>
                        <Link
                          href={`/courses/${courseId}/units/${lesson.id}`}
                          aria-current={active ? 'page' : undefined}
                          className="flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-canvas"
                        >
                          <NumberBadge number={number} status={lessonStatus(progress, lesson.id)} active={active} />
                          <span className={cx('text-[14px] leading-snug', active ? 'font-semibold text-brand-ink' : 'text-ink-2')}>{lesson.title}</span>
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
    </nav>
  );
}

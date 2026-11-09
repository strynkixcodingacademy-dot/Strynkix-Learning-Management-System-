'use client';

/**
 * Strynkix Live Books — the book's contents in the margin of a lesson page:
 * modules as collapsible chapters, lessons numbered "m.l" with their status.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Lesson, Module, Progress } from '@/types/domain';
import { lessonStatus, numberCurriculum } from '@/lib/livebook/structure';
import { cx } from '@/components/ui/tones';
import { Check, ChevronDown } from 'lucide-react';

/** A lesson's place in the sequence: its number, a tick when done, a filled ring while in progress. */
export function NumberBadge({ number, status, active }: { number: string; status: 'completed' | 'in_progress' | 'not_started'; active?: boolean }) {
  return (
    <span className={cx(
      'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium',
      status === 'completed' ? 'bg-success text-white'
        : active ? 'bg-brand text-white'
          : status === 'in_progress' ? 'border-2 border-brand bg-surface text-brand-ink'
            : 'border border-line-strong bg-surface text-ink-3'
    )}>
      {status === 'completed' ? <><Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" /><span className="sr-only">{number}, completed</span></> : number}
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
    <nav aria-label="Learning Path">
      <h2 className="type-section mb-3 text-ink">Contents</h2>
      <ol className="space-y-1">
        {numbered.map((m) => {
          const isOpen = open[m.module.id] ?? false;
          return (
            <li key={m.module.id}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [m.module.id]: !isOpen }))}
                aria-expanded={isOpen}
                className="flex w-full items-baseline gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-muted"
              >
                <span className="font-display text-base text-ink-3">{m.number}</span>
                <span className="min-w-0 flex-1 text-sm font-medium text-ink">{m.module.title}</span>
                <ChevronDown className={cx('h-3.5 w-3.5 shrink-0 self-center text-ink-3 transition-transform duration-150', isOpen && 'rotate-180')} aria-hidden="true" />
              </button>
              {isOpen && (
                <ol className="mb-2 space-y-px pl-1">
                  {m.lessons.map(({ lesson, number }) => {
                    const active = lesson.id === activeLessonId;
                    return (
                      <li key={lesson.id}>
                        <Link
                          href={`/courses/${courseId}/units/${lesson.id}`}
                          aria-current={active ? 'page' : undefined}
                          className={cx('flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors', active ? 'bg-brand-soft' : 'hover:bg-surface-muted')}
                        >
                          <NumberBadge number={number} status={lessonStatus(progress, lesson.id)} active={active} />
                          <span className={cx('text-sm leading-snug', active ? 'font-medium text-brand-ink' : 'text-ink-2')}>{lesson.title}</span>
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

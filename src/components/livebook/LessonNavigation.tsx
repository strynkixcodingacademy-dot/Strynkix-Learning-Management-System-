'use client';

/**
 * Strynkix Live Books — end-of-lesson completion and navigation.
 * Completion is an explicit action (opening a lesson never completes it).
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Eye } from 'lucide-react';
import { Lesson } from '@/types/domain';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Notice } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';

interface LessonNavigationProps {
  courseId: string;
  prevLesson: Lesson | null;
  nextLesson: Lesson | null;
  isCompleted: boolean;
  onMarkCompleted: () => Promise<void>;
  /** False for staff previews: progress is only recorded for enrolled students. */
  canTrackProgress?: boolean;
}

export function LessonNavigation({
  courseId,
  prevLesson,
  nextLesson,
  isCompleted,
  onMarkCompleted,
  canTrackProgress = true,
}: LessonNavigationProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleComplete = async () => {
    setIsUpdating(true);
    setFailed(false);
    try {
      await onMarkCompleted();
      setJustCompleted(true);
    } catch {
      setFailed(true);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="mt-14 space-y-6 border-t border-line pt-8">
      {!canTrackProgress ? (
        <Notice kind="info"><Eye className="hidden" aria-hidden="true" /><strong>Preview mode.</strong> Progress is recorded only for students enrolled in this course.</Notice>
      ) : isCompleted ? (
        <div className={cx('flex flex-col gap-4 rounded-card border border-success-line bg-success-soft p-5 sm:flex-row sm:items-center', justCompleted && 'animate-rise')} role="status">
          <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success text-white', justCompleted && 'celebrate animate-pop')} aria-hidden="true">
            <Check className="w-6 h-6" strokeWidth={3} />
          </span>
          <div className="flex-1">
            <p className="text-base font-bold text-success-ink">{justCompleted ? 'Lesson complete — nicely done.' : 'You’ve completed this lesson.'}</p>
            <p className="text-sm text-ink-2">{nextLesson ? 'Keep the momentum going with the next lesson.' : 'That was the last lesson in this course.'}</p>
          </div>
          {nextLesson ? (
            <Link href={`/courses/${courseId}/lessons/${nextLesson.id}`} className={buttonClasses('primary', 'md', 'self-start sm:self-center')}>
              Next lesson <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          ) : (
            <Link href={`/courses/${courseId}`} className={buttonClasses('secondary', 'md', 'self-start sm:self-center')}>Back to course</Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-base font-bold text-ink">Finished this lesson?</p>
            <p className="text-sm text-ink-3">Mark it complete to update your progress and your instructor&apos;s view.</p>
          </div>
          <Button onClick={handleComplete} loading={isUpdating} icon={<Check className="w-4 h-4" aria-hidden="true" />} className="self-start sm:self-center">
            Mark lesson complete
          </Button>
        </div>
      )}
      {failed && <Notice kind="error">We couldn&apos;t save your progress. Check your connection and try again.</Notice>}

      <nav aria-label="Lesson navigation" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {prevLesson ? (
          <Link href={`/courses/${courseId}/lessons/${prevLesson.id}`}
            className="group flex flex-col rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-canvas">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-3 group-hover:text-brand-ink">
              <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" /> Previous
            </span>
            <span className="mt-1 truncate text-sm font-semibold text-ink">{prevLesson.title}</span>
          </Link>
        ) : <div className="hidden sm:block" />}
        {nextLesson && (
          <Link href={`/courses/${courseId}/lessons/${nextLesson.id}`}
            className="group flex flex-col rounded-xl border border-line bg-surface p-4 text-right transition-colors hover:border-line-strong hover:bg-canvas sm:col-start-2">
            <span className="inline-flex items-center justify-end gap-1.5 text-xs font-semibold text-ink-3 group-hover:text-brand-ink">
              Next <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
            <span className="mt-1 truncate text-sm font-semibold text-ink">{nextLesson.title}</span>
          </Link>
        )}
      </nav>
    </div>
  );
}

'use client';

/**
 * Strynkix Live Books — end-of-lesson completion and navigation.
 * Completion is an explicit action (opening a lesson never completes it).
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
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
    <div className="mt-14 space-y-6">
      {!canTrackProgress ? (
        <Notice kind="info"><span className="font-semibold">Preview mode.</span> Progress is recorded only for students enrolled in this course.</Notice>
      ) : isCompleted ? (
        <div className={cx('flex flex-col gap-4 rounded-card bg-success-soft p-5 sm:flex-row sm:items-center', justCompleted && 'animate-rise')} role="status">
          <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success text-white', justCompleted && 'celebrate animate-pop')} aria-hidden="true">
            <Check className="w-5 h-5" strokeWidth={2.5} />
          </span>
          <div className="flex-1">
            <p className="text-body font-semibold text-success-ink">{justCompleted ? 'Lesson complete — nicely done.' : 'You’ve completed this lesson.'}</p>
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
        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-body font-semibold text-ink">Finished this lesson?</p>
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
          <Link href={`/courses/${courseId}/lessons/${prevLesson.id}`} className="group rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong">
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-3"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous</span>
            <span className="mt-0.5 block text-sm font-medium text-ink group-hover:text-brand-ink">{prevLesson.title}</span>
          </Link>
        ) : <div className="hidden sm:block" />}
        {nextLesson && (
          <Link href={`/courses/${courseId}/lessons/${nextLesson.id}`} className="group rounded-lg border border-line bg-surface p-4 text-right transition-colors hover:border-line-strong sm:col-start-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">Next <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
            <span className="mt-0.5 block text-sm font-medium text-ink group-hover:text-brand-ink">{nextLesson.title}</span>
          </Link>
        )}
      </nav>
    </div>
  );
}

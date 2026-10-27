'use client';

/**
 * Strynkix LMS — Live Books Bottom Navigation & Completion Controller
 * Handles sequential traversal, previous/next pointers, and progress completion triggering.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Lesson } from '@/types/domain';

interface LessonNavigationProps {
  courseId: string;
  prevLesson: Lesson | null;
  nextLesson: Lesson | null;
  isCompleted: boolean;
  onMarkCompleted: () => Promise<void>;
}

export function LessonNavigation({
  courseId,
  prevLesson,
  nextLesson,
  isCompleted,
  onMarkCompleted,
}: LessonNavigationProps) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleComplete = async () => {
    setIsUpdating(true);
    try {
      await onMarkCompleted();
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="mt-12 pt-8 border-t border-slate-800 space-y-6">
      {/* Completion Action Card */}
      <div className="p-4 sm:p-5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-center sm:text-left">
          <div
            className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
              isCompleted
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30'
            }`}
          >
            {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">
              {isCompleted ? 'Lesson Completed!' : 'Finished this lesson?'}
            </h4>
            <p className="text-xs text-slate-400">
              {isCompleted
                ? 'Great job! Your progress has been securely recorded.'
                : 'Mark this lesson as completed to update your course progress.'}
            </p>
          </div>
        </div>

        <button
          onClick={handleComplete}
          disabled={isUpdating}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition shadow-lg ${
            isCompleted
              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900'
              : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-indigo-600/20'
          } disabled:opacity-50`}
        >
          {isUpdating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          <span>{isCompleted ? 'Completed (Click to Re-verify)' : 'Mark as Completed'}</span>
        </button>
      </div>

      {/* Prev / Next Pagination Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {prevLesson ? (
          <Link
            href={`/courses/${courseId}/lessons/${prevLesson.id}`}
            className="group flex flex-col p-4 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/80 transition"
          >
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 group-hover:text-indigo-400 transition font-medium">
              <ArrowLeft className="w-3.5 h-3.5" />
              Previous Lesson
            </span>
            <span className="mt-1 text-sm font-semibold text-slate-200 group-hover:text-white truncate">
              {prevLesson.title}
            </span>
          </Link>
        ) : (
          <div className="hidden sm:block" />
        )}

        {nextLesson && (
          <Link
            href={`/courses/${courseId}/lessons/${nextLesson.id}`}
            className="group flex flex-col p-4 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/80 transition text-right sm:col-start-2"
          >
            <span className="inline-flex items-center justify-end gap-1.5 text-xs text-slate-400 group-hover:text-indigo-400 transition font-medium">
              Next Lesson
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
            <span className="mt-1 text-sm font-semibold text-slate-200 group-hover:text-white truncate">
              {nextLesson.title}
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}

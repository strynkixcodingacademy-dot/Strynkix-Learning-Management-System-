'use client';

/**
 * Strynkix LMS — Today's Schedule Card (Student Dashboard)
 * Renders the approved learning activities for the current day from the cohort's
 * active weekly timetable. Direct deep-links to Live Books lessons and assignments.
 */

import React from 'react';
import Link from 'next/link';
import {
  DaySchedule,
  Progress,
  Submission,
  TimetableActivity,
} from '@/types/domain';
import {
  ACTIVITY_TYPE_LABELS,
  calculateDayCompletion,
  deriveActivityProgress,
  DerivedActivityState,
} from '@/lib/learning/timetable';
import { Card } from '@/components/ui/Page';
import { ProgressRing } from '@/components/ui/Progress';
import { buttonClasses } from '@/components/ui/Button';
import { cx } from '@/components/ui/tones';
import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  Check,
  Clock,
  FileCheck,
  Flag,
  GraduationCap,
  Lock,
  PartyPopper,
  Sparkles,
} from 'lucide-react';

interface TodayScheduleCardProps {
  day: DaySchedule;
  batchName: string;
  courseTitle: string;
  courseId: string;
  studentProgress: Progress[];
  studentSubmissions: Submission[];
  now: Date;
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  lesson: BookOpen,
  practical_exercise: GraduationCap,
  assignment: FileCheck,
  quiz: Clock,
  examination: Clock,
  practical_assessment: GraduationCap,
};

function resolveActivityHref(activity: TimetableActivity, courseId: string): string {
  if (activity.type === 'lesson' && activity.lessonId) {
    return `/courses/${courseId}/lessons/${activity.lessonId}`;
  }
  if (activity.type === 'assignment' && activity.assignmentId) {
    return `/courses/${courseId}/assignments/${activity.assignmentId}`;
  }
  return `/courses/${courseId}`;
}

export function TodayScheduleCard({
  day,
  batchName,
  courseTitle,
  courseId,
  studentProgress,
  studentSubmissions,
  now,
}: TodayScheduleCardProps) {
  const { completedCount, totalCount, percentage } = calculateDayCompletion(
    day,
    studentProgress,
    studentSubmissions,
    now
  );

  const allCompleted = totalCount > 0 && completedCount === totalCount;

  return (
    <Card as="article" className="overflow-hidden shadow-card border border-line">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 p-5 border-b border-line bg-surface">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="text-xs font-semibold text-brand-ink uppercase tracking-wider flex items-center gap-1.5">
            <CalendarCheck className="w-4 h-4" /> Today&apos;s Active Timetable
          </div>
          <h2 className="text-xl font-bold text-ink leading-tight">
            {batchName} · {courseTitle}
          </h2>
          {day.theme && (
            <p className="text-xs text-ink-3">
              Daily Focus: <strong className="text-ink-2">{day.theme}</strong>
            </p>
          )}
        </div>

        <ProgressRing
          value={percentage}
          tone={allCompleted ? 'success' : 'brand'}
          label="Today's progress"
          size={52}
        >
          {completedCount}/{totalCount}
        </ProgressRing>
      </div>

      {/* Activity Stream */}
      {day.activities.length === 0 ? (
        <div className="p-8 text-center text-xs text-ink-3">
          No learning activities scheduled for today. Enjoy your self-paced study or project work!
        </div>
      ) : (
        <ol className="p-5 space-y-4">
          {day.activities.map((act, index) => {
            const derived = deriveActivityProgress(
              act,
              day.date,
              studentProgress,
              studentSubmissions,
              now
            );
            const Icon = TYPE_ICONS[act.type] || BookOpen;
            const href = resolveActivityHref(act, courseId);
            const isCompleted = derived.state === 'completed';

            return (
              <li
                key={act.id}
                className={cx(
                  'flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border transition-colors',
                  isCompleted
                    ? 'border-line bg-surface-muted/50'
                    : derived.state === 'in_progress'
                    ? 'border-brand/40 bg-brand-soft/30'
                    : derived.state === 'overdue'
                    ? 'border-danger-line bg-danger-soft/30'
                    : 'border-line bg-surface hover:border-line-strong'
                )}
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {/* Step / Check Icon */}
                  <span
                    className={cx(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold border-2 transition-colors',
                      isCompleted
                        ? 'border-success bg-success text-white'
                        : derived.state === 'in_progress'
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : derived.state === 'blocked'
                        ? 'border-line bg-surface-muted text-ink-4'
                        : 'border-line-strong bg-surface text-ink-3'
                    )}
                  >
                    {isCompleted ? (
                      <Check className="w-4 h-4 stroke-[3]" />
                    ) : derived.state === 'blocked' ? (
                      <Lock className="w-3.5 h-3.5" />
                    ) : (
                      index + 1
                    )}
                  </span>

                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface border border-line text-ink-3 flex items-center gap-1">
                        <Icon className="w-3 h-3" />
                        {ACTIVITY_TYPE_LABELS[act.type] || act.type}
                      </span>

                      <span className="text-xs font-mono font-medium text-ink-3 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {act.startTime} – {act.endTime} ({act.durationMinutes}m)
                      </span>

                      <span
                        className={cx(
                          'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
                          isCompleted
                            ? 'bg-success-soft text-success-ink'
                            : derived.state === 'in_progress'
                            ? 'bg-brand-soft text-brand-ink'
                            : derived.state === 'overdue'
                            ? 'bg-danger-soft text-danger-ink'
                            : 'bg-surface-muted text-ink-3'
                        )}
                      >
                        {derived.label}
                      </span>
                    </div>

                    <h3
                      className={cx(
                        'text-sm font-bold text-ink',
                        isCompleted && 'line-through text-ink-3'
                      )}
                    >
                      {act.title}
                    </h3>

                    {act.objectives.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {act.objectives.map((obj, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 text-[11px] text-ink-3 rounded-md bg-canvas px-2 py-0.5 border border-line"
                          >
                            <Flag className="w-2.5 h-2.5 text-coral" /> {obj}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {derived.isActionable ? (
                  <Link
                    href={href}
                    className={buttonClasses(
                      isCompleted ? 'secondary' : derived.state === 'in_progress' ? 'primary' : 'primary',
                      'sm',
                      'self-start sm:self-center shrink-0'
                    )}
                  >
                    {derived.actionLabel} <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                ) : (
                  <span className="text-xs text-ink-4 italic self-start sm:self-center shrink-0">
                    {derived.detail}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Completion Celebration Footer */}
      {allCompleted && (
        <div className="flex items-center gap-3 border-t border-success-line bg-success-soft px-5 py-3 text-xs text-success-ink font-semibold">
          <PartyPopper className="w-5 h-5 shrink-0" />
          <span>
            Outstanding work! You have finished every scheduled activity for today.
          </span>
        </div>
      )}
    </Card>
  );
}


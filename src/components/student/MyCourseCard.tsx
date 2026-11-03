'use client';

import React from 'react';
import Link from 'next/link';
import type { MyCourse } from './types';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Page';
import { ProgressBar } from '@/components/ui/Progress';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDate } from '@/lib/academy/format';
import { ArrowRight } from 'lucide-react';

const STATUS_TONE = { active: 'brand', completed: 'success', suspended: 'warning' } as const;

/** A course the student is enrolled in: batch, instructors, dates, progress, Continue. */
export function MyCourseCard({ course }: { course: MyCourse }) {
  const href = course.lastLessonId ? `/courses/${course.courseId}/lessons/${course.lastLessonId}` : `/courses/${course.courseId}`;
  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[17px] font-extrabold leading-snug text-ink">{course.title}</h3>
          {course.description && <p className="mt-1 line-clamp-2 text-sm text-ink-3">{course.description}</p>}
        </div>
        <StatusPill size="sm" tone={STATUS_TONE[course.enrollmentStatus as keyof typeof STATUS_TONE] ?? 'neutral'}>
          {course.enrollmentStatus === 'active' ? 'In progress' : course.enrollmentStatus === 'completed' ? 'Completed' : 'Paused'}
        </StatusPill>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-xs text-ink-3">Batch</dt><dd className="font-semibold text-ink">{course.batchName ?? '—'}</dd></div>
        <div><dt className="text-xs text-ink-3">Instructor</dt><dd className="font-semibold text-ink">{course.instructors.join(', ') || '—'}</dd></div>
        <div><dt className="text-xs text-ink-3">Starts</dt><dd className="font-semibold text-ink">{formatDate(course.startDate)}</dd></div>
        <div><dt className="text-xs text-ink-3">Expected completion</dt><dd className="font-semibold text-ink">{formatDate(course.endDate)}</dd></div>
      </dl>
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-ink-3"><span>{course.completedLessons} of {course.totalLessons} lessons</span><span className="font-bold text-ink">{course.percent}%</span></div>
        <ProgressBar value={course.percent} label={`${course.title} progress`} />
      </div>
      <Link href={href} className={buttonClasses('primary', 'md', 'mt-auto justify-center')}>
        {course.completedLessons === 0 ? 'Start learning' : course.percent >= 100 ? 'Review course' : 'Continue learning'} <ArrowRight className="h-4 w-4" />
      </Link>
    </Card>
  );
}

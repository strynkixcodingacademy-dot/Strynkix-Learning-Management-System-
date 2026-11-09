'use client';

import React from 'react';
import Link from 'next/link';
import type { MyCourse } from './types';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Page';
import { CourseCover } from '@/components/ui/CourseIcon';
import { ProgressBar } from '@/components/ui/Progress';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDate } from '@/lib/academy/format';
import { ArrowRight } from 'lucide-react';

const STATUS_TONE = { active: 'brand', completed: 'success', suspended: 'warning' } as const;

/** A course the student is enrolled in: the volume itself, batch, instructors, dates, progress, Continue. */
export function MyCourseCard({ course }: { course: MyCourse }) {
  const href = course.lastLessonId ? `/courses/${course.courseId}/lessons/${course.lastLessonId}` : `/courses/${course.courseId}`;
  return (
    <Card className="flex h-full gap-5 p-5">
      <Link href={`/courses/${course.courseId}`} tabIndex={-1} aria-hidden="true" className="hidden w-24 shrink-0 self-start sm:block md:w-28">
        <CourseCover course={{ id: course.courseId, title: course.title }} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold leading-snug text-ink"><Link href={`/courses/${course.courseId}`} className="hover:text-brand-ink">{course.title}</Link></h3>
            {course.description && <p className="mt-1 line-clamp-2 text-sm text-ink-3">{course.description}</p>}
          </div>
          <StatusPill size="sm" tone={STATUS_TONE[course.enrollmentStatus as keyof typeof STATUS_TONE] ?? 'neutral'}>
            {course.enrollmentStatus === 'active' ? 'In progress' : course.enrollmentStatus === 'completed' ? 'Completed' : 'Paused'}
          </StatusPill>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="min-w-0"><dt className="text-xs text-ink-3">Batch</dt><dd className="truncate font-medium text-ink">{course.batchName ?? '—'}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-ink-3">Instructor</dt><dd className="truncate font-medium text-ink">{course.instructors.join(', ') || '—'}</dd></div>
          <div><dt className="text-xs text-ink-3">Starts</dt><dd className="font-medium text-ink">{formatDate(course.startDate)}</dd></div>
          <div><dt className="text-xs text-ink-3">Expected completion</dt><dd className="font-medium text-ink">{formatDate(course.endDate)}</dd></div>
        </dl>
        <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href={href} className={buttonClasses('primary', 'md', 'group')}>
            {course.completedLessons === 0 ? 'Start learning' : course.percent >= 100 ? 'Review course' : 'Continue learning'}
            <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          <div className="min-w-32 flex-1 space-y-1">
            <ProgressBar value={course.percent} tone={course.percent >= 100 ? 'success' : 'brand'} label={`${course.title} progress`} />
            <p className="text-xs text-ink-3">{course.completedLessons} of {course.totalLessons} lessons, {course.percent}%</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

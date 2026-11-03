'use client';

/** Strynkix LMS — My Courses: every course the student is enrolled in, with batch, instructors, dates and progress. */

import React from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { studentApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { MyCourseCard } from '@/components/student/MyCourseCard';
import type { MyCourse } from '@/components/student/types';
import { buttonClasses } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';

function Courses() {
  const { data, error, reload } = useApiData('courses', () => studentApi<{ courses: MyCourse[] }>({ action: 'courses' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading your courses…" />;
  return (
    <div className="space-y-6">
      <PageHeader title="My Courses" description="The courses you are enrolled in. Continue where you left off." actions={<Link href="/courses" className={buttonClasses('secondary')}>Browse Live Books</Link>} />
      {data.courses.length === 0 ? (
        <EmptyState title="No courses yet">When your branch enrolls you in a batch, the course appears here.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.courses.map((c) => <MyCourseCard key={c.courseId} course={c} />)}</div>
      )}
    </div>
  );
}

export default function MyCoursesPage() {
  return <RequireRole allowedRoles={['student']}><AppShell><Courses /></AppShell></RequireRole>;
}

'use client';

/**
 * Strynkix LMS — a course's lesson activities and examinations. Authors create
 * and publish them; instructors and branch managers open them to evaluate.
 */

import React, { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { getCourseWithCurriculum, type CourseWithCurriculum } from '@/lib/livebook/service';
import { listCourseAssessments } from '@/lib/assessments/service';
import { EXAM_TYPE_LABELS, KIND_LABELS } from '@/lib/assessments/grading';
import type { Assessment } from '@/types/academy';
import { buttonClasses } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs } from '@/components/ui/Tabs';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import { Plus } from 'lucide-react';

type Filter = 'activities' | 'exams';

function Listing({ courseId }: { courseId: string }) {
  const { tenant } = useAuth();
  const [curriculum, setCurriculum] = useState<CourseWithCurriculum | null>(null);
  const [items, setItems] = useState<Assessment[] | null>(null);
  const [canAuthor, setCanAuthor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('activities');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!tenant) return;
    let live = true;
    Promise.all([getCourseWithCurriculum(courseId, tenant.orgId, true), listCourseAssessments(courseId)])
      .then(([c, r]) => { if (!live) return; setCurriculum(c); setItems(r.assessments); setCanAuthor(r.canAuthor); })
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [courseId, tenant, version]);

  if (error) return <ErrorState onRetry={() => { setError(null); setVersion((v) => v + 1); }}>{error}</ErrorState>;
  if (!items) return <LoadingState label="Loading activities and exams…" />;
  const lessonTitle = (id?: string) => curriculum?.lessons.find((l) => l.id === id)?.title;
  const shown = items.filter((a) => (filter === 'exams' ? a.kind === 'exam' : a.kind !== 'exam'));
  const title = curriculum?.course.title ?? 'Course';

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Course Authoring', href: '/dashboard/courses' }, { label: title, href: `/dashboard/courses/${courseId}` }, { label: 'Activities & exams' }]}
        title="Activities & exams"
        description="Quizzes, written answers and practical assignments attached to lessons, plus demo, practice and final examinations."
        actions={canAuthor && (
          <>
            <Link href={`/dashboard/courses/${courseId}/assessments/new?kind=quiz`} className={buttonClasses('primary')}><Plus className="h-4 w-4" /> New activity</Link>
            <Link href={`/dashboard/courses/${courseId}/assessments/new?kind=exam`} className={buttonClasses('secondary')}><Plus className="h-4 w-4" /> New exam</Link>
          </>
        )}
      />
      <Tabs<Filter> idPrefix="asm" label="Show" value={filter} onChange={setFilter} items={[{ id: 'activities', label: 'Lesson activities' }, { id: 'exams', label: 'Examinations' }]} />
      {shown.length === 0 ? (
        <EmptyState title={filter === 'exams' ? 'No examinations yet' : 'No lesson activities yet'}>
          {canAuthor ? 'Create one with the buttons above. It stays a draft until you publish it.' : 'The course authors haven’t published any yet.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {shown.map((a) => (
            <li key={a.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">{a.title}</div>
                  <div className="text-xs text-ink-3">
                    {a.kind === 'exam' && a.examType ? EXAM_TYPE_LABELS[a.examType] : KIND_LABELS[a.kind]} · {a.totalMarks} marks
                    {lessonTitle(a.lessonId) ? ` · Lesson: ${lessonTitle(a.lessonId)}` : ''}{a.closesAt ? ` · closes ${formatWhen(a.closesAt)}` : ''}
                  </div>
                </div>
                <StatusPill tone={a.status === 'published' ? 'success' : a.status === 'draft' ? 'warning' : 'neutral'} size="sm">{a.status}</StatusPill>
                {canAuthor && <Link href={`/dashboard/courses/${courseId}/assessments/${a.id}`} className={buttonClasses('ghost', 'sm')}>Edit</Link>}
                {a.status !== 'draft' && <Link href={`/dashboard/assessments/${a.id}`} className={buttonClasses('secondary', 'sm')}>Submissions</Link>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CourseAssessmentsPageContent({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params);
  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor', 'content_lead', 'content_designer']}>
      <AppShell><Listing courseId={courseId} /></AppShell>
    </RequireRole>
  );
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function CourseAssessmentsPage(props: Parameters<typeof CourseAssessmentsPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <CourseAssessmentsPageContent {...props} />
    </Suspense>
  );
}

'use client';

/**
 * Strynkix Live Books — Course page.
 * A title page (the cover, what the book is, how far along you are, where to
 * pick up), then its Contents, Schedule, Assignments and About.
 */

import { Breadcrumbs } from '@/components/ui/Page';
import React, { useEffect, useMemo, useState, use, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Batch, Course, Module, Lesson, Progress } from '@/types/domain';
import { getCourseWithCurriculum, getStudentCourseProgress } from '@/lib/livebook/service';
import { calculateCourseProgress, getResumeLesson } from '@/lib/livebook/curriculum';
import { getBatchById, getStudentCourseEnrollment } from '@/lib/batches/service';
import { getStudentAssignments, getStudentPlans, getStudentSubmissions } from '@/lib/learning/service';
import { toLocalDateKey } from '@/lib/learning/metrics';
import { grantsContentAccess } from '@/lib/batches/scope';
import { lessonNumber } from '@/lib/livebook/structure';
import {
  CourseAboutPanel,
  CourseAssignmentsPanel,
  CourseSchedulePanel,
  StudentCourseLearningData,
} from '@/components/learning/CoursePanels';
import { CoursePath } from '@/components/livebook/CoursePath';
import { AppShell } from '@/components/dashboard/AppShell';
import { CourseCover } from '@/components/ui/CourseIcon';
import { ProgressBar } from '@/components/ui/Progress';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs } from '@/components/ui/Tabs';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { ArrowRight } from 'lucide-react';

const TABS = [
  { id: 'path', label: 'Contents' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'about', label: 'About' },
] as const;
type TabId = (typeof TABS)[number]['id'];

interface CoursePageProps {
  params: Promise<{ courseId: string }>;
}

function CourseSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-live="polite">
      <span className="sr-only">Loading course…</span>
      <div className="flex gap-7">
        <Skeleton className="hidden aspect-[3/4] w-40 sm:block" />
        <div className="flex-1 space-y-3"><Skeleton className="h-4 w-48" /><Skeleton className="h-10 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
      </div>
      <Skeleton className="h-10 w-96 max-w-full" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}

function CourseDetailView({ courseId }: { courseId: string }) {
  const { user, tenant } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [progressList, setProgressList] = useState<Progress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ kind: 'not_enrolled' | 'missing' | 'failed'; message: string } | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [learningData, setLearningData] = useState<StudentCourseLearningData | null>(null);
  const [learningError, setLearningError] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const [reloadKey, setReloadKey] = useState(0);

  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab: TabId = TABS.some((t) => t.id === requestedTab) ? (requestedTab as TabId) : 'path';
  const selectTab = (id: TabId) => router.replace(`/courses/${courseId}?tab=${id}`, { scroll: false });
  const isStudent = tenant?.role === 'student';

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      if (!tenant?.orgId || !user?.uid) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const canPreviewDrafts = tenant.role !== 'student';

        // Students reach a course only through an active or completed enrollment.
        let enrollment = null;
        if (tenant.role === 'student') {
          enrollment = await getStudentCourseEnrollment(tenant.orgId, user.uid, courseId);
          if (!enrollment || !grantsContentAccess(enrollment.status)) {
            if (isMounted) setError({ kind: 'not_enrolled', message: 'You aren’t enrolled in this course. Your academy adds students to courses through batches.' });
            return;
          }
        }

        const curriculum = await getCourseWithCurriculum(courseId, tenant.orgId, canPreviewDrafts);
        if (!curriculum) {
          if (isMounted) setError({ kind: 'missing', message: 'This course doesn’t exist or isn’t published yet.' });
          return;
        }
        const prog = await getStudentCourseProgress(courseId, user.uid, tenant.orgId);
        if (!isMounted) return;
        setCourse(curriculum.course);
        setModules(curriculum.modules);
        setLessons(curriculum.lessons);
        setProgressList(prog);

        // Schedule and assignments for the student's own batch. A failure here is
        // reported inside those tabs and does not hide the learning path.
        if (enrollment) {
          try {
            const [plans, assignments, submissions, loadedBatch] = await Promise.all([
              getStudentPlans(enrollment),
              getStudentAssignments(enrollment),
              getStudentSubmissions(tenant.orgId, user.uid),
              getBatchById(enrollment.batchId).catch(() => null),
            ]);
            const ids = new Set(assignments.map((a) => a.id));
            if (!isMounted) return;
            setLearningData({ plans, assignments, submissions: submissions.filter((s) => ids.has(s.assignmentId)) });
            setBatch(loadedBatch);
          } catch (learningErr) {
            console.error('Failed to load schedule and assignments', learningErr);
            if (isMounted) setLearningError('Your schedule and assignments couldn’t be loaded. Refresh to try again.');
          }
        }
      } catch (err) {
        console.error('Failed to load course curriculum', err);
        if (isMounted) setError({ kind: 'failed', message: 'We couldn’t load this course. Check your connection and try again.' });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [courseId, tenant?.orgId, tenant?.role, user?.uid, reloadKey]);

  const today = toLocalDateKey(now);
  const todayLessonIds = useMemo(
    () => new Set(learningData?.plans.filter((p) => p.date === today).flatMap((p) => p.lessonIds) ?? []),
    [learningData, today]
  );

  if (isLoading) return <CourseSkeleton />;

  if (error || !course) {
    if (error?.kind === 'failed') return <ErrorState title="Course didn’t load" onRetry={() => setReloadKey((k) => k + 1)}>{error.message}</ErrorState>;
    return (
      <>
        <h1 className="sr-only">Live Books</h1>
        <EmptyState illustration={error?.kind === 'not_enrolled' ? 'lock' : 'compass'}
          title={error?.kind === 'not_enrolled' ? 'Not enrolled in this course' : 'Course not available'}
          action={<Link href="/dashboard" className={buttonClasses('primary')}>Back to Home</Link>}>
          {error?.message}
        </EmptyState>
      </>
    );
  }

  const completedSet = new Set(progressList.filter((p) => p.status === 'completed').map((p) => p.lessonId));
  const { percentage, completedCount, totalCount } = calculateCourseProgress(lessons.length, completedSet);
  const resumeLesson = getResumeLesson(modules, lessons, progressList);
  const totalMinutes = lessons.reduce((n, l) => n + (l.estimatedMinutes || 0), 0);
  const allDone = totalCount > 0 && completedCount === totalCount;
  const started = progressList.some((p) => p.status !== 'not_started');
  const resumeNumber = resumeLesson ? lessonNumber(modules, lessons, resumeLesson.id) : null;

  return (
    <div className="space-y-8">
      <Breadcrumbs items={[{ label: 'Live Books', href: '/courses' }, { label: course.title }]} />

      <header className="flex gap-6 sm:gap-8">
        <CourseCover course={course} level={course.level} className="hidden w-36 shrink-0 self-start shadow-[0_18px_30px_-18px_rgb(10_14_40/0.55)] sm:flex md:w-40" />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <h1 className="type-page text-ink">{course.title}</h1>
            {course.tagline && <p className="max-w-[58ch] text-body text-ink-2">{course.tagline}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
              <span className="capitalize">{course.level}</span>
              <span>{course.estimatedWeeks} weeks</span>
              <span>{Math.max(1, Math.round(totalMinutes / 60))} h of lessons</span>
              {course.status !== 'published' && <StatusPill tone="warning" size="sm">Preview, {course.status}</StatusPill>}
            </div>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
            {resumeLesson && !allDone && (
              <Link href={`/courses/${course.id}/units/${resumeLesson.id}`} className={buttonClasses('primary', 'lg', 'group min-h-12 min-w-0 self-start !h-auto !whitespace-normal py-2.5 text-left leading-snug')}>
                <span className="min-w-0">
                  {started ? 'Continue' : 'Start'} with {resumeNumber ? `${resumeNumber} ` : ''}<span className="font-normal">{resumeLesson.title}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            )}
            <div className="min-w-0 flex-1 sm:max-w-72">
              <ProgressBar value={totalCount ? percentage : 0} tone={allDone ? 'success' : 'brand'} label="Course progress" />
              <p className="mt-1.5 text-xs text-ink-3">{totalCount ? percentage : 0}% complete, {completedCount} of {totalCount} lessons</p>
            </div>
          </div>
        </div>
      </header>

      <div>
        <Tabs
          idPrefix="course"
          label="Course sections"
          value={tab}
          onChange={selectTab}
          items={TABS.map((t) => ({
            ...t,
            count: t.id === 'assignments' && learningData ? learningData.assignments.length : undefined,
          }))}
        />

        <div id="course-panel" role="tabpanel" aria-labelledby={`course-tab-${tab}`} className="mt-7" key={tab}>
          {tab === 'path' && (
            modules.length === 0 ? (
              <EmptyState illustration="book" title="Lessons are on the way">This course doesn&apos;t have published modules yet.</EmptyState>
            ) : (
              <CoursePath courseId={course.id} modules={modules} lessons={lessons} progress={progressList}
                resumeLessonId={allDone ? null : resumeLesson?.id ?? null} todayLessonIds={todayLessonIds} />
            )
          )}
          {tab === 'schedule' && (
            <CourseSchedulePanel courseId={course.id} data={learningData} lessons={lessons} progress={progressList}
              today={today} isStudent={isStudent} error={learningError} />
          )}
          {tab === 'assignments' && (
            <CourseAssignmentsPanel courseId={course.id} data={learningData} now={now} isStudent={isStudent} error={learningError} />
          )}
          {tab === 'about' && <CourseAboutPanel course={course} batch={batch} lessonCount={lessons.length} />}
        </div>
      </div>
    </div>
  );
}

function CoursePageContent({ params }: CoursePageProps) {
  const { courseId } = use(params);
  return (
    <AppShell>
      <CourseDetailView courseId={courseId} />
    </AppShell>
  );
}

export default function CoursePage({ params }: CoursePageProps) {
  return (
    <Suspense fallback={null}>
      <CoursePageContent params={params} />
    </Suspense>
  );
}

'use client';

/**
 * Strynkix Live Books — Course page.
 * A "book cover" header with progress and a resume action, then Learning Path,
 * Schedule, Assignments and About.
 */

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
import {
  CourseAboutPanel,
  CourseAssignmentsPanel,
  CourseSchedulePanel,
  StudentCourseLearningData,
} from '@/components/learning/CoursePanels';
import { CoursePath } from '@/components/livebook/CoursePath';
import { LiveBooksFrame } from '@/components/livebook/LiveBooksFrame';
import { AppShell } from '@/components/dashboard/AppShell';
import { CourseIcon } from '@/components/ui/CourseIcon';
import { Tabs } from '@/components/ui/Tabs';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { CalendarDays, ClipboardList, Info, Route, Timer } from 'lucide-react';

const TABS = [
  { id: 'path', label: 'Learning Path', icon: Route },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'about', label: 'About', icon: Info },
] as const;
type TabId = (typeof TABS)[number]['id'];

interface CoursePageProps {
  params: Promise<{ courseId: string }>;
}

function CourseSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Loading course…</span>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-44" />
      <Skeleton className="h-10 w-96" />
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
      <EmptyState illustration={error?.kind === 'not_enrolled' ? 'lock' : 'compass'}
        title={error?.kind === 'not_enrolled' ? 'Not enrolled in this course' : 'Course not available'}
        action={<Link href="/dashboard" className={buttonClasses('primary')}>Back to Home</Link>}>
        {error?.message}
      </EmptyState>
    );
  }

  const completedSet = new Set(progressList.filter((p) => p.status === 'completed').map((p) => p.lessonId));
  const { percentage, completedCount, totalCount } = calculateCourseProgress(lessons.length, completedSet);
  const resumeLesson = getResumeLesson(modules, lessons, progressList);
  const totalMinutes = lessons.reduce((n, l) => n + (l.estimatedMinutes || 0), 0);
  const allDone = totalCount > 0 && completedCount === totalCount;

  return (
    <LiveBooksFrame>
      <div className="h-full overflow-y-auto px-5 py-8 sm:px-12 sm:py-10">
        {/* Course header */}
        <div className="flex flex-col gap-5 md:flex-row md:items-center">
          <CourseIcon course={course} size="lg" />
          <div className="min-w-0 flex-1">
            <Link href="/courses" className="text-[13px] font-semibold text-ink-3 hover:text-ink">← All Live Books</Link>
            <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-ink sm:text-[30px]">{course.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
              <span className="font-semibold capitalize">{course.level}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1"><Timer className="h-3.5 w-3.5" aria-hidden="true" /> {course.estimatedWeeks} weeks · {Math.max(1, Math.round(totalMinutes / 60))} h of lessons</span>
              {course.status !== 'published' && <span className="rounded-md bg-warning-soft px-1.5 py-0.5 font-semibold text-warning-ink">Preview — {course.status}</span>}
            </div>
          </div>
          <div className="w-full max-w-[300px] md:text-right">
            <div className="h-2.5 overflow-hidden rounded-full border border-line bg-surface-muted" role="progressbar" aria-label="Course progress" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
              <div className={cx('h-full rounded-full', allDone ? 'bg-success' : 'bg-brand')} style={{ width: `${totalCount ? percentage : 0}%` }} />
            </div>
            <div className="mt-2 text-[13px] text-ink-3">{totalCount ? percentage : 0}% Completed · {completedCount} of {totalCount} lessons</div>
          </div>
        </div>

        <div className="mt-8">
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

      <div id="course-panel" role="tabpanel" aria-labelledby={`course-tab-${tab}`} className="mt-8 animate-fade" key={tab}>
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
    </LiveBooksFrame>
  );
}

function CoursePageContent({ params }: CoursePageProps) {
  const { courseId } = use(params);
  return (
    <AppShell fit>
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

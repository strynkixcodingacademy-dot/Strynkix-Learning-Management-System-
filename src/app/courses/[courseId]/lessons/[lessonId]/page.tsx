'use client';

/**
 * Strynkix LMS — Live Books Interactive Lesson Runtime
 * Features persistent curriculum sidebar, rich block rendering,
 * progress recording, and adjacent lesson pagination.
 */

import React, { useEffect, useState, use, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Course, Module, Lesson, Progress } from '@/types/domain';
import {
  getCourseWithCurriculum,
  getLesson,
  getStudentCourseProgress,
  recordLessonProgress,
} from '@/lib/livebook/service';
import { getAdjacentLessons } from '@/lib/livebook/curriculum';
import { getStudentCourseEnrollment } from '@/lib/batches/service';
import { grantsContentAccess } from '@/lib/batches/scope';
import { CurriculumOutline, CurriculumSidebar } from '@/components/livebook/CurriculumSidebar';
import { headingAnchor, LessonBlockRenderer } from '@/components/livebook/LessonBlockRenderer';
import { LESSON_TYPE_LOOK } from '@/components/learning/LearningPath';
import { getSortedCurriculumLessons } from '@/lib/livebook/curriculum';
import { StatusPill } from '@/components/ui/StatusPill';
import { LessonNavigation } from '@/components/livebook/LessonNavigation';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { AppShell } from '@/components/dashboard/AppShell';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { buttonClasses } from '@/components/ui/Button';
import { ArrowLeft, CheckCheck, ChevronDown, Clock, ListTree } from 'lucide-react';

interface LessonPageProps {
  params: Promise<{ courseId: string; lessonId: string }>;
}

function LessonRuntimeView({
  courseId,
  lessonId,
}: {
  courseId: string;
  lessonId: string;
}) {
  const { user, tenant } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [progressList, setProgressList] = useState<Progress[]>([]);
  const [enrollmentBatchId, setEnrollmentBatchId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);

  // Load Curriculum and Current Lesson
  useEffect(() => {
    async function loadData() {
      if (!tenant?.orgId || !user?.uid) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const canPreviewDrafts = Boolean(
          tenant?.role && ['super_admin', 'university_admin', 'branch_admin', 'instructor'].includes(tenant.role)
        );

        // Students reach content only through an enrollment; staff preview without one.
        let batchId: string | null = null;
        if (tenant.role === 'student') {
          const enrollment = await getStudentCourseEnrollment(tenant.orgId, user.uid, courseId);
          if (!enrollment || !grantsContentAccess(enrollment.status)) {
            setError('You are not enrolled in this course. Contact your academy administrator for access.');
            return;
          }
          batchId = enrollment.batchId;
        }
        setEnrollmentBatchId(batchId);

        const [curriculum, activeLesson, userProgress] = await Promise.all([
          getCourseWithCurriculum(courseId, tenant.orgId, canPreviewDrafts),
          getLesson(lessonId, tenant.orgId, canPreviewDrafts),
          getStudentCourseProgress(courseId, user.uid, tenant.orgId),
        ]);

        if (!curriculum || !activeLesson) {
          setError('Lesson or course not found.');
          return;
        }

        setCourse(curriculum.course);
        setModules(curriculum.modules);
        setLessons(curriculum.lessons);
        setLesson(activeLesson);
        setProgressList(userProgress);

        // Record initial "in_progress" visit (enrolled students only). A failed
        // telemetry write must not block reading the lesson.
        if (batchId) {
          try {
            await recordLessonProgress({
              studentId: user.uid,
              orgId: tenant.orgId,
              courseId,
              moduleId: activeLesson.moduleId,
              lessonId: activeLesson.id,
              batchId,
              status: 'in_progress',
              timeSpentSeconds: 30,
            });
          } catch (progressErr) {
            console.warn('Failed to record lesson visit', progressErr);
          }
        }
      } catch (err) {
        console.error('Failed to load lesson runtime', err);
        setError('Failed to load lesson content. Please verify your connection.');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [courseId, lessonId, tenant?.orgId, tenant?.role, user?.uid]);

  // Handler for marking current lesson as completed
  const handleMarkCompleted = useCallback(async () => {
    if (!user?.uid || !tenant?.orgId || !lesson || !enrollmentBatchId) return;

    try {
      await recordLessonProgress({
        studentId: user.uid,
        orgId: tenant.orgId,
        courseId,
        moduleId: lesson.moduleId,
        lessonId: lesson.id,
        batchId: enrollmentBatchId,
        status: 'completed',
        timeSpentSeconds: 60,
      });

      // Refresh local progress list
      const updated = await getStudentCourseProgress(courseId, user.uid, tenant.orgId);
      setProgressList(updated);
    } catch (err) {
      console.error('Failed to record completion', err);
      throw err; // LessonNavigation shows the failure to the student.
    }
  }, [user, tenant, courseId, lesson, enrollmentBatchId]);

  if (isLoading) {
    return (
      <AppShell bare>
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-10" role="status" aria-live="polite">
          <span className="sr-only">Opening lesson…</span>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-48 w-full" />
        </div>
      </AppShell>
    );
  }

  if (error || !course || !lesson) {
    return (
      <AppShell bare>
        <div className="max-w-md mx-auto py-16 px-4">
          <EmptyState
            illustration="lock"
            title="Lesson unavailable"
            action={
              <Link href={`/courses/${courseId}`} className={buttonClasses('primary')}>
                Back to course syllabus
              </Link>
            }
          >
            {error || 'Unable to open lesson.'}
          </EmptyState>
        </div>
      </AppShell>
    );
  }

  const { prevLesson, nextLesson, currentModule } = getAdjacentLessons(
    modules,
    lessons,
    lesson.id
  );

  const currentProgress = progressList.find((p) => p.lessonId === lesson.id);
  const isCompleted = currentProgress?.status === 'completed';

  const typeLook = LESSON_TYPE_LOOK[lesson.type] ?? LESSON_TYPE_LOOK.concept;
  const ordered = getSortedCurriculumLessons(modules, lessons);
  const position = ordered.findIndex((l) => l.id === lesson.id) + 1;
  const outline = (lesson.blocks ?? []).flatMap((b) =>
    b.type === 'heading' && b.level <= 2 ? [{ id: headingAnchor(b.id, b.text), text: b.text }] : []
  );

  const topBar = (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <Link
        href={`/courses/${course.id}`}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-ink-3 transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span className="hidden max-w-[16rem] truncate sm:inline">{course.title}</span>
        <span className="sm:hidden">Course</span>
      </Link>
      <button
        type="button"
        onClick={() => setOutlineOpen((o) => !o)}
        aria-expanded={outlineOpen}
        aria-controls="mobile-outline"
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 font-semibold text-ink-2 hover:bg-surface-muted lg:hidden"
      >
        <ListTree className="w-4 h-4" aria-hidden="true" /> Contents
      </button>
    </div>
  );

  return (
    <AppShell bare topBar={topBar}>
      <div className="flex flex-1 w-full mx-auto">
        {/* Persistent Curriculum Sidebar */}
        <CurriculumSidebar
          course={course}
          modules={modules}
          lessons={lessons}
          activeLessonId={lesson.id}
          progressList={progressList}
        />

        {/* Lesson Reader Canvas */}
        <article className="flex-1 min-w-0 px-4 sm:px-10 lg:px-14 py-8 lg:py-10 max-w-4xl mx-auto space-y-8 animate-rise">
          {outlineOpen && (
            <div id="mobile-outline" className="rounded-card border border-line bg-surface p-4 shadow-card lg:hidden animate-fade">
              <CurriculumOutline course={course} modules={modules} lessons={lessons} activeLessonId={lesson.id}
                progressList={progressList} onNavigate={() => setOutlineOpen(false)} />
            </div>
          )}
          {/* Lesson Metadata Header */}
          <div className="space-y-3 pb-6 border-b border-line">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-3">
              <span className="font-semibold text-brand-ink">{currentModule?.title || 'Module'}</span>
              {position > 0 && <span>Lesson {position} of {ordered.length}</span>}
              <span className="inline-flex items-center gap-1"><typeLook.icon className="w-4 h-4" aria-hidden="true" /> {typeLook.label}</span>
              <span className="inline-flex items-center gap-1"><Clock className="w-4 h-4" aria-hidden="true" /> {lesson.estimatedMinutes} min</span>
              {isCompleted && <StatusPill tone="success" icon={CheckCheck} size="sm">Completed</StatusPill>}
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold text-ink tracking-tight leading-tight font-display">
              {lesson.title}
            </h1>
          </div>

          {outline.length >= 2 && (
            <details className="group rounded-xl border border-line bg-surface px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-ink-2">
                On this page ({outline.length} sections)
                <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <nav aria-label="On this page" className="mt-2">
                <ol className="space-y-1 text-sm">
                  {outline.map((h, i) => (
                    <li key={h.id}><a href={`#${h.id}`} className="block rounded-md px-2 py-1 text-ink-3 hover:bg-canvas hover:text-brand-ink">{i + 1}. {h.text}</a></li>
                  ))}
                </ol>
              </nav>
            </details>
          )}

          {/* Block-Based Content Area */}
          <div className="space-y-4">
            {lesson.blocks && lesson.blocks.length > 0 ? (
              lesson.blocks.map((block) => (
                <LessonBlockRenderer key={block.id} block={block} />
              ))
            ) : (
              <div className="p-8 rounded-xl bg-surface border border-line text-center text-xs text-ink-3">
                This lesson content is currently being prepared by academy instructors.
              </div>
            )}
          </div>

          {/* Previous / Next Lesson Navigation & Completion Controller */}
          <LessonNavigation
            courseId={course.id}
            prevLesson={prevLesson}
            nextLesson={nextLesson}
            isCompleted={isCompleted}
            onMarkCompleted={handleMarkCompleted}
            canTrackProgress={Boolean(enrollmentBatchId)}
          />
        </article>
      </div>
    </AppShell>
  );
}

function LessonPageContent({ params }: LessonPageProps) {
  const resolvedParams = use(params);
  return (
    <RequireAuth>
      <LessonRuntimeView
        courseId={resolvedParams.courseId}
        lessonId={resolvedParams.lessonId}
      />
    </RequireAuth>
  );
}

export default function LessonPage({ params }: LessonPageProps) {
  return (
    <Suspense
      fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading lesson…</span></div>}
    >
      <LessonPageContent params={params} />
    </Suspense>
  );
}

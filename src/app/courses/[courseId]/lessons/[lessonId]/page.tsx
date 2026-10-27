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
import { CurriculumSidebar } from '@/components/livebook/CurriculumSidebar';
import { LessonBlockRenderer } from '@/components/livebook/LessonBlockRenderer';
import { LessonNavigation } from '@/components/livebook/LessonNavigation';
import { RequireAuth } from '@/components/auth/RouteGuards';
import {
  Clock,
  ArrowLeft,
  Loader2,
  AlertCircle,
  BookOpen,
} from 'lucide-react';

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

        // Record initial "in_progress" visit
        await recordLessonProgress({
          studentId: user.uid,
          orgId: tenant.orgId,
          courseId,
          moduleId: activeLesson.moduleId,
          lessonId: activeLesson.id,
          status: 'in_progress',
          timeSpentSeconds: 30,
        });
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
    if (!user?.uid || !tenant?.orgId || !lesson) return;

    try {
      await recordLessonProgress({
        studentId: user.uid,
        orgId: tenant.orgId,
        courseId,
        moduleId: lesson.moduleId,
        lessonId: lesson.id,
        status: 'completed',
        timeSpentSeconds: 60,
      });

      // Refresh local progress list
      const updated = await getStudentCourseProgress(courseId, user.uid, tenant.orgId);
      setProgressList(updated);
    } catch (err) {
      console.error('Failed to record completion', err);
    }
  }, [user, tenant, courseId, lesson]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <span className="text-xs text-slate-400 font-mono">Loading Live Book lesson...</span>
      </div>
    );
  }

  if (error || !course || !lesson) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 flex flex-col items-center justify-center">
        <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-lg font-bold text-white">Lesson Not Found</h2>
          <p className="text-xs text-slate-400">{error || 'Unable to open lesson.'}</p>
          <Link
            href={`/courses/${courseId}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Course Syllabus
          </Link>
        </div>
      </div>
    );
  }

  const { prevLesson, nextLesson, currentModule } = getAdjacentLessons(
    modules,
    lessons,
    lesson.id
  );

  const currentProgress = progressList.find((p) => p.lessonId === lesson.id);
  const isCompleted = currentProgress?.status === 'completed';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Application Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/courses/${course.id}`}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back to Syllabus</span>
            </Link>
            <span className="text-slate-600 hidden sm:inline">/</span>
            <div className="flex items-center gap-2 font-medium text-xs sm:text-sm text-slate-200">
              <BookOpen className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="line-clamp-1">{course.title}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/80 uppercase">
              {lesson.type}
            </span>
          </div>
        </div>
      </header>

      {/* Main Split Layout: Sidebar + Reading Area */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        {/* Persistent Curriculum Sidebar */}
        <CurriculumSidebar
          course={course}
          modules={modules}
          lessons={lessons}
          activeLessonId={lesson.id}
          progressList={progressList}
        />

        {/* Lesson Reader Canvas */}
        <main className="flex-1 min-w-0 px-6 sm:px-12 py-10 max-w-4xl mx-auto space-y-8">
          {/* Lesson Metadata Header */}
          <div className="space-y-4 pb-6 border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <span>{currentModule?.title || 'Module'}</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {lesson.estimatedMinutes} min read & practice
              </span>
              {isCompleted && (
                <>
                  <span>•</span>
                  <span className="text-emerald-400 font-bold">✓ Completed</span>
                </>
              )}
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
              {lesson.title}
            </h1>
          </div>

          {/* Block-Based Content Area */}
          <div className="space-y-2">
            {lesson.blocks && lesson.blocks.length > 0 ? (
              lesson.blocks.map((block) => (
                <LessonBlockRenderer key={block.id} block={block} />
              ))
            ) : (
              <div className="p-8 rounded-xl bg-slate-900/40 border border-slate-800 text-center text-xs text-slate-400">
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
          />
        </main>
      </div>
    </div>
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
      fallback={
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <span className="text-xs text-slate-400 font-mono">Loading lesson...</span>
        </div>
      }
    >
      <LessonPageContent params={params} />
    </Suspense>
  );
}

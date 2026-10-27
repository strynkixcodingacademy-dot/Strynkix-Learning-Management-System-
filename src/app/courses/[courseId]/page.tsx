'use client';

/**
 * Strynkix LMS — Course Curriculum & Syllabus Overview Page
 * Displays syllabus breakdown, module hierarchy, student completion stats,
 * and a one-click "Resume Where You Left Off" action.
 */

import React, { useEffect, useState, use, Suspense } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Course, Module, Lesson, Progress } from '@/types/domain';
import {
  getCourseWithCurriculum,
  getStudentCourseProgress,
} from '@/lib/livebook/service';
import {
  calculateCourseProgress,
  getResumeLesson,
} from '@/lib/livebook/curriculum';
import { RequireAuth } from '@/components/auth/RouteGuards';
import {
  BookOpen,
  CheckCircle2,
  Circle,
  Clock,
  Play,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from 'lucide-react';

interface CoursePageProps {
  params: Promise<{ courseId: string }>;
}

function CourseDetailView({ courseId }: { courseId: string }) {
  const { user, tenant } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [progressList, setProgressList] = useState<Progress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const curriculum = await getCourseWithCurriculum(courseId, tenant.orgId, canPreviewDrafts);
        if (!curriculum) {
          setError('Course not found or access is restricted.');
          return;
        }

        setCourse(curriculum.course);
        setModules(curriculum.modules);
        setLessons(curriculum.lessons);

        // Load progress
        const prog = await getStudentCourseProgress(courseId, user.uid, tenant.orgId);
        setProgressList(prog);
      } catch (err) {
        console.error('Failed to load course curriculum', err);
        setError('Failed to load course details. Please try again.');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [courseId, tenant?.orgId, tenant?.role, user?.uid]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <span className="text-xs text-slate-400 font-mono">Loading course syllabus...</span>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 flex flex-col items-center justify-center">
        <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-lg font-bold text-white">Course Unavailable</h2>
          <p className="text-xs text-slate-400">{error || 'Course could not be loaded.'}</p>
          <Link
            href="/courses"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Course Catalog
          </Link>
        </div>
      </div>
    );
  }

  const completedSet = new Set(
    progressList.filter((p) => p.status === 'completed').map((p) => p.lessonId)
  );
  const { percentage, completedCount, totalCount } = calculateCourseProgress(
    lessons.length,
    completedSet
  );

  const resumeLesson = getResumeLesson(modules, lessons, progressList);
  const sortedModules = [...modules].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link
            href="/courses"
            className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Course Catalog</span>
          </Link>
          <span className="text-xs font-mono text-emerald-400">
            {percentage}% Complete
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 space-y-10">
        {/* Course Banner Card */}
        <section className="p-8 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800/80 font-semibold uppercase">
                {course.level}
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {course.estimatedWeeks} Weeks Track
              </span>
            </div>

            {resumeLesson && (
              <Link
                href={`/courses/${course.id}/lessons/${resumeLesson.id}`}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold transition shadow-xl shadow-indigo-600/30"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>
                  {completedCount === 0 ? 'Start Course' : 'Resume Where You Left Off'}
                </span>
              </Link>
            )}
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              {course.title}
            </h1>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-3xl">
              {course.description}
            </p>
          </div>

          {/* Progress Bar */}
          <div className="pt-4 border-t border-slate-800/80 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Overall Course Progress</span>
              <span className="font-mono text-emerald-400 font-bold">
                {completedCount} of {totalCount} Lessons Completed ({percentage}%)
              </span>
            </div>
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        </section>

        {/* Syllabus Hierarchy Section */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-400" />
              <span>Course Syllabus & Live Books</span>
            </h2>
            <span className="text-xs font-mono text-slate-500">
              {modules.length} Modules • {lessons.length} Lessons
            </span>
          </div>

          <div className="space-y-6">
            {sortedModules.map((module, mIdx) => {
              const moduleLessons = lessons
                .filter((l) => l.moduleId === module.id)
                .sort((a, b) => a.orderIndex - b.orderIndex);

              return (
                <div
                  key={module.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden shadow-lg"
                >
                  <div className="p-4 sm:p-5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400 font-bold">
                        Module {mIdx + 1}
                      </span>
                      <h3 className="text-base font-bold text-white">{module.title}</h3>
                      {module.summary && (
                        <p className="text-xs text-slate-400 mt-0.5">{module.summary}</p>
                      )}
                    </div>
                    <span className="text-xs font-mono text-slate-500">
                      {moduleLessons.length} lessons
                    </span>
                  </div>

                  <div className="divide-y divide-slate-800/60">
                    {moduleLessons.map((lesson, lIdx) => {
                      const isCompleted = completedSet.has(lesson.id);

                      return (
                        <Link
                          key={lesson.id}
                          href={`/courses/${course.id}/lessons/${lesson.id}`}
                          className="group flex items-center justify-between p-4 hover:bg-slate-800/40 transition text-xs sm:text-sm"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {isCompleted ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                            ) : (
                              <Circle className="w-5 h-5 text-slate-600 shrink-0 group-hover:text-slate-400" />
                            )}
                            <div className="min-w-0">
                              <span className="font-medium text-slate-200 group-hover:text-indigo-300 transition truncate block">
                                {lesson.title}
                              </span>
                              <span className="text-[11px] text-slate-500 font-mono">
                                Lesson {mIdx + 1}.{lIdx + 1} • {lesson.type}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 text-slate-400 font-mono text-xs">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {lesson.estimatedMinutes}m
                            </span>
                            <span className="text-slate-600 group-hover:text-slate-300 transition">
                              →
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

function CoursePageContent({ params }: CoursePageProps) {
  const resolvedParams = use(params);
  return (
    <RequireAuth>
      <CourseDetailView courseId={resolvedParams.courseId} />
    </RequireAuth>
  );
}

export default function CoursePage({ params }: CoursePageProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <span className="text-xs text-slate-400 font-mono">Loading course...</span>
        </div>
      }
    >
      <CoursePageContent params={params} />
    </Suspense>
  );
}

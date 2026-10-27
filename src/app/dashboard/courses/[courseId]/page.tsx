'use client';

/**
 * Strynkix LMS — Course Curriculum Builder
 * Allows authorized instructors and admins to organize modules, add lessons,
 * inspect block counts, and control publication states.
 */

import React, { useEffect, useState, use, Suspense } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import {
  getCourseById,
  getModulesForCourse,
  getLessonsForCourse,
  createModule,
  createLesson,
  setCourseStatus,
  setLessonStatus,
} from '@/lib/courses/service';
import { Course, Module, Lesson, LessonType, EntityStatus } from '@/types/domain';
import {
  BookOpen,
  Plus,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Eye,
  Check,
  XCircle,
  FileCode,
  Layers,
  Edit3,
} from 'lucide-react';

interface CurriculumPageProps {
  params: Promise<{ courseId: string }>;
}

function CurriculumBuilderView({ courseId }: { courseId: string }) {
  const { tenant } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add Module Modal
  const [showModuleModal, setShowModuleModal] = useState(false);
  const [modTitle, setModTitle] = useState('');
  const [modSlug, setModSlug] = useState('');
  const [modSummary, setModSummary] = useState('');
  const [modOrder, setModOrder] = useState(1);
  const [isSubmittingModule, setIsSubmittingModule] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);

  // Add Lesson Modal
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [targetModuleId, setTargetModuleId] = useState('');
  const [lesTitle, setLesTitle] = useState('');
  const [lesSlug, setLesSlug] = useState('');
  const [lesType, setLesType] = useState<LessonType>('concept');
  const [lesMinutes, setLesMinutes] = useState(20);
  const [lesOrder, setLesOrder] = useState(1);
  const [isSubmittingLesson, setIsSubmittingLesson] = useState(false);
  const [lessonError, setLessonError] = useState<string | null>(null);

  const reloadCurriculum = async () => {
    if (!tenant?.orgId) return;
    try {
      setIsLoading(true);
      setError(null);
      const [c, m, l] = await Promise.all([
        getCourseById(courseId),
        getModulesForCourse(courseId, tenant.orgId),
        getLessonsForCourse(courseId, tenant.orgId),
      ]);

      if (!c) {
        setError('Course not found or access restricted.');
        return;
      }
      setCourse(c);
      setModules(m);
      setLessons(l);
    } catch (err: unknown) {
      console.error('Failed to load curriculum:', err);
      setError('Unable to load course curriculum.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchCurriculum() {
      if (!tenant?.orgId) {
        if (isMounted) setIsLoading(false);
        return;
      }
      try {
        const [c, m, l] = await Promise.all([
          getCourseById(courseId),
          getModulesForCourse(courseId, tenant.orgId),
          getLessonsForCourse(courseId, tenant.orgId),
        ]);

        if (isMounted) {
          if (!c) {
            setError('Course not found or access restricted.');
            setIsLoading(false);
            return;
          }
          setCourse(c);
          setModules(m);
          setLessons(l);
          setError(null);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (isMounted) {
          console.error('Failed to load curriculum:', err);
          setError('Unable to load course curriculum.');
          setIsLoading(false);
        }
      }
    }

    fetchCurriculum();
    return () => {
      isMounted = false;
    };
  }, [courseId, tenant?.orgId]);

  const handleToggleCoursePublish = async () => {
    if (!course) return;
    const nextStatus: EntityStatus = course.status === 'published' ? 'draft' : 'published';
    try {
      await setCourseStatus(course.id, nextStatus);
      setSuccessMsg(`Course is now ${nextStatus.toUpperCase()}.`);
      await reloadCurriculum();
    } catch (err: unknown) {
      const e = err as Error;
      setError(`Failed to update course status: ${e.message}`);
    }
  };

  const handleToggleLessonPublish = async (lesson: Lesson) => {
    const nextStatus: EntityStatus = lesson.status === 'published' ? 'draft' : 'published';
    try {
      await setLessonStatus(lesson.id, nextStatus);
      setSuccessMsg(`Lesson "${lesson.title}" is now ${nextStatus.toUpperCase()}.`);
      await reloadCurriculum();
    } catch (err: unknown) {
      const e = err as Error;
      setError(`Failed to update lesson status: ${e.message}`);
    }
  };

  const handleCreateModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant?.orgId) return;

    setIsSubmittingModule(true);
    setModuleError(null);
    try {
      await createModule({
        orgId: tenant.orgId,
        courseId,
        title: modTitle.trim(),
        slug: modSlug.trim().toLowerCase(),
        summary: modSummary.trim(),
        orderIndex: Number(modOrder),
        status: 'published',
      });

      setSuccessMsg(`Module "${modTitle}" created!`);
      setModTitle('');
      setModSlug('');
      setModSummary('');
      setShowModuleModal(false);
      await reloadCurriculum();
    } catch (err: unknown) {
      const e = err as Error;
      setModuleError(e.message || 'Failed to create module.');
    } finally {
      setIsSubmittingModule(false);
    }
  };

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant?.orgId) return;

    setIsSubmittingLesson(true);
    setLessonError(null);
    try {
      await createLesson({
        orgId: tenant.orgId,
        courseId,
        moduleId: targetModuleId,
        title: lesTitle.trim(),
        slug: lesSlug.trim().toLowerCase(),
        type: lesType,
        orderIndex: Number(lesOrder),
        estimatedMinutes: Number(lesMinutes),
        status: 'draft',
        blocks: [
          {
            id: `blk_intro_${Date.now().toString(36)}`,
            type: 'text',
            content: `Welcome to **${lesTitle}**. Edit this Live Book lesson to add concept blocks, code snippets, and interactive quizzes.`,
          },
        ],
      });

      setSuccessMsg(`Lesson "${lesTitle}" drafted! Ready for block authoring.`);
      setLesTitle('');
      setLesSlug('');
      setShowLessonModal(false);
      await reloadCurriculum();
    } catch (err: unknown) {
      const e = err as Error;
      setLessonError(e.message || 'Failed to create lesson.');
    } finally {
      setIsSubmittingLesson(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <span className="text-xs text-slate-400 font-mono">Loading curriculum builder...</span>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="p-8 max-w-md mx-auto my-12 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <h3 className="text-lg font-bold text-white">Course Unavailable</h3>
        <p className="text-xs text-slate-400">{error || 'Could not load course.'}</p>
        <Link
          href="/dashboard/courses"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Authoring Hub</span>
        </Link>
      </div>
    );
  }

  const isPub = course.status === 'published';

  return (
    <div className="space-y-6">
      {/* Top Navigation & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/courses"
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition"
            title="Back to Courses"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase text-indigo-400 font-semibold">
                Curriculum Builder
              </span>
              <span
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                  isPub
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}
              >
                {course.status}
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-white">{course.title}</h2>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Publish / Unpublish Course */}
          <button
            type="button"
            onClick={handleToggleCoursePublish}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
              isPub
                ? 'bg-amber-950 text-amber-300 border border-amber-800 hover:bg-amber-900'
                : 'bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900'
            }`}
          >
            {isPub ? <XCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            <span>{isPub ? 'Unpublish Course' : 'Publish Course'}</span>
          </button>

          {/* Preview Syllabus */}
          <Link
            href={`/courses/${course.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
          >
            <Eye className="w-4 h-4" />
            <span>Student View</span>
          </Link>

          {/* Add Module */}
          <button
            type="button"
            onClick={() => {
              setModOrder(modules.length + 1);
              setShowModuleModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Module</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 flex items-center gap-2.5 text-emerald-300 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Modules & Lessons Hierarchy */}
      {modules.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
          <Layers className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-300">No Modules Configured</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            This course track has no chapters yet. Click &quot;Add Module&quot; to structure your syllabus.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {modules.map((m, mIdx) => {
            const moduleLessons = lessons.filter((l) => l.moduleId === m.id);

            return (
              <div
                key={m.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden shadow-xl"
              >
                {/* Module Bar */}
                <div className="p-4 sm:p-5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-mono uppercase text-indigo-400 font-bold tracking-wider">
                      Module {mIdx + 1}
                    </span>
                    <h3 className="text-base font-bold text-white">{m.title}</h3>
                    {m.summary && <p className="text-xs text-slate-400">{m.summary}</p>}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setTargetModuleId(m.id);
                      setLesOrder(moduleLessons.length + 1);
                      setShowLessonModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-800/80 text-xs font-semibold transition shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Lesson</span>
                  </button>
                </div>

                {/* Lessons in Module */}
                {moduleLessons.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 font-mono">
                    No lessons in this module yet. Click &quot;Add Lesson&quot; to author content.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/60">
                    {moduleLessons.map((l, lIdx) => {
                      const isLesPub = l.status === 'published';
                      return (
                        <div
                          key={l.id}
                          className="p-4 hover:bg-slate-800/30 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 font-mono font-bold text-xs shrink-0">
                              {mIdx + 1}.{lIdx + 1}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-200 text-sm">
                                  {l.title}
                                </span>
                                <span
                                  className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                                    isLesPub
                                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                      : 'bg-amber-950 text-amber-300 border-amber-800'
                                  }`}
                                >
                                  {l.status}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono mt-0.5">
                                <span className="uppercase">{l.type}</span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {l.estimatedMinutes}m
                                </span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <FileCode className="w-3 h-3" />
                                  {l.blocks?.length || 0} blocks
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                            {/* Toggle Publish */}
                            <button
                              type="button"
                              onClick={() => handleToggleLessonPublish(l)}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                                isLesPub
                                  ? 'bg-amber-950/60 text-amber-300 border border-amber-800 hover:bg-amber-900/60'
                                  : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/60'
                              }`}
                              title={isLesPub ? 'Revert to Draft' : 'Publish to Students'}
                            >
                              {isLesPub ? 'Unpublish' : 'Publish'}
                            </button>

                            {/* Preview Lesson */}
                            <Link
                              href={`/courses/${course.id}/lessons/${l.id}`}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                              title="Preview Live Book lesson"
                            >
                              <Eye className="w-4 h-4" />
                            </Link>

                            {/* Edit Lesson Blocks */}
                            <Link
                              href={`/dashboard/courses/${course.id}/lessons/${l.id}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Edit Blocks</span>
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create Module */}
      {showModuleModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                <Layers className="w-5 h-5" />
                <span>Add Curriculum Module</span>
              </div>
              <button
                onClick={() => setShowModuleModal(false)}
                className="text-slate-400 hover:text-white text-xs font-mono"
              >
                Cancel
              </button>
            </div>

            {moduleError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{moduleError}</span>
              </div>
            )}

            <form onSubmit={handleCreateModule} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Module Title <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={modTitle}
                  onChange={(e) => {
                    setModTitle(e.target.value);
                    if (!modSlug) {
                      setModSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
                    }
                  }}
                  placeholder="e.g. Asynchronous TypeScript & Firestore Security"
                  required
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Module Slug <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={modSlug}
                  onChange={(e) => setModSlug(e.target.value)}
                  placeholder="async-ts-firestore"
                  required
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Summary</label>
                <textarea
                  rows={2}
                  value={modSummary}
                  onChange={(e) => setModSummary(e.target.value)}
                  placeholder="Brief chapter overview explaining what students will construct..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Order Index</label>
                <input
                  type="number"
                  min={1}
                  value={modOrder}
                  onChange={(e) => setModOrder(Number(e.target.value))}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModuleModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingModule}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30"
                >
                  {isSubmittingModule && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmittingModule ? 'Adding...' : 'Add Module'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Lesson */}
      {showLessonModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                <BookOpen className="w-5 h-5" />
                <span>Add Live Book Lesson</span>
              </div>
              <button
                onClick={() => setShowLessonModal(false)}
                className="text-slate-400 hover:text-white text-xs font-mono"
              >
                Cancel
              </button>
            </div>

            {lessonError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{lessonError}</span>
              </div>
            )}

            <form onSubmit={handleCreateLesson} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Target Module</label>
                <select
                  value={targetModuleId}
                  onChange={(e) => setTargetModuleId(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                >
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Lesson Title <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={lesTitle}
                  onChange={(e) => {
                    setLesTitle(e.target.value);
                    if (!lesSlug) {
                      setLesSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
                    }
                  }}
                  placeholder="e.g. Zero-Trust Security Invariants"
                  required
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Lesson Slug <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={lesSlug}
                  onChange={(e) => setLesSlug(e.target.value)}
                  placeholder="zero-trust-invariants"
                  required
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Lesson Type</label>
                  <select
                    value={lesType}
                    onChange={(e) => setLesType(e.target.value as LessonType)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="concept">Concept Narrative</option>
                    <option value="interactive_code">Interactive Code</option>
                    <option value="exercise">Exercise & Quiz</option>
                    <option value="project_milestone">Project Milestone</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Est. Minutes</label>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={lesMinutes}
                    onChange={(e) => setLesMinutes(Number(e.target.value))}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Order Index</label>
                <input
                  type="number"
                  min={1}
                  value={lesOrder}
                  onChange={(e) => setLesOrder(Number(e.target.value))}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowLessonModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingLesson}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30"
                >
                  {isSubmittingLesson && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmittingLesson ? 'Creating...' : 'Create Lesson Draft'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function CurriculumBuilderContent({ params }: CurriculumPageProps) {
  const resolved = use(params);
  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor']}>
      <AppShell pageTitle="Curriculum Builder">
        <CurriculumBuilderView courseId={resolved.courseId} />
      </AppShell>
    </RequireRole>
  );
}

export default function CurriculumBuilderPage({ params }: CurriculumPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center py-24 space-y-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <span className="text-xs text-slate-400 font-mono">Loading curriculum builder...</span>
        </div>
      }
    >
      <CurriculumBuilderContent params={params} />
    </Suspense>
  );
}

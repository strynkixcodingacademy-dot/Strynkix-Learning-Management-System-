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
  // Only the Super Admin publishes shared courses and lessons (owner decision D3).
  const canPublish = tenant?.role === 'super_admin';
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
        <Loader2 className="w-8 h-8 text-brand-ink animate-spin" />
        <span className="text-xs text-ink-3">Loading curriculum builder...</span>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="p-8 max-w-md mx-auto my-12 bg-surface border border-line rounded-2xl text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-danger-ink mx-auto" />
        <h3 className="text-lg font-bold text-ink">Course Unavailable</h3>
        <p className="text-xs text-ink-3">{error || 'Could not load course.'}</p>
        <Link
          href="/dashboard/courses"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold"
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/courses"
            className="p-2 rounded-lg bg-surface border border-line text-ink-3 hover:text-ink transition"
            title="Back to Courses"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-brand-ink font-semibold">
                Curriculum Builder
              </span>
              <span
                className={`text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full border ${
 isPub
 ? 'bg-success-soft text-success-ink border-success-line'
 : 'bg-warning-soft text-warning-ink border-warning-line'
 }`}
              >
                {course.status}
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-ink">{course.title}</h2>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
{canPublish ? (<>
          {/* Publish / Unpublish Course */}
          <button
            type="button"
            onClick={handleToggleCoursePublish}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
 isPub
 ? 'bg-warning-soft text-warning-ink border border-warning-line hover:bg-surface-muted'
 : 'bg-success-soft text-success-ink border border-success-line hover:bg-surface-muted'
 }`}
          >
            {isPub ? <XCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            <span>{isPub ? 'Unpublish Course' : 'Publish Course'}</span>
          </button>
          </>) : (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-muted px-3 py-2 text-xs font-semibold text-ink-3" title="Only the Super Admin publishes shared courses">{isPub ? 'Published course' : 'Draft · Super Admin publishes'}</span>
          )}

          {/* Preview Syllabus */}
          <Link
            href={`/courses/${course.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-muted hover:bg-surface-sunken text-ink text-xs font-semibold transition"
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
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold shadow-card transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Module</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-success-soft border border-success-line flex items-center gap-2.5 text-success-ink text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-success-ink" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Modules & Lessons Hierarchy */}
      {modules.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-surface border border-line space-y-3">
          <Layers className="w-10 h-10 text-ink-4 mx-auto" />
          <h3 className="text-sm font-semibold text-ink-2">No Modules Configured</h3>
          <p className="text-xs text-ink-3 max-w-sm mx-auto">
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
                className="rounded-2xl border border-line bg-surface overflow-hidden shadow-card"
              >
                {/* Module Bar */}
                <div className="p-4 sm:p-5 bg-surface border-b border-line flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-brand-ink font-bold tracking-wider">
                      Module {mIdx + 1}
                    </span>
                    <h3 className="text-base font-bold text-ink">{m.title}</h3>
                    {m.summary && <p className="text-xs text-ink-3">{m.summary}</p>}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setTargetModuleId(m.id);
                      setLesOrder(moduleLessons.length + 1);
                      setShowLessonModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-soft hover:bg-brand-soft text-brand-ink border border-brand-line text-xs font-semibold transition shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Lesson</span>
                  </button>
                </div>

                {/* Lessons in Module */}
                {moduleLessons.length === 0 ? (
                  <div className="p-6 text-center text-xs text-ink-3">
                    No lessons in this module yet. Click &quot;Add Lesson&quot; to author content.
                  </div>
                ) : (
                  <div className="divide-y divide-line">
                    {moduleLessons.map((l, lIdx) => {
                      const isLesPub = l.status === 'published';
                      return (
                        <div
                          key={l.id}
                          className="p-4 hover:bg-surface-muted transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-surface-muted flex items-center justify-center text-ink-3 font-bold text-xs shrink-0">
                              {mIdx + 1}.{lIdx + 1}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-ink text-sm">
                                  {l.title}
                                </span>
                                <span
                                  className={`text-[9px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full border ${
 isLesPub
 ? 'bg-success-soft text-success-ink border-success-line'
 : 'bg-warning-soft text-warning-ink border-warning-line'
 }`}
                                >
                                  {l.status}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-ink-3 mt-0.5">
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
{canPublish ? (<>
                            {/* Toggle Publish */}
                            <button
                              type="button"
                              onClick={() => handleToggleLessonPublish(l)}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
 isLesPub
 ? 'bg-warning-soft text-warning-ink border border-warning-line hover:bg-surface-muted'
 : 'bg-success-soft text-success-ink border border-success-line hover:bg-surface-muted'
 }`}
                              title={isLesPub ? 'Revert to Draft' : 'Publish to Students'}
                            >
                              {isLesPub ? 'Unpublish' : 'Publish'}
                            </button>
                            </>) : (
                              <span className="rounded-lg border border-line bg-surface-muted px-2 py-1 text-[11px] font-semibold text-ink-3">{isLesPub ? 'Published' : 'Draft'}</span>
                            )}

                            {/* Preview Lesson */}
                            <Link
                              href={`/courses/${course.id}/lessons/${l.id}`}
                              className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-muted transition"
                              title="Preview Live Book lesson"
                            >
                              <Eye className="w-4 h-4" />
                            </Link>

                            {/* Edit Lesson Blocks */}
                            <Link
                              href={`/dashboard/courses/${course.id}/lessons/${l.id}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-semibold shadow-card transition"
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
        <div className="fixed inset-0 z-50 bg-ink/20 backdrop-blur-[3px] animate-fade flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl bg-surface border border-line shadow-lift p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2 text-brand-ink font-bold text-sm">
                <Layers className="w-5 h-5" />
                <span>Add Curriculum Module</span>
              </div>
              <button
                onClick={() => setShowModuleModal(false)}
                className="text-ink-3 hover:text-ink text-xs"
              >
                Cancel
              </button>
            </div>

            {moduleError && (
              <div className="p-3 rounded-lg bg-danger-soft border border-danger-line text-xs text-danger-ink flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink mt-0.5" />
                <span>{moduleError}</span>
              </div>
            )}

            <form onSubmit={handleCreateModule} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-2">
                  Module Title <span className="text-danger-ink">*</span>
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
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-2">
                  Module Slug <span className="text-danger-ink">*</span>
                </label>
                <input
                  type="text"
                  value={modSlug}
                  onChange={(e) => setModSlug(e.target.value)}
                  placeholder="async-ts-firestore"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink font-mono placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-2">Summary</label>
                <textarea
                  rows={2}
                  value={modSummary}
                  onChange={(e) => setModSummary(e.target.value)}
                  placeholder="Brief chapter overview explaining what students will construct..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-2">Order Index</label>
                <input
                  type="number"
                  min={1}
                  value={modOrder}
                  onChange={(e) => setModOrder(Number(e.target.value))}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink font-mono focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModuleModal(false)}
                  className="px-4 py-2 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink-2 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingModule}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold shadow-card"
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
        <div className="fixed inset-0 z-50 bg-ink/20 backdrop-blur-[3px] animate-fade flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl bg-surface border border-line shadow-lift p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2 text-brand-ink font-bold text-sm">
                <BookOpen className="w-5 h-5" />
                <span>Add Live Book Lesson</span>
              </div>
              <button
                onClick={() => setShowLessonModal(false)}
                className="text-ink-3 hover:text-ink text-xs"
              >
                Cancel
              </button>
            </div>

            {lessonError && (
              <div className="p-3 rounded-lg bg-danger-soft border border-danger-line text-xs text-danger-ink flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink mt-0.5" />
                <span>{lessonError}</span>
              </div>
            )}

            <form onSubmit={handleCreateLesson} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-2">Target Module</label>
                <select
                  value={targetModuleId}
                  onChange={(e) => setTargetModuleId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono"
                >
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-2">
                  Lesson Title <span className="text-danger-ink">*</span>
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
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-2">
                  Lesson Slug <span className="text-danger-ink">*</span>
                </label>
                <input
                  type="text"
                  value={lesSlug}
                  onChange={(e) => setLesSlug(e.target.value)}
                  placeholder="zero-trust-invariants"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink font-mono placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-2">Lesson Type</label>
                  <select
                    value={lesType}
                    onChange={(e) => setLesType(e.target.value as LessonType)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                  >
                    <option value="concept">Concept Narrative</option>
                    <option value="interactive_code">Interactive Code</option>
                    <option value="exercise">Exercise & Quiz</option>
                    <option value="project_milestone">Project Milestone</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-2">Est. Minutes</label>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={lesMinutes}
                    onChange={(e) => setLesMinutes(Number(e.target.value))}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink font-mono focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-2">Order Index</label>
                <input
                  type="number"
                  min={1}
                  value={lesOrder}
                  onChange={(e) => setLesOrder(Number(e.target.value))}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink font-mono focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowLessonModal(false)}
                  className="px-4 py-2 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink-2 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingLesson}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold shadow-card"
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
          <Loader2 className="w-8 h-8 text-brand-ink animate-spin" />
          <span className="text-xs text-ink-3">Loading curriculum builder...</span>
        </div>
      }
    >
      <CurriculumBuilderContent params={params} />
    </Suspense>
  );
}

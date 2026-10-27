'use client';

/**
 * Strynkix LMS — Course Authoring Hub
 * Enables authorized instructors and administrators to create, edit,
 * and publish courses within their permitted organization scope.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import {
  getAdminCourses,
  createCourse,
  setCourseStatus,
} from '@/lib/courses/service';
import { Course, CourseLevel, EntityStatus } from '@/types/domain';
import {
  BookOpen,
  Plus,
  Clock,
  Tag,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Eye,
  Check,
  XCircle,
} from 'lucide-react';

export default function CourseAuthoringPage() {
  const { user, tenant } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<CourseLevel>('beginner');
  const [estimatedWeeks, setEstimatedWeeks] = useState(12);
  const [tagsInput, setTagsInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refreshCourses = async () => {
    if (!tenant?.orgId) return;
    try {
      setIsLoading(true);
      const isSuper = tenant.role === 'super_admin';
      const loaded = await getAdminCourses(isSuper ? undefined : tenant.orgId);
      setCourses(loaded);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchCourses() {
      if (!tenant?.orgId) {
        if (isMounted) setIsLoading(false);
        return;
      }
      try {
        const isSuper = tenant.role === 'super_admin';
        const loaded = await getAdminCourses(isSuper ? undefined : tenant.orgId);
        if (isMounted) {
          setCourses(loaded);
          setError(null);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (isMounted) {
          console.error('Failed to load authoring courses:', err);
          setError('Unable to load courses. Please verify your authoring permissions.');
          setIsLoading(false);
        }
      }
    }

    fetchCourses();
    return () => {
      isMounted = false;
    };
  }, [tenant?.orgId, tenant?.role]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slug || slug === title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50));
    }
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant?.orgId || !user?.uid) return;

    setIsSubmitting(true);
    setFormError(null);
    setSuccessMsg(null);

    try {
      const parsedTags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const created = await createCourse({
        orgId: tenant.orgId,
        title: title.trim(),
        slug: slug.trim().toLowerCase(),
        tagline: tagline.trim(),
        description: description.trim(),
        level,
        tags: parsedTags,
        estimatedWeeks: Number(estimatedWeeks),
        status: 'draft',
        createdById: user.uid,
      });

      setSuccessMsg(`Course "${created.title}" successfully drafted!`);
      setTitle('');
      setSlug('');
      setTagline('');
      setDescription('');
      setLevel('beginner');
      setEstimatedWeeks(12);
      setTagsInput('');
      setShowModal(false);

      await refreshCourses();
    } catch (err: unknown) {
      const e = err as Error;
      setFormError(e.message || 'Failed to create course.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTogglePublish = async (course: Course) => {
    const nextStatus: EntityStatus = course.status === 'published' ? 'draft' : 'published';
    try {
      await setCourseStatus(course.id, nextStatus);
      setSuccessMsg(
        `Course "${course.title}" status changed to ${nextStatus.toUpperCase()}.`
      );
      await refreshCourses();
    } catch (err: unknown) {
      const e = err as Error;
      setError(`Failed to update status: ${e.message}`);
    }
  };

  const filteredCourses = courses.filter((c) => {
    if (statusFilter === 'all') return true;
    return c.status === statusFilter;
  });

  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor']}>
      <AppShell pageTitle="Course Authoring & Management">
        <div className="space-y-6">
          {/* Action Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
            <div>
              <p className="text-xs text-slate-400">
                Design interactive Live Books curricula, author modules, and control publication lifecycle.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="all">All Statuses ({courses.length})</option>
                <option value="published">Published Only</option>
                <option value="draft">Drafts Only</option>
                <option value="archived">Archived</option>
              </select>

              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create Course</span>
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

          {error && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 flex items-center gap-2.5 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
              <span className="text-xs text-slate-400 font-mono">Loading course catalog...</span>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && filteredCourses.length === 0 && (
            <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
              <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-300">No Courses Found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No courses match your active filter. Click &quot;Create Course&quot; to author a new interactive Live Book.
              </p>
            </div>
          )}

          {/* Courses Grid */}
          {!isLoading && filteredCourses.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredCourses.map((c) => {
                const isPub = c.status === 'published';
                return (
                  <div
                    key={c.id}
                    className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between space-y-4 shadow-xl"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                          {c.level}
                        </span>
                        <span
                          className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                            isPub
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : c.status === 'draft'
                              ? 'bg-amber-950 text-amber-300 border-amber-800'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {c.status}
                        </span>
                      </div>

                      <div>
                        <h3 className="text-base font-bold text-white tracking-tight leading-snug">
                          {c.title}
                        </h3>
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                          {c.tagline || c.description}
                        </p>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {c.estimatedWeeks} Weeks
                        </span>
                        {c.tags && c.tags.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Tag className="w-3.5 h-3.5" />
                            {c.tags.slice(0, 2).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions Toolbar */}
                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {/* Publish / Unpublish Button */}
                        <button
                          type="button"
                          onClick={() => handleTogglePublish(c)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                            isPub
                              ? 'bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border border-amber-800/60'
                              : 'bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/60'
                          }`}
                          title={isPub ? 'Revert to Draft' : 'Publish to Students'}
                        >
                          {isPub ? <XCircle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                          <span>{isPub ? 'Unpublish' : 'Publish'}</span>
                        </button>

                        {/* Preview Student Syllabus */}
                        <Link
                          href={`/courses/${c.id}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                          title="Preview student view"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                      </div>

                      {/* Manage Curriculum */}
                      <Link
                        href={`/dashboard/courses/${c.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition"
                      >
                        <span>Curriculum</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Create Course Modal */}
          {showModal && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="max-w-lg w-full rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                    <BookOpen className="w-5 h-5" />
                    <span>Create New Course Track</span>
                  </div>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-slate-400 hover:text-white text-xs font-mono"
                  >
                    Cancel
                  </button>
                </div>

                {formError && (
                  <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <form onSubmit={handleCreateCourse} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      Course Title <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      placeholder="e.g. Distributed Systems & Cloud Infrastructure"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      URL Slug <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="e.g. distributed-systems-cloud"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      Short Tagline <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={tagline}
                      onChange={(e) => setTagline(e.target.value)}
                      placeholder="e.g. Master resilient microservices and real-time event streaming"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      Detailed Syllabus Overview <span className="text-rose-400">*</span>
                    </label>
                    <textarea
                      rows={3}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Provide comprehensive pedagogy goals, target competencies, and technical prerequisites..."
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">Difficulty Level</label>
                      <select
                        value={level}
                        onChange={(e) => setLevel(e.target.value as CourseLevel)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">Estimated Duration</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={1}
                          max={52}
                          value={estimatedWeeks}
                          onChange={(e) => setEstimatedWeeks(Number(e.target.value))}
                          required
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        />
                        <span className="absolute right-3 top-2 text-xs text-slate-500 pointer-events-none">
                          Weeks
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Tags (comma-separated)</label>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="typescript, architecture, cloud, databases"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-[11px]"
                    />
                  </div>

                  <div className="pt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30"
                    >
                      {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{isSubmitting ? 'Drafting...' : 'Create Course Draft'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </RequireRole>
  );
}

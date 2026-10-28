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
import { CourseIcon, courseIdentity, SPINE } from '@/components/ui/CourseIcon';
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
      // Students see RequireRole's fallback; don't query authoring data for them.
      if (!tenant?.orgId || tenant.role === 'student') {
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-line">
            <div>
              <p className="text-xs text-ink-3">
                Design interactive Live Books curricula, author modules, and control publication lifecycle.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-surface border border-line text-xs text-ink font-mono focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="all">All Statuses ({courses.length})</option>
                <option value="published">Published Only</option>
                <option value="draft">Drafts Only</option>
                <option value="archived">Archived</option>
              </select>

              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold shadow-card transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create Course</span>
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

          {error && (
            <div className="p-4 rounded-xl bg-danger-soft border border-danger-line flex items-center gap-2.5 text-danger-ink text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink" />
              <span>{error}</span>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="w-7 h-7 text-brand-ink animate-spin" />
              <span className="text-xs text-ink-3 font-mono">Loading course catalog...</span>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && filteredCourses.length === 0 && (
            <div className="p-12 text-center rounded-2xl bg-surface border border-line space-y-3">
              <BookOpen className="w-10 h-10 text-ink-4 mx-auto" />
              <h3 className="text-sm font-semibold text-ink-2">No Courses Found</h3>
              <p className="text-xs text-ink-3 max-w-sm mx-auto">
                No courses match your active filter. Click &quot;Create Course&quot; to author a new interactive Live Book.
              </p>
            </div>
          )}

          {/* Courses Grid */}
          {!isLoading && filteredCourses.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredCourses.map((c) => {
                const isPub = c.status === 'published';
                const { tone } = courseIdentity(c);
                return (
                  <div
                    key={c.id}
                    className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-surface border border-line hover:border-line-strong transition shadow-card"
                  >
                    <span aria-hidden="true" className={`h-1.5 w-full shrink-0 ${SPINE[tone]}`} />
                    <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <CourseIcon course={c} size="sm" />
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-surface-muted border border-line text-ink-2">
                          {c.level}
                        </span>
                        <span
                          className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
 isPub
 ? 'bg-success-soft text-success-ink border-success-line'
 : c.status === 'draft'
 ? 'bg-warning-soft text-warning-ink border-warning-line'
 : 'bg-surface-muted text-ink-3 border-line'
 }`}
                        >
                          {c.status}
                        </span>
                      </div>

                      <div>
                        <h3 className="text-base font-bold text-ink tracking-tight leading-snug">
                          {c.title}
                        </h3>
                        <p className="text-xs text-ink-3 mt-1 line-clamp-2">
                          {c.tagline || c.description}
                        </p>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-mono text-ink-3">
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
                    <div className="pt-3 border-t border-line flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {/* Publish / Unpublish Button */}
                        <button
                          type="button"
                          onClick={() => handleTogglePublish(c)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
 isPub
 ? 'bg-warning-soft hover:bg-surface-muted text-warning-ink border border-warning-line'
 : 'bg-success-soft hover:bg-surface-muted text-success-ink border border-success-line'
 }`}
                          title={isPub ? 'Revert to Draft' : 'Publish to Students'}
                        >
                          {isPub ? <XCircle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                          <span>{isPub ? 'Unpublish' : 'Publish'}</span>
                        </button>

                        {/* Preview Student Syllabus */}
                        <Link
                          href={`/courses/${c.id}`}
                          className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-muted transition"
                          title="Preview student view"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                      </div>

                      {/* Manage Curriculum */}
                      <Link
                        href={`/dashboard/courses/${c.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-semibold shadow-card transition"
                      >
                        <span>Curriculum</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          )}

          {/* Create Course Modal */}
          {showModal && (
            <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
              <div className="max-w-lg w-full rounded-2xl bg-surface border border-line shadow-lift p-6 space-y-5 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div className="flex items-center gap-2 text-brand-ink font-bold text-sm">
                    <BookOpen className="w-5 h-5" />
                    <span>Create New Course Track</span>
                  </div>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-ink-3 hover:text-ink text-xs font-mono"
                  >
                    Cancel
                  </button>
                </div>

                {formError && (
                  <div className="p-3 rounded-lg bg-danger-soft border border-danger-line text-xs text-danger-ink flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <form onSubmit={handleCreateCourse} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      Course Title <span className="text-danger-ink">*</span>
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      placeholder="e.g. Distributed Systems & Cloud Infrastructure"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      URL Slug <span className="text-danger-ink">*</span>
                    </label>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="e.g. distributed-systems-cloud"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      Short Tagline <span className="text-danger-ink">*</span>
                    </label>
                    <input
                      type="text"
                      value={tagline}
                      onChange={(e) => setTagline(e.target.value)}
                      placeholder="e.g. Master resilient microservices and real-time event streaming"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      Detailed Syllabus Overview <span className="text-danger-ink">*</span>
                    </label>
                    <textarea
                      rows={3}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Provide comprehensive pedagogy goals, target competencies, and technical prerequisites..."
                      required
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-ink-2">Difficulty Level</label>
                      <select
                        value={level}
                        onChange={(e) => setLevel(e.target.value as CourseLevel)}
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                      >
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-ink-2">Estimated Duration</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={1}
                          max={52}
                          value={estimatedWeeks}
                          onChange={(e) => setEstimatedWeeks(Number(e.target.value))}
                          required
                          className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand font-mono"
                        />
                        <span className="absolute right-3 top-2 text-xs text-ink-3 pointer-events-none">
                          Weeks
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">Tags (comma-separated)</label>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="typescript, architecture, cloud, databases"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand font-mono text-[11px]"
                    />
                  </div>

                  <div className="pt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink-2 text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold shadow-card"
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

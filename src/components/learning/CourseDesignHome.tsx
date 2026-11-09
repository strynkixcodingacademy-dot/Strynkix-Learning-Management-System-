'use client';

/**
 * Strynkix Live Books — home for Course Design members (Content Leads and
 * Content Designers). They don't run batches, so instead of the staff "today
 * across your batches" roster they see the courses in their scope with each
 * one's review state, and only links to pages they can open.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { getCourseDesignCourses } from '@/lib/courses/service';
import { COURSE_DESIGN_RESPONSIBILITIES } from '@/lib/admin/course-design';
import { ROLE_LABELS } from '@/components/dashboard/AppShell';
import { Course } from '@/types/domain';
import { buttonClasses } from '@/components/ui/Button';
import { CourseIcon } from '@/components/ui/CourseIcon';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { useScopeNames } from '@/components/home/HomeBlocks';
import { ClipboardCheck, PenTool } from 'lucide-react';

const REVIEW_LABEL: Record<string, string> = { in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved' };

export function CourseDesignHome() {
  const { profile, tenant } = useAuth();
  const scopeNames = useScopeNames();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!profile) return;
    getCourseDesignCourses(profile)
      .then((c) => { if (alive) { setCourses(c.sort((a, b) => a.title.localeCompare(b.title))); setError(null); } })
      .catch(() => { if (alive) setError('We couldn’t load the courses in your scope. Check your connection and try again.'); });
    return () => {
      alive = false;
    };
  }, [profile, reloadKey]);

  if (!tenant || !profile) return null;
  const membership = profile.courseDesign;
  const responsibilities = (membership?.responsibilities ?? [])
    .map((r) => COURSE_DESIGN_RESPONSIBILITIES.find((x) => x.id === r)?.label ?? r).join(', ');
  const inReview = (courses ?? []).filter((c) => c.review?.state === 'in_review').length;
  const firstName = (profile.displayName || '').split(' ')[0] || 'there';

  return (
    <div className="space-y-9">
      <header className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h1 className="type-page text-ink">Course design</h1>
          <p className="max-w-[62ch] text-body text-ink-3">
            {firstName}, {ROLE_LABELS[tenant.role].toLowerCase()}{scopeNames.org ? ` at ${scopeNames.org}` : ''}.{' '}
            {responsibilities ? `You look after ${responsibilities.toLowerCase()}.` : 'No responsibilities assigned yet.'}
            {courses !== null && ` ${courses.length} course${courses.length === 1 ? '' : 's'} in your scope, ${inReview} in review.`}
          </p>
        </div>
        <Link href="/dashboard/courses" className={buttonClasses('primary', 'md', 'self-start')}><PenTool className="h-4 w-4" aria-hidden="true" /> Course Authoring</Link>
      </header>

      <section aria-labelledby="your-courses" className="space-y-4">
        <h2 id="your-courses" className="type-section text-ink">Your courses</h2>
        {error ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)}>{error}</ErrorState>
        ) : courses === null ? (
          <div className="space-y-3" role="status"><span className="sr-only">Loading courses…</span><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        ) : !membership ? (
          <EmptyState compact illustration="lock" title="No Course Design access yet">Ask the Super Admin to assign you responsibilities and courses.</EmptyState>
        ) : courses.length === 0 ? (
          <EmptyState compact illustration="inbox" title="No courses in your scope">The Super Admin chooses which courses you work on.</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {courses.map((c) => (
              <li key={c.id}>
                <Link href={`/dashboard/courses/${c.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-muted/50">
                  <CourseIcon course={c} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink group-hover:text-brand-ink">{c.title}</span>
                    {c.tagline && <span className="block truncate text-xs text-ink-3">{c.tagline}</span>}
                  </span>
                  {c.review && c.review.state !== 'none' ? (
                    <StatusPill tone={c.review.state === 'approved' ? 'success' : c.review.state === 'in_review' ? 'teal' : 'warning'} icon={ClipboardCheck} size="sm">{REVIEW_LABEL[c.review.state]}</StatusPill>
                  ) : (
                    <StatusPill tone={c.status === 'published' ? 'success' : 'neutral'} size="sm">{c.status === 'published' ? 'Published' : c.status === 'archived' ? 'Archived' : 'Draft'}</StatusPill>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

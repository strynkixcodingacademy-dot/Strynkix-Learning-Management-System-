'use client';

/**
 * Strynkix Live Books — Course Catalog Page
 * Displays published courses available within the authenticated user's organization.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/context/AuthContext';
import { getStudentEnrollments } from '@/lib/batches/service';
import { grantsContentAccess } from '@/lib/batches/scope';
import { Course } from '@/types/domain';
import { AppShell } from '@/components/dashboard/AppShell';
import { Card } from '@/components/ui/Page';
import { CourseIcon, courseIdentity, SPINE } from '@/components/ui/CourseIcon';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { ArrowRight, Clock, Tag, RefreshCw } from 'lucide-react';

function CatalogSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Loading courses…</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}

export default function CoursesPage() {
  const { user, tenant } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [unpublishedEnrollments, setUnpublishedEnrollments] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const isStudent = tenant?.role === 'student';

  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let isMounted = true;
    async function loadCourses() {
      if (!tenant?.orgId || !user?.uid) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        if (tenant.role === 'student') {
          // Students see only courses they hold an active or completed enrollment for.
          const enrollments = [
            ...new Map(
              (await getStudentEnrollments(tenant.orgId, user.uid))
                .filter((e) => grantsContentAccess(e.status))
                .map((e) => [e.courseId, e])
            ).values(),
          ];
          const results = await Promise.all(
            enrollments.map(async (e) => {
              try {
                const snap = await getDoc(doc(db, 'courses', e.courseId));
                return snap.exists() ? ({ id: snap.id, ...snap.data() } as Course) : null;
              } catch {
                return null;
              }
            })
          );
          if (!isMounted) return;
          const published = results.filter((c): c is Course => c !== null && c.status === 'published');
          setCourses(published.sort((a, b) => a.title.localeCompare(b.title)));
          setUnpublishedEnrollments(enrollments.length - published.length);
        } else {
          const q = query(
            collection(db, 'courses'),
            where('orgId', '==', tenant.orgId),
            where('status', '==', 'published')
          );
          const snap = await getDocs(q);
          if (!isMounted) return;
          setCourses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Course)).sort((a, b) => a.title.localeCompare(b.title)));
          setUnpublishedEnrollments(0);
        }
      } catch (err) {
        console.error('Failed to load courses', err);
        if (isMounted) setError('Unable to load courses. Please check your network connection.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadCourses();
    return () => {
      isMounted = false;
    };
  }, [tenant?.orgId, tenant?.role, user?.uid, reloadKey]);

  return (
    <AppShell pageTitle="Course Curriculum">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-line">
          <p className="text-sm text-ink-3 max-w-xl">
            {isStudent
              ? 'Your enrolled Live Books for interactive software engineering mastery.'
              : 'All published Live Books in your academy, structured for digital textbook learning.'}
          </p>
          <button
            type="button"
            onClick={reload}
            className={buttonClasses('ghost', 'sm', 'self-start sm:self-center')}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {unpublishedEnrollments > 0 && (
          <Notice kind="warning">
            You are enrolled in {unpublishedEnrollments} course{unpublishedEnrollments === 1 ? '' : 's'} that{' '}
            {unpublishedEnrollments === 1 ? 'is' : 'are'} currently in preparation and will be published soon.
          </Notice>
        )}

        {isLoading && <CatalogSkeleton />}

        {error && !isLoading && (
          <ErrorState title="Curriculum didn’t load" onRetry={reload}>
            {error}
          </ErrorState>
        )}

        {!isLoading && !error && courses.length === 0 && (
          <EmptyState
            illustration="book"
            title={isStudent ? 'No courses enrolled yet' : 'No published courses found'}
            action={
              isStudent ? (
                <Link href="/dashboard" className={buttonClasses('primary')}>
                  Go to Home
                </Link>
              ) : (
                <Link href="/dashboard/courses" className={buttonClasses('primary')}>
                  Open Course Authoring
                </Link>
              )
            }
          >
            {isStudent
              ? 'You are not enrolled in any published courses yet. Once your academy manager assigns you to a batch, your courses will appear here.'
              : 'There are no published courses in this organization yet. Create and publish courses from the authoring studio.'}
          </EmptyState>
        )}

        {!isLoading && !error && courses.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {courses.map((course) => {
              const { tone } = courseIdentity(course);
              return (
                <Card
                  key={course.id}
                  as="article"
                  interactive
                  className="group relative flex overflow-hidden"
                >
                  <span aria-hidden="true" className={cx('w-2 shrink-0', SPINE[tone])} />
                  <div className="flex flex-1 flex-col justify-between gap-5 p-6">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <CourseIcon course={course} size="md" />
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-surface-muted text-ink-2">
                            {course.level || 'Intermediate'}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-ink-3">
                            <Clock className="w-3.5 h-3.5" />
                            {course.estimatedWeeks || 12}w
                          </span>
                        </div>
                      </div>

                      <h2 className="text-xl font-bold leading-snug text-ink group-hover:text-brand-ink transition">
                        <Link href={`/courses/${course.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                          {course.title}
                        </Link>
                      </h2>

                      <p className="text-xs sm:text-sm text-ink-3 leading-relaxed line-clamp-2">
                        {course.tagline || course.description}
                      </p>

                      {course.tags && course.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {course.tags.slice(0, 4).map((t, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-canvas border border-line text-ink-2"
                            >
                              <Tag className="w-3 h-3 text-ink-3" />
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="pt-4 border-t border-line flex items-center justify-between relative z-10">
                      <span className="text-xs font-semibold text-ink-3">Interactive Live Book</span>
                      <Link
                        href={`/courses/${course.id}`}
                        className={buttonClasses('secondary', 'sm', 'group-hover:border-brand-line group-hover:text-brand-ink')}
                      >
                        <span>View Curriculum</span>
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

'use client';

/**
 * Strynkix Live Books — catalogue: the academy's shelves. Courses stand as bound
 * volumes, grouped by track, each with its modules, lessons and the learner's
 * progress. Students see the courses they are enrolled in; staff see every
 * published course.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/context/AuthContext';
import { getStudentEnrollments } from '@/lib/batches/service';
import { grantsContentAccess } from '@/lib/batches/scope';
import { getCourseWithCurriculum, getStudentCourseProgress } from '@/lib/livebook/service';
import { getCourseDesignCourses } from '@/lib/courses/service';
import { Course, CourseLevel } from '@/types/domain';
import { AppShell } from '@/components/dashboard/AppShell';
import { CourseCover } from '@/components/ui/CourseIcon';
import { PageHeader, SearchInput } from '@/components/ui/Page';
import { ProgressBar } from '@/components/ui/Progress';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Check } from 'lucide-react';

interface CourseStats {
  modules: number;
  lessons: number;
  completed: number;
}

const TRACKS: Array<{ level: CourseLevel; label: string; hint: string }> = [
  { level: 'beginner', label: 'Foundation', hint: 'Start here' },
  { level: 'intermediate', label: 'Intermediate', hint: 'Build real projects' },
  { level: 'advanced', label: 'Advanced', hint: 'Go deeper' },
];

const pctOf = (s?: CourseStats) => (s && s.lessons ? Math.round((s.completed / s.lessons) * 100) : 0);

function Book({ course, stats }: { course: Course; stats?: CourseStats }) {
  const pct = pctOf(stats);
  const started = pct > 0;
  return (
    <li className="min-w-0">
      <Link href={`/courses/${course.id}`} className="group flex h-full flex-col rounded-md">
        <CourseCover course={course} level={course.level} className="shadow-[0_14px_24px_-16px_rgb(10_14_40/0.5)] transition-transform duration-200 ease-out group-hover:-translate-y-0.5" />
        <span className="mt-3 text-body font-medium leading-snug text-ink group-hover:text-brand-ink">{course.title}</span>
        {(course.tagline || course.description) && (
          <span className="mt-1 line-clamp-2 text-sm text-ink-3">{course.tagline || course.description}</span>
        )}
        <span className="mt-auto pt-2.5 text-xs text-ink-3">
          {stats ? `${stats.modules} module${stats.modules === 1 ? '' : 's'}, ${stats.lessons} lesson${stats.lessons === 1 ? '' : 's'}` : ' '}
          {course.estimatedWeeks ? `, ${course.estimatedWeeks} weeks` : ''}
        </span>
      </Link>
      {started && (
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={pct} tone={pct === 100 ? 'success' : 'brand'} size="sm" label={`${course.title} progress`} />
          <span className="text-xs tabular-nums text-ink-3">{pct}%</span>
        </div>
      )}
    </li>
  );
}

function ShelfGrid({ children }: { children: React.ReactNode }) {
  return <ul className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">{children}</ul>;
}

export default function CoursesPage() {
  const { user, profile, tenant } = useAuth();
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
        } else if (tenant.role === 'content_lead' || tenant.role === 'content_designer') {
          // Course Design members see only the published courses in their scope.
          const scoped = await getCourseDesignCourses(profile ?? { orgId: tenant.orgId });
          if (!isMounted) return;
          setCourses(scoped.filter((c) => c.status === 'published').sort((a, b) => a.title.localeCompare(b.title)));
          setUnpublishedEnrollments(0);
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
  }, [tenant?.orgId, tenant?.role, user?.uid, reloadKey, profile]);

  // Per-course modules, lessons and the learner's completed lessons.
  const [stats, setStats] = useState<Record<string, CourseStats>>({});
  const courseIds = courses.map((c) => c.id).join(',');
  useEffect(() => {
    let alive = true;
    if (!tenant?.orgId || !user?.uid || !courseIds) return;
    const orgId = tenant.orgId;
    const uid = user.uid;
    Promise.all(courseIds.split(',').map(async (id) => {
      try {
        const [curriculum, progress] = await Promise.all([
          getCourseWithCurriculum(id, orgId, false),
          getStudentCourseProgress(id, uid, orgId).catch(() => []),
        ]);
        if (!curriculum) return null;
        const ids = new Set(curriculum.lessons.map((l) => l.id));
        return [id, {
          modules: curriculum.modules.length,
          lessons: curriculum.lessons.length,
          completed: new Set(progress.filter((p) => p.status === 'completed' && ids.has(p.lessonId)).map((p) => p.lessonId)).size,
        }] as const;
      } catch {
        return null;
      }
    })).then((rows) => {
      if (alive) setStats(Object.fromEntries(rows.filter((r): r is NonNullable<typeof r> => r !== null)));
    });
    return () => {
      alive = false;
    };
  }, [courseIds, tenant?.orgId, user?.uid]);

  const [q, setQ] = useState('');
  const groups = useMemo(() => TRACKS.map((t) => ({ ...t, courses: courses.filter((c) => c.level === t.level) })).filter((g) => g.courses.length), [courses]);
  const isCurrent = (cs: Course[]) => cs.some((c) => { const p = pctOf(stats[c.id]); return p > 0 && p < 100; });
  const needle = q.trim().toLowerCase();
  const matches = needle ? courses.filter((c) => `${c.title} ${c.tagline} ${(c.tags ?? []).join(' ')}`.toLowerCase().includes(needle)) : [];
  const ungrouped = courses.filter((c) => !TRACKS.some((t) => t.level === c.level));

  return (
    <AppShell>
      <div className="space-y-10">
        <PageHeader
          title="Live Books"
          description={isStudent ? 'Your interactive textbooks: read, try the code and check your understanding as you go.' : 'Every published Live Book. Open one to read it as a student would.'}
          actions={<SearchInput id="lb-search" label="Search Live Books" value={q} onChange={setQ} placeholder="Search subjects" className="w-full sm:w-64" />}
        />

        {unpublishedEnrollments > 0 && (
          <Notice kind="warning">
            You are enrolled in {unpublishedEnrollments} course{unpublishedEnrollments === 1 ? '' : 's'} that {unpublishedEnrollments === 1 ? 'is' : 'are'} still being prepared.
          </Notice>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[3/4]" />)}</div>
        ) : error ? (
          <ErrorState title="Live Books didn’t load" onRetry={reload}>{error}</ErrorState>
        ) : courses.length === 0 ? (
          <EmptyState illustration="book" title={isStudent ? 'No courses enrolled yet' : 'No published courses yet'}
            action={isStudent ? <Link href="/dashboard" className={buttonClasses('primary')}>Back to Home</Link> : <Link href="/dashboard/courses" className={buttonClasses('primary')}>Open Course Authoring</Link>}>
            {isStudent ? 'Your academy adds you to courses through batches. Once you’re enrolled, your Live Books appear here.' : 'Publish a course in Course Authoring to see it here.'}
          </EmptyState>
        ) : needle ? (
          <section className="space-y-5">
            <h2 className="type-section text-ink">Results for “{q.trim()}”</h2>
            {matches.length === 0 ? <p className="text-sm text-ink-3">No subjects match that search.</p> : (
              <ShelfGrid>{matches.map((c) => <Book key={c.id} course={c} stats={stats[c.id]} />)}</ShelfGrid>
            )}
          </section>
        ) : (
          <div className="space-y-12">
            {groups.map((g) => (
              <section key={g.level} aria-labelledby={`track-${g.level}`} className="space-y-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2.5">
                  <h2 id={`track-${g.level}`} className="type-section text-ink">{g.label}</h2>
                  <span className="text-sm text-ink-3">{g.hint}</span>
                  {isCurrent(g.courses) ? <StatusPill tone="warning" size="sm">Current</StatusPill>
                    : Object.keys(stats).length > 0 && g.courses.every((c) => pctOf(stats[c.id]) === 100) ? <StatusPill tone="success" icon={Check} size="sm">All complete</StatusPill> : null}
                </div>
                <ShelfGrid>{g.courses.map((c) => <Book key={c.id} course={c} stats={stats[c.id]} />)}</ShelfGrid>
              </section>
            ))}
            {ungrouped.length > 0 && <ShelfGrid>{ungrouped.map((c) => <Book key={c.id} course={c} stats={stats[c.id]} />)}</ShelfGrid>}
          </div>
        )}
      </div>
    </AppShell>
  );
}

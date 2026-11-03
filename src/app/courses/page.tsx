'use client';

/**
 * Strynkix Live Books — catalog. Tracks (by level) on the left; the selected
 * track's subjects as cards on the right, each with modules, lessons and the
 * learner's progress. Students see the courses they are enrolled in; staff see
 * every published course.
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
import { LiveBooksFrame } from '@/components/livebook/LiveBooksFrame';
import { CourseIcon } from '@/components/ui/CourseIcon';
import { ProgressRing } from '@/components/ui/Progress';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { Check, Folder, Layers, Search } from 'lucide-react';

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

function CourseCard({ course, stats }: { course: Course; stats?: CourseStats }) {
  const pct = pctOf(stats);
  return (
    <Link href={`/courses/${course.id}`} className="group flex h-full flex-col rounded-xl border border-line bg-surface p-6 shadow-card transition-[box-shadow,border-color] hover:border-silver hover:shadow-lift">
      <CourseIcon course={course} size="md" />
      <h3 className="mt-5 text-[17px] font-extrabold leading-snug text-ink group-hover:text-brand-ink">{course.title}</h3>
      {(course.tagline || course.description) && (
        <p className="mt-1.5 line-clamp-3 text-[14px] leading-relaxed text-ink-3">{course.tagline || course.description}</p>
      )}
      <span aria-hidden="true" className="min-h-6 flex-1" />
      <div className="flex items-center gap-5 border-t border-line pt-4 text-[14px] text-ink-2">
        <span className="inline-flex items-center gap-1.5" title="Modules"><Folder className="h-4 w-4 text-ink-3" aria-hidden="true" />{stats ? stats.modules : '–'}<span className="sr-only"> modules</span></span>
        <span className="inline-flex items-center gap-1.5" title="Lessons"><Layers className="h-4 w-4 text-ink-3" aria-hidden="true" />{stats ? stats.lessons : '–'}<span className="sr-only"> lessons</span></span>
        <span className="ml-auto inline-flex items-center gap-2" title="Completed">
          <ProgressRing value={stats ? pct : null} tone="success" size={20} label={`${course.title} progress`}>{''}</ProgressRing>
          {stats ? `${pct}%` : '–'}
        </span>
      </div>
    </Link>
  );
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
  const [picked, setPicked] = useState<CourseLevel | null>(null);
  const groups = useMemo(() => TRACKS.map((t) => ({ ...t, courses: courses.filter((c) => c.level === t.level) })).filter((g) => g.courses.length), [courses]);
  const isCurrent = (cs: Course[]) => cs.some((c) => { const p = pctOf(stats[c.id]); return p > 0 && p < 100; });
  const current = groups.find((g) => isCurrent(g.courses))?.level ?? groups[0]?.level ?? null;
  const active = groups.find((g) => g.level === (picked ?? current)) ?? groups[0];
  const needle = q.trim().toLowerCase();
  const shown = needle ? courses.filter((c) => `${c.title} ${c.tagline} ${(c.tags ?? []).join(' ')}`.toLowerCase().includes(needle)) : active?.courses ?? [];

  const search = (
    <div className="relative w-full max-w-[260px]">
      <label htmlFor="lb-search" className="sr-only">Search Live Books</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden="true" />
      <input id="lb-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subjects"
        className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder-ink-4 shadow-card focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15" />
    </div>
  );

  return (
    <AppShell fit>
      <LiveBooksFrame actions={search} className="grid grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
        {/* Tracks */}
        <nav aria-label="Tracks" className="border-b border-line bg-surface md:border-b-0 md:border-r md:overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          ) : groups.map((g) => {
            const selected = !needle && g.level === active?.level;
            const cur = g.level === current && isCurrent(g.courses);
            return (
              <button key={g.level} type="button" onClick={() => { setPicked(g.level); setQ(''); }} aria-pressed={selected}
                className={cx('block w-full border-b border-dashed border-line px-6 py-5 text-left transition-colors', selected ? 'bg-highlight-soft' : 'hover:bg-canvas')}>
                <span className="flex items-center justify-between gap-2">
                  <span className={cx('text-[13.5px]', selected ? 'font-semibold text-warning-ink' : 'text-ink-3')}>{g.label} · {g.courses.length} subject{g.courses.length === 1 ? '' : 's'}</span>
                  {cur ? <span className="rounded-full bg-highlight px-2.5 py-0.5 text-[12px] font-bold text-warning-ink">Current</span>
                    : g.courses.every((c) => pctOf(stats[c.id]) === 100) ? <Check className="h-4 w-4 text-ink-3" aria-label="All complete" /> : null}
                </span>
                <span className="mt-3 flex -space-x-2">
                  {g.courses.slice(0, 4).map((c) => (
                    <span key={c.id} className="rounded-full ring-[3px] ring-surface [&>*]:rounded-full"><CourseIcon course={c} size="sm" /></span>
                  ))}
                  {g.courses.length > 4 && <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-muted text-[12px] font-bold text-ink-3 ring-[3px] ring-surface">+{g.courses.length - 4}</span>}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Subjects */}
        <section className="min-w-0 overflow-y-auto px-5 py-8 sm:px-9">
          {unpublishedEnrollments > 0 && (
            <Notice kind="warning" className="mb-6">
              You are enrolled in {unpublishedEnrollments} course{unpublishedEnrollments === 1 ? '' : 's'} that {unpublishedEnrollments === 1 ? 'is' : 'are'} still being prepared.
            </Notice>
          )}
          {isLoading ? (
            <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-60" />)}</div>
          ) : error ? (
            <ErrorState title="Live Books didn’t load" onRetry={reload}>{error}</ErrorState>
          ) : courses.length === 0 ? (
            <EmptyState illustration="book" title={isStudent ? 'No courses enrolled yet' : 'No published courses yet'}
              action={isStudent ? <Link href="/dashboard" className={buttonClasses('primary')}>Back to Home</Link> : <Link href="/dashboard/courses" className={buttonClasses('primary')}>Open Course Authoring</Link>}>
              {isStudent ? 'Your academy adds you to courses through batches. Once you’re enrolled, your Live Books appear here.' : 'Publish a course in Course Authoring to see it here.'}
            </EmptyState>
          ) : (
            <>
              <h2 className="mb-6 text-[22px] font-extrabold tracking-tight text-ink">{needle ? `Results for “${q.trim()}”` : active?.label}</h2>
              {shown.length === 0 ? (
                <p className="text-sm text-ink-3">No subjects match that search.</p>
              ) : (
                <ul className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
                  {shown.map((c) => <li key={c.id}><CourseCard course={c} stats={stats[c.id]} /></li>)}
                </ul>
              )}
            </>
          )}
        </section>
      </LiveBooksFrame>
    </AppShell>
  );
}

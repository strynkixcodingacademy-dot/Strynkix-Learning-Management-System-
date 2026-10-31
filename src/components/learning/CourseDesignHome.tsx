'use client';

/**
 * Strynkix Live Books — home for Course Design members (Content Leads and
 * Content Designers; milestone G10). They don't run batches, so instead of the
 * staff "today across your batches" board they see the courses in their scope
 * with each one's review state, and only tiles for pages they can open.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { getCourseDesignCourses } from '@/lib/courses/service';
import { COURSE_DESIGN_RESPONSIBILITIES } from '@/lib/admin/course-design';
import { ROLE_LABELS } from '@/components/dashboard/AppShell';
import { Course } from '@/types/domain';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Page';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { helpTile, HomeHero, useScopeNames } from '@/components/home/HomeBlocks';
import { HomeApp, HomeBoard } from '@/components/home/HomeBoard';
import { BookOpen, ClipboardCheck, Layers, PenTool, ShieldCheck } from 'lucide-react';

const REVIEW_LABEL: Record<string, string> = { in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved' };

export function CourseDesignHome() {
  const { profile, tenant } = useAuth();
  const scopeNames = useScopeNames();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [openSection, setOpenSection] = useState<string | null>(null);

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

  const day = (
    <Card className="flex h-full min-h-0 flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[17px] font-extrabold text-ink">Your courses</h2>
        <Link href="/dashboard/courses" className={buttonClasses('secondary', 'sm')}><PenTool className="h-3.5 w-3.5" /> Course Authoring</Link>
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)}>{error}</ErrorState>
        ) : courses === null ? (
          <div className="space-y-3" role="status"><span className="sr-only">Loading courses…</span><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        ) : !membership ? (
          <EmptyState compact illustration="lock" title="No Course Design access yet">Ask the Super Admin to assign you responsibilities and courses.</EmptyState>
        ) : courses.length === 0 ? (
          <EmptyState compact illustration="inbox" title="No courses in your scope">The Super Admin chooses which courses you work on.</EmptyState>
        ) : (
          <ul className="space-y-2.5">
            {courses.map((c) => (
              <li key={c.id}>
                <Link href={`/dashboard/courses/${c.id}`} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 hover:border-line-strong hover:bg-surface-muted">
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{c.title}</span>
                  {c.review && c.review.state !== 'none' ? (
                    <StatusPill tone={c.review.state === 'approved' ? 'success' : c.review.state === 'in_review' ? 'brand' : 'warning'} icon={ClipboardCheck} size="sm">{REVIEW_LABEL[c.review.state]}</StatusPill>
                  ) : (
                    <StatusPill tone={c.status === 'published' ? 'success' : 'neutral'} size="sm">{c.status === 'published' ? 'Published' : c.status === 'archived' ? 'Archived' : 'Draft'}</StatusPill>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );

  // Only pages Course Design members can open (see AppShell NAV_ITEMS).
  const apps: HomeApp[] = [
    { label: 'Course Authoring', art: 'pen', href: '/dashboard/courses' },
    { label: 'Live Books', art: 'preview', href: '/courses' },
    { label: 'User Guide', art: 'guide', href: '/dashboard/guide' },
    { label: 'My Profile', art: 'profile', href: '/dashboard/profile' },
    helpTile,
  ];

  return (
    <HomeBoard
      hero={
        <HomeHero
          name={profile.displayName || 'there'}
          academy={scopeNames.org}
          facts={[
            { icon: ShieldCheck, text: `${ROLE_LABELS[tenant.role]} · Course Design` },
            { icon: Layers, text: responsibilities ? `Responsibilities: ${responsibilities}` : 'No responsibilities assigned' },
            { icon: BookOpen, text: courses === null ? 'Loading your courses…' : `${courses.length} course${courses.length === 1 ? '' : 's'} in your scope · ${inReview} in review` },
          ]}
        />
      }
      day={day}
      apps={apps}
      openKey={openSection}
      onOpenChange={setOpenSection}
    />
  );
}

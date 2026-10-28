'use client';

/**
 * Strynkix Live Books — staff home: "Today across your batches".
 * For each in-scope batch: is today planned and published, who has finished the
 * lessons, who submitted, and what needs review. Uses the same scoped services
 * as the batch pages; Firestore rules decide what each role can read.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { getBatchEnrollments, getBatchesForTenant, getBatchProgress } from '@/lib/batches/service';
import { grantsContentAccess, isBatchManagerRole } from '@/lib/batches/scope';
import { getAssignmentSubmissions, getBatchPlans, getAssignment } from '@/lib/learning/service';
import { toLocalDateKey } from '@/lib/learning/metrics';
import { getBranches, getOrganizations } from '@/lib/admin/service';
import { ROLE_LABELS } from '@/components/dashboard/AppShell';
import { Batch, DailyPlan } from '@/types/domain';
import { buttonClasses } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Page';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatPlanDate } from './LearningBits';
import { KpiTile } from '@/components/ui/DataViz';
import { AppGrid, AppTile, helpTile, HomeHero, useScopeNames } from '@/components/home/HomeBlocks';
import { getPeople } from '@/lib/account/service';
import {
  CalendarCheck,
  CalendarPlus,
  ClipboardCheck,
  FileEdit,
  GitBranch,
  GraduationCap,
  Layers,
  ShieldCheck,
} from 'lucide-react';

interface BatchToday {
  batch: Batch;
  plan: DailyPlan | null;
  activeStudents: number;
  finishedLessons: number | null;
  submitted: number | null;
  needsReview: number | null;
  corrections: number | null;
}

const MAX_BATCHES = 12;

async function loadBatchToday(batch: Batch, today: string): Promise<BatchToday> {
  const [plans, enrollments] = await Promise.all([getBatchPlans(batch), getBatchEnrollments(batch)]);
  const active = enrollments.filter((e) => grantsContentAccess(e.status));
  const plan = plans.find((p) => p.date === today && p.status !== 'archived') ?? null;
  const result: BatchToday = { batch, plan, activeStudents: active.length, finishedLessons: null, submitted: null, needsReview: null, corrections: null };
  if (!plan) return result;

  if (plan.lessonIds.length) {
    try {
      const progress = await getBatchProgress(batch);
      result.finishedLessons = active.filter((e) =>
        plan.lessonIds.every((id) => progress.some((p) => p.studentId === e.studentId && p.lessonId === id && p.status === 'completed'))
      ).length;
    } catch {
      result.finishedLessons = null;
    }
  }
  if (plan.assignmentId) {
    const assignment = await getAssignment(plan.assignmentId);
    if (assignment) {
      const subs = await getAssignmentSubmissions(assignment);
      result.submitted = subs.length;
      result.needsReview = subs.filter((s) => s.status === 'submitted').length;
      result.corrections = subs.filter((s) => s.status === 'resubmit_requested').length;
    }
  }
  return result;
}

function Stat({ value, total, label, tone }: { value: number | null; total?: number; label: string; tone?: 'attention' }) {
  return (
    <div className="min-w-0">
      <div className={tone === 'attention' && value ? 'text-lg font-extrabold text-coral-ink' : 'text-lg font-extrabold text-ink'}>
        {value === null ? '—' : value}
        {total !== undefined && value !== null && <span className="text-sm font-semibold text-ink-3">/{total}</span>}
      </div>
      <div className="text-xs text-ink-3">{label}</div>
    </div>
  );
}

export function StaffHome() {
  const { user, profile, tenant } = useAuth();
  const [rows, setRows] = useState<BatchToday[]>([]);
  const [counts, setCounts] = useState<{ orgs?: number; branches?: number }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingPeople, setPendingPeople] = useState(0);
  const scopeNames = useScopeNames();
  const today = toLocalDateKey(new Date());

  // Accounts awaiting approval, for the People tile badge (managers and Super Admin).
  useEffect(() => {
    let alive = true;
    if (!tenant || (tenant.role !== 'super_admin' && tenant.role !== 'branch_admin')) return;
    getPeople(tenant)
      .then((people) => { if (alive) setPendingPeople(people.filter((p) => p.status === 'pending_verification' || p.status === 'invited').length); })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tenant]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!tenant || !user) return;
      setError(null);
      try {
        const batches = (await getBatchesForTenant(tenant, user.uid))
          .filter((b) => b.status === 'in_progress' || b.status === 'upcoming')
          .slice(0, MAX_BATCHES);
        const settled = await Promise.allSettled(batches.map((b) => loadBatchToday(b, today)));
        const extra: { orgs?: number; branches?: number } = {};
        if (tenant.role === 'super_admin') {
          const [orgs, branches] = await Promise.all([getOrganizations(), getBranches()]);
          extra.orgs = orgs.length;
          extra.branches = branches.length;
        } else if (tenant.role === 'university_admin') {
          extra.branches = (await getBranches(tenant.orgId)).length;
        }
        if (!isMounted) return;
        setRows(settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])));
        setCounts(extra);
      } catch (err) {
        console.error('Failed to load staff home', err);
        if (isMounted) setError('We couldn’t load today’s overview. Check your connection and try again.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [tenant, user, today, reloadKey]);

  if (!tenant) return null;
  const isManager = isBatchManagerRole(tenant.role);
  const needsReview = rows.reduce((n, r) => n + (r.needsReview ?? 0), 0);
  const unplanned = rows.filter((r) => !r.plan).length;
  const activeStudents = rows.reduce((n, r) => n + r.activeStudents, 0);
  const firstReview = rows.find((r) => r.plan && (r.needsReview ?? 0) > 0);
  const firstUnplanned = rows.find((r) => !r.plan);
  const role = tenant.role;
  const isAcademyAdmin = role === 'super_admin' || role === 'university_admin';
  const tiles: AppTile[] = [
    ...(isAcademyAdmin ? [{ label: 'Branches', art: 'branch' as const, href: '/dashboard/branches' }] : []),
    { label: isManager ? 'Batches' : 'My Batches', art: 'clipboard', href: '/dashboard/batches' },
    { label: 'Review Work', art: 'review', href: firstReview ? `/dashboard/batches/${firstReview.batch.id}/plans/${firstReview.plan!.id}` : '/dashboard#today', badge: needsReview, badgeLabel: 'submissions to review' },
    { label: 'Daily Plans', art: 'calendar', href: firstUnplanned ? `/dashboard/batches/${firstUnplanned.batch.id}/plans` : rows[0] ? `/dashboard/batches/${rows[0].batch.id}/plans` : '/dashboard/batches', badge: unplanned, badgeLabel: 'batches without a plan today' },
    ...(role === 'super_admin' || role === 'branch_admin' ? [{ label: 'People', art: 'people' as const, href: '/dashboard/people', badge: pendingPeople, badgeLabel: 'accounts waiting for approval' }] : []),
    { label: 'Analytics', art: 'chart', href: '/dashboard/analytics' },
    { label: 'Course Authoring', art: 'pen', href: '/dashboard/courses' },
    { label: 'Live Books', art: 'preview', href: '/courses' },
    ...(role === 'super_admin' ? [{ label: 'Organizations', art: 'building' as const, href: '/dashboard/organizations' }] : []),
    { label: 'User Guide', art: 'guide', href: '/dashboard/guide' },
    { label: 'My Profile', art: 'profile', href: '/dashboard/profile' },
    helpTile,
  ];

  return (
    <div className="space-y-10">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-8">
      <HomeHero
        name={profile?.displayName || 'there'}
        academy={scopeNames.org}
        facts={[
          { icon: ShieldCheck, text: <>{ROLE_LABELS[tenant.role]}{scopeNames.branch ? <> · {scopeNames.branch}</> : tenant.role === 'super_admin' ? ' · every branch' : null}</> },
          ...(counts.branches !== undefined ? [{ icon: GitBranch, text: `${counts.branches} branch${counts.branches === 1 ? '' : 'es'} in the academy` }] : []),
          { icon: Layers, text: isLoading ? 'Loading your batches…' : rows.length ? `${rows.length} running batch${rows.length === 1 ? '' : 'es'} · ${activeStudents} active student${activeStudents === 1 ? '' : 's'}` : 'No running batches yet' },
          { icon: CalendarCheck, text: isLoading ? formatPlanDate(today, 'long') : `${formatPlanDate(today, 'long')} · ${needsReview} to review · ${unplanned} without a plan today` },
        ]}
      />

      {!isLoading && !error && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTile label="Running batches" value={rows.length} icon={Layers} hint="Upcoming or in progress." />
          <KpiTile label="Active students" value={activeStudents} icon={GraduationCap} tone="teal" hint="Enrolled and active in those batches." />
          <KpiTile label="To review" value={needsReview} icon={ClipboardCheck} tone="coral" hint="Today’s submissions waiting for marks or feedback." />
          <KpiTile label="Unplanned today" value={unplanned} icon={CalendarPlus} tone="warning" hint={unplanned ? 'Batches with no plan for today.' : 'Every batch has today planned.'} />
        </div>
      )}

      <Section id="today" title="Today across your batches" icon={CalendarCheck}
        action={<Link href="/dashboard/batches" className="text-sm font-semibold text-brand-ink hover:underline">All batches</Link>}>
        {isLoading ? (
          <div className="space-y-3" role="status"><span className="sr-only">Loading batches…</span><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        ) : error ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState compact illustration="calendar" title="No running batches"
            action={isManager ? <Link href="/dashboard/batches" className={buttonClasses('primary', 'sm')}>Create a batch</Link> : undefined}>
            {isManager ? 'Create a batch to start planning daily learning.' : 'When you’re assigned to a batch, today’s plan and submissions appear here.'}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const planHref = r.plan ? `/dashboard/batches/${r.batch.id}/plans/${r.plan.id}` : `/dashboard/batches/${r.batch.id}/plans`;
              return (
                <Card as="li" key={r.batch.id} className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center">
                    <div className="min-w-0 2xl:w-72">
                      <Link href={`/dashboard/batches/${r.batch.id}`} className="text-base font-bold text-ink hover:text-brand-ink">{r.batch.name}</Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                        <span>{r.activeStudents} student{r.activeStudents === 1 ? '' : 's'}</span>
                        {r.plan ? (
                          r.plan.status === 'published'
                            ? <StatusPill tone="success" icon={CalendarCheck} size="sm">Published</StatusPill>
                            : <StatusPill tone="warning" icon={FileEdit} size="sm">Draft — not visible</StatusPill>
                        ) : (
                          <StatusPill tone="neutral" icon={CalendarPlus} size="sm">No plan today</StatusPill>
                        )}
                      </div>
                      {r.plan && <div className="mt-1 truncate text-sm text-ink-2">{r.plan.title}</div>}
                    </div>
                    <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
                      <Stat value={r.plan?.lessonIds.length ? r.finishedLessons : null} total={r.activeStudents} label="finished lessons" />
                      <Stat value={r.plan?.assignmentId ? r.submitted : null} total={r.activeStudents} label="submitted" />
                      <Stat value={r.needsReview} label="need review" tone="attention" />
                      <Stat value={r.corrections} label="awaiting fixes" />
                    </div>
                    <Link href={planHref} className={buttonClasses(r.plan ? (r.needsReview ? 'primary' : 'secondary') : 'primary', 'sm', 'self-start 2xl:self-center')}>
                      {r.plan ? (r.needsReview ? <><ClipboardCheck className="w-3.5 h-3.5" /> Review</> : 'Open plan') : <><CalendarPlus className="w-3.5 h-3.5" /> Plan today</>}
                    </Link>
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </Section>

        </div>

        <aside className="space-y-8">
          <AppGrid tiles={tiles} />
        </aside>
      </div>
    </div>
  );
}

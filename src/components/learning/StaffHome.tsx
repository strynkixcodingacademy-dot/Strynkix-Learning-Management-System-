'use client';

/**
 * Strynkix Live Books — staff home: "Today across your batches".
 * A roster of the day: for each in-scope batch, is today planned and published,
 * who has finished the lessons, who submitted, and what needs review. Uses the
 * same scoped services as the batch pages; Firestore rules decide what each role
 * can read.
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
import { KpiTile } from '@/components/ui/DataViz';
import { SectionLink, TableFrame } from '@/components/ui/Page';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatPlanDate } from './LearningBits';
import { HomeIndex, HomeLink, useScopeNames } from '@/components/home/HomeBlocks';
import { getPeople } from '@/lib/account/service';
import {
  BarChart3,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  FileEdit,
  GitBranch,
  Library,
  PenTool,
  ScrollText,
  Users,
  UsersRound,
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

function Count({ value, total, attention }: { value: number | null; total?: number; attention?: boolean }) {
  if (value === null) return <span className="text-ink-4">—</span>;
  return (
    <span className={attention && value ? 'font-semibold text-coral-ink' : 'text-ink'}>
      {value}{total !== undefined && <span className="text-ink-3">/{total}</span>}
    </span>
  );
}

function PlanStatus({ plan }: { plan: DailyPlan | null }) {
  if (!plan) return <StatusPill tone="neutral" icon={CalendarPlus} size="sm">No plan today</StatusPill>;
  return plan.status === 'published'
    ? <StatusPill tone="success" icon={CalendarCheck} size="sm">Published</StatusPill>
    : <StatusPill tone="warning" icon={FileEdit} size="sm">Draft, not visible</StatusPill>;
}

function BatchAction({ row }: { row: BatchToday }) {
  const href = row.plan ? `/dashboard/batches/${row.batch.id}/plans/${row.plan.id}` : `/dashboard/batches/${row.batch.id}/plans`;
  if (!row.plan) return <Link href={href} className={buttonClasses('primary', 'sm')}>Plan today</Link>;
  if (row.needsReview) return <Link href={href} className={buttonClasses('primary', 'sm')}><ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" /> Review</Link>;
  return <Link href={href} className={buttonClasses('secondary', 'sm')}>Open plan</Link>;
}

/** Batches as a roster of the day. Phones get the same facts as stacked rows. */
function TodayRoster({ rows }: { rows: BatchToday[] }) {
  return (
    <>
      <TableFrame className="hidden md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="px-4 py-2.5" scope="col">Batch</th>
              <th className="px-3 py-2.5" scope="col">Today&apos;s plan</th>
              <th className="px-3 py-2.5 text-right" scope="col">Finished lessons</th>
              <th className="px-3 py-2.5 text-right" scope="col">Submitted</th>
              <th className="px-3 py-2.5 text-right" scope="col">To review</th>
              <th className="px-3 py-2.5 text-right" scope="col">Awaiting fixes</th>
              <th className="px-4 py-2.5" scope="col"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.batch.id}>
                <td className="px-4 py-3">
                  <Link href={`/dashboard/batches/${r.batch.id}`} className="font-medium text-ink hover:text-brand-ink hover:underline">{r.batch.name}</Link>
                  <div className="text-xs text-ink-3">{r.activeStudents} student{r.activeStudents === 1 ? '' : 's'}</div>
                </td>
                <td className="px-3 py-3">
                  <PlanStatus plan={r.plan} />
                  {r.plan && <div className="mt-0.5 max-w-52 truncate text-xs text-ink-3">{r.plan.title}</div>}
                </td>
                <td className="px-3 py-3 text-right"><Count value={r.plan?.lessonIds.length ? r.finishedLessons : null} total={r.activeStudents} /></td>
                <td className="px-3 py-3 text-right"><Count value={r.plan?.assignmentId ? r.submitted : null} total={r.activeStudents} /></td>
                <td className="px-3 py-3 text-right"><Count value={r.needsReview} attention /></td>
                <td className="px-3 py-3 text-right"><Count value={r.corrections} /></td>
                <td className="px-4 py-3 text-right"><BatchAction row={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface md:hidden">
        {rows.map((r) => (
          <li key={r.batch.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/dashboard/batches/${r.batch.id}`} className="font-medium text-ink">{r.batch.name}</Link>
                <div className="text-xs text-ink-3">{r.activeStudents} student{r.activeStudents === 1 ? '' : 's'}</div>
              </div>
              <BatchAction row={r} />
            </div>
            <PlanStatus plan={r.plan} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between gap-2"><dt className="text-ink-3">Finished</dt><dd className="tabular-nums"><Count value={r.plan?.lessonIds.length ? r.finishedLessons : null} total={r.activeStudents} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-3">Submitted</dt><dd className="tabular-nums"><Count value={r.plan?.assignmentId ? r.submitted : null} total={r.activeStudents} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-3">To review</dt><dd className="tabular-nums"><Count value={r.needsReview} attention /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-3">Awaiting fixes</dt><dd className="tabular-nums"><Count value={r.corrections} /></dd></div>
            </dl>
          </li>
        ))}
      </ul>
    </>
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

  // Accounts awaiting approval, for the People count (managers and Super Admin).
  useEffect(() => {
    let alive = true;
    if (!tenant || !['super_admin', 'university_admin', 'branch_admin'].includes(tenant.role)) return;
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
  const firstUnplanned = rows.find((r) => !r.plan);
  const role = tenant.role;
  const isAcademyAdmin = role === 'super_admin' || role === 'university_admin';
  const firstName = (profile?.displayName || '').split(' ')[0] || 'there';
  const firstReview = rows.find((r) => (r.needsReview ?? 0) > 0 && r.plan);

  const links: HomeLink[] = [
    { label: isManager ? 'Batches' : 'My Batches', icon: Users, href: '/dashboard/batches' },
    { label: 'Daily Plans', icon: CalendarDays, href: firstUnplanned ? `/dashboard/batches/${firstUnplanned.batch.id}/plans` : rows[0] ? `/dashboard/batches/${rows[0].batch.id}/plans` : '/dashboard/batches', count: unplanned, countLabel: 'batches without a plan today' },
    { label: 'Review Work', icon: ClipboardCheck, href: firstReview ? `/dashboard/batches/${firstReview.batch.id}/plans/${firstReview.plan!.id}` : '/dashboard/assessments', count: needsReview, countLabel: 'submissions to review' },
    ...(isManager ? [{ label: 'People', icon: UsersRound, href: '/dashboard/people', count: pendingPeople, countLabel: 'accounts waiting for approval' }] : []),
    ...(isAcademyAdmin ? [{ label: 'Branches', icon: GitBranch, href: '/dashboard/branches' }] : []),
    { label: 'Analytics', icon: BarChart3, href: '/dashboard/analytics' },
    { label: 'Course Authoring', icon: PenTool, href: '/dashboard/courses' },
    { label: 'Live Books', icon: Library, href: '/courses' },
    ...(role === 'super_admin' ? [{ label: 'Organizations', icon: Building2, href: '/dashboard/organizations' }] : []),
    ...(isAcademyAdmin ? [{ label: 'Audit Log', icon: ScrollText, href: '/dashboard/audit' }] : []),
  ];

  const place = scopeNames.branch ?? (tenant.role === 'super_admin' ? 'every branch' : scopeNames.org);
  const scopeLine = `${ROLE_LABELS[tenant.role].toLowerCase()}${place ? ` for ${place}` : ''}${counts.branches !== undefined ? `, ${counts.branches} branch${counts.branches === 1 ? '' : 'es'}` : ''}`;

  return (
    <div className="space-y-9">
      <header className="space-y-2">
        <p className="text-sm font-medium text-ink-3">{formatPlanDate(today, 'long')}</p>
        <h1 className="type-page text-ink">Today</h1>
        <p className="text-body text-ink-2">{profile?.displayName || firstName}, {scopeLine}.</p>
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <KpiTile label="To review" value={isLoading ? '—' : needsReview} tone={needsReview ? 'coral' : 'neutral'} hint="Submissions on today's plans" />
        <KpiTile label="Without a plan today" value={isLoading ? '—' : unplanned} tone={unplanned ? 'warning' : 'neutral'} hint="Running or upcoming batches" />
        <KpiTile label="Running batches" value={isLoading ? '—' : rows.length} hint="In your scope" />
        <KpiTile label="Active students" value={isLoading ? '—' : activeStudents} hint="Across those batches" />
      </div>

      <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section aria-labelledby="today-heading" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="today-heading" className="type-section text-ink">Your batches today</h2>
            <SectionLink href="/dashboard/batches">All batches</SectionLink>
          </div>
          {isLoading ? (
            <div className="space-y-3" role="status"><span className="sr-only">Loading batches…</span><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
          ) : error ? (
            <ErrorState onRetry={() => setReloadKey((k) => k + 1)}>{error}</ErrorState>
          ) : rows.length === 0 ? (
            <EmptyState illustration="calendar" title="No running batches"
              action={isManager ? <Link href="/dashboard/batches" className={buttonClasses('primary', 'sm')}>Create a batch</Link> : undefined}>
              {isManager ? 'Create a batch to start planning daily learning.' : 'When you’re assigned to a batch, today’s plan and submissions appear here.'}
            </EmptyState>
          ) : <TodayRoster rows={rows} />}
        </section>

        <nav aria-label="Shortcuts" className="space-y-3">
          <h2 className="type-section text-ink">Shortcuts</h2>
          <HomeIndex links={links} />
        </nav>
      </div>
    </div>
  );
}

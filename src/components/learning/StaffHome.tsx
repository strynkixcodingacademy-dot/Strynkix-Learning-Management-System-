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
import { Card, PageHeader, Section } from '@/components/ui/Page';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatPlanDate } from './LearningBits';
import { KpiTile } from '@/components/ui/DataViz';
import { TONE_CLASSES, Tone } from '@/components/ui/tones';
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  FileEdit,
  GitBranch,
  GraduationCap,
  Layers,
  PenTool,
  Sparkles,
  UserPlus,
  Users,
  type LucideIcon,
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

function QuickLink({ href, icon: Icon, title, body, tone = 'brand' }: { href: string; icon: LucideIcon; title: string; body: string; tone?: Tone }) {
  const t = TONE_CLASSES[tone];
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-silver hover:shadow-lift">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.soft} ${t.ink}`}><Icon className="w-5 h-5" /></span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-sm font-bold text-ink">{title} <ArrowRight className="w-3.5 h-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></span>
        <span className="block text-xs text-ink-3">{body}</span>
      </span>
    </Link>
  );
}

export function StaffHome() {
  const { user, profile, tenant } = useAuth();
  const [rows, setRows] = useState<BatchToday[]>([]);
  const [counts, setCounts] = useState<{ orgs?: number; branches?: number }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const today = toLocalDateKey(new Date());

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

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={ROLE_LABELS[tenant.role]}
        title={`Hello, ${(profile?.displayName || '').split(' ')[0] || 'there'}`}
        description={isLoading ? 'Loading today’s overview…' : rows.length === 0
          ? 'You have no running batches right now.'
          : `${formatPlanDate(today, 'long')} · ${needsReview} submission${needsReview === 1 ? '' : 's'} to review · ${unplanned} batch${unplanned === 1 ? '' : 'es'} without a plan today`}
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
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 lg:w-72">
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
                    <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
                      <Link href={`/dashboard/batches/${r.batch.id}/timetable`} className={buttonClasses('secondary', 'sm')}>
                        <CalendarDays className="w-3.5 h-3.5" /> Timetable
                      </Link>
                      <Link href={planHref} className={buttonClasses(r.plan ? (r.needsReview ? 'primary' : 'ghost') : 'ghost', 'sm')}>
                        {r.plan ? (r.needsReview ? <><ClipboardCheck className="w-3.5 h-3.5" /> Review</> : 'Open plan') : <><CalendarPlus className="w-3.5 h-3.5" /> Plan today</>}
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="next" title="Next steps" icon={Sparkles}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {firstReview && (
            <QuickLink href={`/dashboard/batches/${firstReview.batch.id}/plans/${firstReview.plan!.id}`} icon={ClipboardCheck} tone="coral"
              title={`Review ${needsReview} submission${needsReview === 1 ? '' : 's'}`} body={`Start with ${firstReview.batch.name}. Grade or request a correction.`} />
          )}
          {firstUnplanned && (
            <QuickLink href={`/dashboard/batches/${firstUnplanned.batch.id}/plans`} icon={CalendarPlus} tone="warning"
              title={`Plan today for ${unplanned} batch${unplanned === 1 ? '' : 'es'}`} body={`${firstUnplanned.batch.name} has no plan for today yet.`} />
          )}
          {isManager && (
            <QuickLink href="/dashboard/batches" icon={UserPlus} title="Add or enroll students" body="Open a batch to create student accounts and enroll them in one step." />
          )}
          {(tenant.role === 'super_admin' || tenant.role === 'branch_admin') && (
            <QuickLink href="/dashboard/people" icon={Users} title="Manage people" body="Approve pending sign-ups, suspend or reactivate accounts." />
          )}
          <QuickLink href="/dashboard/analytics" icon={BarChart3} tone="teal" title="See analytics" body="Completion, submissions, marks and students who need attention." />
          {(tenant.role === 'super_admin' || tenant.role === 'university_admin') && (
            <QuickLink href="/dashboard/branches" icon={GitBranch} tone="lavender" title="Branches" body={counts.branches !== undefined ? `${counts.branches} branch${counts.branches === 1 ? '' : 'es'}. Open one to see its batches and team.` : 'Campuses and franchises.'} />
          )}
          <QuickLink href="/dashboard/courses" icon={PenTool} tone="lavender" title="Write a lesson" body="Build courses, modules and interactive Live Book lessons." />
          {tenant.role === 'super_admin' && (
            <QuickLink href="/dashboard/admin/timetables" icon={CalendarCheck} tone="coral"
              title="Timetable Approvals" body="Review submitted weekly timetables across branches and approve or request changes." />
          )}
          {isManager && (
            <QuickLink href="/dashboard/batches" icon={CalendarDays} tone="brand"
              title="Weekly Timetables" body="Build, submit, and manage weekly timetables from Monday to Sunday for your cohorts." />
          )}
          {tenant.role === 'super_admin' && counts.orgs !== undefined && (
            <QuickLink href="/dashboard/organizations" icon={Building2} tone="lavender" title="Organization" body={`${counts.orgs} organization${counts.orgs === 1 ? '' : 's'} configured.`} />
          )}
        </div>
      </Section>
    </div>
  );
}

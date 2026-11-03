'use client';

/** Shared pieces for the Super Admin Command Centre pages: metric tiles, activity list, academy/branch/period filters. */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBranches, getOrganizations } from '@/lib/admin/service';
import { formatMoney, todayLocal } from '@/lib/academy/format';
import type { Branch, Organization } from '@/types/domain';
import { Field, fieldClasses } from '@/components/ui/Page';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';

export interface Stats {
  branches: number; activeBranches: number; students: number; activeStudents: number; instructors: number; branchManagers: number; universityAdmins: number; courseDesigners: number;
  courses: number | null; publishedCourses: number | null; batches: number; runningBatches: number; enrollments: number; activeEnrollments: number; completedEnrollments: number; withdrawnEnrollments: number;
  admissions: number; expected: number; collected: number; outstanding: number; expenses: number;
}
export interface Named { id: string; name: string; count: number }
export interface Overview {
  period: { from: string; to: string };
  stats: Stats & { academies?: number };
  admissions: { total: number; thisYear: number; thisMonth: number; today: number; inPeriod: number; byMonth: { month: string; count: number }[]; byAcademy: Named[]; byBranch: Named[]; byCourse: Named[] };
  academics: { courses: { total: number; published: number; draft: number }; enrolledStudents: number; averageCompletion: number | null; averageAttendance: number | null; averageAssessment: number | null; pendingEvaluations: number; upcomingExams: { id: string; title: string; courseId: string; examType: string | null; opensAt: string | null; closesAt: string | null }[]; inactiveStudents: number };
  finance: { expected: number; collectedToDate: number; outstanding: number; overdue: number; overdueAccounts: number; collectedInPeriod: number; collectedThisMonth: number; discounts: number; refunds: number; expenses: number; net: number; pendingDiscounts: number };
  charts: {
    admissionsByMonth: { month: string; count: number }[]; collectionsByMonth: { month: string; collected: number; expenses: number }[]; studentsByAcademy: Named[]; admissionsByBranch: Named[]; coursePopularity: Named[];
    completionByCourse: { courseId: string; title: string; completion: number }[]; attendanceByMonth: { month: string; percent: number }[]; expenseCategories: { name: string; amount: number }[]; outstandingByMonth: { month: string; outstanding: number }[];
  };
  recent: ActivityRow[];
}
export interface ActivityRow { id: string; label: string; academy: string | null; branch: string | null; by: string; amount: number | null; reason: string | null; at: string | null; targetType: string | null }

export function Metric({ label, value, href, hint }: { label: string; value: React.ReactNode; href?: string; hint?: string }) {
  const body = (
    <>
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-3">{hint}</div>}
    </>
  );
  return href ? <Link href={href} className="block rounded-card border border-line bg-surface p-4 shadow-card hover:border-silver">{body}</Link> : <div className="rounded-card border border-line bg-surface p-4 shadow-card">{body}</div>;
}

export function ActivityList({ rows }: { rows: ActivityRow[] }) {
  if (!rows.length) return <p className="text-sm text-ink-3">No recorded activity yet.</p>;
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-surface">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 p-3 text-sm">
          <span className="font-semibold text-ink">{r.label}</span>
          {r.amount !== null && <span className="tabular-nums text-ink-2">{formatMoney(r.amount)}</span>}
          <span className="text-ink-3">{[r.academy, r.branch].filter(Boolean).join(' · ')}</span>
          <span className="text-ink-3">by {r.by}</span>
          {r.reason && <span className="text-xs text-ink-3">“{r.reason}”</span>}
          <span className="ml-auto text-xs text-ink-3">{formatWhen(r.at ?? undefined)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Academy / branch / period filter shared by Command Centre pages. */
export function useCommandFilters(initial: { orgId?: string; branchId?: string } = {}) {
  const [orgId, setOrgId] = useState(initial.orgId ?? '');
  const [branchId, setBranchId] = useState(initial.branchId ?? '');
  const [from, setFrom] = useState(`${todayLocal().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(todayLocal());
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => { getOrganizations().then(setOrgs).catch(() => setOrgs([])); }, []);
  useEffect(() => {
    if (!orgId) return;
    let live = true;
    getBranches(orgId).then((b) => live && setBranches(b)).catch(() => live && setBranches([]));
    return () => { live = false; };
  }, [orgId]);
  const params = { ...(orgId ? { orgId } : {}), ...(orgId && branchId ? { branchId } : {}), from, to };
  const controls = (opts: { dates?: boolean } = { dates: true }) => (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <Field label="Academy" htmlFor="cf-org"><select id="cf-org" value={orgId} onChange={(e) => { setOrgId(e.target.value); setBranchId(''); }} className={`${fieldClasses} min-w-[200px]`}><option value="">All academies</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      {orgId && <Field label="Branch" htmlFor="cf-branch"><select id="cf-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className={`${fieldClasses} min-w-[180px]`}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
      {opts.dates && <>
        <Field label="From" htmlFor="cf-from"><input id="cf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClasses} /></Field>
        <Field label="To" htmlFor="cf-to"><input id="cf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClasses} /></Field>
      </>}
    </div>
  );
  return { orgId, branchId, from, to, params, controls, orgs, branches };
}


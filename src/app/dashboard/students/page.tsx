'use client';

/**
 * Strynkix LMS — Students: the register of every student in the caller's
 * scope (Super Admin: any academy; University Admin: their academy; Branch
 * Manager: their branch). Contacts and guardian, admission, batches, courses,
 * attendance, results and fees (finance access only) in one searchable,
 * filterable table, with an audited CSV export. Rows open the full profile.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Avatar } from '@/components/ui/DataViz';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { cx, type Tone } from '@/components/ui/tones';
import { studentsApi } from '@/lib/academy/api';
import { formatDate, formatMoney } from '@/lib/academy/format';
import { studentColumns } from '@/lib/students/csv';
import { downloadCsv } from '@/lib/export/csv';
import type { FeeStatus, StudentRow } from '@/lib/students/records';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowDownUp, ChevronDown, Download, GraduationCap, IndianRupee, Phone, Search, UserPlus, UserRoundX, Users, X,
} from 'lucide-react';

interface Register {
  scope: { orgId: string; branchId: string | null; lockedToBranch: boolean };
  academies: { id: string; name: string }[] | null;
  branches: { id: string; name: string }[];
  batches: { id: string; name: string; branchId: string; courseId: string }[];
  courses: { id: string; title: string }[];
  canSeeFinance: boolean;
  truncated: boolean;
  rows: StudentRow[];
}

type Quick = 'all' | 'active' | 'unassigned' | 'overdue' | 'low_attendance';
type SortKey = 'name' | 'admission' | 'attendance' | 'score' | 'balance';

const LOW_ATTENDANCE = 75;
const PAGE = 50;

const FEE_LOOK: Record<FeeStatus, { tone: Tone; label: string }> = {
  paid: { tone: 'success', label: 'Paid' },
  partial: { tone: 'warning', label: 'Part paid' },
  pending: { tone: 'neutral', label: 'Not paid yet' },
  overdue: { tone: 'danger', label: 'Overdue' },
  none: { tone: 'neutral', label: 'No fee account' },
};
const ACCOUNT_LOOK: Record<string, { tone: Tone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  pending_verification: { tone: 'warning', label: 'Pending' },
  invited: { tone: 'warning', label: 'Invited' },
  suspended: { tone: 'danger', label: 'Suspended' },
};

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase();

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-4">{label}</div>
      <div className="mt-0.5 break-words text-[13px] font-semibold text-ink-2">{children || '—'}</div>
    </div>
  );
}

function Details({ r, finance }: { r: StudentRow; finance: boolean }) {
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
      <Detail label="Date of birth">{r.dateOfBirth ? `${formatDate(r.dateOfBirth)}${r.age !== null ? ` (${r.age} yrs)` : ''}` : null}</Detail>
      <Detail label="Gender">{r.gender}</Detail>
      <Detail label="Email">{r.email}</Detail>
      <Detail label="Mobile">{r.mobile}</Detail>
      <Detail label="Parent / guardian">{[r.guardian.name, r.guardian.relation].filter(Boolean).join(' · ')}</Detail>
      <Detail label="Guardian contact">{[r.guardian.phone, r.guardian.email].filter(Boolean).join(' · ')}</Detail>
      <Detail label="Emergency contact">{[r.emergency.name, r.emergency.relation, r.emergency.phone].filter(Boolean).join(' · ')}</Detail>
      <Detail label="Address">{[r.address, r.city, r.state, r.pinCode].filter(Boolean).join(', ')}</Detail>
      <Detail label="College / institution">{r.college}</Detail>
      <Detail label="Qualification">{r.qualification}</Detail>
      <Detail label="Current occupation">{r.occupation}</Detail>
      <Detail label="Courses">{r.courses.map((c) => c.title).join(', ')}</Detail>
      <Detail label="Attendance">{r.attendancePercent !== null ? `${r.attendancePercent}% of ${r.sessionsMarked} sessions` : null}</Detail>
      <Detail label="Results">{r.averageScore !== null ? `${r.averageScore}% average over ${r.assessmentsEvaluated} assessment${r.assessmentsEvaluated === 1 ? '' : 's'}` : null}</Detail>
      <Detail label="Certificates">{r.certificates ? String(r.certificates) : null}</Detail>
      <Detail label="Last sign-in">{r.lastActive ? formatDate(r.lastActive) : null}</Detail>
      {finance && r.fees && r.fees.status !== 'none' && (
        <>
          <Detail label="Total fee">{formatMoney(r.fees.due)}</Detail>
          <Detail label="Paid">{formatMoney(r.fees.collected)}</Detail>
          <Detail label="Balance">{formatMoney(r.fees.balance)}{r.fees.overdue ? ` (${formatMoney(r.fees.overdue)} overdue)` : ''}</Detail>
          <Detail label="Next due">{r.fees.nextDueDate ? formatDate(r.fees.nextDueDate) : null}</Detail>
        </>
      )}
    </div>
  );
}

function AttendanceCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-4">—</span>;
  const low = value < LOW_ATTENDANCE;
  return (
    <div className="w-20">
      <div className={cx('text-[13px] font-bold tabular-nums', low ? 'text-danger-ink' : 'text-ink')}>{value}%</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
        <div className={cx('h-full rounded-full', low ? 'bg-danger' : 'bg-success')} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

function SortHead({ k, sort, onSort, children, className }: { k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cx('px-3 py-2.5 text-left', className)} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 font-bold hover:text-ink">
        {children} <ArrowDownUp className={cx('h-3 w-3', sort.key === k ? 'text-brand-ink' : 'text-ink-4')} aria-hidden="true" />
      </button>
    </th>
  );
}

function Students() {
  const { tenant } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [orgId, setOrgId] = useState<string | undefined>(undefined);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [data, setData] = useState<Register | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [q, setQ] = useState('');
  const [quick, setQuick] = useState<Quick>('all');
  const [batch, setBatch] = useState('');
  const [course, setCourse] = useState('');
  const [account, setAccount] = useState('');
  const [enrollment, setEnrollment] = useState('');
  const [fee, setFee] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    studentsApi<Register>({ action: 'list', ...(orgId ? { orgId } : {}), ...(branchId ? { branchId } : {}) })
      .then((r) => { if (alive) { setData(r); setError(null); } })
      .catch((e) => { if (alive) setError((e as Error).message || 'The student register couldn’t load.'); });
    return () => {
      alive = false;
    };
  }, [orgId, branchId, reloadKey]);

  const reload = (next: { orgId?: string; branchId?: string }) => {
    setData(null);
    setError(null);
    setBatch('');
    setCourse('');
    setPage(0);
    if ('orgId' in next) setOrgId(next.orgId);
    setBranchId(next.branchId);
  };

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const counts = useMemo(() => ({
    all: rows.length,
    active: rows.filter((r) => r.accountStatus === 'active' && r.enrollmentStatus === 'active').length,
    unassigned: rows.filter((r) => r.batches.length === 0).length,
    overdue: rows.filter((r) => r.fees?.status === 'overdue').length,
    low_attendance: rows.filter((r) => r.attendancePercent !== null && r.attendancePercent < LOW_ATTENDANCE).length,
  }), [rows]);

  const filtered = useMemo(() => {
    const needle = norm(q.trim());
    const out = rows.filter((r) => {
      if (quick === 'active' && !(r.accountStatus === 'active' && r.enrollmentStatus === 'active')) return false;
      if (quick === 'unassigned' && r.batches.length > 0) return false;
      if (quick === 'overdue' && r.fees?.status !== 'overdue') return false;
      if (quick === 'low_attendance' && !(r.attendancePercent !== null && r.attendancePercent < LOW_ATTENDANCE)) return false;
      if (batch && !r.batches.some((b) => b.id === batch)) return false;
      if (course && !r.courses.some((c) => c.id === course)) return false;
      if (account && r.accountStatus !== account) return false;
      if (enrollment && r.enrollmentStatus !== enrollment) return false;
      if (fee && r.fees?.status !== fee) return false;
      if (!needle) return true;
      return [r.name, r.studentId, r.email, r.mobile, r.guardian.name, r.guardian.phone, r.college, r.city]
        .some((v) => norm(v).includes(needle));
    });
    const val = (r: StudentRow): string | number => {
      switch (sort.key) {
        case 'admission': return r.admissionDate ?? '';
        case 'attendance': return r.attendancePercent ?? -1;
        case 'score': return r.averageScore ?? -1;
        case 'balance': return r.fees?.balance ?? -1;
        default: return r.name.toLowerCase();
      }
    };
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, q, quick, batch, course, account, enrollment, fee, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const anyFilter = !!(q || quick !== 'all' || batch || course || account || enrollment || fee);
  const clearFilters = () => { setQ(''); setQuick('all'); setBatch(''); setCourse(''); setAccount(''); setEnrollment(''); setFee(''); setPage(0); };
  const sortBy = (key: SortKey) => { setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 })); setPage(0); };

  const exportCsv = async () => {
    if (!data || !filtered.length) return;
    const ok = await confirm({
      title: `Export ${filtered.length} student${filtered.length === 1 ? '' : 's'}?`,
      body: <>The file contains personal details{data.canSeeFinance ? ' and fees' : ''} of the students in your current view. Keep it secure and share it only with people who need it. The export is recorded in the audit log.</>,
      confirmLabel: 'Export CSV',
      tone: 'primary',
    });
    if (!ok) return;
    setExporting(true);
    try {
      const filters = Object.fromEntries(Object.entries({ q, quick, batch, course, account, enrollment, fee }).filter(([, v]) => v && v !== 'all'));
      await studentsApi({ action: 'log_export', orgId: data.scope.orgId, ...(data.scope.branchId ? { branchId: data.scope.branchId } : {}), count: filtered.length, format: 'csv', filters });
      downloadCsv(`students-${new Date().toISOString().slice(0, 10)}.csv`, filtered, studentColumns(data.canSeeFinance));
      toast.success(`Exported ${filtered.length} student${filtered.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error((e as Error).message || 'The export couldn’t be completed.');
    } finally {
      setExporting(false);
    }
  };

  const batchesHere = (data?.batches ?? []).filter((b) => !data?.scope.branchId || b.branchId === data.scope.branchId);
  const select = cx(fieldClasses, 'h-10 py-0 text-[13px]');
  const QUICK: Array<{ key: Quick; label: string; icon: React.ComponentType<{ className?: string }>; tone: string; show: boolean }> = [
    { key: 'all', label: 'All students', icon: GraduationCap, tone: 'text-brand-ink', show: true },
    { key: 'active', label: 'Active learners', icon: Users, tone: 'text-success-ink', show: true },
    { key: 'unassigned', label: 'Not in a batch', icon: UserRoundX, tone: 'text-warning-ink', show: true },
    { key: 'low_attendance', label: `Attendance under ${LOW_ATTENDANCE}%`, icon: AlertTriangle, tone: 'text-coral-ink', show: true },
    { key: 'overdue', label: 'Fees overdue', icon: IndianRupee, tone: 'text-danger-ink', show: !!data?.canSeeFinance },
  ];

  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader
        eyebrow={tenant?.role === 'branch_admin' ? 'Your branch' : 'Academy'}
        title="Students"
        description="Every student with contacts, guardian, admission, batches, attendance, results and fees. Click a student for details."
        actions={<>
          <Link href="/dashboard/admissions/new" className={buttonClasses('secondary')}><UserPlus className="h-4 w-4" /> New admission</Link>
          <Button onClick={exportCsv} loading={exporting} disabled={!filtered.length} icon={<Download className="h-4 w-4" />}>Export CSV</Button>
        </>}
      />

      {data && !data.scope.lockedToBranch && (
        <div className="flex flex-wrap gap-3">
          {data.academies && (
            <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-3">
              Academy
              <select value={data.scope.orgId} onChange={(e) => reload({ orgId: e.target.value, branchId: undefined })} className={cx(select, 'w-56')}>
                {data.academies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-3">
            Branch
            <select value={data.scope.branchId ?? ''} onChange={(e) => reload({ branchId: e.target.value || undefined })} className={cx(select, 'w-56')}>
              <option value="">All branches</option>
              {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>
      )}

      {error ? (
        <ErrorState title="The student register didn’t load" onRetry={() => { setError(null); setReloadKey((k) => k + 1); }}>{error}</ErrorState>
      ) : !data ? (
        <LoadingState label="Loading students…" rows={5} />
      ) : (
        <>
          {data.truncated && <Notice kind="warning">This academy has more students than one list can show. Choose a branch to see everyone.</Notice>}

          <div role="group" aria-label="Quick filters" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {QUICK.filter((x) => x.show).map(({ key, label, icon: Icon, tone }) => {
              const on = quick === key;
              return (
                <button key={key} type="button" aria-pressed={on} onClick={() => { setQuick(on && key !== 'all' ? 'all' : key); setPage(0); }}
                  className={cx('rounded-card border bg-surface p-4 text-left shadow-card transition-colors', on ? 'border-brand ring-2 ring-brand/20' : 'border-line hover:border-line-strong')}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">{label}</span>
                    <Icon className={cx('h-4 w-4 shrink-0', tone)} />
                  </span>
                  <span className="mt-1.5 block text-[26px] font-extrabold leading-none tabular-nums text-ink">{counts[key]}</span>
                </button>
              );
            })}
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-line p-4 xl:flex-row xl:items-center">
              <div className="relative xl:w-80">
                <label htmlFor="student-search" className="sr-only">Search students</label>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden="true" />
                <input id="student-search" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }}
                  placeholder="Name, student ID, mobile, guardian, college…" className={cx(fieldClasses, 'h-10 pl-9 text-[13px]')} />
              </div>
              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <select aria-label="Batch" value={batch} onChange={(e) => { setBatch(e.target.value); setPage(0); }} className={select}>
                  <option value="">All batches</option>
                  {batchesHere.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select aria-label="Course" value={course} onChange={(e) => { setCourse(e.target.value); setPage(0); }} className={select}>
                  <option value="">All courses</option>
                  {data.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <select aria-label="Enrollment" value={enrollment} onChange={(e) => { setEnrollment(e.target.value); setPage(0); }} className={select}>
                  <option value="">Any enrollment</option>
                  <option value="active">Studying</option>
                  <option value="completed">Completed</option>
                  <option value="suspended">Enrollment paused</option>
                  <option value="dropped">Dropped</option>
                  <option value="not_enrolled">Not enrolled</option>
                </select>
                <select aria-label="Account status" value={account} onChange={(e) => { setAccount(e.target.value); setPage(0); }} className={select}>
                  <option value="">Any account</option>
                  <option value="active">Active</option>
                  <option value="pending_verification">Pending</option>
                  <option value="invited">Invited</option>
                  <option value="suspended">Suspended</option>
                </select>
                {data.canSeeFinance && (
                  <select aria-label="Fee status" value={fee} onChange={(e) => { setFee(e.target.value); setPage(0); }} className={select}>
                    <option value="">Any fee status</option>
                    <option value="overdue">Overdue</option>
                    <option value="partial">Part paid</option>
                    <option value="pending">Not paid yet</option>
                    <option value="paid">Paid</option>
                    <option value="none">No fee account</option>
                  </select>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-[13px] text-ink-3">
              <span><strong className="font-bold text-ink">{filtered.length}</strong> of {rows.length} student{rows.length === 1 ? '' : 's'}</span>
              {anyFilter && <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 font-semibold text-brand-ink hover:underline"><X className="h-3.5 w-3.5" /> Clear filters</button>}
            </div>

            {filtered.length === 0 ? (
              <div className="p-6">
                <EmptyState compact illustration="inbox" title={rows.length ? 'No students match these filters' : 'No students yet'}
                  action={rows.length ? <Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button> : <Link href="/dashboard/admissions/new" className={buttonClasses('primary', 'sm')}>New admission</Link>}>
                  {rows.length ? 'Try a different search or filter.' : 'Students appear here once they are admitted or added to a batch.'}
                </EmptyState>
              </div>
            ) : (
              <>
                {/* Desktop: a table; each row expands to every detail. */}
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[980px] text-[13px]">
                    <thead className="bg-surface-muted text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
                      <tr>
                        <SortHead sort={sort} onSort={sortBy} k="name" className="pl-5">Student</SortHead>
                        <th scope="col" className="px-3 py-2.5 text-left font-bold">Contact &amp; guardian</th>
                        <th scope="col" className="px-3 py-2.5 text-left font-bold">Branch · batch</th>
                        <SortHead sort={sort} onSort={sortBy} k="admission">Admitted</SortHead>
                        <SortHead sort={sort} onSort={sortBy} k="attendance">Attendance</SortHead>
                        <SortHead sort={sort} onSort={sortBy} k="score">Avg score</SortHead>
                        {data.canSeeFinance && <SortHead sort={sort} onSort={sortBy} k="balance">Fees</SortHead>}
                        <th scope="col" className="px-3 py-2.5 text-left font-bold">Status</th>
                        <th scope="col" className="w-10 pr-4"><span className="sr-only">Details</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {shown.map((r) => {
                        const expanded = open === r.id;
                        const acc = ACCOUNT_LOOK[r.accountStatus] ?? ACCOUNT_LOOK.active;
                        return (
                          <React.Fragment key={r.id}>
                            <tr className={cx('align-top transition-colors hover:bg-canvas', expanded && 'bg-canvas')}>
                              <td className="py-3 pl-5 pr-3">
                                <div className="flex items-center gap-3">
                                  <Avatar name={r.name} size={34} />
                                  <div className="min-w-0">
                                    <Link href={`/dashboard/people/${r.id}`} className="block truncate font-bold text-ink hover:text-brand-ink">{r.name}</Link>
                                    <div className="truncate text-[12px] text-ink-3">{r.studentId ?? 'No student ID'} · {r.email}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-1.5 font-semibold text-ink-2">{r.mobile ? <><Phone className="h-3.5 w-3.5 text-ink-4" />{r.mobile}</> : <span className="text-ink-4">No mobile</span>}</div>
                                <div className="mt-0.5 text-[12px] text-ink-3">{r.guardian.name || r.guardian.phone ? `${r.guardian.name ?? 'Guardian'}${r.guardian.relation ? ` (${r.guardian.relation})` : ''}${r.guardian.phone ? ` · ${r.guardian.phone}` : ''}` : 'No guardian on file'}</div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="font-semibold text-ink-2">{r.branchName ?? '—'}</div>
                                <div className="mt-0.5 text-[12px] text-ink-3">{r.batches.length ? r.batches.map((b) => b.name).join(', ') : <span className="italic">Not in a batch</span>}</div>
                              </td>
                              <td className="px-3 py-3 font-semibold text-ink-2">{r.admissionDate ? formatDate(r.admissionDate) : '—'}</td>
                              <td className="px-3 py-3"><AttendanceCell value={r.attendancePercent} /></td>
                              <td className="px-3 py-3 font-bold tabular-nums text-ink">{r.averageScore !== null ? `${r.averageScore}%` : <span className="font-normal text-ink-4">—</span>}</td>
                              {data.canSeeFinance && (
                                <td className="px-3 py-3">
                                  {r.fees ? <>
                                    <StatusPill tone={FEE_LOOK[r.fees.status].tone} size="sm">{FEE_LOOK[r.fees.status].label}</StatusPill>
                                    {r.fees.balance > 0 && <div className="mt-1 text-[12px] font-semibold text-ink-3">{formatMoney(r.fees.balance)} due</div>}
                                  </> : <span className="text-ink-4">—</span>}
                                </td>
                              )}
                              <td className="px-3 py-3"><StatusPill tone={acc.tone} size="sm">{acc.label}</StatusPill></td>
                              <td className="py-3 pr-4">
                                <button type="button" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded} aria-controls={`d-${r.id}`}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted hover:text-ink" aria-label={`${expanded ? 'Hide' : 'Show'} details for ${r.name}`}>
                                  <ChevronDown className={cx('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
                                </button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr id={`d-${r.id}`} className="bg-canvas">
                                <td colSpan={data.canSeeFinance ? 9 : 8} className="px-5 pb-5 pt-1">
                                  <div className="rounded-xl border border-line bg-surface p-4">
                                    <Details r={r} finance={data.canSeeFinance} />
                                    <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                                      <Link href={`/dashboard/people/${r.id}`} className={buttonClasses('primary', 'sm')}>Open full profile</Link>
                                      {r.batches[0] && <Link href={`/dashboard/batches/${r.batches[0].id}`} className={buttonClasses('secondary', 'sm')}>Open batch</Link>}
                                      {data.canSeeFinance && r.fees && r.fees.status !== 'none' && <Link href="/dashboard/finance" className={buttonClasses('secondary', 'sm')}>Fees &amp; payments</Link>}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Phones and tablets: cards. */}
                <ul className="divide-y divide-line lg:hidden">
                  {shown.map((r) => {
                    const expanded = open === r.id;
                    const acc = ACCOUNT_LOOK[r.accountStatus] ?? ACCOUNT_LOOK.active;
                    return (
                      <li key={r.id} className="p-4">
                        <div className="flex items-start gap-3">
                          <Avatar name={r.name} size={38} />
                          <div className="min-w-0 flex-1">
                            <Link href={`/dashboard/people/${r.id}`} className="block truncate font-bold text-ink">{r.name}</Link>
                            <div className="truncate text-[12px] text-ink-3">{r.studentId ?? 'No student ID'} · {r.branchName ?? '—'}</div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <StatusPill tone={acc.tone} size="sm">{acc.label}</StatusPill>
                              {r.attendancePercent !== null && <StatusPill tone={r.attendancePercent < LOW_ATTENDANCE ? 'danger' : 'success'} size="sm">{r.attendancePercent}% attendance</StatusPill>}
                              {data.canSeeFinance && r.fees && r.fees.status !== 'none' && <StatusPill tone={FEE_LOOK[r.fees.status].tone} size="sm">{FEE_LOOK[r.fees.status].label}</StatusPill>}
                            </div>
                            <div className="mt-2 text-[12.5px] text-ink-2">{r.batches.length ? r.batches.map((b) => b.name).join(', ') : <span className="italic text-ink-3">Not in a batch</span>}</div>
                          </div>
                          <button type="button" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted" aria-label={`${expanded ? 'Hide' : 'Show'} details for ${r.name}`}>
                            <ChevronDown className={cx('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
                          </button>
                        </div>
                        {expanded && (
                          <div className="mt-3 rounded-xl border border-line bg-canvas p-4">
                            <Details r={r} finance={data.canSeeFinance} />
                            <Link href={`/dashboard/people/${r.id}`} className={cx(buttonClasses('primary', 'sm'), 'mt-4')}>Open full profile</Link>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {pages > 1 && (
                  <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-ink-3">
                    <span>Page {page + 1} of {pages}</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                      <Button size="sm" variant="secondary" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export default function StudentsPage() {
  return (
    <AppShell>
      <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}>
        <Students />
      </RequireRole>
    </AppShell>
  );
}

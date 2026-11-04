'use client';

/**
 * Strynkix Live Books — People.
 * Students, instructors (and, for the Super Admin, branch managers) in the
 * caller's scope: who they are, which batches they're in, and their account
 * status, with approve / suspend / reactivate. Rules enforce the scope.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell, ROLE_LABELS } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { buttonClasses } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Avatar, KpiTile } from '@/components/ui/DataViz';
import { Card, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tone, cx } from '@/components/ui/tones';
import { changePersonStatus, countPeople, getEnrollmentsForStudents, getPeoplePage, StatusAction, statusActionFor } from '@/lib/account/service';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { getBatchesForTenant } from '@/lib/batches/service';
import { getBranches } from '@/lib/admin/service';
import { grantsContentAccess } from '@/lib/batches/scope';
import { Batch, Branch, Enrollment, UserProfile, UserStatus } from '@/types/domain';
import { CircleCheck, CirclePause, Clock3, GraduationCap, PenTool, Search, UserPlus, Users, UserX } from 'lucide-react';
import { ContentMemberDialog } from '@/components/people/ContentMemberDialog';
import { AccountEditDialog } from '@/components/people/AccountEditDialog';
import { canCorrectAccount } from '@/lib/admin/account-authority';
import { CourseDesignMembershipDialog } from '@/components/people/CourseDesignMembershipDialog';
import { isEligibleForCourseDesign, hasOrgWideScope } from '@/lib/admin/course-design';

type RoleFilter = 'all' | 'student' | 'instructor' | 'branch_admin' | 'content';
const isContent = (r: string) => r === 'content_lead' || r === 'content_designer';
type StatusFilter = 'all' | 'active' | 'pending' | 'suspended';

const STATUS_LOOK: Record<UserStatus, { tone: Tone; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  active: { tone: 'success', label: 'Active', icon: CircleCheck },
  pending_verification: { tone: 'warning', label: 'Pending', icon: Clock3 },
  invited: { tone: 'warning', label: 'Invited', icon: Clock3 },
  suspended: { tone: 'danger', label: 'Suspended', icon: CirclePause },
};

const ACTION_LOOK: Record<StatusAction, { label: string; confirm: string; body: string; danger?: boolean }> = {
  approve: { label: 'Approve', confirm: 'Approve account', body: 'They can sign in and use everything their role allows straight away.' },
  suspend: { label: 'Suspend', confirm: 'Suspend account', body: 'They lose access immediately. Their learning history, submissions and marks are kept, and you can reactivate them at any time.', danger: true },
  reactivate: { label: 'Reactivate', confirm: 'Reactivate account', body: 'They regain access with everything their role allows.' },
};


export default function PeoplePage() {
  const { user, tenant, profile } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [showContentForm, setShowContentForm] = useState(false);
  const [membershipFor, setMembershipFor] = useState<UserProfile | null>(null);
  const [editingAccount, setEditingAccount] = useState<UserProfile | null>(null);

  const canManage = tenant?.role === 'super_admin' || tenant?.role === 'university_admin' || tenant?.role === 'branch_admin';

  // Pagination (milestone G14): role and status filters and full-email search run in
  // Firestore; a partial name filters the people already loaded.
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [counts, setCounts] = useState({ students: 0, instructors: 0, pending: 0, suspended: 0 });
  const emailSearch = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.trim()) ? q.trim().toLowerCase() : undefined;

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!tenant || !user || !canManage) return;
      try {
        const [page, c, b, br] = await Promise.all([
          getPeoplePage(tenant, { role: roleFilter, status: statusFilter, email: emailSearch }, null),
          countPeople(tenant).catch(() => null),
          getBatchesForTenant(tenant, user.uid).catch(() => []),
          tenant.role === 'super_admin' || tenant.role === 'university_admin' ? getBranches(tenant.orgId).catch(() => []) : Promise.resolve([]),
        ]);
        const e = await getEnrollmentsForStudents(tenant, page.people.filter((x) => x.role === 'student').map((x) => x.id)).catch(() => []);
        if (!alive) return;
        setPeople(page.people);
        setCursor(page.cursor);
        setHasMore(page.hasMore);
        if (c) setCounts(c);
        setEnrollments(e);
        setBatches(b);
        setBranches(br);
        setError(null);
      } catch (err) {
        console.error('Failed to load people', err);
        if (alive) setError('We couldn’t load people for your scope. Check your connection and try again.');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [tenant, user, canManage, reloadKey, roleFilter, statusFilter, emailSearch]);

  const loadMore = async () => {
    if (!tenant || !cursor) return;
    setLoadingMore(true);
    try {
      const page = await getPeoplePage(tenant, { role: roleFilter, status: statusFilter, email: emailSearch }, cursor);
      const e = await getEnrollmentsForStudents(tenant, page.people.filter((x) => x.role === 'student').map((x) => x.id)).catch(() => []);
      setPeople((list) => [...list, ...page.people]);
      setEnrollments((list) => [...list, ...e]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch {
      setNotice({ kind: 'error', text: 'More people couldn’t be loaded. Try again.' });
    } finally {
      setLoadingMore(false);
    }
  };

  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const batchesFor = (p: UserProfile): Batch[] => {
    if (p.role === 'student') {
      return enrollments
        .filter((e) => e.studentId === p.id && grantsContentAccess(e.status))
        .flatMap((e) => (batchById.get(e.batchId) ? [batchById.get(e.batchId)!] : []));
    }
    if (p.role === 'instructor') return batches.filter((b) => b.instructorUserIds.includes(p.id) && b.status !== 'archived');
    return [];
  };

  // Role, status and full-email filters already ran in Firestore; a partial name narrows the loaded page.
  const needle = emailSearch ? '' : q.trim().toLowerCase();
  const filtered = people.filter((p) => !needle || `${p.displayName} ${p.email}`.toLowerCase().includes(needle));
  const unassignedLoaded = people.filter((p) => p.role === 'student' && p.status === 'active' && batchesFor(p).length === 0).length;

  const runAction = async (person: UserProfile, action: StatusAction) => {
    const look = ACTION_LOOK[action];
    const ok = await confirm({ title: `${look.confirm}: ${person.displayName}?`, body: look.body, confirmLabel: look.confirm, tone: look.danger ? 'danger' : 'primary' });
    if (!ok) return;
    setBusy(person.id);
    setNotice(null);
    try {
      const status = await changePersonStatus(person, action);
      setPeople((list) => list.map((p) => (p.id === person.id ? { ...p, status } : p)));
      setNotice({ kind: 'success', text: `${person.displayName} is now ${STATUS_LOOK[status].label.toLowerCase()}.` });
    } catch (err) {
      console.error('Status change failed', err);
      setNotice({ kind: 'error', text: `Couldn’t update ${person.displayName}. They may be outside your scope.` });
    } finally {
      setBusy(null);
    }
  };

  const roleTabs: Array<[RoleFilter, string]> = [
    ['all', 'Everyone'],
    ['student', 'Students'],
    ['instructor', 'Instructors'],
    ...(tenant?.role === 'super_admin' || tenant?.role === 'university_admin' ? [['branch_admin', 'Branch managers'] as [RoleFilter, string]] : []),
    ...(tenant?.role === 'super_admin' ? [['content', 'Content team'] as [RoleFilter, string]] : []),
  ];

  return (
    <AppShell>
      <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}>
        <div className="space-y-8">
          <PageHeader
            eyebrow={tenant?.role === 'branch_admin' ? 'Your branch' : 'Academy-wide'}
            title="People"
            description="Everyone you manage, the batches they’re in, and their account status."
            actions={<>
              {tenant?.role === 'super_admin' && (
                <button type="button" onClick={() => setShowContentForm(true)} className={buttonClasses('secondary')}>
                  <PenTool className="h-4 w-4" /> Add content team member
                </button>
              )}
              <Link href="/dashboard/people/search" className={buttonClasses('secondary')}>
                <Search className="h-4 w-4" /> Find by mobile or student ID
              </Link>
              <Link href="/dashboard/people/onboard?role=instructor" className={buttonClasses('secondary')}>
                <UserPlus className="h-4 w-4" /> Onboard instructor
              </Link>
              {tenant?.role === 'super_admin' && (
                <Link href="/dashboard/people/onboard?role=content_designer" className={buttonClasses('secondary')}>
                  <PenTool className="h-4 w-4" /> Onboard course designer
                </Link>
              )}
              <Link href="/dashboard/admissions/new" className={buttonClasses('primary')}>
                <UserPlus className="h-4 w-4" /> New admission
              </Link>
            </>}
          />

          {loading ? (
            <LoadingState label="Loading people…" rows={4} />
          ) : error ? (
            <ErrorState onRetry={() => { setLoading(true); setReloadKey((k) => k + 1); }}>{error}</ErrorState>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <KpiTile label="Students" value={counts.students} icon={GraduationCap} hint={hasMore ? `${unassignedLoaded} of those loaded have no batch` : `${unassignedLoaded} active without a batch`} />
                <KpiTile label="Instructors" value={counts.instructors} icon={Users} tone="teal" hint="Assigned to batches as lead instructors" />
                <KpiTile label="Pending approval" value={counts.pending} icon={Clock3} tone="warning" hint={counts.pending ? 'Waiting for you to approve' : 'Nobody is waiting'} />
                <KpiTile label="Suspended" value={counts.suspended} icon={UserX} tone="coral" hint="No access until reactivated" />
              </div>

              {counts.pending > 0 && statusFilter !== 'pending' && (
                <Notice kind="warning" action={<button type="button" onClick={() => { setLoading(true); setStatusFilter('pending'); }} className="text-xs font-bold text-warning-ink underline">Review now</button>}>
                  {counts.pending} account{counts.pending === 1 ? ' is' : 's are'} waiting for approval.
                </Notice>
              )}
              {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
              <Notice kind="info" action={<Link href="/dashboard/students" className="shrink-0 text-xs font-bold text-brand-ink underline">Open Students</Link>}>
                Need a student’s contacts, guardian, attendance, results or fees, or a spreadsheet of everyone? Use the Students register.
              </Notice>

              <Card className="overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
                  <div role="tablist" aria-label="Filter by role" className="flex gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1">
                    {roleTabs.map(([value, label]) => (
                      <button key={value} type="button" role="tab" aria-selected={roleFilter === value} onClick={() => { if (value !== roleFilter) { setLoading(true); setRoleFilter(value); } }}
                        className={cx('shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-bold transition-colors', roleFilter === value ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-1 flex-col gap-3 sm:flex-row lg:justify-end">
                    <label htmlFor="status-filter" className="sr-only">Filter by status</label>
                    <select id="status-filter" value={statusFilter} onChange={(e) => { setLoading(true); setStatusFilter(e.target.value as StatusFilter); }} className={cx(fieldClasses, 'sm:w-44')}>
                      <option value="all">All statuses</option>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="suspended">Suspended</option>
                    </select>
                    <div className="relative sm:w-72">
                      <label htmlFor="people-search" className="sr-only">Search people</label>
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden="true" />
                      <input id="people-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, or full email" className={cx(fieldClasses, 'pl-9')} />
                    </div>
                  </div>
                </div>

                {filtered.length === 0 ? (
                  <div className="p-6">
                    <EmptyState compact illustration="inbox" title={people.length ? 'Nobody matches these filters' : 'No people yet'}
                      action={people.length ? <button type="button" onClick={() => { setLoading(true); setRoleFilter('all'); setStatusFilter('all'); setQ(''); }} className="text-sm font-bold text-brand-ink hover:underline">Clear filters</button>
                        : <Link href="/dashboard/batches" className={buttonClasses('primary', 'sm')}>Open batches</Link>}>
                      {people.length ? 'Try a different role, status or search.' : 'Create students and instructors from a batch so they’re enrolled and assigned in one step.'}
                    </EmptyState>
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {filtered.map((p) => {
                      const look = STATUS_LOOK[p.status] ?? STATUS_LOOK.active;
                      const action = user && tenant ? statusActionFor(p, { uid: user.uid, role: tenant.role }) : null;
                      const theirBatches = batchesFor(p);
                      return (
                        <li key={p.id} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 md:flex-row md:items-center">
                          <div className="flex min-w-0 items-center gap-3 md:w-[34%]">
                            <Avatar name={p.displayName || p.email} size={38} />
                            <div className="min-w-0">
                              <Link href={`/dashboard/people/${p.id}`} className="block truncate text-sm font-bold text-ink hover:text-brand-ink">{p.displayName || 'Unnamed'}</Link>
                              <div className="truncate text-xs text-ink-3">{p.email}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 md:w-[22%]">
                            <StatusPill tone={p.role === 'student' ? 'brand' : p.role === 'instructor' ? 'teal' : isContent(p.role) ? 'coral' : 'lavender'} size="sm">{ROLE_LABELS[p.role]}</StatusPill>
                            {tenant?.role === 'super_admin' && p.branchId && <span className="truncate text-xs font-semibold text-ink-3">{branchName.get(p.branchId) ?? p.branchId}</span>}
                          </div>
                          <div className="min-w-0 flex-1 text-xs text-ink-3">
                            {theirBatches.length ? (
                              <div className="flex flex-wrap gap-1.5">
                                {theirBatches.slice(0, 3).map((b) => (
                                  <Link key={b.id} href={`/dashboard/batches/${b.id}`} className="rounded-md border border-line bg-surface-muted px-2 py-0.5 font-semibold text-ink-2 hover:border-brand-line hover:text-brand-ink">{b.name}</Link>
                                ))}
                                {theirBatches.length > 3 && <span className="py-0.5 font-semibold">+{theirBatches.length - 3} more</span>}
                              </div>
                            ) : p.role === 'branch_admin' ? (
                              <span>Manages {branchName.get(p.branchId ?? '') ?? 'a branch'}</span>
                            ) : p.courseDesign ? (
                              <span>Course Design · {p.courseDesign.responsibilities.length} responsibilit{p.courseDesign.responsibilities.length === 1 ? 'y' : 'ies'} · {hasOrgWideScope(p) ? 'every course' : `${p.courseDesign.assignedCourseIds.length} course${p.courseDesign.assignedCourseIds.length === 1 ? '' : 's'}`}</span>
                            ) : isContent(p.role) ? (
                              <span className="italic">No Course Design membership yet</span>
                            ) : (
                              <span className="italic">Not in a batch yet</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-3 md:w-[24%] md:justify-end">
                            <StatusPill tone={look.tone} icon={look.icon} size="sm">{look.label}</StatusPill>
                            {tenant?.role === 'super_admin' && user && p.id !== user.uid && isEligibleForCourseDesign(p.role) && p.status === 'active' && (
                              <button type="button" onClick={() => setMembershipFor(p)} className={buttonClasses('secondary', 'sm')}>Course Design</button>
                            )}
                            {profile && user && canCorrectAccount({ ...profile, id: user.uid }, p) && (
                              <button type="button" onClick={() => setEditingAccount(p)} className={buttonClasses('ghost', 'sm')}>Edit</button>
                            )}
                            {action && (
                              <button type="button" disabled={busy === p.id} onClick={() => runAction(p, action)}
                                className={buttonClasses(action === 'suspend' ? 'danger' : action === 'approve' ? 'primary' : 'secondary', 'sm')}>
                                {ACTION_LOOK[action].label}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {(hasMore || (needle && people.length > 0)) && (
                  <div className="flex flex-col items-center gap-2 border-t border-line p-3 text-xs text-ink-3">
                    {needle && hasMore && <span>Searching the people loaded so far. Type a full email address to search everyone.</span>}
                    {hasMore && (
                      <button type="button" onClick={loadMore} disabled={loadingMore} className={buttonClasses('secondary', 'sm')}>
                        {loadingMore ? 'Loading…' : 'Load more people'}
                      </button>
                    )}
                  </div>
                )}
              </Card>
              <p className="text-xs text-ink-3">
                New students and instructors are created inside a batch, so they’re enrolled or assigned straight away. Accounts are suspended, never deleted, so history is kept.
              </p>
            </>
          )}
        </div>
        {dialog}
        {editingAccount && tenant && (
          <AccountEditDialog person={editingAccount} viewerRole={tenant.role} branches={branches}
            onClose={() => setEditingAccount(null)}
            onSaved={(text) => { setEditingAccount(null); setNotice({ kind: 'success', text }); setLoading(true); setReloadKey((k) => k + 1); }} />
        )}
        {membershipFor && (
          <CourseDesignMembershipDialog
            person={membershipFor}
            onClose={() => setMembershipFor(null)}
            onSaved={(courseDesign) => {
              setPeople((list) => list.map((x) => (x.id === membershipFor.id ? { ...x, courseDesign } : x)));
              setNotice({ kind: 'success', text: courseDesign ? `Course Design membership saved for ${membershipFor.displayName}.` : `Course Design membership removed from ${membershipFor.displayName}.` });
              setMembershipFor(null);
            }}
          />
        )}
        {showContentForm && tenant && (
          <ContentMemberDialog
            orgId={tenant.orgId}
            onClose={() => setShowContentForm(false)}
            onCreated={(person) => setPeople((list) => [...list, person].sort((a, b) => a.displayName.localeCompare(b.displayName)))}
          />
        )}
      </RequireRole>
    </AppShell>
  );
}

'use client';

/**
 * Strynkix LMS — Global people directory (Super Admin): search every academy by
 * name, email, mobile, user ID or student ID; filter by academy, branch, role,
 * status, course and batch. Profiles open the existing person page, where
 * audited account actions live.
 */

import React, { Suspense, use, useState } from 'react';
import Link from 'next/link';
import { AppShell, ROLE_LABELS } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { commandApi } from '@/lib/academy/api';
import { usePaged } from '@/lib/hooks/usePaged';
import type { UserRole } from '@/types/domain';
import { CommandNav } from '@/components/command/CommandNav';
import { useCommandFilters } from '@/components/command/Shared';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';

interface Row { id: string; displayName: string; email: string; role: UserRole; status: string; academy: string; branch: string | null; studentId: string | null }
const ROLES: UserRole[] = ['university_admin', 'branch_admin', 'instructor', 'content_lead', 'content_designer', 'student', 'super_admin'];

function People({ initial }: { initial: { orgId?: string; branchId?: string; role?: string } }) {
  const f = useCommandFilters({ orgId: initial.orgId, branchId: initial.branchId });
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState(initial.role && ROLES.includes(initial.role as UserRole) ? initial.role : '');
  const [status, setStatus] = useState('');
  const [courseId, setCourseId] = useState('');
  const [batchId, setBatchId] = useState('');
  const params = JSON.parse(JSON.stringify({ q: q || undefined, orgId: f.orgId || undefined, branchId: f.orgId && f.branchId ? f.branchId : undefined, role: role || undefined, status: status || undefined, courseId: courseId || undefined, batchId: batchId || undefined }));
  const p = usePaged<Row>(JSON.stringify(params), async (cursor) => {
    const r = await commandApi<{ people: Row[]; cursor: string | null }>({ action: 'people', ...params, ...(cursor ? { cursor } : {}) });
    return { rows: r.people, cursor: r.cursor };
  });
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: 'Command Centre', href: '/dashboard/command' }, { label: 'People' }]} title="People" description="Everyone across every academy. Search finds a name by its start, or an exact email, mobile number, user ID or student ID." />
      <CommandNav />
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); }}>
        <Field label="Search" htmlFor="pp-q"><input id="pp-q" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Name, email, mobile, user ID, student ID" className={`${fieldClasses} min-w-[280px]`} /></Field>
        <Button type="submit">Search</Button>
        {q && <Button variant="ghost" onClick={() => { setDraft(''); setQ(''); }}>Clear</Button>}
      </form>
      <div className="flex flex-wrap items-end gap-3">
        {f.controls({ dates: false })}
        <Field label="Role" htmlFor="pp-role"><select id="pp-role" value={role} onChange={(e) => setRole(e.target.value)} className={fieldClasses}><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
        <Field label="Status" htmlFor="pp-st"><select id="pp-st" value={status} onChange={(e) => setStatus(e.target.value)} className={fieldClasses}><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="pending_verification">Awaiting approval</option><option value="invited">Invited</option></select></Field>
        <Field label="Course ID" htmlFor="pp-course"><input id="pp-course" value={courseId} onChange={(e) => setCourseId(e.target.value.trim())} className={`${fieldClasses} w-36`} /></Field>
        <Field label="Batch ID" htmlFor="pp-batch"><input id="pp-batch" value={batchId} onChange={(e) => setBatchId(e.target.value.trim())} className={`${fieldClasses} w-36`} /></Field>
      </div>
      {p.error ? <ErrorState onRetry={p.reload}>{p.error}</ErrorState> : p.loading && !p.rows.length ? <LoadingState label="Searching…" /> : !p.rows.length ? <EmptyState title="Nobody found">No account matches. Try fewer filters, or search by full email.</EmptyState> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-line">{['Name', 'Role', 'Academy', 'Branch', 'Status'].map((h) => <th key={h} className="p-2.5 text-left text-xs font-semibold text-ink-3">{h}</th>)}</tr></thead>
            <tbody>{p.rows.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                <td className="p-2.5"><Link href={`/dashboard/people/${u.id}`} className="font-semibold text-brand-ink hover:underline">{u.displayName || 'Unnamed'}</Link><div className="text-xs text-ink-3">{u.email}{u.studentId ? ` · ${u.studentId}` : ''} · {u.id}</div></td>
                <td className="p-2.5">{ROLE_LABELS[u.role]}</td><td className="p-2.5">{u.academy}</td><td className="p-2.5">{u.branch ?? '—'}</td>
                <td className="p-2.5"><StatusPill size="sm" tone={u.status === 'active' ? 'success' : 'warning'}>{u.status}</StatusPill></td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
      {p.cursor && <Button variant="secondary" loading={p.loading} onClick={p.more}>Load more</Button>}
      <p className="text-xs text-ink-3">Lists are ordered by account ID so every account appears exactly once across pages.</p>
    </div>
  );
}

function Content({ searchParams }: { searchParams: Promise<{ orgId?: string; branchId?: string; role?: string }> }) {
  const sp = use(searchParams);
  return <RequireRole allowedRoles={['super_admin']}><AppShell><People initial={sp} /></AppShell></RequireRole>;
}

export default function GlobalPeoplePage(props: Parameters<typeof Content>[0]) {
  return <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}><Content {...props} /></Suspense>;
}

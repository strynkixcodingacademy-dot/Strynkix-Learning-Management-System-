'use client';

/** Strynkix LMS — Academy and branch listings for the Command Centre (search, filter, sort, pages). */

import React, { useState } from 'react';
import Link from 'next/link';
import { commandApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatDate, formatMoney } from '@/lib/academy/format';
import { CommandNav } from './CommandNav';
import type { Stats } from './Shared';
import { useCommandFilters } from './Shared';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';

const th = 'p-2.5 text-left text-xs font-semibold text-ink-3';
const td = 'p-2.5';

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-ink-3">
      <span>{total} in total · page {page + 1} of {pages}</span>
      <span className="flex gap-2"><Button size="sm" variant="ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button><Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</Button></span>
    </div>
  );
}

interface AcademyRow { id: string; name: string; status: string; createdAt: string | null; stats: Stats }
export function AcademyListing() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('created_desc');
  const [page, setPage] = useState(0);
  const params = { q: q.trim() || undefined, status: status || undefined, sort, page };
  const { data, error, reload } = useApiData(JSON.stringify(params), () => commandApi<{ total: number; pageSize: number; academies: AcademyRow[] }>({ action: 'academies', ...JSON.parse(JSON.stringify(params)) }));
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: 'Command Centre', href: '/dashboard/command' }, { label: 'Academies' }]} title="Academies" description="Every academy with its people, admissions and money. Open one for its 360° view." />
      <CommandNav />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" htmlFor="a-q"><input id="a-q" value={q} placeholder="Name or ID" onChange={(e) => { setQ(e.target.value); setPage(0); }} className={fieldClasses} /></Field>
        <Field label="Status" htmlFor="a-st"><select id="a-st" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className={fieldClasses}><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option></select></Field>
        <Field label="Sort" htmlFor="a-sort"><select id="a-sort" value={sort} onChange={(e) => setSort(e.target.value)} className={fieldClasses}><option value="created_desc">Newest first</option><option value="created_asc">Oldest first</option><option value="name">Name</option></select></Field>
      </div>
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Loading academies…" /> : !data.academies.length ? <EmptyState title="No academies">Nothing matches these filters.</EmptyState> : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead><tr className="border-b border-line">{['Academy', 'Status', 'Branches', 'Students', 'Instructors', 'Courses', 'Admissions', 'Collected', 'Outstanding', 'Created'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{data.academies.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className={td}><Link href={`/dashboard/command/academies/${a.id}`} className="font-semibold text-brand-ink hover:underline">{a.name}</Link><div className="text-xs text-ink-3">{a.id}</div></td>
                  <td className={td}><StatusPill size="sm" tone={a.status === 'active' ? 'success' : 'warning'}>{a.status}</StatusPill></td>
                  <td className={td}>{a.stats.branches}</td><td className={td}>{a.stats.students}</td><td className={td}>{a.stats.instructors}</td><td className={td}>{a.stats.courses}</td><td className={td}>{a.stats.admissions}</td>
                  <td className={`${td} tabular-nums`}>{formatMoney(a.stats.collected)}</td><td className={`${td} tabular-nums`}>{formatMoney(a.stats.outstanding)}</td><td className={td}>{formatDate(a.createdAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </Card>
          <Pager page={page} total={data.total} size={data.pageSize} onPage={setPage} />
        </>
      )}
    </div>
  );
}

interface BranchRow { id: string; name: string; code: string; status: string; orgId: string; academy: string; managers: { id: string; name: string }[]; stats: Stats }
export function BranchListing({ initialOrgId }: { initialOrgId?: string }) {
  const f = useCommandFilters({ orgId: initialOrgId });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const params = { orgId: f.orgId || undefined, q: q.trim() || undefined, status: status || undefined, page };
  const { data, error, reload } = useApiData(JSON.stringify(params), () => commandApi<{ total: number; pageSize: number; branches: BranchRow[] }>({ action: 'branches', ...JSON.parse(JSON.stringify(params)) }));
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: 'Command Centre', href: '/dashboard/command' }, { label: 'Branches' }]} title="Branches" description="Every branch with its manager, people, admissions and money. Open one for its 360° view." />
      <CommandNav />
      <div className="flex flex-wrap items-end gap-3">
        {f.controls({ dates: false })}
        <Field label="Search" htmlFor="b-q"><input id="b-q" value={q} placeholder="Name, code or ID" onChange={(e) => { setQ(e.target.value); setPage(0); }} className={fieldClasses} /></Field>
        <Field label="Status" htmlFor="b-st"><select id="b-st" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className={fieldClasses}><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
      </div>
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Loading branches…" /> : !data.branches.length ? <EmptyState title="No branches">Nothing matches these filters.</EmptyState> : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead><tr className="border-b border-line">{['Branch', 'Academy', 'Manager', 'Status', 'Students', 'Instructors', 'Batches', 'Admissions', 'Collected', 'Outstanding', 'Expenses'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{data.branches.map((b) => (
                <tr key={b.id} className="border-b border-line last:border-0">
                  <td className={td}><Link href={`/dashboard/command/branches/${b.id}`} className="font-semibold text-brand-ink hover:underline">{b.name}</Link><div className="text-xs text-ink-3">{b.code}</div></td>
                  <td className={td}><Link href={`/dashboard/command/academies/${b.orgId}`} className="hover:underline">{b.academy}</Link></td>
                  <td className={td}>{b.managers.map((m) => m.name).join(', ') || <span className="text-ink-3">Not assigned</span>}</td>
                  <td className={td}><StatusPill size="sm" tone={b.status === 'active' ? 'success' : 'neutral'}>{b.status}</StatusPill></td>
                  <td className={td}>{b.stats.students}</td><td className={td}>{b.stats.instructors}</td><td className={td}>{b.stats.batches}</td><td className={td}>{b.stats.admissions}</td>
                  <td className={`${td} tabular-nums`}>{formatMoney(b.stats.collected)}</td><td className={`${td} tabular-nums`}>{formatMoney(b.stats.outstanding)}</td><td className={`${td} tabular-nums`}>{formatMoney(b.stats.expenses)}</td>
                </tr>
              ))}</tbody>
            </table>
          </Card>
          <Pager page={page} total={data.total} size={data.pageSize} onPage={setPage} />
        </>
      )}
    </div>
  );
}

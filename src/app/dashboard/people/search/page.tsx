'use client';

/** Strynkix LMS — find a person by name, email, mobile number or student ID (admission number), within your scope. */

import React, { useState } from 'react';
import Link from 'next/link';
import { AppShell, ROLE_LABELS } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { admissionsApi } from '@/lib/academy/api';
import type { UserRole } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, Notice } from '@/components/ui/States';

interface Hit { id: string; displayName: string; email: string; role: UserRole; status: string; studentId: string | null }

function Search() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: 'People', href: '/dashboard/people' }, { label: 'Find' }]} title="Find a person" description="Search by the start of a name, a full email, a mobile number exactly as recorded, or a student ID." />
      <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try { setHits((await admissionsApi<{ people: Hit[] }>({ action: 'search', q })).people); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, mobile or student ID" className={`${fieldClasses} max-w-md`} />
        <Button type="submit" loading={busy} disabled={q.trim().length < 2}>Search</Button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
      {hits && (hits.length === 0 ? <EmptyState title="No matches">Nobody in your scope matches “{q}”.</EmptyState> : (
        <ul className="space-y-2">{hits.map((h) => (
          <li key={h.id}><Link href={`/dashboard/people/${h.id}`}><Card interactive className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1"><div className="font-semibold text-ink">{h.displayName}</div><div className="text-xs text-ink-3">{h.email}{h.studentId ? ` · ${h.studentId}` : ''}</div></div>
            <span className="text-xs font-semibold text-ink-2">{ROLE_LABELS[h.role]}</span>
          </Card></Link></li>
        ))}</ul>
      ))}
    </div>
  );
}

export default function PeopleSearchPage() {
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><AppShell><Search /></AppShell></RequireRole>;
}

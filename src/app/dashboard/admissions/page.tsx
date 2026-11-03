'use client';

/** Strynkix LMS — Admissions: drafts to finish, confirmed admissions, and the start of a new one. */

import React, { useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { admissionsApi, reportsApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { downloadCsv } from '@/lib/export/csv';
import { formatDate } from '@/lib/academy/format';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs } from '@/components/ui/Tabs';
import { UserPlus } from 'lucide-react';

interface Row { id: string; status: 'draft' | 'confirmed' | 'cancelled'; admissionNumber: string | null; name: string; email: string; mobile: string; confirmedAt: string | null; updatedAt: string; studentId: string | null; feeAccountId: string | null }

function Admissions() {
  const [tab, setTab] = useState<'confirmed' | 'draft'>('confirmed');
  const { data, error, reload } = useApiData(tab, () => admissionsApi<{ admissions: Row[] }>({ action: 'list', status: tab }));
  const [exporting, setExporting] = useState(false);
  return (
    <div className="space-y-6">
      <PageHeader title="Admissions" description="Admit a student in five guided steps. Drafts are saved as you go."
        actions={<>
          <Button variant="secondary" loading={exporting} onClick={async () => {
            setExporting(true);
            try {
              const r = await reportsApi<{ rows: Record<string, string>[] }>({ action: 'export', dataset: 'admissions' });
              downloadCsv('admissions.csv', r.rows, ['orgId', 'branch', 'admissionNumber', 'status', 'name', 'email', 'mobile', 'city', 'course', 'confirmedAt'].map((k) => ({ header: k, value: (x: Record<string, string>) => x[k] })));
            } finally { setExporting(false); }
          }}>Export CSV</Button>
          <Link href="/dashboard/admissions/new" className={buttonClasses('primary')}><UserPlus className="h-4 w-4" /> New admission</Link>
        </>} />
      <Tabs idPrefix="adm" label="Admissions" value={tab} onChange={setTab} items={[{ id: 'confirmed', label: 'Confirmed' }, { id: 'draft', label: 'Incomplete drafts' }]} />
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Loading admissions…" /> : data.admissions.length === 0 ? (
        <EmptyState title={tab === 'draft' ? 'No drafts' : 'No admissions yet'}>{tab === 'draft' ? 'Admissions you start and don’t finish appear here.' : 'Start with “New admission”.'}</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Student</th><th className="p-3">Admission no.</th><th className="p-3">Contact</th><th className="p-3">{tab === 'draft' ? 'Last saved' : 'Confirmed'}</th><th className="p-3" /></tr></thead>
            <tbody>{data.admissions.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="p-3 font-semibold text-ink">{a.name || 'Unnamed draft'}</td>
                <td className="p-3">{a.admissionNumber ?? <StatusPill size="sm" tone="warning">Draft</StatusPill>}</td>
                <td className="p-3 text-ink-2">{a.email}<div className="text-xs text-ink-3">{a.mobile}</div></td>
                <td className="p-3">{formatDate(a.confirmedAt ?? a.updatedAt)}</td>
                <td className="p-3 text-right"><Link href={`/dashboard/admissions/${a.id}`} className={buttonClasses(tab === 'draft' ? 'primary' : 'ghost', 'sm')}>{tab === 'draft' ? 'Continue' : 'Open'}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export default function AdmissionsPage() {
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><AppShell><Admissions /></AppShell></RequireRole>;
}

'use client';

/**
 * Strynkix LMS — Academic intelligence (Super Admin): course performance,
 * students who may need attention, instructor activity and assessment
 * monitoring for an academy, optionally narrowed to a branch and course.
 */

import React, { Suspense, use, useState } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { commandApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { CommandNav } from '@/components/command/CommandNav';
import { IntelView, type Intel } from '@/components/command/Entity360';
import { useCommandFilters } from '@/components/command/Shared';
import { Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { ErrorState, LoadingState, Notice } from '@/components/ui/States';

function Academics({ initialOrgId, initialBranchId }: { initialOrgId?: string; initialBranchId?: string }) {
  const f = useCommandFilters({ orgId: initialOrgId, branchId: initialBranchId });
  const [courseId, setCourseId] = useState('');
  const key = f.orgId ? `${f.orgId}|${f.branchId}|${courseId}` : null;
  const { data, error, reload } = useApiData(key, () => commandApi<Intel>({ action: 'academic_intel', orgId: f.orgId, ...(f.branchId ? { branchId: f.branchId } : {}), ...(courseId ? { courseId } : {}) }));
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: 'Command Centre', href: '/dashboard/command' }, { label: 'Academics' }]} title="Academic intelligence" description="How courses, learners, instructors and assessments are doing. Indicators are prompts to follow up, never labels." />
      <CommandNav />
      <div className="flex flex-wrap items-end gap-3">
        {f.controls({ dates: false })}
        {data && <Field label="Course" htmlFor="ai-course"><select id="ai-course" value={courseId} onChange={(e) => setCourseId(e.target.value)} className={fieldClasses}><option value="">All courses</option>{data.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>}
      </div>
      {!f.orgId ? <Notice kind="info">Choose an academy to analyse. Academic monitoring reads each learner’s records, so it runs one academy at a time.</Notice>
        : error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Analysing academic records…" rows={5} /> : <IntelView data={data} />}
    </div>
  );
}

function Content({ searchParams }: { searchParams: Promise<{ orgId?: string; branchId?: string }> }) {
  const sp = use(searchParams);
  return <RequireRole allowedRoles={['super_admin']}><AppShell><Academics initialOrgId={sp.orgId} initialBranchId={sp.branchId} /></AppShell></RequireRole>;
}

export default function AcademicsPage(props: Parameters<typeof Content>[0]) {
  return <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}><Content {...props} /></Suspense>;
}

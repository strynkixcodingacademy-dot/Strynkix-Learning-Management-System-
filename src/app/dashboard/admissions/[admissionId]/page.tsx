'use client';

import React, { Suspense, use } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { AdmissionLoader } from '@/components/admissions/AdmissionWizard';
import { PageHeader } from '@/components/ui/Page';

function AdmissionPageContent({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}>
      <AppShell>
        <div className="space-y-6">
          <PageHeader breadcrumbs={[{ label: 'Admissions', href: '/dashboard/admissions' }, { label: 'Admission' }]} title="Admission" />
          <AdmissionLoader admissionId={admissionId} />
        </div>
      </AppShell>
    </RequireRole>
  );
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function AdmissionPage(props: Parameters<typeof AdmissionPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <AdmissionPageContent {...props} />
    </Suspense>
  );
}

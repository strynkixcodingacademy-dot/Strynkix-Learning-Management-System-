'use client';

import React from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { AdmissionWizard } from '@/components/admissions/AdmissionWizard';
import { PageHeader } from '@/components/ui/Page';

export default function NewAdmissionPage() {
  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}>
      <AppShell>
        <div className="space-y-6">
          <PageHeader breadcrumbs={[{ label: 'Admissions', href: '/dashboard/admissions' }, { label: 'New admission' }]} title="New admission" description="Fill in each step. Nothing is final until you confirm on the last step." />
          <AdmissionWizard />
        </div>
      </AppShell>
    </RequireRole>
  );
}

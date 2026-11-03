'use client';

import React, { Suspense, use } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { BranchListing } from '@/components/command/Listings';

function Content({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = use(searchParams);
  return <RequireRole allowedRoles={['super_admin']}><AppShell><BranchListing initialOrgId={orgId} /></AppShell></RequireRole>;
}

export default function BranchesPage(props: Parameters<typeof Content>[0]) {
  return <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}><Content {...props} /></Suspense>;
}

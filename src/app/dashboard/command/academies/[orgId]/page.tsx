'use client';

import React, { Suspense, use } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { Entity360 } from '@/components/command/Entity360';

function Content({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { orgId } = use(params);
  const { tab } = use(searchParams);
  return <RequireRole allowedRoles={['super_admin']}><AppShell><Entity360 kind="academy" id={orgId} initialTab={tab} /></AppShell></RequireRole>;
}

export default function AcademyPage(props: Parameters<typeof Content>[0]) {
  return <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}><Content {...props} /></Suspense>;
}

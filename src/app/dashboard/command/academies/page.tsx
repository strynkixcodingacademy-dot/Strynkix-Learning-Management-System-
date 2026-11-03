'use client';

import React from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { AcademyListing } from '@/components/command/Listings';

export default function AcademiesPage() {
  return <RequireRole allowedRoles={['super_admin']}><AppShell><AcademyListing /></AppShell></RequireRole>;
}

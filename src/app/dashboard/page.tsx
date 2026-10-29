'use client';

/**
 * Strynkix Live Books — Home.
 * Students get their learning home (My Day, progress, courses); staff get
 * "Today across your batches".
 */

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { StudentDashboard } from '@/components/learning/StudentDashboard';
import { StaffHome } from '@/components/learning/StaffHome';

export default function DashboardPage() {
  const { tenant } = useAuth();
  return (
    <AppShell fit>
      {tenant?.role === 'student' ? <StudentDashboard /> : tenant ? <StaffHome /> : null}
    </AppShell>
  );
}

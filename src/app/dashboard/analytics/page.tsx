'use client';

/**
 * Strynkix Live Books — Analytics.
 * Staff: learning, submissions, marks, review backlog and students needing
 * attention across every batch in scope. Students: their own progress.
 * Every figure states its definition; nothing is estimated or invented.
 */

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { StaffAnalytics } from '@/components/analytics/StaffAnalytics';
import { StudentAnalytics } from '@/components/analytics/StudentAnalytics';

export default function AnalyticsPage() {
  const { tenant } = useAuth();
  return (
    <AppShell>
      {tenant?.role === 'student' ? <StudentAnalytics /> : tenant ? <StaffAnalytics /> : null}
    </AppShell>
  );
}

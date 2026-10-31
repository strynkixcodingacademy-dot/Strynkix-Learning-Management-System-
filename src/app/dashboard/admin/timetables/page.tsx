'use client';

/**
 * Strynkix LMS — Super Admin Timetable Approval Hub
 * Central administrative dashboard for reviewing and acting on pending weekly
 * timetables submitted by Branch Managers across all franchise branches.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { getPendingTimetables } from '@/lib/learning/timetable-service';
import { getBatchById } from '@/lib/batches/service';
import { formatWeekRange, getSundayOfWeek } from '@/lib/learning/timetable';
import { Batch, WeeklyTimetable } from '@/types/domain';
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle,
  Clock,
  Loader2,
  ShieldCheck,
} from 'lucide-react';

interface PendingRow {
  timetable: WeeklyTimetable;
  batch: Batch | null;
}

function TimetableApprovalHub() {
  const { tenant } = useAuth();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!tenant) return;
      setIsLoading(true);
      setError(null);
      try {
        const pending = await getPendingTimetables(tenant.orgId);
        const resolved = await Promise.all(
          pending.map(async (tt) => {
            const b = await getBatchById(tt.batchId);
            return { timetable: tt, batch: b };
          })
        );
        if (!isMounted) return;
        setRows(resolved);
      } catch (err) {
        console.error('Failed to load pending timetables', err);
        if (isMounted) setError('Could not load pending timetables.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [tenant]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-ink tracking-tight flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-brand-ink" />
          Super Admin Timetable Approvals
        </h1>
        <p className="text-xs text-ink-3 mt-1">
          Review, approve, or request corrections for cohort weekly timetables submitted by Branch Managers.
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-xs text-ink-3">
          <Loader2 className="w-8 h-8 animate-spin text-brand-ink mb-2" />
          Loading pending submissions...
        </div>
      ) : error ? (
        <div className="p-5 rounded-2xl bg-danger-soft border border-danger-line text-xs text-danger-ink">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-surface border border-line space-y-2">
          <CheckCircle className="w-10 h-10 text-success-ink mx-auto" />
          <h3 className="text-sm font-bold text-ink">All Timetables Approved</h3>
          <p className="text-xs text-ink-3 max-w-sm mx-auto">
            There are currently no weekly timetables awaiting Super Admin review. When Branch Managers submit a week, it will appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-card divide-y divide-line">
          {rows.map(({ timetable, batch }) => {
            const weekEnd = getSundayOfWeek(timetable.weekStartDate);

            return (
              <div
                key={timetable.id}
                className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-surface-muted transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs font-mono font-bold text-brand-ink">
                    <Clock className="w-3.5 h-3.5" />
                    {formatWeekRange(timetable.weekStartDate, weekEnd)}
                  </div>
                  <h3 className="text-base font-bold text-ink truncate">
                    Cohort: {batch?.name || timetable.batchId} ({batch?.code || '—'})
                  </h3>
                  <div className="text-xs text-ink-3 flex items-center gap-3">
                    <span>Branch: <strong className="text-ink-2">{timetable.branchId}</strong></span>
                    <span>·</span>
                    <span>Revision: <strong>{timetable.currentRevisionId}</strong></span>
                  </div>
                </div>

                <Link
                  href={`/dashboard/batches/${timetable.batchId}/timetable`}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold transition-colors self-start sm:self-auto shrink-0"
                >
                  Review Timetable <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminTimetablesPage() {
  return (
    <AppShell>
      <RequireRole allowedRoles={['super_admin']}>
        <TimetableApprovalHub />
      </RequireRole>
    </AppShell>
  );
}

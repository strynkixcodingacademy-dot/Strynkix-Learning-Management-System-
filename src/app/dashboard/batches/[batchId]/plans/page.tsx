'use client';

/**
 * Strynkix Live Books — Daily Plans for a batch (instructor / admin)
 * Lists the batch's plans and creates a new draft plan for a chosen date.
 */

import React, { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { getBatchById } from '@/lib/batches/service';
import { isBatchOpenForEnrollment } from '@/lib/batches/scope';
import { canTeachBatch, getBatchPlans, savePlan } from '@/lib/learning/service';
import { toLocalDateKey } from '@/lib/learning/metrics';
import { formatPlanDate } from '@/components/learning/LearningBits';
import { Batch, DailyPlan } from '@/types/domain';
import { AlertCircle, ArrowLeft, ArrowRight, CalendarPlus, ClipboardList, Loader2 } from 'lucide-react';

interface PlansPageProps {
  params: Promise<{ batchId: string }>;
}

const STATUS_STYLES: Record<DailyPlan['status'], string> = {
  draft: 'bg-surface-muted text-ink-2 border-line',
  published: 'bg-success-soft text-success-ink border-success-line',
  archived: 'bg-surface text-ink-3 border-line',
};

function PlansView({ batchId }: { batchId: string }) {
  const { user, tenant } = useAuth();
  const router = useRouter();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [plans, setPlans] = useState<DailyPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(() => toLocalDateKey(new Date()));
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!tenant || !user) return;
      setIsLoading(true);
      setError(null);
      try {
        const loaded = await getBatchById(batchId);
        if (!loaded) throw new Error('not found');
        const loadedPlans = await getBatchPlans(loaded);
        if (!isMounted) return;
        setBatch(loaded);
        setPlans(loadedPlans);
      } catch (err) {
        console.error('Failed to load plans', err);
        if (isMounted) setError('This batch was not found or you are not assigned to it.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [batchId, tenant, user]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batch || !user) return;
    setFormError(null);
    setIsCreating(true);
    try {
      // Lessons are due at 23:59 local time on the plan date by default; editable next.
      const [y, m, d] = date.split('-').map(Number);
      const dueAt = new Date(y, m - 1, d, 23, 59).toISOString();
      const plan = await savePlan(batch, {
        date,
        title: `Day plan — ${formatPlanDate(date)}`,
        objectives: [],
        lessonIds: [],
        learningDueAt: dueAt,
      }, tenant, user.uid, null);
      router.push(`/dashboard/batches/${batch.id}/plans/${plan.id}`);
    } catch (err) {
      setFormError((err as Error).message || 'Could not create the plan.');
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3" role="status">
        <Loader2 className="w-7 h-7 text-brand-ink animate-spin" />
        <span className="text-xs text-ink-3">Loading daily plans...</span>
      </div>
    );
  }

  if (error || !batch) {
    return (
      <div className="max-w-md mx-auto p-6 rounded-2xl bg-surface border border-line text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-danger-ink mx-auto" />
        <p className="text-sm text-ink-2">{error}</p>
        <Link href="/dashboard/batches" className="text-xs text-brand-ink font-semibold">Back to batches</Link>
      </div>
    );
  }

  const canEdit = user ? canTeachBatch(tenant, user.uid, batch) && isBatchOpenForEnrollment(batch.status) : false;

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl border border-brand/30 bg-brand-soft/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <span className="text-ink">
          <strong>Weekly Timetable System:</strong> Plan complete Monday–Sunday schedules with multi-activity streams, lessons, assessments, and Super Admin approval.
        </span>
        <Link
          href={`/dashboard/batches/${batch.id}/timetable`}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-brand hover:bg-brand-strong text-white font-semibold whitespace-nowrap shadow-sm self-start sm:self-auto"
        >
          Open Weekly Timetable <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <Link href={`/dashboard/batches/${batch.id}`} className="inline-flex items-center gap-2 text-xs text-ink-3 hover:text-ink">
        <ArrowLeft className="w-4 h-4" /> {batch.name}
      </Link>

      {canEdit ? (
        <form onSubmit={handleCreate} className="p-5 rounded-2xl bg-surface border border-line flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="space-y-1 flex-1">
            <label htmlFor="planDate" className="text-xs font-semibold text-ink-2">Plan a day</label>
            <input id="planDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
          </div>
          <button type="submit" disabled={isCreating}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold">
            {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />}
            Create draft plan
          </button>
          {formError && <p className="text-xs text-danger-ink sm:basis-full" role="alert">{formError}</p>}
        </form>
      ) : (
        <p className="text-xs text-ink-3">This batch is {batch.status.replace('_', ' ')} or outside your teaching scope; plans are read-only.</p>
      )}

      {plans.length === 0 ? (
        <div className="p-10 text-center rounded-2xl bg-surface border border-line text-sm text-ink-3">
          No daily plans yet. Pick a date above to plan the first day.
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface overflow-hidden">
          {plans.map((p) => (
            <li key={p.id}>
              <Link href={`/dashboard/batches/${batch.id}/plans/${p.id}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 hover:bg-surface-muted">
                <div className="min-w-0">
                  <div className="text-[11px] text-brand-ink">{formatPlanDate(p.date)}</div>
                  <div className="text-sm font-semibold text-ink truncate">{p.title}</div>
                  <div className="text-[11px] text-ink-3 flex items-center gap-2">
                    {p.lessonIds.length} lesson{p.lessonIds.length === 1 ? '' : 's'}
                    {p.assignmentId && <span className="inline-flex items-center gap-1"><ClipboardList className="w-3 h-3" /> assignment</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full border ${STATUS_STYLES[p.status]}`}>{p.status}</span>
                  <ArrowRight className="w-4 h-4 text-ink-3" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlansContent({ params }: PlansPageProps) {
  const { batchId } = use(params);
  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor']}>
      <AppShell pageTitle="Daily Plans">
        <PlansView batchId={batchId} />
      </AppShell>
    </RequireRole>
  );
}

export default function PlansPage({ params }: PlansPageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <PlansContent params={params} />
    </Suspense>
  );
}

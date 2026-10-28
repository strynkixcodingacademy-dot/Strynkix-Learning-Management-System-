'use client';

/**
 * Strynkix LMS — Batch Management & Instructor Batch List
 * Administrators create, edit, and archive batches within their scope.
 * Instructors see only the batches they are assigned to (read-only).
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { BatchFormModal } from '@/components/batches/BatchFormModal';
import { BatchStatusBadge } from '@/components/batches/StatusBadges';
import { getBranches } from '@/lib/admin/service';
import { getAdminCourses } from '@/lib/courses/service';
import { getBatchesForTenant, setBatchStatus } from '@/lib/batches/service';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { isBatchManagerRole } from '@/lib/batches/scope';
import { Batch, Branch, Course } from '@/types/domain';
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Users,
} from 'lucide-react';

type StatusFilter = 'current' | 'archived' | 'all';

function formatDate(iso?: string): string {
  return iso ? iso.slice(0, 10) : '—';
}

export default function BatchesPage() {
  const { user, tenant } = useAuth();
  const isManager = isBatchManagerRole(tenant?.role);
  const { confirm, dialog } = useConfirm();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('current');
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (!tenant || !user) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const isSuper = tenant.role === 'super_admin';
        const [loadedBatches, loadedBranches, loadedCourses] = await Promise.all([
          getBatchesForTenant(tenant, user.uid),
          getBranches(isSuper ? undefined : tenant.orgId),
          getAdminCourses(isSuper ? undefined : tenant.orgId),
        ]);
        if (!isMounted) return;
        setBatches(loadedBatches);
        setBranches(loadedBranches);
        setCourses(loadedCourses);
      } catch (err) {
        console.error('Failed to load batches', err);
        if (isMounted) setError('Unable to load batches. Please verify your permissions and network connection.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [tenant, user, reloadKey]);

  // Branch admins may only create batches for their own branch.
  const creatableBranches = branches.filter(
    (b) => b.status === 'active' && (tenant?.role !== 'branch_admin' || b.id === tenant.branchId)
  );

  const courseTitle = (courseId: string) => courses.find((c) => c.id === courseId)?.title || courseId;
  const branchName = (branchId: string) => branches.find((b) => b.id === branchId)?.name || branchId;

  const visibleBatches = batches.filter((b) =>
    statusFilter === 'all' ? true : statusFilter === 'archived' ? b.status === 'archived' : b.status !== 'archived'
  );

  const handleArchiveToggle = async (batch: Batch) => {
    const archiving = batch.status !== 'archived';
    if (archiving) {
      const ok = await confirm({
        title: `Archive "${batch.name}"?`,
        body: 'Archived batches stop accepting enrollments and become read-only for students.',
        confirmLabel: 'Archive Batch',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusyBatchId(batch.id);
    setError(null);
    setSuccessMsg(null);
    try {
      await setBatchStatus(batch, archiving ? 'archived' : 'upcoming', tenant);
      setSuccessMsg(archiving ? `Batch "${batch.name}" archived.` : `Batch "${batch.name}" restored as upcoming.`);
      reload();
    } catch (err) {
      setError((err as Error).message || 'Failed to update batch status.');
    } finally {
      setBusyBatchId(null);
    }
  };

  const handleSaved = (message: string) => {
    setShowCreate(false);
    setEditingBatch(null);
    setSuccessMsg(message);
    reload();
  };

  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor']}>
      <AppShell pageTitle={isManager ? 'Batches & Enrollment' : 'My Batches'}>
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-line">
            <p className="text-xs text-ink-3">
              {isManager
                ? 'Create cohorts for a course, assign instructors, and manage student enrollment.'
                : 'Cohorts you are assigned to teach, with rosters and learning progress.'}
            </p>
            <div className="flex items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="px-2.5 py-1.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                aria-label="Filter batches by status"
              >
                <option value="current">Current</option>
                <option value="archived">Archived</option>
                <option value="all">All</option>
              </select>
              {isManager && (
                <button
                  type="button"
                  onClick={() => {
                    setSuccessMsg(null);
                    setShowCreate(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold shadow-card transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Batch</span>
                </button>
              )}
            </div>
          </div>

          {successMsg && (
            <div className="p-4 rounded-xl bg-success-soft border border-success-line flex items-center gap-2.5 text-success-ink text-xs">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-success-ink" />
              <span>{successMsg}</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-danger-soft border border-danger-line flex items-center justify-between gap-2.5 text-danger-ink text-xs">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink" />
                <span>{error}</span>
              </div>
              <button onClick={reload} className="font-semibold text-danger-ink hover:text-ink shrink-0">
                Retry
              </button>
            </div>
          )}

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="w-7 h-7 text-brand-ink animate-spin" />
              <span className="text-xs text-ink-3 font-mono">Loading batches...</span>
            </div>
          )}

          {!isLoading && !error && visibleBatches.length === 0 && (
            <div className="p-12 text-center rounded-2xl bg-surface border border-line space-y-3">
              <Layers className="w-10 h-10 text-ink-4 mx-auto" />
              <h3 className="text-sm font-semibold text-ink-2">
                {batches.length > 0 ? 'No batches match this filter' : isManager ? 'No Batches Yet' : 'No Assigned Batches'}
              </h3>
              <p className="text-xs text-ink-3 max-w-sm mx-auto">
                {batches.length > 0
                  ? 'Change the status filter to see other batches.'
                  : isManager
                    ? 'Click "Create Batch" to start a cohort for one of your courses.'
                    : 'You are not assigned to any batch yet. Ask your branch administrator to add you as an instructor.'}
              </p>
            </div>
          )}

          {!isLoading && visibleBatches.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {visibleBatches.map((batch) => (
                <div
                  key={batch.id}
                  className="p-5 rounded-2xl bg-surface border border-line hover:border-line-strong transition space-y-4 shadow-card flex flex-col"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-ink tracking-tight truncate">{batch.name}</h3>
                      <div className="text-[11px] font-mono text-brand-ink mt-0.5">{batch.code}</div>
                    </div>
                    <BatchStatusBadge status={batch.status} />
                  </div>

                  <div className="space-y-1.5 text-xs text-ink-3 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-3">Course</span>
                      <span className="text-ink-2 text-right truncate">{courseTitle(batch.courseId)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-3">Branch</span>
                      <span className="text-ink-2 font-mono">{branchName(batch.branchId)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-3 flex items-center gap-1">
                        <CalendarDays className="w-3.5 h-3.5" /> Schedule
                      </span>
                      <span className="text-ink-2 font-mono">
                        {formatDate(batch.startDate)} → {formatDate(batch.endDate)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-3 flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" /> Instructors
                      </span>
                      <span className="text-ink-2 font-mono">
                        {batch.instructorUserIds?.length || 0}
                        {batch.maxStudents ? ` • cap ${batch.maxStudents}` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-line flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/batches/${batch.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-semibold"
                    >
                      <span>{isManager ? 'Roster & Enrollment' : 'View Roster'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    {isManager && (
                      <>
                        {batch.status !== 'archived' && (
                          <button
                            type="button"
                            onClick={() => {
                              setSuccessMsg(null);
                              setEditingBatch(batch);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink text-xs font-semibold"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleArchiveToggle(batch)}
                          disabled={busyBatchId === batch.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken disabled:opacity-50 text-ink text-xs font-semibold"
                        >
                          {busyBatchId === batch.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : batch.status === 'archived' ? (
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          ) : (
                            <Archive className="w-3.5 h-3.5" />
                          )}
                          <span>{batch.status === 'archived' ? 'Restore' : 'Archive'}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {isManager && tenant && user && (showCreate || editingBatch) && (
            <BatchFormModal
              tenant={tenant}
              actorUid={user.uid}
              branches={creatableBranches}
              courses={courses}
              batch={editingBatch}
              onClose={() => {
                setShowCreate(false);
                setEditingBatch(null);
              }}
              onSaved={handleSaved}
            />
          )}

          {dialog}
        </div>
      </AppShell>
    </RequireRole>
  );
}

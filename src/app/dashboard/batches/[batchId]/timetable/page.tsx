'use client';

/**
 * Strynkix LMS — Batch Weekly Timetable Page
 * Branch Managers create, edit and submit weekly Monday-to-Sunday timetables.
 * Super Admins review, approve or request corrections with mandatory feedback.
 */

import React, { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { getBatchById } from '@/lib/batches/service';
import { isBatchOpenForEnrollment } from '@/lib/batches/scope';
import { getLessonsForCourse, getModulesForCourse } from '@/lib/courses/service';
import {
  formatWeekRange,
  getISOWeekInfo,
  getMondayOfWeek,
  getSundayOfWeek,
  createEmptyDaysRecord,
  timetableIdFor,
} from '@/lib/learning/timetable';
import {
  approveTimetable,
  getTimetableAuditLogs,
  getTimetableRevision,
  getWeeklyTimetable,
  requestTimetableChanges,
  saveTimetableDraft,
  submitTimetableForApproval,
} from '@/lib/learning/timetable-service';
import { ApprovalBanner } from '@/components/timetable/ApprovalBanner';
import { AuditHistoryDrawer } from '@/components/timetable/AuditHistoryDrawer';
import { TimetableEditor } from '@/components/timetable/TimetableEditor';
import {
  Batch,
  DayOfWeek,
  DaySchedule,
  Lesson,
  Module,
  TimetableAuditLog,
  TimetableRevision,
  WeeklyTimetable,
} from '@/types/domain';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ShieldAlert,
} from 'lucide-react';

interface TimetablePageProps {
  params: Promise<{ batchId: string }>;
}

function TimetableBatchView({ batchId }: { batchId: string }) {
  const { user, tenant } = useAuth();
  const router = useRouter();

  // Current selected Monday (YYYY-MM-DD)
  const [weekStartDate, setWeekStartDate] = useState(() => getMondayOfWeek(new Date()));
  const [batch, setBatch] = useState<Batch | null>(null);
  const [timetable, setTimetable] = useState<WeeklyTimetable | null>(null);
  const [revision, setRevision] = useState<TimetableRevision | null>(null);
  const [days, setDays] = useState<Record<DayOfWeek, DaySchedule>>(() =>
    createEmptyDaysRecord(weekStartDate)
  );

  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [auditLogs, setAuditLogs] = useState<TimetableAuditLog[]>([]);
  const [isAuditOpen, setIsAuditOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Super Admin action modal
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [adminActionBusy, setAdminActionBusy] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      if (!tenant || !user) return;
      setIsLoading(true);
      setError(null);
      try {
        const loadedBatch = await getBatchById(batchId);
        if (!loadedBatch) throw new Error('Batch not found');

        const [loadedModules, loadedLessons] = await Promise.all([
          getModulesForCourse(loadedBatch.courseId, loadedBatch.orgId),
          getLessonsForCourse(loadedBatch.courseId, loadedBatch.orgId),
        ]);

        const ttId = timetableIdFor(loadedBatch.id, weekStartDate);
        const loadedTimetable = await getWeeklyTimetable(ttId);

        let loadedRev: TimetableRevision | null = null;
        let loadedLogs: TimetableAuditLog[] = [];

        if (loadedTimetable) {
          // If active revision exists and user is viewing approved, load active; else load current
          const targetRevId = loadedTimetable.currentRevisionId || loadedTimetable.activeRevisionId;
          if (targetRevId) {
            loadedRev = await getTimetableRevision(ttId, targetRevId);
          }
          loadedLogs = await getTimetableAuditLogs(ttId);
        }

        if (!isMounted) return;
        setBatch(loadedBatch);
        setModules(loadedModules);
        setLessons(loadedLessons.filter((l) => l.status === 'published'));
        setTimetable(loadedTimetable);
        setRevision(loadedRev);
        setAuditLogs(loadedLogs);

        if (loadedRev?.days) {
          setDays(loadedRev.days);
        } else {
          setDays(createEmptyDaysRecord(weekStartDate));
        }
      } catch (err) {
        console.error('Failed to load weekly timetable', err);
        if (isMounted) setError((err as Error).message || 'Failed to load timetable.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [batchId, weekStartDate, tenant, user]);

  const handlePrevWeek = () => {
    const [y, m, d] = weekStartDate.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d - 7, 12, 0, 0));
    setWeekStartDate(getMondayOfWeek(prev));
  };

  const handleNextWeek = () => {
    const [y, m, d] = weekStartDate.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 7, 12, 0, 0));
    setWeekStartDate(getMondayOfWeek(next));
  };

  const handleSaveDraft = async () => {
    if (!batch || !user) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const res = await saveTimetableDraft(
        batch,
        weekStartDate,
        days,
        tenant,
        user.uid,
        revision?.status !== 'approved' ? revision?.id : undefined
      );
      setTimetable(res.timetable);
      setRevision(res.revision);
      setDays(res.revision.days);
      const updatedLogs = await getTimetableAuditLogs(res.timetable.id);
      setAuditLogs(updatedLogs);
    } catch (err) {
      setActionError((err as Error).message || 'Could not save draft.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!batch || !user) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      // First save draft to ensure all latest edits are persisted
      const res = await saveTimetableDraft(
        batch,
        weekStartDate,
        days,
        tenant,
        user.uid,
        revision?.status !== 'approved' ? revision?.id : undefined
      );
      await submitTimetableForApproval(res.timetable.id, res.revision.id, tenant, user.uid);

      setTimetable({ ...res.timetable, latestStatus: 'submitted' });
      setRevision({ ...res.revision, status: 'submitted' });
      const updatedLogs = await getTimetableAuditLogs(res.timetable.id);
      setAuditLogs(updatedLogs);
    } catch (err) {
      setActionError((err as Error).message || 'Submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Super Admin handlers
  const handleApprove = async () => {
    if (!timetable || !revision || !user) return;
    setAdminActionBusy(true);
    setActionError(null);
    try {
      await approveTimetable(timetable.id, revision.id, user.uid);
      setTimetable({ ...timetable, activeRevisionId: revision.id, latestStatus: 'approved' });
      setRevision({ ...revision, status: 'approved' });
      setShowApproveConfirm(false);
      const updatedLogs = await getTimetableAuditLogs(timetable.id);
      setAuditLogs(updatedLogs);
    } catch (err) {
      setActionError((err as Error).message || 'Approval failed.');
    } finally {
      setAdminActionBusy(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!timetable || !revision || !user) return;
    if (rejectComment.trim().length < 5) {
      setActionError('Correction comments must be at least 5 characters long.');
      return;
    }
    setAdminActionBusy(true);
    setActionError(null);
    try {
      await requestTimetableChanges(timetable.id, revision.id, rejectComment.trim(), user.uid);
      setTimetable({ ...timetable, latestStatus: 'changes_requested' });
      setRevision({ ...revision, status: 'changes_requested', reviewComment: rejectComment.trim() });
      setShowRejectModal(false);
      setRejectComment('');
      const updatedLogs = await getTimetableAuditLogs(timetable.id);
      setAuditLogs(updatedLogs);
    } catch (err) {
      setActionError((err as Error).message || 'Requesting changes failed.');
    } finally {
      setAdminActionBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-3" role="status">
        <Loader2 className="w-8 h-8 text-brand-ink animate-spin" />
        <span className="text-xs text-ink-3">Loading weekly timetable...</span>
      </div>
    );
  }

  if (error || !batch) {
    return (
      <div className="max-w-md mx-auto p-6 rounded-2xl bg-surface border border-line text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-danger-ink mx-auto" />
        <p className="text-sm text-ink-2">{error || 'Batch not found.'}</p>
        <Link href="/dashboard/batches" className="text-xs text-brand-ink font-semibold">
          Back to batches
        </Link>
      </div>
    );
  }

  const isSuperAdmin = tenant?.role === 'super_admin';
  const isBranchAdmin = tenant?.role === 'branch_admin' || tenant?.role === 'university_admin';
  const canManage = (isBranchAdmin || isSuperAdmin) && isBatchOpenForEnrollment(batch.status);
  const isApproved = revision?.status === 'approved';
  const canEditSchedule = canManage && !isApproved;

  const weekEnd = getSundayOfWeek(weekStartDate);
  const weekInfo = getISOWeekInfo(weekStartDate);

  return (
    <div className="space-y-6">
      {/* Navigation & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Link
            href={`/dashboard/batches/${batch.id}`}
            className="inline-flex items-center gap-2 text-xs text-ink-3 hover:text-ink mb-2"
          >
            <ArrowLeft className="w-4 h-4" /> {batch.name}
          </Link>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight flex items-center gap-2">
            Weekly Timetable Planning
          </h1>
          <p className="text-xs text-ink-3 mt-0.5">
            Cohort: <strong className="text-ink-2">{batch.name}</strong> ({batch.code}) · {weekInfo.label}
          </p>
        </div>

        {/* Week Selector Bar */}
        <div className="flex items-center gap-2 p-1.5 rounded-xl bg-surface border border-line shadow-sm self-start md:self-auto">
          <button
            type="button"
            onClick={handlePrevWeek}
            className="p-1.5 rounded-lg hover:bg-surface-muted text-ink-3"
            title="Previous Week"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="px-3 text-xs font-bold text-ink">
            {formatWeekRange(weekStartDate, weekEnd)}
          </div>
          <button
            type="button"
            onClick={handleNextWeek}
            className="p-1.5 rounded-lg hover:bg-surface-muted text-ink-3"
            title="Next Week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {actionError && (
        <div className="p-4 rounded-xl border border-danger-line bg-danger-soft text-danger-ink text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Approval Status & Actions Banner */}
      <ApprovalBanner
        revision={revision}
        latestStatus={timetable?.latestStatus}
        isSuperAdmin={isSuperAdmin}
        canManage={canManage}
        onSubmit={handleSubmitForApproval}
        onOpenAudit={() => setIsAuditOpen(true)}
        isSubmitting={isSubmitting}
      />

      {/* Super Admin Review Decision Bar */}
      {isSuperAdmin && revision?.status === 'submitted' && (
        <div className="p-5 rounded-2xl bg-surface border-2 border-brand/30 shadow-card space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-ink">
            <ShieldAlert className="w-4 h-4" /> Super Admin Review Action Required
          </div>
          <p className="text-xs text-ink-2">
            This timetable has been submitted by the Branch Manager for review. Inspect all 7 days below, then make your determination.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowApproveConfirm(true)}
              className="px-4 py-2 rounded-xl bg-success hover:bg-success-strong text-white text-xs font-bold transition-colors"
            >
              Approve & Activate Timetable
            </button>
            <button
              type="button"
              onClick={() => setShowRejectModal(true)}
              className="px-4 py-2 rounded-xl bg-surface-muted hover:bg-surface-sunken text-warning-ink text-xs font-bold transition-colors"
            >
              Request Changes with Feedback
            </button>
          </div>
        </div>
      )}

      {/* Approved Notice & Branch Revisioning */}
      {isApproved && canManage && (
        <div className="p-4 rounded-xl border border-line bg-canvas flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <span className="text-ink-2">
            Need to adjust this schedule? Spawning a new revision will keep this approved schedule active for students until the new revision is approved.
          </span>
          <button
            type="button"
            onClick={async () => {
              if (!batch || !user) return;
              setIsSaving(true);
              try {
                // Spawning next revision
                const res = await saveTimetableDraft(batch, weekStartDate, days, tenant, user.uid);
                setTimetable(res.timetable);
                setRevision(res.revision);
                setDays(res.revision.days);
              } catch (err) {
                setActionError((err as Error).message);
              } finally {
                setIsSaving(false);
              }
            }}
            className="px-3.5 py-1.5 rounded-lg bg-surface border border-line hover:bg-surface-muted text-ink font-semibold whitespace-nowrap"
          >
            Create New Working Revision
          </button>
        </div>
      )}

      {/* 7-Day Timetable Editor */}
      <TimetableEditor
        days={days}
        onChange={setDays}
        canEdit={canEditSchedule}
        courseId={batch.courseId}
        modules={modules}
        lessons={lessons}
        onSaveDraft={handleSaveDraft}
        isSaving={isSaving}
      />

      {/* Audit History Drawer */}
      <AuditHistoryDrawer
        isOpen={isAuditOpen}
        onClose={() => setIsAuditOpen(false)}
        logs={auditLogs}
      />

      {/* Super Admin Approve Modal */}
      {showApproveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="max-w-md w-full bg-surface rounded-2xl border border-line p-6 space-y-4 shadow-2xl animate-pop">
            <h3 className="text-base font-bold text-ink">Approve and Activate Weekly Timetable?</h3>
            <p className="text-xs text-ink-2 leading-relaxed">
              Approving will immediately publish this schedule to all enrolled students and assigned instructors in cohort <strong>{batch.name}</strong> for the week of {formatWeekRange(weekStartDate, weekEnd)}.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowApproveConfirm(false)}
                className="px-4 py-2 rounded-xl border border-line text-xs font-semibold text-ink-2 hover:bg-surface-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={adminActionBusy}
                className="px-4 py-2 rounded-xl bg-success hover:bg-success-strong text-white text-xs font-bold"
              >
                {adminActionBusy ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Super Admin Reject / Changes Requested Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="max-w-md w-full bg-surface rounded-2xl border border-line p-6 space-y-4 shadow-2xl animate-pop">
            <h3 className="text-base font-bold text-ink">Request Corrections</h3>
            <p className="text-xs text-ink-2">
              Provide mandatory feedback explaining what the Branch Manager must correct before this timetable can be approved.
            </p>
            <div className="space-y-1">
              <label htmlFor="rejectComments" className="text-[11px] font-semibold text-ink-3">
                Correction Feedback * (min 5 characters)
              </label>
              <textarea
                id="rejectComments"
                rows={3}
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                placeholder="e.g. Please reschedule Wednesday afternoon assessment to Thursday morning."
                required
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 rounded-xl border border-line text-xs font-semibold text-ink-2 hover:bg-surface-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRequestChanges}
                disabled={adminActionBusy || rejectComment.trim().length < 5}
                className="px-4 py-2 rounded-xl bg-warning-ink hover:opacity-90 text-white text-xs font-bold disabled:opacity-50"
              >
                {adminActionBusy ? 'Submitting...' : 'Request Corrections'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimetableContent({ params }: TimetablePageProps) {
  const { batchId } = use(params);

  return (
    <AppShell>
      <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor']}>
        <TimetableBatchView batchId={batchId} />
      </RequireRole>
    </AppShell>
  );
}

export default function BatchTimetablePage({ params }: TimetablePageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20 text-xs text-ink-3">
          <Loader2 className="w-6 h-6 animate-spin text-brand-ink mr-2" />
          Loading batch timetable...
        </div>
      }
    >
      <TimetableContent params={params} />
    </Suspense>
  );
}

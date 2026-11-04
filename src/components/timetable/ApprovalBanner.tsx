'use client';

/**
 * Strynkix LMS — Timetable Approval Banner
 * Displays the current workflow status, revision number, Super Admin correction
 * comments (when changes are requested), and submission controls.
 */

import React from 'react';
import { TimetableRevision, TimetableStatus } from '@/types/domain';
import { STATUS_LABELS } from '@/lib/learning/timetable';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileEdit,
  History,
  Send,
  Sparkles,
} from 'lucide-react';

interface ApprovalBannerProps {
  revision: TimetableRevision | null;
  latestStatus?: TimetableStatus;
  isSuperAdmin: boolean;
  canManage: boolean;
  onSubmit: () => void;
  onOpenAudit: () => void;
  isSubmitting?: boolean;
}

const STATUS_ICONS: Record<TimetableStatus, React.ComponentType<{ className?: string }>> = {
  draft: FileEdit,
  submitted: Clock,
  changes_requested: AlertTriangle,
  approved: CheckCircle2,
};

const STATUS_PILL_STYLES: Record<TimetableStatus, string> = {
  draft: 'bg-surface-muted text-ink-2 border-line',
  submitted: 'bg-brand-soft text-brand-ink border-brand/20',
  changes_requested: 'bg-warning-soft text-warning-ink border-warning-line',
  approved: 'bg-success-soft text-success-ink border-success-line',
};

export function ApprovalBanner({
  revision,
  latestStatus = 'draft',
  isSuperAdmin,
  canManage,
  onSubmit,
  onOpenAudit,
  isSubmitting = false,
}: ApprovalBannerProps) {
  const status = revision?.status ?? latestStatus;
  const Icon = STATUS_ICONS[status] || FileEdit;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-surface border border-line shadow-card">
        <div className="flex items-start sm:items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${STATUS_PILL_STYLES[status]}`}
          >
            <Icon className="w-4 h-4" />
            {STATUS_LABELS[status]}
          </span>

          {revision && (
            <span className="text-xs font-semibold text-ink-3">
              Revision #{revision.revisionNumber}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenAudit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted text-ink-2 text-xs font-semibold transition-colors"
          >
            <History className="w-3.5 h-3.5" /> Audit History
          </button>

          {canManage && (status === 'draft' || status === 'changes_requested') && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              {status === 'changes_requested' ? 'Resubmit for Approval' : 'Submit for Approval'}
            </button>
          )}
        </div>
      </div>

      {status === 'changes_requested' && revision?.reviewComment && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-warning-line bg-warning-soft text-xs text-ink-2">
          <AlertCircle className="w-5 h-5 text-warning-ink shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-warning-ink uppercase tracking-wider text-[11px]">
              Super Admin Correction Feedback:
            </div>
            <p className="whitespace-pre-line text-ink leading-relaxed">
              {revision.reviewComment}
            </p>
            <p className="text-[11px] text-ink-3">
              Make the requested adjustments below, then click &ldquo;Resubmit for Approval&rdquo;.
            </p>
          </div>
        </div>
      )}

      {status === 'approved' && (
        <div className="flex items-center gap-2 p-3 rounded-xl border border-success-line bg-success-soft text-xs text-success-ink font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            This timetable revision is <strong>approved and active</strong>. Enrolled students and instructors see this schedule.
          </span>
        </div>
      )}
    </div>
  );
}


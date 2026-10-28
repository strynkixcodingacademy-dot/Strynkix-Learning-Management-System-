import React from 'react';
import { BatchStatus, EnrollmentStatus } from '@/types/domain';

const BATCH_STYLES: Record<BatchStatus, string> = {
  upcoming: 'bg-teal-soft text-teal-ink border-teal-line',
  in_progress: 'bg-success-soft text-success-ink border-success-line',
  completed: 'bg-brand-soft text-brand-ink border-brand-line',
  cancelled: 'bg-danger-soft text-danger-ink border-danger-line',
  archived: 'bg-surface-muted text-ink-3 border-line',
};

const ENROLLMENT_STYLES: Record<EnrollmentStatus, string> = {
  active: 'bg-success-soft text-success-ink border-success-line',
  completed: 'bg-brand-soft text-brand-ink border-brand-line',
  dropped: 'bg-surface-muted text-ink-3 border-line',
  suspended: 'bg-warning-soft text-warning-ink border-warning-line',
};

const ENROLLMENT_LABELS: Record<EnrollmentStatus, string> = {
  active: 'active',
  completed: 'completed',
  dropped: 'withdrawn',
  suspended: 'deactivated',
};

const badgeClass = 'text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full border whitespace-nowrap';

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return <span className={`${badgeClass} ${BATCH_STYLES[status] || BATCH_STYLES.archived}`}>{status.replace('_', ' ')}</span>;
}

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  return (
    <span className={`${badgeClass} ${ENROLLMENT_STYLES[status] || ENROLLMENT_STYLES.dropped}`}>
      {ENROLLMENT_LABELS[status] || status}
    </span>
  );
}

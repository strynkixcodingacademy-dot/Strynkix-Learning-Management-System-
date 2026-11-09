/** Batch and enrollment status as the shared pill, so a status reads the same everywhere. */

import React from 'react';
import { BatchStatus, EnrollmentStatus } from '@/types/domain';
import { StatusPill } from '@/components/ui/StatusPill';
import type { Tone } from '@/components/ui/tones';

const BATCH: Record<BatchStatus, { tone: Tone; label: string }> = {
  upcoming: { tone: 'info', label: 'Upcoming' },
  in_progress: { tone: 'brand', label: 'In progress' },
  completed: { tone: 'success', label: 'Completed' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
  archived: { tone: 'neutral', label: 'Archived' },
};

const ENROLLMENT: Record<EnrollmentStatus, { tone: Tone; label: string }> = {
  active: { tone: 'brand', label: 'Active' },
  completed: { tone: 'success', label: 'Completed' },
  dropped: { tone: 'neutral', label: 'Withdrawn' },
  suspended: { tone: 'warning', label: 'Deactivated' },
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const look = BATCH[status] ?? BATCH.archived;
  return <StatusPill size="sm" tone={look.tone}>{look.label}</StatusPill>;
}

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  const look = ENROLLMENT[status] ?? ENROLLMENT.dropped;
  return <StatusPill size="sm" tone={look.tone}>{look.label}</StatusPill>;
}

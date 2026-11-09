'use client';

import React from 'react';
import type { AttemptStatus } from '@/types/academy';
import { ATTEMPT_STATUS_LABELS } from '@/lib/assessments/grading';
import { StatusPill } from '@/components/ui/StatusPill';
import type { Tone } from '@/components/ui/tones';
import { CheckCircle2, Circle, Clock, Hourglass, RotateCcw, Send } from 'lucide-react';

const LOOK: Record<AttemptStatus | 'not_started', { tone: Tone; icon: typeof Circle }> = {
  not_started: { tone: 'neutral', icon: Circle },
  in_progress: { tone: 'brand', icon: Clock },
  submitted: { tone: 'info', icon: Send },
  under_evaluation: { tone: 'warning', icon: Hourglass },
  evaluated: { tone: 'success', icon: CheckCircle2 },
  returned: { tone: 'coral', icon: RotateCcw },
};

export function AttemptStatusPill({ status, late, resubmission, size }: { status: AttemptStatus | 'not_started'; late?: boolean; resubmission?: boolean; size?: 'sm' | 'md' }) {
  const look = LOOK[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusPill tone={look.tone} icon={look.icon} size={size}>{ATTEMPT_STATUS_LABELS[status]}</StatusPill>
      {resubmission && <StatusPill tone="teal" size="sm">Resubmitted</StatusPill>}
      {late && <StatusPill tone="danger" size="sm">Late</StatusPill>}
    </span>
  );
}

/** "12 Mar, 10:30" in the viewer's locale. */
export function formatWhen(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

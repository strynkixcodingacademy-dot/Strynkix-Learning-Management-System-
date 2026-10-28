/**
 * Strynkix Live Books — shared presentation pieces for daily learning.
 */

import React from 'react';
import {
  AlarmClock,
  CheckCheck,
  CircleDashed,
  CircleDot,
  Clock3,
  Hourglass,
  MessageSquareWarning,
  Send,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { DeadlineState, DEADLINE_STATE_LABELS } from '@/lib/learning/submission-state';
import { Ratio } from '@/lib/learning/metrics';
import { StatusPill } from '@/components/ui/StatusPill';
import { ProgressBar } from '@/components/ui/Progress';
import { Tone } from '@/components/ui/tones';

const DEADLINE_LOOK: Record<DeadlineState, { tone: Tone; icon: LucideIcon }> = {
  upcoming: { tone: 'neutral', icon: CircleDashed },
  due_soon: { tone: 'warning', icon: AlarmClock },
  overdue: { tone: 'danger', icon: Hourglass },
  submitted_on_time: { tone: 'teal', icon: Send },
  submitted_late: { tone: 'coral', icon: Clock3 },
  correction_requested: { tone: 'warning', icon: MessageSquareWarning },
  graded: { tone: 'success', icon: Star },
};

export function DeadlineBadge({ state, size = 'md' }: { state: DeadlineState; size?: 'sm' | 'md' }) {
  const look = DEADLINE_LOOK[state];
  return (
    <StatusPill tone={look.tone} icon={look.icon} size={size}>
      {DEADLINE_STATE_LABELS[state]}
    </StatusPill>
  );
}

export type LessonState = 'pending' | 'in_progress' | 'completed';

export const LESSON_STATE_LOOK: Record<LessonState, { tone: Tone; icon: LucideIcon; label: string }> = {
  pending: { tone: 'neutral', icon: CircleDashed, label: 'Not started' },
  in_progress: { tone: 'warning', icon: CircleDot, label: 'In progress' },
  completed: { tone: 'success', icon: CheckCheck, label: 'Completed' },
};

/** Re-exported so existing imports keep working. */
export { ProgressBar };

/** One metric with numerator/denominator and a plain-language explanation. */
export function MetricRow({
  title,
  ratio,
  unit,
  emptyText,
  explanation,
  tone,
}: {
  title: string;
  ratio: Ratio;
  unit: string;
  emptyText: string;
  explanation: string;
  tone: Tone;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">{title}</h3>
      {ratio.percentage === null ? (
        <div className="text-base font-semibold text-ink-2">{emptyText}</div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-extrabold tracking-tight text-ink">{ratio.percentage}%</span>
          <span className="text-sm text-ink-3">{ratio.numerator} of {ratio.denominator} {unit}</span>
        </div>
      )}
      <ProgressBar value={ratio.percentage} tone={tone} label={title} size="sm" />
      <p className="text-xs leading-snug text-ink-3">{explanation}</p>
    </div>
  );
}

/** Back-compat card wrapper around MetricRow. */
export function MetricCard(props: React.ComponentProps<typeof MetricRow>) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <MetricRow {...props} />
    </div>
  );
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatPlanDate(date: string, style: 'short' | 'long' = 'short'): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined,
    style === 'long' ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "due in 3 h", "due tomorrow at 6:00 PM", "2 days overdue" — friendly, never alarming. */
export function formatDue(iso: string | undefined, now: Date): string {
  if (!iso) return 'No deadline';
  const due = new Date(iso);
  const diff = due.getTime() - now.getTime();
  const hours = Math.round(Math.abs(diff) / 3_600_000);
  const days = Math.round(Math.abs(diff) / 86_400_000);
  if (diff < 0) {
    if (hours < 1) return 'due just now';
    return hours < 24 ? `${hours} h past due` : `${days} day${days === 1 ? '' : 's'} past due`;
  }
  if (hours < 1) return 'due within the hour';
  if (hours < 12) return `due in ${hours} h`;
  const sameDay = due.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86_400_000).toDateString() === due.toDateString();
  if (sameDay) return `due today at ${formatTime(iso)}`;
  if (tomorrow) return `due tomorrow at ${formatTime(iso)}`;
  return `due ${due.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

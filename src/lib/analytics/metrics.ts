/**
 * Strynkix LMS — Analytics (pure functions).
 * Built on computeLearningMetrics so every number matches what students see on
 * their own dashboard (definitions in docs/DAILY_LEARNING.md §5). Ratios carry
 * numerator and denominator; percentages are null when nothing is due.
 */

import { Assignment, Batch, DailyPlan, Enrollment, Progress, Submission } from '@/types/domain';
import { grantsContentAccess } from '@/lib/batches/scope';
import { combineMetrics, computeLearningMetrics, LearningMetrics, Ratio, toLocalDateKey } from '@/lib/learning/metrics';

export interface BatchData {
  batch: Batch;
  enrollments: Enrollment[];
  plans: DailyPlan[];
  assignments: Assignment[];
  submissions: Submission[];
  progress: Progress[];
}

export interface StudentRow {
  studentId: string;
  name: string;
  email?: string;
  batchId: string;
  batchName: string;
  metrics: LearningMetrics;
  lastActivity?: string;
  /** Plain-language reasons this learner needs attention (empty when on track). */
  flags: string[];
}

export interface BatchRow {
  batch: Batch;
  activeStudents: number;
  plansPublished: number;
  metrics: LearningMetrics;
  reviewBacklog: number;
  awaitingCorrection: number;
}

export interface DayPoint {
  date: string;
  submissions: number;
  completions: number;
}

export interface AnalyticsReport {
  totals: {
    batches: number;
    activeStudents: number;
    plansPublished: number;
    reviewBacklog: number;
    awaitingCorrection: number;
    atRisk: number;
  };
  metrics: LearningMetrics;
  batches: BatchRow[];
  students: StudentRow[];
  days: DayPoint[];
}

const dayKey = (iso?: string) => (iso ? toLocalDateKey(new Date(iso)) : null);

/** Reasons a learner needs attention. Thresholds are deliberately simple and stated in the UI. */
export function studentFlags(m: LearningMetrics): string[] {
  const flags: string[] = [];
  if (m.overdueAssignments.length >= 1) {
    flags.push(`${m.overdueAssignments.length} assignment${m.overdueAssignments.length === 1 ? '' : 's'} past deadline, not submitted`);
  }
  if (m.overdueLessons.length >= 2) flags.push(`${m.overdueLessons.length} lessons overdue`);
  const pct = m.assessment.percentage;
  if (pct !== null && m.assessment.gradedCount >= 2 && pct < 50) flags.push(`average mark ${pct}%`);
  return flags;
}

export function lastNDays(now: Date, n: number): string[] {
  // Step back in whole days from "today" in the academy zone, then render each key.
  const [y, m, d] = toLocalDateKey(now).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d - (n - 1 - i)));
    return day.toISOString().slice(0, 10);
  });
}

export function buildAnalytics(data: BatchData[], now: Date, days = 14): AnalyticsReport {
  const today = toLocalDateKey(now);
  const batchRows: BatchRow[] = [];
  const students: StudentRow[] = [];

  for (const b of data) {
    const active = b.enrollments.filter((e) => grantsContentAccess(e.status));
    const published = b.plans.filter((p) => p.status === 'published');
    const perStudent: LearningMetrics[] = [];
    for (const e of active) {
      const own = b.submissions.filter((s) => s.studentId === e.studentId);
      const progress = b.progress.filter((p) => p.studentId === e.studentId);
      const metrics = computeLearningMetrics({
        plans: published,
        assignments: b.assignments,
        submissions: own,
        progress,
        enrolledAt: e.enrolledAt,
        now,
        today,
      });
      perStudent.push(metrics);
      const last = [...own.map((s) => s.submittedAt), ...progress.map((p) => p.lastAccessedAt || p.completedAt)]
        .filter((x): x is string => !!x)
        .sort()
        .pop();
      students.push({
        studentId: e.studentId,
        name: e.studentDisplayName || e.studentEmail || 'Student',
        email: e.studentEmail,
        batchId: b.batch.id,
        batchName: b.batch.name,
        metrics,
        lastActivity: last,
        flags: studentFlags(metrics),
      });
    }
    const activeIds = new Set(active.map((e) => e.studentId));
    const current = b.submissions.filter((s) => activeIds.has(s.studentId));
    batchRows.push({
      batch: b.batch,
      activeStudents: active.length,
      plansPublished: published.filter((p) => p.date <= today).length,
      metrics: combineMetrics(perStudent),
      reviewBacklog: current.filter((s) => s.status === 'submitted').length,
      awaitingCorrection: current.filter((s) => s.status === 'resubmit_requested').length,
    });
  }

  const window = lastNDays(now, days);
  const index = new Map(window.map((d, i) => [d, i]));
  const series: DayPoint[] = window.map((date) => ({ date, submissions: 0, completions: 0 }));
  for (const b of data) {
    for (const s of b.submissions) {
      const i = index.get(dayKey(s.submittedAt) ?? '');
      if (i !== undefined) series[i].submissions += 1;
    }
    for (const p of b.progress) {
      if (p.status !== 'completed') continue;
      const i = index.get(dayKey(p.completedAt) ?? '');
      if (i !== undefined) series[i].completions += 1;
    }
  }

  return {
    totals: {
      batches: batchRows.length,
      activeStudents: batchRows.reduce((n, r) => n + r.activeStudents, 0),
      plansPublished: batchRows.reduce((n, r) => n + r.plansPublished, 0),
      reviewBacklog: batchRows.reduce((n, r) => n + r.reviewBacklog, 0),
      awaitingCorrection: batchRows.reduce((n, r) => n + r.awaitingCorrection, 0),
      atRisk: students.filter((s) => s.flags.length > 0).length,
    },
    metrics: combineMetrics(batchRows.map((r) => r.metrics)),
    batches: batchRows,
    students: students.sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name)),
    days: series,
  };
}

/** "3 of 4" style text for a ratio, or a dash when nothing is due yet. */
export function ratioText(r: Ratio): string {
  return r.denominator === 0 ? '—' : `${r.numerator} of ${r.denominator}`;
}

/** A KPI hint: "<n of d> <what>", or `empty` when nothing has been due yet. */
export function ratioHint(r: Ratio, what: string, empty: string): string {
  return r.denominator === 0 ? empty : `${r.numerator} of ${r.denominator} ${what}`;
}

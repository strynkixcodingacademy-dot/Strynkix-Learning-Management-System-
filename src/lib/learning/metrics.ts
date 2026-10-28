/**
 * Strynkix LMS — Daily Learning Metrics (formulas in docs/DAILY_LEARNING.md §5)
 * Pure functions. Each metric is reported separately with its numerator and
 * denominator; percentages are null when the denominator is zero.
 */

import { Assignment, DailyPlan, Progress, Submission } from '@/types/domain';

export interface Ratio {
  numerator: number;
  denominator: number;
  /** null when nothing is due/assigned yet, so the UI never shows a fake 0% */
  percentage: number | null;
}

export interface OverdueLesson {
  lessonId: string;
  planId: string;
  dueAt: string;
}

export interface OverdueAssignment {
  assignmentId: string;
  deadline: string;
}

export interface LearningMetrics {
  learningCompletion: Ratio;
  submissionRate: Ratio;
  assessment: Ratio & { gradedCount: number };
  upcomingAssignments: number;
  lateSubmissions: number;
  overdueLessons: OverdueLesson[];
  overdueAssignments: OverdueAssignment[];
}

export interface MetricsInput {
  plans: DailyPlan[];
  assignments: Assignment[];
  submissions: Submission[];
  progress: Progress[];
  /** Enrollment start; assignments due before it are not counted. */
  enrolledAt?: string;
  now: Date;
  /** Calendar date (YYYY-MM-DD) treated as "today" for plan inclusion. */
  today: string;
}

function ratio(numerator: number, denominator: number): Ratio {
  return {
    numerator,
    denominator,
    percentage: denominator > 0 ? Math.round((numerator / denominator) * 100) : null,
  };
}

const time = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);

export function computeLearningMetrics(input: MetricsInput): LearningMetrics {
  const now = input.now.getTime();
  const completed = new Set(input.progress.filter((p) => p.status === 'completed').map((p) => p.lessonId));

  // Learning: distinct lessons from published plans dated today or earlier.
  const assigned = new Map<string, { planId: string; dueAt: string }>();
  for (const plan of input.plans) {
    if (plan.status !== 'published' || plan.date > input.today) continue;
    for (const lessonId of plan.lessonIds ?? []) {
      const existing = assigned.get(lessonId);
      // The earliest due date wins when a lesson is assigned on several days.
      if (!existing || time(plan.learningDueAt) < time(existing.dueAt)) {
        assigned.set(lessonId, { planId: plan.id, dueAt: plan.learningDueAt });
      }
    }
  }
  const assignedIds = [...assigned.keys()];
  const learningCompletion = ratio(assignedIds.filter((id) => completed.has(id)).length, assignedIds.length);
  const overdueLessons = assignedIds
    .filter((id) => !completed.has(id) && time(assigned.get(id)!.dueAt) < now)
    .map((id) => ({ lessonId: id, ...assigned.get(id)! }));

  // Assignments: published, with a deadline, not due before enrollment.
  const enrolledAt = time(input.enrolledAt);
  const relevant = input.assignments.filter(
    (a) => a.status === 'published' && a.deadline && !(time(a.deadline) < enrolledAt)
  );
  const submissionsByAssignment = new Map(input.submissions.map((s) => [s.assignmentId, s]));
  const due = relevant.filter((a) => time(a.deadline) <= now);
  const dueSubmitted = due.filter((a) => submissionsByAssignment.has(a.id));
  const overdueAssignments = due
    .filter((a) => !submissionsByAssignment.has(a.id))
    .map((a) => ({ assignmentId: a.id, deadline: a.deadline! }));

  const lateSubmissions = relevant.filter((a) => {
    const s = submissionsByAssignment.get(a.id);
    return s?.submittedAt && time(s.submittedAt) > time(a.deadline);
  }).length;

  // Assessment: graded work only; ungraded work is excluded, not counted as zero.
  const pointsById = new Map(relevant.map((a) => [a.id, a.totalPoints]));
  let earned = 0;
  let available = 0;
  let gradedCount = 0;
  for (const s of input.submissions) {
    const total = pointsById.get(s.assignmentId);
    if (s.status !== 'graded' || typeof s.score !== 'number' || !total) continue;
    earned += Math.min(s.score, total);
    available += total;
    gradedCount += 1;
  }

  return {
    learningCompletion,
    submissionRate: ratio(dueSubmitted.length, due.length),
    assessment: { ...ratio(earned, available), gradedCount },
    upcomingAssignments: relevant.length - due.length,
    lateSubmissions,
    overdueLessons,
    overdueAssignments,
  };
}

/** Sums per-course metrics into an overall view (numerators and denominators, not averages of percentages). */
export function combineMetrics(list: LearningMetrics[]): LearningMetrics {
  const sum = (pick: (m: LearningMetrics) => Ratio) =>
    ratio(
      list.reduce((n, m) => n + pick(m).numerator, 0),
      list.reduce((n, m) => n + pick(m).denominator, 0)
    );
  return {
    learningCompletion: sum((m) => m.learningCompletion),
    submissionRate: sum((m) => m.submissionRate),
    assessment: { ...sum((m) => m.assessment), gradedCount: list.reduce((n, m) => n + m.assessment.gradedCount, 0) },
    upcomingAssignments: list.reduce((n, m) => n + m.upcomingAssignments, 0),
    lateSubmissions: list.reduce((n, m) => n + m.lateSubmissions, 0),
    overdueLessons: list.flatMap((m) => m.overdueLessons),
    overdueAssignments: list.flatMap((m) => m.overdueAssignments),
  };
}

// Academy time zone (owner decision D4): set once at sign-in from the
// organization's settings.defaultTimezone so every device agrees on "today".
// Unset (tests, scripts, orgs without a zone) falls back to the device's zone.
let academyTimeZone: string | undefined;

/** Sets the academy time zone; ignores values the browser doesn't recognise. */
export function setAcademyTimeZone(timeZone: string | undefined): void {
  if (!timeZone) {
    academyTimeZone = undefined;
    return;
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(0);
    academyTimeZone = timeZone;
  } catch {
    academyTimeZone = undefined;
  }
}

export function getAcademyTimeZone(): string | undefined {
  return academyTimeZone;
}

/** Calendar date (YYYY-MM-DD) for a Date in the academy's time zone (or the device's). */
export function toLocalDateKey(date: Date, timeZone: string | undefined = academyTimeZone): string {
  if (timeZone) {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

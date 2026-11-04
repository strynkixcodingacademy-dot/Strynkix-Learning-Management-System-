/**
 * Strynkix LMS — Weekly Timetable Domain Logic & Pure Utilities
 * Pure functions: week date boundaries, ISO week math, deterministic IDs,
 * activity sorting, state transitions, and student activity-progress derivation.
 */

import {
  ActivityProgressState,
  ActivityType,
  DayOfWeek,
  DaySchedule,
  Progress,
  Submission,
  TimetableActivity,
  TimetableRevision,
  TimetableStatus,
  UserRole,
} from '@/types/domain';
import { getAcademyTimeZone, toLocalDateKey } from './metrics';

export const DAYS_OF_WEEK: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  lesson: 'Live Book Lesson',
  practical_exercise: 'Practical Exercise',
  assignment: 'Graded Assignment',
  revision: 'Revision & Recap',
  project_work: 'Project Milestone',
  doubt_solving: 'Doubt Clearing Session',
  quiz: 'Knowledge Check Quiz',
  examination: 'Examination',
  practical_assessment: 'Practical Assessment',
};

export const STATUS_LABELS: Record<TimetableStatus, string> = {
  draft: 'Draft',
  submitted: 'Pending Approval',
  changes_requested: 'Changes Requested',
  approved: 'Approved & Active',
};

// -----------------------------------------------------------------------------
// Deterministic ID Helpers
// -----------------------------------------------------------------------------

export function timetableIdFor(batchId: string, weekStartDate: string): string {
  return `timetable_${batchId}_${weekStartDate}`;
}

export function revisionIdFor(revisionNumber: number): string {
  return `rev_${revisionNumber}`;
}

// -----------------------------------------------------------------------------
// Week Date Math & Boundaries
// -----------------------------------------------------------------------------

/**
 * Returns the YYYY-MM-DD Monday date for any given date in the target timezone.
 * Monday is day 1 of the week according to ISO-8601.
 */
export function getMondayOfWeek(
  dateInput: Date | string,
  timeZone: string | undefined = getAcademyTimeZone()
): string {
  const d = typeof dateInput === 'string' ? new Date(`${dateInput}T12:00:00Z`) : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date provided: ${String(dateInput)}`);
  }

  // Determine current day of week (0=Sun, 1=Mon, ..., 6=Sat) in the given timezone
  const dateKey = toLocalDateKey(d, timeZone);
  const [year, month, day] = dateKey.split('-').map(Number);
  const localDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayOfWeek = localDate.getUTCDay(); // 0 is Sunday, 1 is Monday

  // Days to subtract to reach Monday
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const mondayDate = new Date(localDate.getTime() + diffToMonday * 24 * 60 * 60 * 1000);
  const y = mondayDate.getUTCFullYear();
  const m = String(mondayDate.getUTCMonth() + 1).padStart(2, '0');
  const dayNum = String(mondayDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

/**
 * Returns the Sunday YYYY-MM-DD that is 6 days after the given Monday.
 */
export function getSundayOfWeek(mondayDateKey: string): string {
  const [year, month, day] = mondayDateKey.split('-').map(Number);
  const mondayDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const sundayDate = new Date(mondayDate.getTime() + 6 * 24 * 60 * 60 * 1000);
  const y = sundayDate.getUTCFullYear();
  const m = String(sundayDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(sundayDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns an array of YYYY-MM-DD dates for the 7 days starting from Monday.
 */
export function getWeekDates(mondayDateKey: string): { dayOfWeek: DayOfWeek; date: string }[] {
  const [year, month, day] = mondayDateKey.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return DAYS_OF_WEEK.map((dayOfWeek, idx) => {
    const cur = new Date(start.getTime() + idx * 24 * 60 * 60 * 1000);
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    return { dayOfWeek, date: `${y}-${m}-${d}` };
  });
}

/**
 * Returns ISO week number and year label (e.g. "Week 44, 2026").
 */
export function getISOWeekInfo(mondayDateKey: string): { weekNumber: number; year: number; label: string } {
  const [year, month, day] = mondayDateKey.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // Set to nearest Thursday: current date + 4 - current day number
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const targetYear = target.getUTCFullYear();
  return {
    weekNumber,
    year: targetYear,
    label: `Week ${weekNumber}, ${targetYear}`,
  };
}

/**
 * Formats a Monday-Sunday range for human display (e.g. "02 Nov – 08 Nov 2026").
 */
export function formatWeekRange(mondayKey: string, sundayKey: string): string {
  const [y1, m1, d1] = mondayKey.split('-').map(Number);
  const [y2, m2, d2] = sundayKey.split('-').map(Number);
  const monDate = new Date(Date.UTC(y1, m1 - 1, d1));
  const sunDate = new Date(Date.UTC(y2, m2 - 1, d2));

  const monStr = monDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const sunStr = sunDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${monStr} – ${sunStr}`;
}

// -----------------------------------------------------------------------------
// Empty Template & Default Generators
// -----------------------------------------------------------------------------

export function createEmptyDaySchedule(date: string, dayOfWeek: DayOfWeek): DaySchedule {
  return {
    date,
    dayOfWeek,
    activities: [],
  };
}

export function createEmptyDaysRecord(weekStartDate: string): Record<DayOfWeek, DaySchedule> {
  const dates = getWeekDates(weekStartDate);
  const record: Partial<Record<DayOfWeek, DaySchedule>> = {};
  for (const { dayOfWeek, date } of dates) {
    record[dayOfWeek] = createEmptyDaySchedule(date, dayOfWeek);
  }
  return record as Record<DayOfWeek, DaySchedule>;
}

// -----------------------------------------------------------------------------
// Activity Ordering & Time Calculations
// -----------------------------------------------------------------------------

export function sortActivities(activities: TimetableActivity[]): TimetableActivity[] {
  return [...activities].sort((a, b) => {
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
    return a.startTime.localeCompare(b.startTime);
  });
}

export function normalizeActivityOrder(activities: TimetableActivity[]): TimetableActivity[] {
  const sorted = sortActivities(activities);
  return sorted.map((act, index) => ({
    ...act,
    orderIndex: index,
  }));
}

export function calculateDurationMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

// -----------------------------------------------------------------------------
// State Machine Transitions & Authority
// -----------------------------------------------------------------------------

export function canTransitionTimetable(
  from: TimetableStatus | null,
  to: TimetableStatus,
  role: UserRole,
  isReviewCommentProvided = false
): { allowed: boolean; reason?: string } {
  // Super admin can create draft, submit, approve, or request changes
  if (role === 'super_admin') {
    if (to === 'changes_requested' && !isReviewCommentProvided) {
      return { allowed: false, reason: 'Super Admin must provide correction comments when requesting changes.' };
    }
    return { allowed: true };
  }

  // Branch manager (branch_admin) permissions
  if (role === 'branch_admin' || role === 'university_admin') {
    if (to === 'approved') {
      return { allowed: false, reason: 'Only Super Admin can approve timetables.' };
    }
    if (to === 'changes_requested') {
      return { allowed: false, reason: 'Only Super Admin can request changes on timetables.' };
    }
    if (to === 'draft') {
      return { allowed: from === null || from === 'draft' || from === 'changes_requested' };
    }
    if (to === 'submitted') {
      return { allowed: from === 'draft' || from === 'changes_requested' };
    }
    return { allowed: false, reason: 'Invalid status transition.' };
  }

  return { allowed: false, reason: `Role ${role} cannot mutate timetables.` };
}

// -----------------------------------------------------------------------------
// Student Activity-Progress Derivation
// -----------------------------------------------------------------------------

export interface DerivedActivityState {
  state: ActivityProgressState;
  label: string;
  detail: string;
  isActionable: boolean;
  actionLabel: string;
  completedAt?: string;
  score?: number;
}

export function deriveActivityProgress(
  activity: TimetableActivity,
  dayDate: string,
  studentProgress: Progress[],
  studentSubmissions: Submission[],
  now: Date
): DerivedActivityState {
  const nowMs = now.getTime();
  const [endH, endM] = activity.endTime.split(':').map(Number);
  const [y, m, d] = dayDate.split('-').map(Number);
  const activityEndTimeMs = new Date(Date.UTC(y, m - 1, d, endH, endM)).getTime();
  const isPastActivityTime = nowMs > activityEndTimeMs;

  // 1. Lesson Activities
  if (activity.type === 'lesson') {
    const prog = activity.lessonId
      ? studentProgress.find((p) => p.lessonId === activity.lessonId)
      : null;

    if (prog?.status === 'completed') {
      return {
        state: 'completed',
        label: 'Completed',
        detail: 'Lesson finished',
        isActionable: true,
        actionLabel: 'Review',
        completedAt: prog.completedAt,
      };
    }
    if (prog?.status === 'in_progress') {
      return {
        state: 'in_progress',
        label: 'In Progress',
        detail: 'Lesson in progress',
        isActionable: true,
        actionLabel: 'Continue',
      };
    }
    if (isPastActivityTime) {
      return {
        state: 'overdue',
        label: 'Overdue',
        detail: 'Scheduled time passed',
        isActionable: true,
        actionLabel: 'Start',
      };
    }
    return {
      state: 'not_started',
      label: 'Not Started',
      detail: `${activity.durationMinutes} min lesson`,
      isActionable: true,
      actionLabel: 'Start',
    };
  }

  // 2. Assignment Activities
  if (activity.type === 'assignment') {
    const sub = activity.assignmentId
      ? studentSubmissions.find((s) => s.assignmentId === activity.assignmentId)
      : null;

    if (sub) {
      if (sub.status === 'graded') {
        return {
          state: 'completed',
          label: 'Graded',
          detail: typeof sub.score === 'number' ? `Score: ${sub.score} marks` : 'Graded',
          isActionable: true,
          actionLabel: 'View marks',
          score: sub.score,
        };
      }
      if (sub.status === 'resubmit_requested') {
        return {
          state: 'in_progress',
          label: 'Correction requested',
          detail: 'Feedback provided by instructor',
          isActionable: true,
          actionLabel: 'Fix & resubmit',
        };
      }
      return {
        state: 'completed',
        label: 'Submitted',
        detail: 'Awaiting grading',
        isActionable: true,
        actionLabel: 'View submission',
      };
    }

    if (isPastActivityTime) {
      return {
        state: 'overdue',
        label: 'Overdue',
        detail: 'Assignment overdue',
        isActionable: true,
        actionLabel: 'Submit now',
      };
    }
    return {
      state: 'not_started',
      label: 'Not Submitted',
      detail: 'Graded assignment',
      isActionable: true,
      actionLabel: 'Start assignment',
    };
  }

  // 3. Assessment / Exam Activities
  if (
    activity.type === 'quiz' ||
    activity.type === 'examination' ||
    activity.type === 'practical_assessment'
  ) {
    const window = activity.assessment?.availabilityWindow;
    if (window) {
      const windowStartMs = new Date(window.start).getTime();
      const windowEndMs = new Date(window.end).getTime();

      if (nowMs < windowStartMs) {
        return {
          state: 'blocked',
          label: 'Upcoming',
          detail: `Opens at ${new Date(window.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          isActionable: false,
          actionLabel: 'Not yet available',
        };
      }
      if (nowMs > windowEndMs) {
        return {
          state: 'overdue',
          label: 'Window Closed',
          detail: 'Assessment window has closed',
          isActionable: false,
          actionLabel: 'Closed',
        };
      }
    }

    // Within window or no explicit window: check if lesson quiz completed or assignment submitted
    const sub = activity.assignmentId
      ? studentSubmissions.find((s) => s.assignmentId === activity.assignmentId)
      : null;
    if (sub?.status === 'graded' || sub?.status === 'submitted') {
      return {
        state: 'completed',
        label: sub.status === 'graded' ? 'Graded' : 'Submitted',
        detail: typeof sub.score === 'number' ? `${sub.score} marks` : 'Submitted',
        isActionable: true,
        actionLabel: 'View assessment',
        score: sub.score,
      };
    }

    return {
      state: 'not_started',
      label: 'Ready to Start',
      detail: activity.assessment ? `${activity.assessment.maxMarks} marks · ${activity.durationMinutes} mins` : 'Assessment',
      isActionable: true,
      actionLabel: 'Start assessment',
    };
  }

  // 4. Practical exercises, revisions, doubts, project milestones
  return {
    state: isPastActivityTime ? 'completed' : 'not_started',
    label: isPastActivityTime ? 'Completed' : 'Scheduled',
    detail: `${activity.durationMinutes} min session`,
    isActionable: true,
    actionLabel: 'Open session',
  };
}

export function calculateDayCompletion(
  day: DaySchedule,
  studentProgress: Progress[],
  studentSubmissions: Submission[],
  now: Date
): { completedCount: number; totalCount: number; percentage: number | null } {
  if (day.activities.length === 0) {
    return { completedCount: 0, totalCount: 0, percentage: null };
  }

  let completed = 0;
  for (const act of day.activities) {
    const derived = deriveActivityProgress(act, day.date, studentProgress, studentSubmissions, now);
    if (derived.state === 'completed') {
      completed++;
    }
  }

  return {
    completedCount: completed,
    totalCount: day.activities.length,
    percentage: Math.round((completed / day.activities.length) * 100),
  };
}


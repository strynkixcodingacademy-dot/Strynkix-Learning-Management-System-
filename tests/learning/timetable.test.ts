import { describe, it, expect } from 'vitest';
import {
  calculateDayCompletion,
  calculateDurationMinutes,
  canTransitionTimetable,
  createEmptyDaysRecord,
  deriveActivityProgress,
  formatWeekRange,
  getISOWeekInfo,
  getMondayOfWeek,
  getSundayOfWeek,
  getWeekDates,
  normalizeActivityOrder,
  revisionIdFor,
  sortActivities,
  timetableIdFor,
} from '@/lib/learning/timetable';
import {
  assessmentScheduleSchema,
  dayScheduleSchema,
  timetableActivitySchema,
  timetableCorrectionSchema,
  timetableRevisionSchema,
  weeklyTimetableSchema,
} from '@/types/validation';
import { Progress, Submission, TimetableActivity } from '@/types/domain';

describe('Stage 8 Weekly Timetable: Week Date Math & Boundaries', () => {
  it('correctly finds the Monday of any date in the week', () => {
    // 2026-11-04 is a Wednesday
    expect(getMondayOfWeek('2026-11-04')).toBe('2026-11-02');
    // 2026-11-02 is Monday itself
    expect(getMondayOfWeek('2026-11-02')).toBe('2026-11-02');
    // 2026-11-08 is Sunday (should belong to the week starting 2026-11-02)
    expect(getMondayOfWeek('2026-11-08')).toBe('2026-11-02');
    // 2026-11-09 is next Monday
    expect(getMondayOfWeek('2026-11-09')).toBe('2026-11-09');
  });

  it('correctly handles month and year boundary rollovers', () => {
    // 2026-01-01 is Thursday -> Monday is 2025-12-29
    expect(getMondayOfWeek('2026-01-01')).toBe('2025-12-29');
    // 2026-03-01 is Sunday -> Monday is 2026-02-23
    expect(getMondayOfWeek('2026-03-01')).toBe('2026-02-23');
  });

  it('calculates the Sunday 6 days after Monday', () => {
    expect(getSundayOfWeek('2026-11-02')).toBe('2026-11-08');
    expect(getSundayOfWeek('2025-12-29')).toBe('2026-01-04');
  });

  it('returns all 7 days of the week starting from Monday', () => {
    const days = getWeekDates('2026-11-02');
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ dayOfWeek: 'monday', date: '2026-11-02' });
    expect(days[1]).toEqual({ dayOfWeek: 'tuesday', date: '2026-11-03' });
    expect(days[2]).toEqual({ dayOfWeek: 'wednesday', date: '2026-11-04' });
    expect(days[3]).toEqual({ dayOfWeek: 'thursday', date: '2026-11-05' });
    expect(days[4]).toEqual({ dayOfWeek: 'friday', date: '2026-11-06' });
    expect(days[5]).toEqual({ dayOfWeek: 'saturday', date: '2026-11-07' });
    expect(days[6]).toEqual({ dayOfWeek: 'sunday', date: '2026-11-08' });
  });

  it('computes ISO week info and human range format', () => {
    const iso = getISOWeekInfo('2026-11-02');
    expect(iso.weekNumber).toBe(45);
    expect(iso.year).toBe(2026);
    expect(iso.label).toBe('Week 45, 2026');

    const formatted = formatWeekRange('2026-11-02', '2026-11-08');
    expect(formatted).toMatch(/Nov\s+2\s+–\s+Nov\s+8,\s+2026/);
  });

  it('generates deterministic IDs', () => {
    expect(timetableIdFor('b_pune', '2026-11-02')).toBe('timetable_b_pune_2026-11-02');
    expect(revisionIdFor(1)).toBe('rev_1');
    expect(revisionIdFor(3)).toBe('rev_3');
  });

  it('creates an empty 7-day schedule template', () => {
    const template = createEmptyDaysRecord('2026-11-02');
    expect(Object.keys(template)).toHaveLength(7);
    expect(template.monday.date).toBe('2026-11-02');
    expect(template.monday.activities).toEqual([]);
    expect(template.sunday.date).toBe('2026-11-08');
  });
});

describe('Stage 8 Weekly Timetable: Activity Ordering & Times', () => {
  const a1: TimetableActivity = {
    id: 'a1', orderIndex: 2, type: 'lesson', title: 'Lesson 2', startTime: '11:00', endTime: '12:30',
    durationMinutes: 90, courseId: 'c1', objectives: [],
  };
  const a2: TimetableActivity = {
    id: 'a2', orderIndex: 0, type: 'lesson', title: 'Lesson 1', startTime: '09:00', endTime: '10:30',
    durationMinutes: 90, courseId: 'c1', objectives: [],
  };
  const a3: TimetableActivity = {
    id: 'a3', orderIndex: 1, type: 'practical_exercise', title: 'Lab', startTime: '10:30', endTime: '11:00',
    durationMinutes: 30, courseId: 'c1', objectives: [],
  };

  it('sorts activities by orderIndex and re-indexes cleanly', () => {
    const sorted = sortActivities([a1, a2, a3]);
    expect(sorted.map((a) => a.id)).toEqual(['a2', 'a3', 'a1']);

    const normalized = normalizeActivityOrder([a1, a2, a3]);
    expect(normalized[0].orderIndex).toBe(0);
    expect(normalized[1].orderIndex).toBe(1);
    expect(normalized[2].orderIndex).toBe(2);
  });

  it('calculates duration in minutes accurately', () => {
    expect(calculateDurationMinutes('09:00', '10:30')).toBe(90);
    expect(calculateDurationMinutes('14:15', '16:45')).toBe(150);
    expect(calculateDurationMinutes('10:00', '10:00')).toBe(0);
  });
});

describe('Stage 8 Weekly Timetable: State Machine Transitions', () => {
  it('allows branch_admin to create draft, edit draft, and submit for approval', () => {
    expect(canTransitionTimetable(null, 'draft', 'branch_admin').allowed).toBe(true);
    expect(canTransitionTimetable('draft', 'draft', 'branch_admin').allowed).toBe(true);
    expect(canTransitionTimetable('draft', 'submitted', 'branch_admin').allowed).toBe(true);
    expect(canTransitionTimetable('changes_requested', 'draft', 'branch_admin').allowed).toBe(true);
    expect(canTransitionTimetable('changes_requested', 'submitted', 'branch_admin').allowed).toBe(true);
  });

  it('strictly forbids branch_admin from approving timetables', () => {
    const res = canTransitionTimetable('submitted', 'approved', 'branch_admin');
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/Only Super Admin can approve/);
  });

  it('strictly forbids branch_admin from requesting changes on timetables', () => {
    const res = canTransitionTimetable('submitted', 'changes_requested', 'branch_admin');
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/Only Super Admin can request changes/);
  });

  it('allows super_admin to approve submissions', () => {
    expect(canTransitionTimetable('submitted', 'approved', 'super_admin').allowed).toBe(true);
  });

  it('requires super_admin to provide comments when requesting changes', () => {
    expect(canTransitionTimetable('submitted', 'changes_requested', 'super_admin', false).allowed).toBe(false);
    expect(canTransitionTimetable('submitted', 'changes_requested', 'super_admin', true).allowed).toBe(true);
  });

  it('forbids instructors and students from mutating timetable statuses', () => {
    expect(canTransitionTimetable('draft', 'submitted', 'instructor').allowed).toBe(false);
    expect(canTransitionTimetable('draft', 'submitted', 'student').allowed).toBe(false);
    expect(canTransitionTimetable('submitted', 'approved', 'instructor').allowed).toBe(false);
  });
});

describe('Stage 8 Weekly Timetable: Activity Progress Derivation', () => {
  const NOW = new Date('2026-11-04T12:00:00.000Z');

  it('derives lesson progress: completed, in_progress, overdue, not_started', () => {
    const lessonAct: TimetableActivity = {
      id: 'act_les', orderIndex: 0, type: 'lesson', title: 'JS Async', startTime: '09:00', endTime: '10:00',
      durationMinutes: 60, courseId: 'c1', lessonId: 'les_1', objectives: [],
    };

    const completedProgress: Progress[] = [
      { id: 'p1', orgId: 'o', courseId: 'c1', moduleId: 'm1', lessonId: 'les_1', studentId: 's1', status: 'completed', timeSpentSeconds: 300, lastAccessedAt: '', completedAt: '2026-11-04T09:45:00Z', createdAt: '', updatedAt: '' },
    ];
    const resCompleted = deriveActivityProgress(lessonAct, '2026-11-04', completedProgress, [], NOW);
    expect(resCompleted.state).toBe('completed');
    expect(resCompleted.actionLabel).toBe('Review');

    const inProgressProgress: Progress[] = [
      { id: 'p2', orgId: 'o', courseId: 'c1', moduleId: 'm1', lessonId: 'les_1', studentId: 's1', status: 'in_progress', timeSpentSeconds: 60, lastAccessedAt: '', createdAt: '', updatedAt: '' },
    ];
    const resInProgress = deriveActivityProgress(lessonAct, '2026-11-04', inProgressProgress, [], NOW);
    expect(resInProgress.state).toBe('in_progress');
    expect(resInProgress.actionLabel).toBe('Continue');

    // No progress and past 10:00 UTC on 2026-11-04 (NOW is 12:00) -> overdue
    const resOverdue = deriveActivityProgress(lessonAct, '2026-11-04', [], [], NOW);
    expect(resOverdue.state).toBe('overdue');

    // Future day (2026-11-05) -> not started
    const resNotStarted = deriveActivityProgress(lessonAct, '2026-11-05', [], [], NOW);
    expect(resNotStarted.state).toBe('not_started');
  });

  it('derives assignment progress: graded, submitted, correction, overdue', () => {
    const assignAct: TimetableActivity = {
      id: 'act_asn', orderIndex: 1, type: 'assignment', title: 'Drills', startTime: '10:00', endTime: '11:00',
      durationMinutes: 60, courseId: 'c1', assignmentId: 'asn_1', objectives: [],
    };

    const gradedSub: Submission[] = [
      { id: 'asn_1_s1', orgId: 'o', assignmentId: 'asn_1', batchId: 'b1', studentId: 's1', status: 'graded', score: 9, submittedAt: '2026-11-04T10:30:00Z', createdAt: '', updatedAt: '' },
    ];
    expect(deriveActivityProgress(assignAct, '2026-11-04', [], gradedSub, NOW).state).toBe('completed');
    expect(deriveActivityProgress(assignAct, '2026-11-04', [], gradedSub, NOW).score).toBe(9);

    const corrSub: Submission[] = [
      { id: 'asn_1_s1', orgId: 'o', assignmentId: 'asn_1', batchId: 'b1', studentId: 's1', status: 'resubmit_requested', submittedAt: '2026-11-04T10:30:00Z', createdAt: '', updatedAt: '' },
    ];
    expect(deriveActivityProgress(assignAct, '2026-11-04', [], corrSub, NOW).state).toBe('in_progress');

    // Past 11:00 with no submission -> overdue
    expect(deriveActivityProgress(assignAct, '2026-11-04', [], [], NOW).state).toBe('overdue');
  });

  it('enforces assessment availability windows', () => {
    const examAct: TimetableActivity = {
      id: 'act_exam', orderIndex: 2, type: 'examination', title: 'Midterm', startTime: '14:00', endTime: '16:00',
      durationMinutes: 120, courseId: 'c1', objectives: [],
      assessment: {
        assessmentType: 'weekly_test', maxMarks: 100, format: 'mcq', syllabus: 'Modules 1-3',
        instructions: 'Closed book', availabilityWindow: {
          start: '2026-11-04T14:00:00.000Z',
          end: '2026-11-04T16:00:00.000Z',
        },
      },
    };

    // Before window (NOW is 12:00) -> blocked
    const resBlocked = deriveActivityProgress(examAct, '2026-11-04', [], [], NOW);
    expect(resBlocked.state).toBe('blocked');
    expect(resBlocked.isActionable).toBe(false);

    // During window (15:00) -> ready to start
    const duringWindow = new Date('2026-11-04T15:00:00.000Z');
    const resReady = deriveActivityProgress(examAct, '2026-11-04', [], [], duringWindow);
    expect(resReady.state).toBe('not_started');
    expect(resReady.isActionable).toBe(true);

    // After window (17:00) -> window closed
    const afterWindow = new Date('2026-11-04T17:00:00.000Z');
    const resClosed = deriveActivityProgress(examAct, '2026-11-04', [], [], afterWindow);
    expect(resClosed.state).toBe('overdue');
  });

  it('calculates day completion metrics properly', () => {
    const day = {
      date: '2026-11-04',
      dayOfWeek: 'wednesday' as const,
      activities: [
        { id: 'a1', orderIndex: 0, type: 'lesson' as const, title: 'L1', startTime: '09:00', endTime: '10:00', durationMinutes: 60, courseId: 'c1', lessonId: 'l1', objectives: [] },
        { id: 'a2', orderIndex: 1, type: 'lesson' as const, title: 'L2', startTime: '10:00', endTime: '11:00', durationMinutes: 60, courseId: 'c1', lessonId: 'l2', objectives: [] },
      ],
    };

    const progress: Progress[] = [
      { id: 'p1', orgId: 'o', courseId: 'c1', moduleId: 'm', lessonId: 'l1', studentId: 's', status: 'completed', timeSpentSeconds: 100, lastAccessedAt: '', createdAt: '', updatedAt: '' },
    ];

    const result = calculateDayCompletion(day, progress, [], NOW);
    expect(result.totalCount).toBe(2);
    expect(result.completedCount).toBe(1);
    expect(result.percentage).toBe(50);
  });
});

describe('Stage 8 Weekly Timetable: Zod Validation Schemas', () => {
  it('validates a correct timetable activity and rejects invalid time bounds', () => {
    const valid = {
      id: 'act_1', orderIndex: 0, type: 'lesson', title: 'React Hooks', startTime: '09:00', endTime: '10:30',
      durationMinutes: 90, courseId: 'course_1', objectives: ['Understand useState'],
    };
    expect(timetableActivitySchema.safeParse(valid).success).toBe(true);

    const invalidTimes = { ...valid, startTime: '11:00', endTime: '10:00' };
    expect(timetableActivitySchema.safeParse(invalidTimes).success).toBe(false);
  });

  it('validates assessment metadata and prevents passing marks > max marks', () => {
    const valid = {
      assessmentType: 'weekly_test', maxMarks: 50, passingMarks: 25, format: 'mcq',
      syllabus: 'State management', instructions: 'No calculators',
    };
    expect(assessmentScheduleSchema.safeParse(valid).success).toBe(true);

    const invalid = { ...valid, maxMarks: 50, passingMarks: 60 };
    expect(assessmentScheduleSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates mandatory correction comment length (min 5 chars)', () => {
    expect(timetableCorrectionSchema.safeParse({ comment: 'Fix Thursday time' }).success).toBe(true);
    expect(timetableCorrectionSchema.safeParse({ comment: 'Bad' }).success).toBe(false);
    expect(timetableCorrectionSchema.safeParse({ comment: '   ' }).success).toBe(false);
  });

  it('validates weekly timetable root and revision shapes', () => {
    const root = {
      id: 'timetable_b1_2026-11-02', orgId: 'org1', branchId: 'br1', batchId: 'b1', courseId: 'c1',
      weekStartDate: '2026-11-02', weekEndDate: '2026-11-08', activeRevisionId: null,
      currentRevisionId: 'rev_1', latestStatus: 'draft',
    };
    expect(weeklyTimetableSchema.safeParse(root).success).toBe(true);
  });
});


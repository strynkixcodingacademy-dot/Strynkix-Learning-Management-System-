import { describe, it, expect } from 'vitest';
import {
  canReviewerGrade,
  canReviewerRequestCorrection,
  canStudentSubmit,
  getDeadlineState,
  getSubmissionContentError,
  isLateSubmission,
} from '@/lib/learning/submission-state';
import { combineMetrics, computeLearningMetrics, MetricsInput } from '@/lib/learning/metrics';
import { dailyAssignmentSchema, dailyPlanSchema } from '@/types/validation';
import { Assignment, DailyPlan, Progress, Submission } from '@/types/domain';

const NOW = new Date('2026-10-10T12:00:00.000Z');

const plan = (date: string, lessonIds: string[], dueAt: string, status: DailyPlan['status'] = 'published'): DailyPlan => ({
  id: `b1_${date}`, orgId: 'o', branchId: 'br', courseId: 'c', batchId: 'b1', date, title: `Day ${date}`,
  objectives: [], lessonIds, learningDueAt: dueAt, status, createdById: 'i', createdAt: '', updatedAt: '',
});
const assignment = (id: string, deadline: string, totalPoints = 10, status: Assignment['status'] = 'published'): Assignment => ({
  id, orgId: 'o', courseId: 'c', batchId: 'b1', planId: id, title: id, description: 'Do it',
  submissionType: 'text', totalPoints, rubric: [], deadline, status, createdById: 'i', createdAt: '', updatedAt: '',
});
const submission = (assignmentId: string, submittedAt: string, status: Submission['status'] = 'submitted', score?: number): Submission => ({
  id: `${assignmentId}_s`, orgId: 'o', assignmentId, batchId: 'b1', studentId: 's', status, submittedAt, score,
  createdAt: '', updatedAt: '',
});
const progress = (lessonId: string, status: Progress['status']): Progress => ({
  id: `s_c_${lessonId}`, orgId: 'o', courseId: 'c', moduleId: 'm', lessonId, studentId: 's', status,
  timeSpentSeconds: 60, lastAccessedAt: '', createdAt: '', updatedAt: '',
});

const base = (overrides: Partial<MetricsInput> = {}): MetricsInput => ({
  plans: [], assignments: [], submissions: [], progress: [], now: NOW, today: '2026-10-10', ...overrides,
});

describe('Stage 7: submission state machine', () => {
  it('students submit when nothing exists, edit before review, and resubmit after a correction request only', () => {
    expect(canStudentSubmit(null)).toBe(true);
    expect(canStudentSubmit({ status: 'submitted' })).toBe(true);
    expect(canStudentSubmit({ status: 'resubmit_requested' })).toBe(true);
    expect(canStudentSubmit({ status: 'graded' })).toBe(false);
    expect(canStudentSubmit({ status: 'under_review' })).toBe(false);
  });

  it('reviewers grade from submitted/graded/correction and request corrections from submitted/graded', () => {
    expect(['submitted', 'graded', 'resubmit_requested'].every((s) => canReviewerGrade(s as Submission['status']))).toBe(true);
    expect(canReviewerGrade('draft')).toBe(false);
    expect(canReviewerRequestCorrection('submitted')).toBe(true);
    expect(canReviewerRequestCorrection('graded')).toBe(true);
    expect(canReviewerRequestCorrection('resubmit_requested')).toBe(false);
  });

  it('derives lateness from server submittedAt vs deadline', () => {
    expect(isLateSubmission('2026-10-10T18:00:01.000Z', '2026-10-10T18:00:00.000Z')).toBe(true);
    expect(isLateSubmission('2026-10-10T17:59:59.000Z', '2026-10-10T18:00:00.000Z')).toBe(false);
    expect(isLateSubmission(undefined, '2026-10-10T18:00:00.000Z')).toBe(false);
  });

  it('reports deadline states for every situation', () => {
    expect(getDeadlineState('2026-10-12T00:00:00.000Z', null, NOW)).toBe('upcoming');
    expect(getDeadlineState('2026-10-10T20:00:00.000Z', null, NOW)).toBe('due_soon');
    expect(getDeadlineState('2026-10-09T00:00:00.000Z', null, NOW)).toBe('overdue');
    expect(getDeadlineState('2026-10-09T00:00:00.000Z', { status: 'submitted', submittedAt: '2026-10-08T00:00:00.000Z' }, NOW)).toBe('submitted_on_time');
    expect(getDeadlineState('2026-10-09T00:00:00.000Z', { status: 'submitted', submittedAt: '2026-10-09T01:00:00.000Z' }, NOW)).toBe('submitted_late');
    expect(getDeadlineState('2026-10-09T00:00:00.000Z', { status: 'resubmit_requested', submittedAt: '' }, NOW)).toBe('correction_requested');
    expect(getDeadlineState('2026-10-09T00:00:00.000Z', { status: 'graded', submittedAt: '' }, NOW)).toBe('graded');
  });

  it('validates content against the submission type', () => {
    expect(getSubmissionContentError('text', { textAnswer: 'x' })).toBeNull();
    expect(getSubmissionContentError('text', { codeContent: 'x' })).toMatch(/written answer/);
    expect(getSubmissionContentError('code', { codeContent: '  ' })).toMatch(/Code is required/);
    expect(getSubmissionContentError('text_and_code', { textAnswer: 'a' })).toMatch(/Both/);
    expect(getSubmissionContentError('text_and_code', { textAnswer: 'a', codeContent: 'b' })).toBeNull();
  });
});

describe('Stage 7: plan and assignment schemas', () => {
  const validPlan = {
    orgId: 'o', branchId: 'br', courseId: 'c', batchId: 'b1', date: '2026-10-10', title: 'Day 10',
    objectives: ['A'], lessonIds: ['l1'], learningDueAt: '2026-10-10T18:00:00.000Z', status: 'draft',
  };
  it('accepts a valid plan and rejects bad dates, too many lessons, and duplicates', () => {
    expect(dailyPlanSchema.safeParse(validPlan).success).toBe(true);
    expect(dailyPlanSchema.safeParse({ ...validPlan, date: '10/10/2026' }).success).toBe(false);
    expect(dailyPlanSchema.safeParse({ ...validPlan, lessonIds: Array.from({ length: 11 }, (_, i) => `l${i}`) }).success).toBe(false);
    expect(dailyPlanSchema.safeParse({ ...validPlan, lessonIds: ['l1', 'l1'] }).success).toBe(false);
  });
  it('requires instructions, a deadline and marks within bounds for assignments', () => {
    const a = { title: 'Lab', description: 'Write code', submissionType: 'code', totalPoints: 10, deadline: '2026-10-10T18:00:00.000Z' };
    expect(dailyAssignmentSchema.safeParse(a).success).toBe(true);
    expect(dailyAssignmentSchema.safeParse({ ...a, totalPoints: 0 }).success).toBe(false);
    expect(dailyAssignmentSchema.safeParse({ ...a, description: '' }).success).toBe(false);
    expect(dailyAssignmentSchema.safeParse({ ...a, deadline: 'tomorrow' }).success).toBe(false);
    expect(dailyAssignmentSchema.safeParse({ ...a, submissionType: 'zip' }).success).toBe(false);
  });
});

describe('Stage 7: metrics', () => {
  it('learning completion counts distinct lessons from published plans dated today or earlier', () => {
    const m = computeLearningMetrics(base({
      plans: [
        plan('2026-10-09', ['l1', 'l2'], '2026-10-09T18:00:00.000Z'),
        plan('2026-10-10', ['l2', 'l3'], '2026-10-10T18:00:00.000Z'),
        plan('2026-10-11', ['l4'], '2026-10-11T18:00:00.000Z'), // future: excluded
        plan('2026-10-08', ['l5'], '2026-10-08T18:00:00.000Z', 'draft'), // unpublished: excluded
      ],
      progress: [progress('l1', 'completed'), progress('l2', 'in_progress'), progress('l9', 'completed')],
    }));
    expect(m.learningCompletion).toEqual({ numerator: 1, denominator: 3, percentage: 33 });
    // l2 is overdue (earliest due date 10-09 passed); l3 is due tonight, not overdue yet.
    expect(m.overdueLessons.map((o) => o.lessonId)).toEqual(['l2']);
  });

  it('opening a lesson (in_progress) does not count as completion', () => {
    const m = computeLearningMetrics(base({
      plans: [plan('2026-10-10', ['l1'], '2026-10-11T00:00:00.000Z')],
      progress: [progress('l1', 'in_progress')],
    }));
    expect(m.learningCompletion.percentage).toBe(0);
  });

  it('submission rate uses only due assignments; future ones are upcoming; pre-enrollment ones are excluded', () => {
    const m = computeLearningMetrics(base({
      enrolledAt: '2026-10-05T00:00:00.000Z',
      assignments: [
        assignment('a_old', '2026-10-01T18:00:00.000Z'), // before enrollment
        assignment('a1', '2026-10-08T18:00:00.000Z'),
        assignment('a2', '2026-10-09T18:00:00.000Z'),
        assignment('a3', '2026-10-12T18:00:00.000Z'), // future
        assignment('a_draft', '2026-10-08T18:00:00.000Z', 10, 'draft'),
      ],
      submissions: [submission('a1', '2026-10-08T10:00:00.000Z'), submission('a3', '2026-10-10T10:00:00.000Z')],
    }));
    expect(m.submissionRate).toEqual({ numerator: 1, denominator: 2, percentage: 50 });
    expect(m.upcomingAssignments).toBe(1);
    expect(m.overdueAssignments.map((o) => o.assignmentId)).toEqual(['a2']);
  });

  it('assessment uses graded work only; ungraded work is excluded, not zero', () => {
    const m = computeLearningMetrics(base({
      assignments: [assignment('a1', '2026-10-08T18:00:00.000Z', 10), assignment('a2', '2026-10-09T18:00:00.000Z', 20)],
      submissions: [submission('a1', '2026-10-08T10:00:00.000Z', 'graded', 7), submission('a2', '2026-10-09T10:00:00.000Z', 'submitted')],
    }));
    expect(m.assessment).toEqual({ numerator: 7, denominator: 10, percentage: 70, gradedCount: 1 });
  });

  it('a correction request removes the grade from assessment until regraded', () => {
    const m = computeLearningMetrics(base({
      assignments: [assignment('a1', '2026-10-08T18:00:00.000Z', 10)],
      submissions: [submission('a1', '2026-10-08T10:00:00.000Z', 'resubmit_requested', 4)],
    }));
    expect(m.assessment.percentage).toBeNull();
    expect(m.submissionRate.percentage).toBe(100);
  });

  it('counts late submissions and returns null (not 0%) when nothing is due or graded', () => {
    const empty = computeLearningMetrics(base());
    expect(empty.learningCompletion.percentage).toBeNull();
    expect(empty.submissionRate.percentage).toBeNull();
    expect(empty.assessment.percentage).toBeNull();
    const m = computeLearningMetrics(base({
      assignments: [assignment('a1', '2026-10-08T18:00:00.000Z')],
      submissions: [submission('a1', '2026-10-09T10:00:00.000Z')],
    }));
    expect(m.lateSubmissions).toBe(1);
  });

  it('publishing new future work does not change past metrics', () => {
    const past = { plans: [plan('2026-10-09', ['l1'], '2026-10-09T18:00:00.000Z')], assignments: [assignment('a1', '2026-10-09T18:00:00.000Z')], submissions: [submission('a1', '2026-10-09T10:00:00.000Z')], progress: [progress('l1', 'completed')] };
    const before = computeLearningMetrics(base(past));
    const after = computeLearningMetrics(base({
      ...past,
      plans: [...past.plans, plan('2026-10-15', ['l7', 'l8'], '2026-10-15T18:00:00.000Z')],
      assignments: [...past.assignments, assignment('a9', '2026-10-15T18:00:00.000Z')],
    }));
    expect(after.learningCompletion).toEqual(before.learningCompletion);
    expect(after.submissionRate).toEqual(before.submissionRate);
    expect(after.assessment).toEqual(before.assessment);
  });

  it('combines courses by summing numerators and denominators', () => {
    const a = computeLearningMetrics(base({ assignments: [assignment('a1', '2026-10-08T18:00:00.000Z', 10)], submissions: [submission('a1', '2026-10-08T10:00:00.000Z', 'graded', 10)] }));
    const b = computeLearningMetrics(base({ assignments: [assignment('b1', '2026-10-08T18:00:00.000Z', 90)], submissions: [submission('b1', '2026-10-08T10:00:00.000Z', 'graded', 0)] }));
    // 10/100 = 10%, not the 50% an average of percentages would give.
    expect(combineMetrics([a, b]).assessment.percentage).toBe(10);
  });
});

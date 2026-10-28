/**
 * Analytics — totals are sums of real numerators/denominators, inactive
 * enrollments are excluded, and "needs attention" reasons are explicit.
 */

import { describe, it, expect } from 'vitest';
import { buildAnalytics, lastNDays, studentFlags } from '@/lib/analytics/metrics';
import { Assignment, Batch, DailyPlan, Enrollment, Progress, Submission } from '@/types/domain';

const NOW = new Date('2026-10-28T12:00:00');
const at = (d: string, t = '10:00:00') => new Date(`${d}T${t}`).toISOString();

const batch = (id: string): Batch => ({
  id, orgId: 'org', branchId: 'br', courseId: 'c1', name: `Batch ${id}`, code: id,
  instructorUserIds: [], startDate: at('2026-10-01'), status: 'in_progress', createdAt: '', updatedAt: '',
});
const enr = (b: string, s: string, status: Enrollment['status'] = 'active'): Enrollment => ({
  id: `c1_${s}`, orgId: 'org', branchId: 'br', courseId: 'c1', batchId: b, studentId: s, status,
  enrolledAt: at('2026-10-01'), studentDisplayName: s.toUpperCase(), createdAt: '', updatedAt: '',
});
const plan = (b: string, date: string, lessonIds: string[]): DailyPlan => ({
  id: `${b}_${date}`, orgId: 'org', branchId: 'br', courseId: 'c1', batchId: b, date, title: date, objectives: [],
  lessonIds, learningDueAt: at(date, '20:00:00'), assignmentId: `${b}_${date}`, status: 'published', createdById: 'i', createdAt: '', updatedAt: '',
});
const asg = (b: string, date: string): Assignment => ({
  id: `${b}_${date}`, orgId: 'org', courseId: 'c1', batchId: b, planId: `${b}_${date}`, title: 'A', description: 'Do it',
  totalPoints: 10, rubric: [], deadline: at(date, '23:00:00'), status: 'published', createdById: 'i', createdAt: '', updatedAt: '',
});
const sub = (b: string, date: string, s: string, extra: Partial<Submission> = {}): Submission => ({
  id: `${b}_${date}_${s}`, orgId: 'org', assignmentId: `${b}_${date}`, batchId: b, studentId: s,
  status: 'submitted', submittedAt: at(date, '18:00:00'), createdAt: '', updatedAt: '', ...extra,
});
const done = (s: string, lessonId: string, date: string): Progress => ({
  id: `${s}_c1_${lessonId}`, orgId: 'org', courseId: 'c1', moduleId: 'm', lessonId, studentId: s, batchId: 'b1',
  status: 'completed', timeSpentSeconds: 60, lastAccessedAt: at(date), completedAt: at(date), createdAt: '', updatedAt: '',
});

describe('buildAnalytics', () => {
  const data = [{
    batch: batch('b1'),
    enrollments: [enr('b1', 's1'), enr('b1', 's2'), enr('b1', 'gone', 'dropped')],
    plans: [plan('b1', '2026-10-26', ['l1']), plan('b1', '2026-10-27', ['l2']), plan('b1', '2026-10-30', ['l3'])],
    assignments: [asg('b1', '2026-10-26'), asg('b1', '2026-10-27')],
    submissions: [
      sub('b1', '2026-10-26', 's1', { status: 'graded', score: 8 }),
      sub('b1', '2026-10-27', 's1'),
      sub('b1', '2026-10-26', 'gone'),
    ],
    progress: [done('s1', 'l1', '2026-10-26'), done('s1', 'l2', '2026-10-27')],
  }];
  const r = buildAnalytics(data, NOW);

  it('counts only active enrollments and published plans up to today', () => {
    expect(r.totals.activeStudents).toBe(2);
    expect(r.totals.plansPublished).toBe(2);
  });

  it('sums numerators and denominators across students (no averaged percentages)', () => {
    // 2 students × 2 lessons planned up to today; s1 finished both.
    expect(r.metrics.learningCompletion).toMatchObject({ numerator: 2, denominator: 4, percentage: 50 });
    // 2 students × 2 due assignments; s1 submitted both.
    expect(r.metrics.submissionRate).toMatchObject({ numerator: 2, denominator: 4, percentage: 50 });
    // Only graded work: 8 of 10.
    expect(r.metrics.assessment).toMatchObject({ numerator: 8, denominator: 10, percentage: 80, gradedCount: 1 });
  });

  it('review backlog ignores withdrawn students', () => {
    expect(r.totals.reviewBacklog).toBe(1);
  });

  it('flags the student who missed deadlines, with reasons, and puts them first', () => {
    expect(r.students[0].studentId).toBe('s2');
    expect(r.students[0].flags.join(' ')).toMatch(/2 assignments past deadline/);
    expect(r.students.find((s) => s.studentId === 's1')!.flags).toEqual([]);
    expect(r.totals.atRisk).toBe(1);
  });

  it('builds a 14-day series that includes withdrawn students’ historic activity', () => {
    expect(r.days).toHaveLength(14);
    expect(r.days.at(-1)!.date).toBe('2026-10-28');
    const d26 = r.days.find((d) => d.date === '2026-10-26')!;
    expect(d26).toMatchObject({ submissions: 2, completions: 1 });
  });

  it('reports nothing-due as null percentages, never 0%', () => {
    const empty = buildAnalytics([{ ...data[0], plans: [], assignments: [], submissions: [], progress: [] }], NOW);
    expect(empty.metrics.learningCompletion.percentage).toBeNull();
    expect(empty.metrics.submissionRate.percentage).toBeNull();
  });
});

describe('helpers', () => {
  it('lastNDays ends today and is contiguous', () => {
    expect(lastNDays(NOW, 3)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
  });

  it('low marks only flag after at least two graded pieces of work', () => {
    const base = { learningCompletion: { numerator: 0, denominator: 0, percentage: null }, submissionRate: { numerator: 0, denominator: 0, percentage: null }, upcomingAssignments: 0, lateSubmissions: 0, overdueLessons: [], overdueAssignments: [] };
    expect(studentFlags({ ...base, assessment: { numerator: 2, denominator: 10, percentage: 20, gradedCount: 1 } })).toEqual([]);
    expect(studentFlags({ ...base, assessment: { numerator: 4, denominator: 20, percentage: 20, gradedCount: 2 } })).toEqual(['average mark 20%']);
  });
});

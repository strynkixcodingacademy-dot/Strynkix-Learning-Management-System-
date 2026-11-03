import { describe, it, expect } from 'vitest';
import { currentStreak, earnedAchievements, learningDays, longestStreak, monthSummary, perfectAttendanceMonths, ratingSummary, weekStart, weeklyHistory, weeklyProgress } from '@/lib/engagement/streaks';

describe('learning streaks', () => {
  const days = learningDays([{ kind: 'lesson', date: '2026-03-01' }, { kind: 'assessment', date: '2026-03-02' }, { kind: 'attendance', date: '2026-03-02' }, { kind: 'lesson', date: '2026-03-03' }, { kind: 'lesson', date: '2026-03-05' }]);
  it('counts unique days and consecutive runs', () => {
    expect(days).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05']);
    expect(longestStreak(days)).toBe(3);
  });
  it('a streak survives until the end of the next day, then resets', () => {
    expect(currentStreak(days, '2026-03-05')).toBe(1);
    expect(currentStreak(days, '2026-03-06')).toBe(1); // not yet broken today
    expect(currentStreak(days, '2026-03-07')).toBe(0);
    expect(currentStreak(days, '2026-03-04')).toBe(3);
  });
  it('crosses month and year boundaries', () => {
    expect(currentStreak(['2025-12-30', '2025-12-31', '2026-01-01'], '2026-01-01')).toBe(3);
    expect(longestStreak(['2024-02-28', '2024-02-29', '2024-03-01'])).toBe(3);
  });
  it('weeks start on Monday; weekly goal and history', () => {
    expect(weekStart('2026-03-08')).toBe('2026-03-02'); // Sunday → Monday before
    expect(weekStart('2026-03-02')).toBe('2026-03-02');
    expect(weeklyProgress(days, '2026-03-05', 3)).toEqual({ weekStart: '2026-03-02', goal: 3, done: 3, met: true });
    expect(weeklyHistory(days, '2026-03-05', 2)).toEqual([{ weekStart: '2026-02-23', days: 1 }, { weekStart: '2026-03-02', days: 3 }]);
    expect(monthSummary([{ kind: 'lesson', date: '2026-03-01' }, { kind: 'lesson', date: '2026-03-01' }, { kind: 'attendance', date: '2026-03-04' }], '2026-03')).toMatchObject({ learningDays: 2, lessons: 2, classesAttended: 1 });
  });
});

describe('achievements and ratings', () => {
  const stats = { lessonsCompleted: 12, assignmentsSubmitted: 1, assessmentsCompleted: 0, projectsApproved: 0, coursesCompleted: 0, longestStreak: 7, perfectAttendanceMonths: ['2026-02'] };
  it('awards only what the verified stats satisfy, with configurable thresholds', () => {
    expect(earnedAchievements(stats).map((a) => a.key).sort()).toEqual(['first_assignment', 'first_lesson', 'lessons_10', 'perfect_attendance_2026-02', 'streak_7']);
    expect(earnedAchievements(stats, { disabled: ['streak_7'], thresholds: { lessons_10: 15 } }).map((a) => a.key).sort()).toEqual(['first_assignment', 'first_lesson', 'perfect_attendance_2026-02']);
    expect(earnedAchievements(stats, { disabled: [], thresholds: { first_lesson: 99 } }).some((a) => a.key === 'first_lesson')).toBe(true); // fixed thresholds can't be changed
  });
  it('perfect attendance needs a completed month with 4+ classes, all present', () => {
    const r = (date: string, status: string) => ({ date, status });
    expect(perfectAttendanceMonths([r('2026-02-02', 'present'), r('2026-02-09', 'present'), r('2026-02-16', 'excused'), r('2026-02-17', 'present'), r('2026-02-23', 'present'), r('2026-03-02', 'present')], '2026-03-10')).toEqual(['2026-02']);
    expect(perfectAttendanceMonths([r('2026-02-02', 'present'), r('2026-02-09', 'late'), r('2026-02-16', 'present'), r('2026-02-23', 'present')], '2026-03-10')).toEqual([]);
  });
  it('averages appear only with enough responses', () => {
    expect(ratingSummary([5, 4])).toMatchObject({ responses: 2, average: null });
    expect(ratingSummary([5, 4, 3])).toMatchObject({ responses: 3, average: 4, distribution: [0, 0, 1, 1, 1] });
  });
});

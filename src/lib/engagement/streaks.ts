/**
 * Strynkix LMS — learning days, streaks, goals and achievement rules
 * (Stage 10). Pure and client-safe.
 *
 * A learning day is a local date on which the student did something the
 * platform records: completed a lesson, submitted an assessment or a daily
 * assignment, or attended a class (present or late). Opening the dashboard or
 * a lesson never counts.
 */

export type LearningEventKind = 'lesson' | 'assessment' | 'assignment' | 'attendance';
export interface LearningEvent { kind: LearningEventKind; date: string } // local YYYY-MM-DD

const addDays = (date: string, n: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export const learningDays = (events: LearningEvent[]) => [...new Set(events.map((e) => e.date))].sort();

/** Consecutive learning days ending today, or yesterday if today has none yet (the streak is still alive). */
export function currentStreak(days: string[], today: string): number {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export function longestStreak(days: string[]): number {
  let best = 0, run = 0, prev: string | null = null;
  for (const d of [...days].sort()) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}

/** Monday of the local week containing `date`. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function weeklyProgress(days: string[], today: string, goal: number) {
  const start = weekStart(today);
  const done = days.filter((d) => d >= start && d <= today).length;
  return { weekStart: start, goal, done, met: done >= goal };
}

/** Learning days per week for the last `weeks` weeks (oldest first). */
export function weeklyHistory(days: string[], today: string, weeks = 12) {
  const current = weekStart(today);
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(current, -7 * (weeks - 1 - i));
    const end = addDays(start, 6);
    return { weekStart: start, days: days.filter((d) => d >= start && d <= end).length };
  });
}

export function monthSummary(events: LearningEvent[], month: string) {
  const inMonth = events.filter((e) => e.date.startsWith(month));
  const by = (k: LearningEventKind) => inMonth.filter((e) => e.kind === k).length;
  return { month, learningDays: new Set(inMonth.map((e) => e.date)).size, lessons: by('lesson'), assessments: by('assessment'), assignments: by('assignment'), classesAttended: by('attendance') };
}

// --- achievements ----------------------------------------------------------

export interface AchievementStats {
  lessonsCompleted: number; assignmentsSubmitted: number; assessmentsCompleted: number; projectsApproved: number;
  coursesCompleted: number; longestStreak: number; perfectAttendanceMonths: string[];
}
export type AchievementMetric = Exclude<keyof AchievementStats, 'perfectAttendanceMonths'>;
export interface AchievementDefinition { id: string; title: string; description: string; metric: AchievementMetric | 'perfectAttendanceMonth'; threshold: number; configurable: boolean }

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { id: 'first_lesson', title: 'First Lesson Completed', description: 'Completed your first lesson.', metric: 'lessonsCompleted', threshold: 1, configurable: false },
  { id: 'lessons_10', title: 'Ten Lessons Completed', description: 'Completed 10 lessons.', metric: 'lessonsCompleted', threshold: 10, configurable: true },
  { id: 'lessons_50', title: 'Fifty Lessons Completed', description: 'Completed 50 lessons.', metric: 'lessonsCompleted', threshold: 50, configurable: true },
  { id: 'first_assignment', title: 'First Assignment Submitted', description: 'Submitted your first assignment.', metric: 'assignmentsSubmitted', threshold: 1, configurable: false },
  { id: 'assessments_10', title: 'Ten Assessments Completed', description: 'Completed 10 quizzes, written activities or exams.', metric: 'assessmentsCompleted', threshold: 10, configurable: true },
  { id: 'streak_7', title: 'Seven-Day Learning Streak', description: 'Learned on 7 days in a row.', metric: 'longestStreak', threshold: 7, configurable: true },
  { id: 'streak_30', title: 'Thirty-Day Learning Streak', description: 'Learned on 30 days in a row.', metric: 'longestStreak', threshold: 30, configurable: true },
  { id: 'first_project', title: 'First Project Completed', description: 'An instructor approved your first project.', metric: 'projectsApproved', threshold: 1, configurable: false },
  { id: 'course_completed', title: 'Course Completed', description: 'Completed a course.', metric: 'coursesCompleted', threshold: 1, configurable: false },
  { id: 'perfect_attendance', title: 'Perfect Attendance Month', description: 'Attended every class in a month (at least 4 classes).', metric: 'perfectAttendanceMonth', threshold: 1, configurable: false },
];

export interface AchievementSettings { disabled: string[]; thresholds: Record<string, number> }
export const DEFAULT_ACHIEVEMENT_SETTINGS: AchievementSettings = { disabled: [], thresholds: {} };

/** Achievements the stats satisfy, as award keys (perfect attendance is one award per month). */
export function earnedAchievements(stats: AchievementStats, settings: AchievementSettings = DEFAULT_ACHIEVEMENT_SETTINGS): { key: string; definition: AchievementDefinition; value: number; period?: string }[] {
  return ACHIEVEMENTS.filter((d) => !settings.disabled.includes(d.id)).flatMap((d) => {
    if (d.metric === 'perfectAttendanceMonth') return stats.perfectAttendanceMonths.map((m) => ({ key: `${d.id}_${m}`, definition: d, value: 1, period: m }));
    const threshold = d.configurable ? Math.max(1, settings.thresholds[d.id] ?? d.threshold) : d.threshold;
    const value = stats[d.metric];
    return value >= threshold ? [{ key: d.id, definition: { ...d, threshold }, value }] : [];
  });
}

/** Completed calendar months (before `today`) with at least 4 classes, every one attended as present. */
export function perfectAttendanceMonths(records: { date: string; status: string }[], today: string): string[] {
  const by = new Map<string, string[]>();
  for (const r of records) if (r.status !== 'excused') by.set(r.date.slice(0, 7), [...(by.get(r.date.slice(0, 7)) ?? []), r.status]);
  return [...by.entries()].filter(([m, st]) => m < today.slice(0, 7) && st.length >= 4 && st.every((s) => s === 'present')).map(([m]) => m).sort();
}

/** Ratings: averages are shown only with enough responses. */
export const MIN_FEEDBACK_RESPONSES = 3;
export function ratingSummary(ratings: number[]) {
  const n = ratings.length;
  return { responses: n, average: n >= MIN_FEEDBACK_RESPONSES ? Math.round((ratings.reduce((s, r) => s + r, 0) / n) * 10) / 10 : null, distribution: [1, 2, 3, 4, 5].map((v) => ratings.filter((r) => r === v).length) };
}

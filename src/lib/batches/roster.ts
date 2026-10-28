/**
 * Strynkix LMS — Batch Roster Progress Aggregation
 * Combines enrollments with existing progress records. Keeps three situations
 * distinct so the UI never shows a misleading "0%":
 *   - 'unavailable': progress could not be loaded (permissions / network)
 *   - 'no_activity': loaded successfully, but the student has no progress records
 *   - 'tracked':     at least one progress record exists for a published lesson
 */

import { Enrollment, Progress } from '@/types/domain';

export type RosterProgressState = 'unavailable' | 'no_activity' | 'tracked';

export interface RosterRow {
  enrollment: Enrollment;
  state: RosterProgressState;
  completedCount: number;
  inProgressCount: number;
  totalLessons: number;
  /** null when the course has no published lessons or progress is unavailable */
  percentage: number | null;
  lastAccessedAt: string | null;
}

/**
 * @param progress Progress records for the batch, or null if loading failed.
 * @param publishedLessonIds IDs of currently published lessons; progress on
 *        unpublished or removed lessons is ignored.
 */
export function buildRosterProgress(
  enrollments: Enrollment[],
  progress: Progress[] | null,
  publishedLessonIds: string[]
): RosterRow[] {
  const publishedSet = new Set(publishedLessonIds);
  const totalLessons = publishedSet.size;

  const byStudent = new Map<string, Progress[]>();
  for (const record of progress ?? []) {
    if (!publishedSet.has(record.lessonId)) continue;
    const list = byStudent.get(record.studentId) ?? [];
    list.push(record);
    byStudent.set(record.studentId, list);
  }

  return enrollments.map((enrollment) => {
    if (progress === null) {
      return {
        enrollment,
        state: 'unavailable',
        completedCount: 0,
        inProgressCount: 0,
        totalLessons,
        percentage: null,
        lastAccessedAt: null,
      };
    }

    const records = (byStudent.get(enrollment.studentId) ?? []).filter(
      (r) => r.courseId === enrollment.courseId
    );
    const completedLessons = new Set(records.filter((r) => r.status === 'completed').map((r) => r.lessonId));
    const inProgressLessons = new Set(
      records.filter((r) => r.status === 'in_progress' && !completedLessons.has(r.lessonId)).map((r) => r.lessonId)
    );
    const lastAccessedAt = records.reduce<string | null>(
      (latest, r) => (r.lastAccessedAt && (!latest || r.lastAccessedAt > latest) ? r.lastAccessedAt : latest),
      null
    );

    return {
      enrollment,
      state: records.length === 0 ? 'no_activity' : 'tracked',
      completedCount: completedLessons.size,
      inProgressCount: inProgressLessons.size,
      totalLessons,
      percentage: totalLessons > 0 ? Math.round((completedLessons.size / totalLessons) * 100) : null,
      lastAccessedAt,
    };
  });
}

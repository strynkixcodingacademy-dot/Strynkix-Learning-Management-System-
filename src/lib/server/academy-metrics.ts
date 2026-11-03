import 'server-only';

/**
 * Strynkix LMS — figures computed from the underlying records (never stored
 * totals): course completion, attendance, released assessment results.
 * Used by student pages, certificates, analytics and reports.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { Assessment, AssessmentAttempt, AttendanceSession, AttendanceStatus } from '@/types/academy';
import { isResultReleased } from '@/lib/assessments/grading';

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Published lessons of a course and how many the student completed. */
export async function courseCompletion(db: Firestore, orgId: string, courseId: string, studentId: string) {
  const [lessons, done] = await Promise.all([
    db.collection('lessons').where('orgId', '==', orgId).where('courseId', '==', courseId).where('status', '==', 'published').count().get(),
    db.collection('progress').where('orgId', '==', orgId).where('courseId', '==', courseId).where('studentId', '==', studentId).where('status', '==', 'completed').count().get(),
  ]);
  const total = lessons.data().count;
  const completed = Math.min(done.data().count, total);
  return { totalLessons: total, completedLessons: completed, percent: pct(completed, total) };
}

export interface AttendanceStats { scheduled: number; present: number; late: number; absent: number; excused: number; percent: number }

/** Present and late count as attended; excused sessions don't count against the student. */
export function attendanceStats(sessions: Pick<AttendanceSession, 'records'>[], studentId: string): AttendanceStats {
  const s = { scheduled: 0, present: 0, late: 0, absent: 0, excused: 0 };
  for (const session of sessions) {
    const st: AttendanceStatus | undefined = session.records?.[studentId];
    if (!st) continue;
    s.scheduled++;
    s[st]++;
  }
  return { ...s, percent: pct(s.present + s.late, s.scheduled - s.excused) };
}

export async function batchSessions(db: Firestore, orgId: string, batchId: string, from?: string, to?: string): Promise<AttendanceSession[]> {
  let q = db.collection('attendance').where('orgId', '==', orgId).where('batchId', '==', batchId);
  if (from) q = q.where('date', '>=', from);
  if (to) q = q.where('date', '<=', to);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceSession)).sort((a, b) => a.date.localeCompare(b.date));
}

/** A student's attempts, with only what release rules allow for scores. */
export async function releasedResults(db: Firestore, orgId: string, studentId: string, tx?: Transaction) {
  const q = db.collection('assessmentAttempts').where('orgId', '==', orgId).where('studentId', '==', studentId);
  const snap = tx ? await tx.get(q) : await q.get();
  const attempts = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssessmentAttempt));
  const ids = [...new Set(attempts.map((a) => a.assessmentId))];
  const refs = ids.map((id) => db.doc(`assessments/${id}`));
  const snaps = refs.length ? (tx ? await tx.getAll(...refs) : await db.getAll(...refs)) : [];
  const assessments = new Map(snaps.filter((s) => s.exists).map((s) => [s.id, { id: s.id, ...s.data() } as Assessment]));
  return attempts.map((t) => {
    const a = assessments.get(t.assessmentId);
    return { attempt: t, assessment: a ?? null, released: a ? isResultReleased(a, t) : false };
  });
}

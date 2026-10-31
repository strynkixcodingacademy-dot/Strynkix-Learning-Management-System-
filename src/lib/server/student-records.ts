import 'server-only';

/**
 * Strynkix LMS — a student's own workspace, computed on the server from their
 * records: dashboard overview, My Courses and My Scores. A student only ever
 * receives their own data; scores appear only once released.
 */

import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { Batch, Course, Enrollment, Progress, Submission } from '@/types/domain';
import type { Assessment, AssessmentAttempt, Certificate } from '@/types/academy';
import { canStartAttempt } from '@/lib/assessments/grading';
import { denied, getDocData, loadActor, parseBody } from '@/lib/server/academy-scope';
import { attendanceStats, batchSessions, courseCompletion, releasedResults } from '@/lib/server/academy-metrics';

export const studentRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('overview') }).strict(),
  z.object({ action: z.literal('courses') }).strict(),
  z.object({ action: z.literal('scores') }).strict(),
]);

type Services = { db: Firestore; auth: Auth };

async function myCourses(db: Firestore, orgId: string, studentId: string) {
  const enrollments = (await db.collection('enrollments').where('orgId', '==', orgId).where('studentId', '==', studentId).get()).docs
    .map((d) => ({ id: d.id, ...d.data() } as Enrollment))
    .filter((e) => e.status !== 'dropped');
  const out = [];
  for (const e of enrollments) {
    const [course, batch, completion, progress] = await Promise.all([
      getDocData<Course>(db, `courses/${e.courseId}`),
      getDocData<Batch>(db, `batches/${e.batchId}`),
      courseCompletion(db, orgId, e.courseId, studentId),
      db.collection('progress').where('orgId', '==', orgId).where('courseId', '==', e.courseId).where('studentId', '==', studentId).get(),
    ]);
    if (!course) continue;
    const last = progress.docs.map((d) => d.data() as Progress).sort((a, b) => (b.lastAccessedAt ?? '').localeCompare(a.lastAccessedAt ?? ''))[0];
    out.push({
      courseId: course.id, title: course.title, description: course.tagline || course.description, level: course.level,
      courseStatus: course.status, enrollmentStatus: e.status, batchId: e.batchId, batchName: batch?.name ?? null,
      instructors: batch?.instructorNames ?? [], startDate: batch?.startDate ?? null, endDate: batch?.endDate ?? null,
      ...completion, lastLessonId: last?.lessonId ?? null, lastAccessedAt: last?.lastAccessedAt ?? null,
    });
  }
  return out;
}

export async function handleStudent(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(studentRequestSchema, body);
  if (actor.role !== 'student') throw denied('This page is for students.');
  const { db } = services;
  const orgId = actor.orgId;
  const now = new Date();

  if (req.action === 'courses') return { courses: await myCourses(db, orgId, actor.id) };

  if (req.action === 'scores') {
    const [results, subs, progress] = await Promise.all([
      releasedResults(db, orgId, actor.id),
      db.collection('submissions').where('orgId', '==', orgId).where('studentId', '==', actor.id).get(),
      db.collection('progress').where('orgId', '==', orgId).where('studentId', '==', actor.id).get(),
    ]);
    const courseIds = new Set<string>();
    const assessments = results.filter((r) => r.attempt.status !== 'in_progress').map(({ attempt: t, assessment: a, released }) => {
      courseIds.add(t.courseId);
      return {
        id: t.id, assessmentId: t.assessmentId, courseId: t.courseId, title: t.title, kind: t.kind, examType: t.examType ?? null,
        attemptNumber: t.attemptNumber, status: t.status, late: t.late, submittedAt: t.submittedAt ?? null,
        totalMarks: t.totalMarks, passingPercent: a?.passingPercent ?? null, released,
        resultPublishedAt: released ? (a?.resultRelease === 'manual' ? a.resultsReleasedAt : a?.resultRelease === 'after_close' ? a.closesAt ?? t.evaluatedAt : t.evaluatedAt) ?? null : null,
        ...(released ? { score: t.score, percent: t.percent, passed: t.passed, feedback: t.feedback ?? null } : {}),
        provisional: !released && t.status !== 'evaluated' && t.autoScore !== undefined && a?.resultRelease === 'immediate' ? t.autoScore : null,
      };
    });
    const assignments = subs.docs.map((d) => ({ id: d.id, ...d.data() } as Submission)).map((s) => {
      if (s.courseId) courseIds.add(s.courseId);
      return { id: s.id, assignmentId: s.assignmentId, courseId: s.courseId ?? null, status: s.status, attemptCount: s.attemptCount ?? 1, score: s.status === 'graded' ? s.score ?? null : null, feedback: s.status === 'graded' ? s.feedback ?? null : null, submittedAt: s.submittedAt ?? null, gradedAt: s.gradedAt ?? null };
    });
    const assignmentDocs = await Promise.all([...new Set(assignments.map((s) => s.assignmentId))].map((id) => getDocData<{ title: string; totalPoints: number }>(db, `assignments/${id}`)));
    const aBy = new Map(assignmentDocs.filter(Boolean).map((a) => [a!.id, a!]));
    const lessonQuizzes = progress.docs.map((d) => d.data() as Progress).filter((p) => p.quiz).map((p) => {
      courseIds.add(p.courseId);
      return { lessonId: p.lessonId, courseId: p.courseId, attempts: p.quiz!.attemptCount, bestPercent: p.quiz!.bestPercent, passed: p.quiz!.passed, lastAttemptAt: p.quiz!.lastAttemptAt };
    });
    const lessonIds = [...new Set(lessonQuizzes.map((q) => q.lessonId))];
    const lessonSnaps = lessonIds.length ? await db.getAll(...lessonIds.map((id) => db.doc(`lessons/${id}`))) : [];
    const lessonTitle = new Map(lessonSnaps.map((s) => [s.id, (s.data()?.title as string) ?? 'Lesson']));
    const courseSnaps = courseIds.size ? await db.getAll(...[...courseIds].map((id) => db.doc(`courses/${id}`))) : [];
    return {
      courses: Object.fromEntries(courseSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()!.title as string])),
      assessments,
      assignments: assignments.map((s) => ({ ...s, title: aBy.get(s.assignmentId)?.title ?? 'Assignment', totalPoints: aBy.get(s.assignmentId)?.totalPoints ?? null })),
      lessonQuizzes: lessonQuizzes.map((q) => ({ ...q, lessonTitle: lessonTitle.get(q.lessonId) ?? 'Lesson' })),
    };
  }

  // overview
  const courses = await myCourses(db, orgId, actor.id);
  const active = courses.filter((c) => c.enrollmentStatus === 'active');
  const [results, certSnap, notesSnap] = await Promise.all([
    releasedResults(db, orgId, actor.id),
    db.collection('certificates').where('orgId', '==', orgId).where('studentId', '==', actor.id).get(),
    db.collection('notifications').where('orgId', '==', orgId).where('userId', '==', actor.id).orderBy('createdAt', 'desc').limit(5).get(),
  ]);
  let attended = 0, counted = 0;
  for (const c of active) {
    const s = attendanceStats(await batchSessions(db, orgId, c.batchId), actor.id);
    attended += s.present + s.late;
    counted += s.scheduled - s.excused;
  }
  // Upcoming and pending work from published assessments in active courses.
  const upcoming: unknown[] = [];
  const attemptsBy = new Map<string, AssessmentAttempt[]>();
  for (const r of results) attemptsBy.set(r.attempt.assessmentId, [...(attemptsBy.get(r.attempt.assessmentId) ?? []), r.attempt]);
  for (const c of active) {
    const snap = await db.collection('assessments').where('orgId', '==', orgId).where('courseId', '==', c.courseId).where('status', '==', 'published').get();
    for (const d of snap.docs) {
      const a = { id: d.id, ...d.data() } as Assessment;
      if (a.batchIds?.length && !a.batchIds.includes(c.batchId)) continue;
      const mine = (attemptsBy.get(a.id) ?? []).sort((x, y) => y.attemptNumber - x.attemptNumber);
      const latest = mine[0];
      const open = canStartAttempt(a, mine, now).ok;
      const awaiting = !latest || latest.status === 'returned' || latest.status === 'in_progress';
      if ((open || latest?.status === 'in_progress') && awaiting) {
        upcoming.push({ id: a.id, courseId: a.courseId, courseTitle: c.title, title: a.title, kind: a.kind, examType: a.examType ?? null, closesAt: a.closesAt ?? null, opensAt: a.opensAt ?? null, status: latest?.status ?? 'not_started' });
      }
    }
  }
  const recent = results.filter((r) => r.released).sort((x, y) => (y.attempt.evaluatedAt ?? '').localeCompare(x.attempt.evaluatedAt ?? '')).slice(0, 5)
    .map(({ attempt: t }) => ({ id: t.id, assessmentId: t.assessmentId, courseId: t.courseId, title: t.title, kind: t.kind, score: t.score, totalMarks: t.totalMarks, percent: t.percent, passed: t.passed, evaluatedAt: t.evaluatedAt }));
  const certificates = certSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Certificate));
  const totalLessons = active.reduce((s, c) => s + c.totalLessons, 0);
  const completedLessons = active.reduce((s, c) => s + c.completedLessons, 0);
  return {
    profile: { name: actor.displayName, email: actor.email, studentId: actor.metadata?.studentIdNumber ?? null },
    courses,
    current: active.sort((a, b) => (b.lastAccessedAt ?? '').localeCompare(a.lastAccessedAt ?? ''))[0] ?? null,
    lessons: { total: totalLessons, completed: completedLessons, remaining: totalLessons - completedLessons, percent: totalLessons ? Math.round((completedLessons / totalLessons) * 1000) / 10 : 0 },
    attendance: { percent: counted > 0 ? Math.round((attended / counted) * 1000) / 10 : null, classes: counted },
    upcoming: (upcoming as { closesAt: string | null }[]).sort((x, y) => (x.closesAt ?? '9').localeCompare(y.closesAt ?? '9')).slice(0, 8),
    pendingCount: upcoming.length,
    recentScores: recent,
    certificates: certificates.map((c) => ({ id: c.id, courseTitle: c.courseTitle, certificateNumber: c.certificateNumber, status: c.status, completedOn: c.completedOn })),
    notifications: notesSnap.docs.map((d) => ({ id: d.id, title: d.data().title, body: d.data().body, link: d.data().link ?? null, read: d.data().read })),
  };
}

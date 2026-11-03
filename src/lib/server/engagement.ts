import 'server-only';

/**
 * Strynkix LMS — student engagement (Stage 10): learning days and streaks,
 * goals, achievements, notification preferences, reminders, and the
 * instructor and administrator engagement views.
 *
 * Every figure comes from records the platform keeps: lesson completions,
 * assessment and assignment submissions, attendance, approved projects,
 * completed enrollments. Viewing a page never counts as activity.
 * Achievements are evaluated and awarded on the server only, once each
 * (achievements/{studentId}_{key} is created, never overwritten).
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema, planDateSchema } from '@/types/validation';
import type { Batch, Enrollment, Progress, Submission } from '@/types/domain';
import type { Assessment, AssessmentAttempt, AttendanceSession } from '@/types/academy';
import {
  ACHIEVEMENTS, DEFAULT_ACHIEVEMENT_SETTINGS, currentStreak, ratingSummary, earnedAchievements, learningDays, longestStreak, monthSummary, perfectAttendanceMonths,
  weeklyHistory, weeklyProgress, type AchievementSettings, type AchievementStats, type LearningEvent,
} from '@/lib/engagement/streaks';
import { canStartAttempt, isResultReleased } from '@/lib/assessments/grading';
import { denied, financeScope, getDocData, invalid, isAcademyManager, isSuper, loadActor, localDate, notFound, parseBody } from '@/lib/server/academy-scope';
import { attendanceStats } from '@/lib/server/academy-metrics';
import { notify } from '@/lib/server/notifications';

export const MUTABLE_CATEGORIES = ['reminders', 'achievements', 'attendance', 'activities'] as const;
export type NotificationCategory = (typeof MUTABLE_CATEGORIES)[number];

export const engagementRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('my_engagement') }).strict(),
  z.object({ action: z.literal('set_goal'), goal: z.number().int().min(1).max(7) }).strict(),
  z.object({ action: z.literal('preferences') }).strict(),
  z.object({ action: z.literal('set_preferences'), muted: z.array(z.enum(MUTABLE_CATEGORIES)).max(4) }).strict(),
  z.object({ action: z.literal('achievement_settings'), orgId: idSchema.optional() }).strict(),
  z.object({ action: z.literal('save_achievement_settings'), orgId: idSchema.optional(), disabled: z.array(z.string().max(40)).max(20), thresholds: z.record(z.string().max(40), z.number().int().min(1).max(1000)) }).strict(),
  z.object({ action: z.literal('instructor_dashboard') }).strict(),
  z.object({ action: z.literal('academy_engagement'), orgId: idSchema.optional(), branchId: idSchema.optional(), courseId: idSchema.optional(), batchId: idSchema.optional(), studentId: idSchema.optional(), from: planDateSchema.optional(), to: planDateSchema.optional() }).strict(),
  z.object({ action: z.literal('run_reminders') }).strict(),
]);

type Services = { db: Firestore; auth: Auth };

/** Local reporting date of a stored timestamp (ISO string or Firestore Timestamp). */
export function localDay(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Timestamp ? v.toDate() : typeof v === 'string' ? new Date(v) : (v as { toDate?: () => Date }).toDate?.() ?? null;
  return d && !Number.isNaN(d.getTime()) ? localDate(d) : null;
}

/** A student's verified learning events and achievement stats. */
export async function studentRecords(db: Firestore, orgId: string, studentId: string) {
  const today = localDate();
  const [progress, attempts, subs, enrollments, projects, certs] = await Promise.all([
    db.collection('progress').where('orgId', '==', orgId).where('studentId', '==', studentId).where('status', '==', 'completed').get(),
    db.collection('assessmentAttempts').where('orgId', '==', orgId).where('studentId', '==', studentId).get(),
    db.collection('submissions').where('orgId', '==', orgId).where('studentId', '==', studentId).get(),
    db.collection('enrollments').where('orgId', '==', orgId).where('studentId', '==', studentId).get(),
    db.collection('portfolioEntries').where('orgId', '==', orgId).where('studentId', '==', studentId).where('reviewStatus', '==', 'approved').count().get(),
    db.collection('certificates').where('orgId', '==', orgId).where('studentId', '==', studentId).where('status', '==', 'issued').count().get(),
  ]);
  const enr = enrollments.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));
  const events: LearningEvent[] = [];
  for (const d of progress.docs) { const day = localDay((d.data() as Progress).completedAt ?? (d.data() as Progress).updatedAt); if (day) events.push({ kind: 'lesson', date: day }); }
  const atts = attempts.docs.map((d) => ({ id: d.id, ...d.data() } as AssessmentAttempt)).filter((t) => t.status !== 'in_progress' && t.submittedAt);
  for (const t of atts) { const day = localDay(t.submittedAt); if (day) events.push({ kind: ['short_answer', 'long_answer', 'practical'].includes(t.kind) ? 'assignment' : 'assessment', date: day }); }
  const submitted = subs.docs.map((d) => d.data() as Submission).filter((s) => s.status !== 'draft');
  for (const s of submitted) { const day = localDay(s.submittedAt); if (day) events.push({ kind: 'assignment', date: day }); }
  const attendance: { date: string; status: string }[] = [];
  const batchIds = [...new Set(enr.map((e) => e.batchId))];
  const sessionsByBatch = new Map<string, AttendanceSession[]>();
  await Promise.all(batchIds.map(async (b) => {
    const s = (await db.collection('attendance').where('orgId', '==', orgId).where('batchId', '==', b).get()).docs.map((d) => d.data() as AttendanceSession);
    sessionsByBatch.set(b, s);
    for (const x of s) { const st = x.records?.[studentId]; if (st) { attendance.push({ date: x.date, status: st }); if (st === 'present' || st === 'late') events.push({ kind: 'attendance', date: x.date }); } }
  }));
  const days = learningDays(events);
  const stats: AchievementStats = {
    lessonsCompleted: progress.size,
    assignmentsSubmitted: submitted.length + atts.filter((t) => ['short_answer', 'long_answer', 'practical'].includes(t.kind)).length,
    assessmentsCompleted: new Set(atts.map((t) => t.assessmentId)).size,
    projectsApproved: projects.data().count,
    coursesCompleted: Math.max(enr.filter((e) => e.status === 'completed').length, certs.data().count),
    longestStreak: longestStreak(days), perfectAttendanceMonths: perfectAttendanceMonths(attendance, today),
  };
  return { events, days, stats, enrollments: enr, attempts: atts, sessionsByBatch };
}

async function achievementSettings(db: Firestore, orgId: string): Promise<AchievementSettings> {
  const s = await getDocData<AchievementSettings>(db, `achievementSettings/${orgId}`);
  return { ...DEFAULT_ACHIEVEMENT_SETTINGS, ...(s ?? {}) };
}

async function muted(db: Firestore, uid: string): Promise<NotificationCategory[]> {
  return ((await getDocData<{ muted: NotificationCategory[] }>(db, `notificationPreferences/${uid}`))?.muted) ?? [];
}

/** Awards newly earned achievements exactly once each (create-only ids) and notifies unless muted. */
export async function awardAchievements(db: Firestore, student: { id: string; orgId: string; branchId?: string }, stats: AchievementStats) {
  const earned = earnedAchievements(stats, await achievementSettings(db, student.orgId));
  if (!earned.length) return [];
  const mute = (await muted(db, student.id)).includes('achievements');
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const refs = earned.map((e) => db.doc(`achievements/${student.id}_${e.key}`));
    const snaps = await tx.getAll(...refs);
    const fresh = earned.filter((_, i) => !snaps[i].exists);
    for (const e of fresh) {
      tx.create(db.doc(`achievements/${student.id}_${e.key}`), {
        orgId: student.orgId, branchId: student.branchId ?? null, studentId: student.id, definitionId: e.definition.id, key: e.key, title: e.definition.title,
        description: e.definition.description, evidence: { metric: e.definition.metric, value: e.value, threshold: e.definition.threshold, ...(e.period ? { period: e.period } : {}) }, awardedAt: iso,
      });
      if (!mute) notify(tx, db, { orgId: student.orgId, userId: student.id, type: 'achievement_awarded', title: `Achievement: ${e.definition.title}`, body: e.definition.description, link: '/dashboard/achievements', sourceId: e.key });
    }
    return fresh.map((e) => e.key);
  });
}

/** Creates a notification once (fixed id), unless muted. Returns whether it was created. */
async function remindOnce(db: Firestore, id: string, n: { orgId: string; userId: string; type: string; title: string; body: string; link: string; sourceId: string }) {
  try {
    await db.doc(`notifications/${id}`).create({ ...n, read: false, createdAt: FieldValue.serverTimestamp() });
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === 6) return false;
    throw e;
  }
}

/**
 * Reminders (run by the scheduled job or the Super Admin): assessments closing
 * within 48 hours not yet submitted, activities starting within 24 hours, and
 * attendance below 75% (at least 4 classes; once a month). Fixed ids make
 * repeated runs harmless; muted categories are skipped.
 */
export async function runReminders(db: Firestore) {
  const now = new Date();
  const nowIso = now.toISOString();
  const in48 = new Date(now.getTime() + 48 * 3600_000).toISOString();
  const in24 = new Date(now.getTime() + 24 * 3600_000).toISOString();
  const month = localDate().slice(0, 7);
  let sent = 0, skipped = 0;
  const prefs = new Map<string, NotificationCategory[]>();
  const isMuted = async (uid: string, c: NotificationCategory) => { if (!prefs.has(uid)) prefs.set(uid, await muted(db, uid)); return prefs.get(uid)!.includes(c); };
  const count = (ok: boolean) => (ok ? sent++ : skipped++);

  const assessments = (await db.collection('assessments').where('status', '==', 'published').where('closesAt', '>=', nowIso).where('closesAt', '<=', in48).get()).docs.map((d) => ({ id: d.id, ...d.data() } as Assessment));
  for (const a of assessments) {
    const [enr, attempts] = await Promise.all([
      db.collection('enrollments').where('orgId', '==', a.orgId).where('courseId', '==', a.courseId).where('status', '==', 'active').get(),
      db.collection('assessmentAttempts').where('assessmentId', '==', a.id).select('studentId', 'status').get(),
    ]);
    const done = new Set(attempts.docs.filter((d) => d.data().status !== 'in_progress').map((d) => d.data().studentId as string));
    for (const d of enr.docs) {
      const e = d.data() as Enrollment;
      if ((a.batchIds?.length && !a.batchIds.includes(e.batchId)) || done.has(e.studentId)) continue;
      if (await isMuted(e.studentId, 'reminders')) { skipped++; continue; }
      count(await remindOnce(db, `rem_asm_${a.id}_${e.studentId}`, { orgId: a.orgId, userId: e.studentId, type: 'assessment_reminder', title: `Due soon: ${a.title}`, body: `Closes ${new Date(a.closesAt!).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`, link: `/courses/${a.courseId}/activities/${a.id}`, sourceId: a.id }));
    }
  }
  const activities = (await db.collection('activities').where('status', '==', 'scheduled').where('startsAt', '>=', nowIso).where('startsAt', '<=', in24).get()).docs;
  for (const d of activities) {
    const regs = await db.collection('activityRegistrations').where('activityId', '==', d.id).where('status', '==', 'registered').get();
    for (const r of regs.docs) {
      const uid = r.data().studentId as string;
      if (await isMuted(uid, 'activities')) { skipped++; continue; }
      count(await remindOnce(db, `rem_act_${d.id}_${uid}`, { orgId: d.data().orgId, userId: uid, type: 'activity_reminder', title: `Tomorrow: ${d.data().title}`, body: `Starts ${new Date(d.data().startsAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`, link: '/dashboard/activities', sourceId: d.id }));
    }
  }
  const batches = (await db.collection('batches').where('status', '==', 'in_progress').get()).docs;
  for (const b of batches) {
    const [enr, sessions] = await Promise.all([
      db.collection('enrollments').where('orgId', '==', b.data().orgId).where('batchId', '==', b.id).where('status', '==', 'active').get(),
      db.collection('attendance').where('orgId', '==', b.data().orgId).where('batchId', '==', b.id).get(),
    ]);
    const s = sessions.docs.map((d) => d.data() as AttendanceSession);
    for (const d of enr.docs) {
      const uid = d.data().studentId as string;
      const st = attendanceStats(s, uid);
      if (st.scheduled < 4 || st.percent >= 75) continue;
      if (await isMuted(uid, 'attendance')) { skipped++; continue; }
      count(await remindOnce(db, `rem_att_${b.id}_${uid}_${month}`, { orgId: b.data().orgId, userId: uid, type: 'attendance_alert', title: 'Your attendance is below 75%', body: `${st.percent}% of ${st.scheduled} classes in ${b.data().name}. Talk to your instructor if you need help catching up.`, link: '/dashboard/attendance', sourceId: b.id }));
    }
  }
  return { sent, skipped };
}

export async function handleEngagement(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(engagementRequestSchema, body);
  const { db } = services;
  const today = localDate();
  const nowIso = new Date().toISOString();

  switch (req.action) {
    case 'my_engagement': {
      if (actor.role !== 'student') throw denied('This is the student engagement view.');
      const rec = await studentRecords(db, actor.orgId, actor.id);
      const goal = (await getDocData<{ weeklyGoal: number }>(db, `engagementSettings/${actor.id}`))?.weeklyGoal ?? 4;
      const newly = await awardAchievements(db, actor, rec.stats);
      const [achSnap, doubts, regs, subs] = await Promise.all([
        db.collection('achievements').where('studentId', '==', actor.id).get(),
        db.collection('doubts').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get(),
        db.collection('activityRegistrations').where('studentId', '==', actor.id).where('status', '==', 'registered').get(),
        db.collection('submissions').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).where('status', '==', 'graded').get(),
      ]);
      // Upcoming deadlines: published activities/exams in active courses that are open and not yet submitted.
      const active = rec.enrollments.filter((e) => e.status === 'active');
      const deadlines: { id: string; courseId: string; title: string; kind: string; closesAt: string }[] = [];
      const published = await Promise.all(active.map((e) => db.collection('assessments').where('orgId', '==', actor.orgId).where('courseId', '==', e.courseId).where('status', '==', 'published').get()));
      for (const [i, e] of active.entries()) {
        for (const d of published[i].docs) {
          const a = { id: d.id, ...d.data() } as Assessment;
          if (!a.closesAt || a.closesAt < nowIso || (a.batchIds?.length && !a.batchIds.includes(e.batchId))) continue;
          const mine = rec.attempts.filter((t) => t.assessmentId === a.id);
          if (mine.length && mine[0].status !== 'returned') continue;
          if (canStartAttempt(a, mine, new Date()).ok) deadlines.push({ id: a.id, courseId: a.courseId, title: a.title, kind: a.kind, closesAt: a.closesAt });
        }
      }
      // Recent instructor feedback: released evaluations with comments, and graded daily assignments.
      const assessIds = [...new Set(rec.attempts.filter((t) => t.status === 'evaluated' && t.feedback).map((t) => t.assessmentId))];
      const aSnaps = assessIds.length ? await db.getAll(...assessIds.map((id) => db.doc(`assessments/${id}`))) : [];
      const aBy = new Map(aSnaps.filter((s) => s.exists).map((s) => [s.id, { id: s.id, ...s.data() } as Assessment]));
      const feedback = [
        ...rec.attempts.filter((t) => t.status === 'evaluated' && t.feedback && aBy.has(t.assessmentId) && isResultReleased(aBy.get(t.assessmentId)!, t))
          .map((t) => ({ source: 'assessment', title: t.title, feedback: t.feedback!, at: t.evaluatedAt ?? '', link: `/courses/${t.courseId}/activities/${t.assessmentId}` })),
        ...subs.docs.map((d) => d.data() as Submission).filter((s) => s.feedback).map((s) => ({ source: 'assignment', title: 'Daily assignment', feedback: s.feedback!, at: localDay(s.gradedAt) ?? '', link: '/dashboard/scores' })),
      ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
      let attended = 0, counted = 0;
      for (const e of active) { const s = attendanceStats(rec.sessionsByBatch.get(e.batchId) ?? [], actor.id); attended += s.present + s.late; counted += s.scheduled - s.excused; }
      const lastMonth = (() => { const [y, m] = today.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
      return {
        today, streak: { current: currentStreak(rec.days, today), longest: rec.stats.longestStreak, totalDays: rec.days.length, learnedToday: rec.days.includes(today) },
        weekly: weeklyProgress(rec.days, today, goal), history: weeklyHistory(rec.days, today, 12),
        thisMonth: monthSummary(rec.events, today.slice(0, 7)), lastMonth: monthSummary(rec.events, lastMonth), stats: rec.stats,
        achievements: achSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String((b as { awardedAt?: string }).awardedAt).localeCompare(String((a as { awardedAt?: string }).awardedAt))),
        newlyAwarded: newly, available: ACHIEVEMENTS.length,
        deadlines: deadlines.sort((a, b) => a.closesAt.localeCompare(b.closesAt)).slice(0, 8), feedback,
        attendance: { percent: counted ? Math.round((attended / counted) * 1000) / 10 : null, classes: counted },
        doubts: doubts.docs.map((d) => ({ id: d.id, title: d.data().title as string, status: d.data().status as string })).filter((d) => d.status !== 'resolved'),
        activities: regs.docs.map((d) => d.data()).filter((r) => (r.startsAt as string) >= nowIso).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))).slice(0, 5)
          .map((r) => ({ activityId: r.activityId as string, title: r.activityTitle as string, startsAt: r.startsAt as string })),
      };
    }

    case 'set_goal': {
      if (actor.role !== 'student') throw denied();
      await db.doc(`engagementSettings/${actor.id}`).set({ orgId: actor.orgId, weeklyGoal: req.goal, updatedAt: nowIso }, { merge: true });
      return { ok: true };
    }

    case 'preferences': return { muted: await muted(db, actor.id), categories: MUTABLE_CATEGORIES };

    case 'set_preferences': {
      await db.doc(`notificationPreferences/${actor.id}`).set({ orgId: actor.orgId, muted: [...new Set(req.muted)], updatedAt: nowIso });
      return { ok: true };
    }

    case 'achievement_settings':
    case 'save_achievement_settings': {
      const orgId = isSuper(actor) ? req.orgId ?? actor.orgId : actor.orgId;
      if (!isAcademyManager(actor, orgId)) throw denied('Academy administrators configure achievements.');
      if (req.action === 'achievement_settings') return { definitions: ACHIEVEMENTS, settings: await achievementSettings(db, orgId) };
      const known = new Set(ACHIEVEMENTS.map((a) => a.id));
      const configurable = new Set(ACHIEVEMENTS.filter((a) => a.configurable).map((a) => a.id));
      if (req.disabled.some((d) => !known.has(d)) || Object.keys(req.thresholds).some((k) => !configurable.has(k))) throw invalid('Unknown achievement or a threshold that can’t be changed.');
      await db.runTransaction(async (tx) => {
        tx.set(db.doc(`achievementSettings/${orgId}`), { disabled: req.disabled, thresholds: req.thresholds, updatedById: actor.id, updatedAt: nowIso });
        tx.create(db.collection('auditLog').doc(), { orgId, courseId: null, targetType: 'achievement_settings', targetId: orgId, action: 'achievement_settings_update', actorId: actor.id, actorRole: actor.role, at: FieldValue.serverTimestamp() });
      });
      return { ok: true };
    }

    case 'instructor_dashboard': {
      if (actor.role !== 'instructor') throw denied('This is the instructor view.');
      const batches = (await db.collection('batches').where('orgId', '==', actor.orgId).where('instructorUserIds', 'array-contains', actor.id).get()).docs.map((d) => ({ id: d.id, ...d.data() } as Batch)).filter((b) => !['archived', 'cancelled'].includes(b.status));
      const ids = batches.map((b) => b.id);
      const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
      const since7Day = localDate(new Date(Date.now() - 6 * 86400_000));
      const chunks = (n: number) => Array.from({ length: Math.ceil(ids.length / n) }, (_, i) => ids.slice(i * n, i * n + n));
      const inBatches = async (col: string, extra?: (q: FirebaseFirestore.Query) => FirebaseFirestore.Query) => (await Promise.all(chunks(10).map((c) => { let q = db.collection(col).where('orgId', '==', actor.orgId).where('batchId', 'in', c); if (extra) q = extra(q); return q.get(); }))).flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));
      const [enr, progress, attempts, doubts, feedback, subs, sessions, activities, achievements] = ids.length ? await Promise.all([
        inBatches('enrollments', (q) => q.where('status', '==', 'active')),
        inBatches('progress', (q) => q.where('status', '==', 'completed')),
        inBatches('assessmentAttempts'),
        inBatches('doubts'),
        inBatches('feedback'),
        inBatches('submissions', (q) => q.where('status', '==', 'submitted')),
        inBatches('attendance'),
        db.collection('activities').where('orgId', '==', actor.orgId).where('status', '==', 'scheduled').get(),
        db.collection('achievements').where('orgId', '==', actor.orgId).where('awardedAt', '>=', since30).get(),
      ]) : [[], [], [], [], [], [], [], null, null];
      const students = new Set((enr as Enrollment[]).map((e) => e.studentId));
      const recentActive = new Set<string>();
      for (const p of progress as unknown as Progress[]) if ((localDay(p.completedAt) ?? '') >= since7Day) recentActive.add(p.studentId);
      for (const t of attempts as unknown as AssessmentAttempt[]) if (t.submittedAt && (localDay(t.submittedAt) ?? '') >= since7Day) recentActive.add(t.studentId);
      for (const s of sessions as unknown as AttendanceSession[]) if (s.date >= since7Day) for (const [uid, st] of Object.entries(s.records ?? {})) if (st === 'present' || st === 'late') recentActive.add(uid);
      const lessonCounts = new Map<string, number>();
      await Promise.all([...new Set(batches.map((b) => b.courseId))].map(async (c) => lessonCounts.set(c, (await db.collection('lessons').where('orgId', '==', actor.orgId).where('courseId', '==', c).where('status', '==', 'published').count().get()).data().count)));
      return {
        batches: batches.map((b) => {
          const mine = (enr as Enrollment[]).filter((e) => e.batchId === b.id);
          const done = (progress as unknown as Progress[]).filter((p) => p.batchId === b.id).length;
          const sess = (sessions as unknown as AttendanceSession[]).filter((s) => s.batchId === b.id && s.date >= since30.slice(0, 10));
          const att = mine.map((e) => attendanceStats(sess, e.studentId)).filter((x) => x.scheduled);
          return {
            id: b.id, name: b.name, status: b.status, students: mine.length, activeLast7Days: mine.filter((e) => recentActive.has(e.studentId)).length,
            completion: mine.length && lessonCounts.get(b.courseId) ? Math.min(100, Math.round((done / (mine.length * lessonCounts.get(b.courseId)!)) * 1000) / 10) : null,
            attendance30d: att.length ? Math.round(att.reduce((s, x) => s + x.percent, 0) / att.length) : null, classes30d: sess.length,
          };
        }),
        pendingDoubts: (doubts as unknown as { id: string; title: string; status: string; studentName: string; priority: string; lastActivityAt: string }[]).filter((d) => d.status !== 'resolved').sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt)).slice(0, 20),
        feedbackToRead: (feedback as unknown as { status: string; targetType: string; instructorIds: string[] }[]).filter((f) => f.status === 'submitted' && (f.targetType !== 'teaching' || f.instructorIds.includes(actor.id))).length,
        awaitingReview: (attempts as unknown as AssessmentAttempt[]).filter((t) => ['submitted', 'under_evaluation'].includes(t.status)).length + (subs as unknown[]).length,
        upcomingActivities: activities ? activities.docs.map((d) => ({ id: d.id, ...d.data() } as { id: string; title: string; startsAt: string; branchId: string | null })).filter((a) => a.startsAt >= nowIso && (!a.branchId || a.branchId === actor.branchId)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 5) : [],
        milestones: achievements ? achievements.docs.map((d) => d.data()).filter((a) => students.has(a.studentId as string)).sort((a, b) => String(b.awardedAt).localeCompare(String(a.awardedAt))).slice(0, 10)
          .map((a) => ({ studentId: a.studentId as string, title: a.title as string, awardedAt: a.awardedAt as string, studentName: (enr as Enrollment[]).find((e) => e.studentId === a.studentId)?.studentDisplayName ?? '' })) : [],
        students: students.size,
      };
    }

    case 'academy_engagement': {
      const scope = financeScope(actor, req.orgId ?? actor.orgId, req.branchId);
      const from = req.from ?? localDate(new Date(Date.now() - 29 * 86400_000));
      const to = req.to ?? today;
      let eq = db.collection('enrollments').where('orgId', '==', scope.orgId).where('status', '==', 'active');
      if (scope.branchId) eq = eq.where('branchId', '==', scope.branchId);
      let enr = (await eq.get()).docs.map((d) => d.data() as Enrollment).filter((e) => (!req.courseId || e.courseId === req.courseId) && (!req.batchId || e.batchId === req.batchId));
      if (req.studentId) { enr = enr.filter((e) => e.studentId === req.studentId); if (!enr.length) throw notFound('That student'); }
      const students = new Set(enr.map((e) => e.studentId));
      const batchIds = [...new Set(enr.map((e) => e.batchId))];
      const fromIso = new Date(`${from}T00:00:00+05:30`).toISOString();
      const toIso = new Date(`${to}T23:59:59.999+05:30`).toISOString();
      const [progress, attempts, doubts, feedback, projects, achievements, regs, sessions] = await Promise.all([
        db.collection('progress').where('orgId', '==', scope.orgId).where('completedAt', '>=', fromIso).where('completedAt', '<=', toIso).select('studentId', 'completedAt').get(),
        db.collection('assessmentAttempts').where('orgId', '==', scope.orgId).where('submittedAt', '>=', fromIso).where('submittedAt', '<=', toIso).select('studentId', 'submittedAt').get(),
        db.collection('doubts').where('orgId', '==', scope.orgId).get(),
        db.collection('feedback').where('orgId', '==', scope.orgId).get(),
        db.collection('portfolioEntries').where('orgId', '==', scope.orgId).select('studentId', 'reviewStatus').get(),
        db.collection('achievements').where('orgId', '==', scope.orgId).select('studentId', 'definitionId', 'awardedAt').get(),
        db.collection('activityRegistrations').where('orgId', '==', scope.orgId).get(),
        Promise.all(batchIds.map((b) => db.collection('attendance').where('orgId', '==', scope.orgId).where('batchId', '==', b).get())),
      ]);
      // Learning days per student in the period (and the 60 days before the end, for current streaks).
      const daysBy = new Map<string, Set<string>>();
      const add = (uid: string, day: string | null) => { if (!day || !students.has(uid)) return; const s = daysBy.get(uid) ?? new Set(); s.add(day); daysBy.set(uid, s); };
      for (const d of progress.docs) add(d.data().studentId, localDay(d.data().completedAt));
      for (const d of attempts.docs) add(d.data().studentId, localDay(d.data().submittedAt));
      for (const snap of sessions) for (const d of snap.docs) { const s = d.data() as AttendanceSession; if (s.date < from || s.date > to) continue; for (const [uid, st] of Object.entries(s.records ?? {})) if (st === 'present' || st === 'late') add(uid, s.date); }
      const weeks = new Map<string, Set<string>>();
      for (const [uid, days] of daysBy) for (const d of days) { const w = weeklyHistory([d], d, 1)[0].weekStart; const s = weeks.get(w) ?? new Set(); s.add(uid); weeks.set(w, s); }
      const streaks = [...students].map((uid) => currentStreak([...(daysBy.get(uid) ?? [])].sort(), to));
      const bucket = (lo: number, hi: number) => streaks.filter((s) => s >= lo && s <= hi).length;
      const inScope = (x: { branchId?: string | null; studentId?: string }) => (!x.studentId || students.has(x.studentId));
      const ds = doubts.docs.map((d) => d.data()).filter((d) => inScope(d as { studentId: string }) && String(d.createdAt).slice(0, 10) >= from && String(d.createdAt).slice(0, 10) <= to);
      const hours = (a?: string | null, b?: string | null) => (a && b ? (Date.parse(b) - Date.parse(a)) / 3600_000 : null);
      const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null; };
      const fb = feedback.docs.map((d) => d.data()).filter((f) => inScope(f as { studentId: string }) && String(f.submittedAt).slice(0, 10) >= from && String(f.submittedAt).slice(0, 10) <= to);
      const ach = achievements.docs.map((d) => d.data()).filter((a) => students.has(a.studentId) && String(a.awardedAt).slice(0, 10) >= from && String(a.awardedAt).slice(0, 10) <= to);
      const rg = regs.docs.map((d) => d.data()).filter((r) => students.has(r.studentId));
      const byActivity = new Map<string, { title: string; registered: number; attended: number; cancelled: number }>();
      for (const r of rg) { const v = byActivity.get(r.activityId) ?? { title: r.activityTitle, registered: 0, attended: 0, cancelled: 0 }; if (r.status === 'cancelled') v.cancelled++; else v.registered++; if (r.status === 'attended') v.attended++; byActivity.set(r.activityId, v); }
      const ratingsBy = new Map<string, number[]>();
      for (const f of fb) if (f.rating) ratingsBy.set(f.targetType, [...(ratingsBy.get(f.targetType) ?? []), f.rating]);
      return {
        scope, period: { from, to }, students: students.size,
        participation: { activeStudents: daysBy.size, percent: students.size ? Math.round((daysBy.size / students.size) * 1000) / 10 : null },
        weeklyActive: [...weeks.entries()].sort().map(([weekStart, s]) => ({ weekStart, students: s.size })),
        streakDistribution: [{ label: 'No current streak', count: bucket(0, 0) }, { label: '1–2 days', count: bucket(1, 2) }, { label: '3–6 days', count: bucket(3, 6) }, { label: '7–13 days', count: bucket(7, 13) }, { label: '14+ days', count: bucket(14, 100000) }],
        achievements: ACHIEVEMENTS.map((d) => ({ id: d.id, title: d.title, awarded: ach.filter((a) => a.definitionId === d.id).length })),
        doubts: { asked: ds.length, resolved: ds.filter((d) => d.status === 'resolved').length, open: ds.filter((d) => d.status !== 'resolved').length, avgFirstResponseHours: avg(ds.map((d) => hours(d.createdAt, d.firstResponseAt))), avgResolutionHours: avg(ds.map((d) => hours(d.createdAt, d.resolvedAt))) },
        activities: [...byActivity.entries()].map(([id, v]) => ({ id, ...v })),
        feedback: { responses: fb.length, byType: [...ratingsBy.entries()].map(([type, r]) => ({ type, ...ratingSummary(r) })) },
        projects: ['draft', 'submitted', 'under_review', 'changes_requested', 'approved'].map((st) => ({ status: st, count: projects.docs.filter((d) => students.has(d.data().studentId) && (d.data().reviewStatus ?? 'draft') === st).length })),
      };
    }

    case 'run_reminders': {
      if (!isSuper(actor)) throw denied('Only the Super Admin runs reminders manually.');
      const r = await runReminders(db);
      await db.collection('auditLog').add({ orgId: actor.orgId, courseId: null, targetType: 'reminders', targetId: 'reminders', action: 'reminders_run', actorId: actor.id, actorRole: actor.role, ...r, at: FieldValue.serverTimestamp() });
      return r;
    }
  }
}


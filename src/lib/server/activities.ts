import 'server-only';

/**
 * Strynkix LMS — academy activities and events (Stage 10): workshops, guest
 * lectures, competitions, hackathons, exhibitions, mock interviews, career
 * and placement sessions, special classes.
 *
 * - Staff create activities in their own scope: Branch Managers and
 *   instructors for their branch; University Admins for any branch or the
 *   whole academy; the Super Admin anywhere.
 * - Students see and register for activities they are eligible for (same
 *   academy, their branch or academy-wide, and the course/batch rules).
 * - Registration is one document per student per activity
 *   (activityRegistrations/{activityId}_{studentId}) and the seat count is
 *   checked and changed in the same transaction, so concurrent registrations
 *   can never overbook. Cancelling frees the seat.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema } from '@/types/validation';
import type { Enrollment } from '@/types/domain';
import { type Actor, canManageBranch, conflict, denied, displayName, getDocData, invalid, isAcademyManager, isSuper, loadActor, notFound, parseBody } from '@/lib/server/academy-scope';
import { notify } from '@/lib/server/notifications';

export const ACTIVITY_TYPES = ['workshop', 'guest_lecture', 'coding_competition', 'hackathon', 'project_exhibition', 'mock_interview', 'career_guidance', 'placement_preparation', 'special_class'] as const;

export interface ActivityDoc {
  orgId: string; branchId: string | null; type: (typeof ACTIVITY_TYPES)[number]; title: string; description: string; startsAt: string; endsAt: string; registrationDeadline: string;
  capacity: number | null; eligibility: { courseIds: string[]; batchIds: string[] }; organizerName: string; location: string; mode: 'in_person' | 'online'; meetingUrl: string | null;
  status: 'scheduled' | 'cancelled' | 'completed'; registeredCount: number; createdById: string; createdAt: string; updatedAt: string; cancelReason?: string;
}
export interface RegistrationDoc { activityId: string; orgId: string; branchId: string; studentId: string; studentName: string; status: 'registered' | 'cancelled' | 'attended' | 'absent'; registeredAt: string; cancelledAt: string | null; activityTitle: string; startsAt: string }

const iso = z.string().datetime({ offset: true });
const activityInput = z.object({
  branchId: idSchema.nullable(), type: z.enum(ACTIVITY_TYPES), title: z.string().trim().min(3, 'Give the activity a title.').max(150), description: z.string().trim().max(3000).default(''),
  startsAt: iso, endsAt: iso, registrationDeadline: iso, capacity: z.number().int().min(1).max(10000).nullable(),
  eligibility: z.object({ courseIds: z.array(idSchema).max(20).default([]), batchIds: z.array(idSchema).max(50).default([]) }).strict().default({ courseIds: [], batchIds: [] }),
  organizerName: z.string().trim().min(2, 'Name the organizer.').max(120), location: z.string().trim().max(200).default(''), mode: z.enum(['in_person', 'online']),
  meetingUrl: z.union([z.string().trim().url().max(500).refine((u) => u.startsWith('https://'), 'Links must start with https://'), z.literal(''), z.null()]).default(null),
}).strict();

export const activityRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), orgId: idSchema.optional() }).strict(),
  z.object({ action: z.literal('save'), activityId: idSchema.optional(), orgId: idSchema.optional(), activity: activityInput }).strict(),
  z.object({ action: z.literal('set_status'), activityId: idSchema, status: z.enum(['cancelled', 'completed']), reason: z.string().trim().max(300).optional() }).strict(),
  z.object({ action: z.literal('register'), activityId: idSchema }).strict(),
  z.object({ action: z.literal('cancel_registration'), activityId: idSchema }).strict(),
  z.object({ action: z.literal('registrations'), activityId: idSchema }).strict(),
  z.object({ action: z.literal('mark_attendance'), activityId: idSchema, records: z.record(idSchema, z.enum(['attended', 'absent'])) }).strict(),
]);

type Services = { db: Firestore; auth: Auth };

/** May the actor manage activities at this academy/branch (null branch = academy-wide)? */
function canManage(a: Actor, orgId: string, branchId: string | null): boolean {
  if (isAcademyManager(a, orgId)) return true;
  if (!branchId) return false;
  return canManageBranch(a, orgId, branchId) || (a.role === 'instructor' && a.orgId === orgId && a.branchId === branchId);
}

/** Student eligibility: same academy, their branch or academy-wide, and the course/batch rules. */
function eligible(act: ActivityDoc, student: Actor, enrollments: Enrollment[]): boolean {
  if (act.orgId !== student.orgId || (act.branchId && act.branchId !== student.branchId)) return false;
  const active = enrollments.filter((e) => e.status === 'active');
  if (act.eligibility.courseIds.length && !active.some((e) => act.eligibility.courseIds.includes(e.courseId))) return false;
  if (act.eligibility.batchIds.length && !active.some((e) => act.eligibility.batchIds.includes(e.batchId))) return false;
  return true;
}

async function studentEnrollments(db: Firestore, a: Actor) {
  return (await db.collection('enrollments').where('orgId', '==', a.orgId).where('studentId', '==', a.id).get()).docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));
}

export async function handleActivities(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(activityRequestSchema, body);
  const { db } = services;
  const now = new Date().toISOString();

  switch (req.action) {
    case 'list': {
      if (actor.role === 'student') {
        const [acts, regs, enr] = await Promise.all([
          db.collection('activities').where('orgId', '==', actor.orgId).get(),
          db.collection('activityRegistrations').where('studentId', '==', actor.id).get(),
          studentEnrollments(db, actor),
        ]);
        const mine = new Map(regs.docs.map((d) => [(d.data() as RegistrationDoc).activityId, d.data() as RegistrationDoc]));
        const all = acts.docs.map((d) => ({ id: d.id, ...(d.data() as ActivityDoc) }));
        return {
          upcoming: all.filter((a) => a.status === 'scheduled' && a.endsAt >= now && eligible(a, actor, enr))
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
            .map((a) => ({ ...a, registration: mine.get(a.id) ?? null, seatsLeft: a.capacity === null ? null : Math.max(0, a.capacity - a.registeredCount), canRegister: now <= a.registrationDeadline })),
          history: [...mine.values()].filter((r) => r.status !== 'registered' || r.startsAt < now).sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
        };
      }
      if (!['super_admin', 'university_admin', 'branch_admin', 'instructor'].includes(actor.role)) throw denied();
      const orgId = isSuper(actor) ? req.orgId ?? actor.orgId : actor.orgId;
      const rows = (await db.collection('activities').where('orgId', '==', orgId).get()).docs.map((d) => ({ id: d.id, ...(d.data() as ActivityDoc) }))
        .filter((a) => isAcademyManager(actor, orgId) || a.branchId === actor.branchId || a.branchId === null);
      return { activities: rows.sort((a, b) => b.startsAt.localeCompare(a.startsAt)).map((a) => ({ ...a, canManage: canManage(actor, a.orgId, a.branchId) })), canCreate: true, branchId: actor.branchId ?? null };
    }

    case 'save': {
      const orgId = isSuper(actor) ? req.orgId ?? actor.orgId : actor.orgId;
      const a = req.activity;
      if (a.branchId) { const b = await getDocData<{ orgId: string }>(db, `branches/${a.branchId}`); if (!b || b.orgId !== orgId) throw notFound('That branch'); }
      if (!canManage(actor, orgId, a.branchId)) throw denied(a.branchId ? 'You can only create activities for your own branch.' : 'Academy-wide activities are created by academy administrators.');
      if (a.endsAt <= a.startsAt) throw invalid('The end must be after the start.');
      if (a.registrationDeadline > a.startsAt) throw invalid('Registration must close before the activity starts.');
      if (a.mode === 'online' && !a.meetingUrl) throw invalid('Add the meeting link for an online activity.');
      const ref = req.activityId ? db.doc(`activities/${req.activityId}`) : db.collection('activities').doc();
      return db.runTransaction(async (tx) => {
        const prev = req.activityId ? (await tx.get(ref)).data() as ActivityDoc | undefined : undefined;
        if (req.activityId && !prev) throw notFound('That activity');
        if (prev) {
          if (!canManage(actor, prev.orgId, prev.branchId) || prev.orgId !== orgId) throw denied();
          if (prev.status !== 'scheduled') throw conflict('Cancelled or completed activities can’t be edited.');
          if (a.capacity !== null && a.capacity < prev.registeredCount) throw invalid(`${prev.registeredCount} students are already registered; the capacity can’t be lower.`);
          tx.update(ref, { ...a, meetingUrl: a.meetingUrl || null, updatedAt: now });
        } else {
          tx.create(ref, { ...a, meetingUrl: a.meetingUrl || null, orgId, status: 'scheduled', registeredCount: 0, createdById: actor.id, createdAt: now, updatedAt: now });
        }
        tx.create(db.collection('auditLog').doc(), { orgId, branchId: a.branchId, courseId: null, targetType: 'activity', targetId: ref.id, action: prev ? 'activity_update' : 'activity_create', actorId: actor.id, actorRole: actor.role, at: FieldValue.serverTimestamp() });
        return { activityId: ref.id };
      });
    }

    case 'set_status': {
      const ref = db.doc(`activities/${req.activityId}`);
      const regs = await db.collection('activityRegistrations').where('activityId', '==', req.activityId).where('status', '==', 'registered').get();
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That activity');
        const act = snap.data() as ActivityDoc;
        if (!isSuper(actor) && actor.orgId !== act.orgId) throw notFound('That activity');
        if (!canManage(actor, act.orgId, act.branchId)) throw denied();
        if (act.status !== 'scheduled') throw conflict('This activity is already closed.');
        if (req.status === 'cancelled' && !req.reason) throw invalid('Give a reason for cancelling.');
        tx.update(ref, { status: req.status, ...(req.reason ? { cancelReason: req.reason } : {}), updatedAt: now });
        if (req.status === 'cancelled') for (const r of regs.docs) notify(tx, db, { orgId: act.orgId, userId: r.data().studentId, type: 'activity_update', title: `Cancelled: ${act.title}`, body: req.reason!, link: '/dashboard/activities', sourceId: req.activityId });
        tx.create(db.collection('auditLog').doc(), { orgId: act.orgId, branchId: act.branchId, courseId: null, targetType: 'activity', targetId: req.activityId, action: `activity_${req.status}`, actorId: actor.id, actorRole: actor.role, ...(req.reason ? { reason: req.reason } : {}), at: FieldValue.serverTimestamp() });
        return { ok: true, notified: req.status === 'cancelled' ? regs.size : 0 };
      });
    }

    case 'register':
    case 'cancel_registration': {
      if (actor.role !== 'student') throw denied('Students register for activities.');
      const enr = await studentEnrollments(db, actor);
      const ref = db.doc(`activities/${req.activityId}`);
      const regRef = db.doc(`activityRegistrations/${req.activityId}_${actor.id}`);
      return db.runTransaction(async (tx) => {
        const [snap, regSnap] = await Promise.all([tx.get(ref), tx.get(regRef)]);
        if (!snap.exists) throw notFound('That activity');
        const act = snap.data() as ActivityDoc;
        if (!eligible(act, actor, enr)) throw notFound('That activity');
        const reg = regSnap.exists ? (regSnap.data() as RegistrationDoc) : null;
        if (act.status !== 'scheduled') throw conflict('This activity is no longer open.');
        if (now > act.registrationDeadline) throw conflict('Registration has closed.');
        if (req.action === 'register') {
          if (reg?.status === 'registered') throw conflict('You are already registered.', 'duplicate');
          if (act.capacity !== null && act.registeredCount >= act.capacity) throw conflict('This activity is full.', 'full');
          const doc: RegistrationDoc = { activityId: req.activityId, orgId: act.orgId, branchId: actor.branchId ?? '', studentId: actor.id, studentName: displayName(actor), status: 'registered', registeredAt: now, cancelledAt: null, activityTitle: act.title, startsAt: act.startsAt };
          if (reg) tx.update(regRef, { ...doc }); else tx.create(regRef, doc);
          tx.update(ref, { registeredCount: FieldValue.increment(1) });
          return { status: 'registered' };
        }
        if (reg?.status !== 'registered') throw conflict('You aren’t registered.');
        tx.update(regRef, { status: 'cancelled', cancelledAt: now });
        tx.update(ref, { registeredCount: FieldValue.increment(-1) });
        return { status: 'cancelled' };
      });
    }

    case 'registrations':
    case 'mark_attendance': {
      const act = await getDocData<ActivityDoc>(db, `activities/${req.activityId}`);
      if (!act || (!isSuper(actor) && actor.orgId !== act.orgId)) throw notFound('That activity');
      if (!canManage(actor, act.orgId, act.branchId)) throw denied();
      const regs = await db.collection('activityRegistrations').where('activityId', '==', req.activityId).get();
      if (req.action === 'registrations') return { activity: act, registrations: regs.docs.map((d) => ({ ...(d.data() as RegistrationDoc), id: d.id })).sort((a, b) => a.studentName.localeCompare(b.studentName)) };
      if (now < act.startsAt) throw conflict('Attendance can be recorded once the activity has started.');
      const registered = new Map(regs.docs.map((d) => [(d.data() as RegistrationDoc).studentId, d.ref]));
      const batch = db.batch();
      for (const [studentId, st] of Object.entries(req.records)) {
        const r = registered.get(studentId);
        if (!r) throw invalid('Attendance can only be recorded for registered students.');
        batch.update(r, { status: st, attendanceMarkedById: actor.id, attendanceMarkedAt: now });
      }
      batch.create(db.collection('auditLog').doc(), { orgId: act.orgId, branchId: act.branchId, courseId: null, targetType: 'activity', targetId: req.activityId, action: 'activity_attendance', actorId: actor.id, actorRole: actor.role, count: Object.keys(req.records).length, at: FieldValue.serverTimestamp() });
      await batch.commit();
      return { ok: true };
    }
  }
}

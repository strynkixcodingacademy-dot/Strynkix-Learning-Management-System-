import 'server-only';

/**
 * Strynkix LMS — doubt resolution and mentoring (Stage 10).
 *
 * A student asks about a course they are enrolled in (optionally a module or
 * lesson). Only that student, the instructors of their batch, the managers of
 * their branch and academy administrators can see it — never other students
 * or other academies. Every message and status change is kept in
 * doubts/{id}/messages with who did it and when; participants are notified.
 *
 * Statuses: open → assigned → in_progress ↔ waiting_for_student → resolved
 * (and reopen → open).
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema } from '@/types/validation';
import type { Batch, Enrollment } from '@/types/domain';
import { type Actor, canManageBranch, conflict, denied, displayName, getDocData, invalid, isAcademyManager, isSuper, loadActor, notFound, parseBody, teachesBatch } from '@/lib/server/academy-scope';
import { notify } from '@/lib/server/notifications';

export const DOUBT_STATUSES = ['open', 'assigned', 'in_progress', 'waiting_for_student', 'resolved'] as const;
export type DoubtStatus = (typeof DOUBT_STATUSES)[number];

export interface DoubtDoc {
  orgId: string; branchId: string; batchId: string; courseId: string; courseTitle: string; moduleId: string | null; lessonId: string | null; lessonTitle: string | null;
  studentId: string; studentName: string; title: string; body: string; references: string[]; priority: 'normal' | 'high'; status: DoubtStatus;
  assignedToId: string | null; assignedToName: string | null; messageCount: number; createdAt: string; updatedAt: string; lastActivityAt: string;
  firstResponseAt: string | null; resolvedAt: string | null; resolvedById: string | null;
}

const https = z.string().trim().url().max(500).refine((u) => u.startsWith('https://'), 'Links must start with https://');
export const doubtRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), courseId: idSchema, moduleId: idSchema.optional(), lessonId: idSchema.optional(), title: z.string().trim().min(5, 'Write a short title (at least 5 characters).').max(150), body: z.string().trim().min(10, 'Explain your doubt (at least 10 characters).').max(5000), references: z.array(https).max(5).default([]), priority: z.enum(['normal', 'high']).default('normal') }).strict(),
  z.object({ action: z.literal('list'), status: z.enum(DOUBT_STATUSES).optional(), courseId: idSchema.optional(), batchId: idSchema.optional(), priority: z.enum(['normal', 'high']).optional(), orgId: idSchema.optional() }).strict(),
  z.object({ action: z.literal('get'), doubtId: idSchema }).strict(),
  z.object({ action: z.literal('reply'), doubtId: idSchema, body: z.string().trim().min(2, 'Write a reply.').max(5000) }).strict(),
  z.object({ action: z.literal('assign'), doubtId: idSchema, instructorId: idSchema }).strict(),
  z.object({ action: z.literal('set_status'), doubtId: idSchema, status: z.enum([...DOUBT_STATUSES, 'reopen'] as [string, ...string[]]), note: z.string().trim().max(1000).optional() }).strict(),
]);

type Services = { db: Firestore; auth: Auth };
const isStaffOf = (a: Actor, d: DoubtDoc, batch: Batch | null) => isAcademyManager(a, d.orgId) || canManageBranch(a, d.orgId, d.branchId) || (!!batch && teachesBatch(a, batch));
const canSee = (a: Actor, d: DoubtDoc, batch: Batch | null) => (isSuper(a) || a.orgId === d.orgId) && (a.id === d.studentId || isStaffOf(a, d, batch));
const LABEL: Record<DoubtStatus, string> = { open: 'Open', assigned: 'Assigned', in_progress: 'In progress', waiting_for_student: 'Waiting for you', resolved: 'Resolved' };

async function load(db: Firestore, a: Actor, id: string) {
  const d = await getDocData<DoubtDoc>(db, `doubts/${id}`);
  const batch = d ? await getDocData<Batch>(db, `batches/${d.batchId}`) : null;
  if (!d || !canSee(a, d, batch)) throw notFound('That doubt');
  return { d, batch };
}

/** Notifies the other side: the student for staff actions; the assigned instructor (or the batch's instructors) for student actions. */
function tell(tx: Transaction, db: Firestore, a: Actor, d: DoubtDoc & { id: string }, batch: Batch | null, kind: 'reply' | 'status', text: string) {
  const link = `/dashboard/doubts/${d.id}`;
  if (a.id === d.studentId) {
    const to = d.assignedToId ? [d.assignedToId] : batch?.instructorUserIds ?? [];
    for (const uid of to) notify(tx, db, { orgId: d.orgId, userId: uid, type: kind === 'reply' ? 'doubt_reply' : 'doubt_status', title: `${d.studentName}: ${d.title}`, body: text, link, sourceId: d.id });
  } else {
    notify(tx, db, { orgId: d.orgId, userId: d.studentId, type: kind === 'reply' ? 'doubt_reply' : 'doubt_status', title: kind === 'reply' ? `New reply: ${d.title}` : `Your doubt is now “${LABEL[d.status]}”`, body: text, link, sourceId: d.id });
  }
}

export async function handleDoubts(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(doubtRequestSchema, body);
  const { db } = services;
  const iso = new Date().toISOString();

  switch (req.action) {
    case 'create': {
      if (actor.role !== 'student') throw denied('Doubts are asked by students.');
      const e = await getDocData<Enrollment>(db, `enrollments/${req.courseId}_${actor.id}`);
      if (!e || e.status !== 'active') throw invalid('Ask about a course you are currently enrolled in.');
      const [course, lesson, batch] = await Promise.all([
        getDocData<{ title: string }>(db, `courses/${req.courseId}`),
        req.lessonId ? getDocData<{ title: string; courseId: string; moduleId: string }>(db, `lessons/${req.lessonId}`) : null,
        getDocData<Batch>(db, `batches/${e.batchId}`),
      ]);
      if (req.lessonId && (!lesson || lesson.courseId !== req.courseId)) throw invalid('That lesson isn’t part of this course.');
      if (req.moduleId) { const m = await getDocData<{ courseId: string }>(db, `modules/${req.moduleId}`); if (!m || m.courseId !== req.courseId) throw invalid('That module isn’t part of this course.'); }
      const ref = db.collection('doubts').doc();
      const doc: DoubtDoc = {
        orgId: actor.orgId, branchId: e.branchId, batchId: e.batchId, courseId: req.courseId, courseTitle: course?.title ?? 'Course', moduleId: req.moduleId ?? lesson?.moduleId ?? null,
        lessonId: req.lessonId ?? null, lessonTitle: lesson?.title ?? null, studentId: actor.id, studentName: displayName(actor), title: req.title, body: req.body, references: req.references,
        priority: req.priority, status: 'open', assignedToId: null, assignedToName: null, messageCount: 0, createdAt: iso, updatedAt: iso, lastActivityAt: iso, firstResponseAt: null, resolvedAt: null, resolvedById: null,
      };
      await db.runTransaction(async (tx) => {
        tx.create(ref, doc);
        tell(tx, db, actor, { ...doc, id: ref.id }, batch, 'reply', req.title);
      });
      return { doubtId: ref.id };
    }

    case 'list': {
      let rows: (DoubtDoc & { id: string })[];
      const map = (s: FirebaseFirestore.QuerySnapshot) => s.docs.map((d) => ({ id: d.id, ...(d.data() as DoubtDoc) }));
      if (actor.role === 'student') rows = map(await db.collection('doubts').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get());
      else if (actor.role === 'instructor') {
        const batches = (await db.collection('batches').where('orgId', '==', actor.orgId).where('instructorUserIds', 'array-contains', actor.id).get()).docs.map((d) => d.id);
        rows = [];
        for (let i = 0; i < batches.length; i += 10) rows.push(...map(await db.collection('doubts').where('orgId', '==', actor.orgId).where('batchId', 'in', batches.slice(i, i + 10)).get()));
      } else if (actor.role === 'branch_admin' && actor.branchId) rows = map(await db.collection('doubts').where('orgId', '==', actor.orgId).where('branchId', '==', actor.branchId).get());
      else if (actor.role === 'university_admin' || isSuper(actor)) rows = map(await db.collection('doubts').where('orgId', '==', isSuper(actor) ? req.orgId ?? actor.orgId : actor.orgId).get());
      else throw denied();
      rows = rows.filter((d) => (!req.status || d.status === req.status) && (!req.courseId || d.courseId === req.courseId) && (!req.batchId || d.batchId === req.batchId) && (!req.priority || d.priority === req.priority))
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, 300);
      return { doubts: rows.map(({ body: _b, references: _r, ...d }) => { void _b; void _r; return d; }), canManage: actor.role !== 'student' };
    }

    case 'get': {
      const { d, batch } = await load(db, actor, req.doubtId);
      const msgs = await db.collection(`doubts/${req.doubtId}/messages`).orderBy('createdAt').get();
      return {
        doubt: { ...d, id: req.doubtId }, messages: msgs.docs.map((m) => ({ id: m.id, ...m.data() })), isStudent: actor.id === d.studentId, isStaff: isStaffOf(actor, d, batch),
        instructors: isStaffOf(actor, d, batch) && batch ? (batch.instructorUserIds ?? []).map((id, i) => ({ id, name: batch.instructorNames?.[i] ?? id })) : [],
      };
    }

    case 'reply':
    case 'assign':
    case 'set_status': {
      const ref = db.doc(`doubts/${req.doubtId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That doubt');
        const d = { id: snap.id, ...(snap.data() as DoubtDoc) };
        const bsnap = await tx.get(db.doc(`batches/${d.batchId}`));
        const batch = bsnap.exists ? ({ id: bsnap.id, ...bsnap.data() } as Batch) : null;
        if (!canSee(actor, d, batch)) throw notFound('That doubt');
        const staff = isStaffOf(actor, d, batch);
        const student = actor.id === d.studentId;
        const msgRef = ref.collection('messages').doc();
        const base = { authorId: actor.id, authorName: displayName(actor), authorRole: actor.role, createdAt: iso };
        const update: Record<string, unknown> = { updatedAt: iso, lastActivityAt: iso, messageCount: FieldValue.increment(1) };

        if (req.action === 'reply') {
          if (d.status === 'resolved') throw conflict('This doubt is resolved. Reopen it to continue the discussion.');
          tx.create(msgRef, { ...base, kind: 'message', body: req.body });
          if (staff && !student) {
            if (!d.firstResponseAt) update.firstResponseAt = iso;
            if (d.status === 'open' || d.status === 'assigned') update.status = 'in_progress';
          } else if (d.status === 'waiting_for_student') update.status = d.assignedToId ? 'in_progress' : 'open';
          tx.update(ref, update);
          tell(tx, db, actor, { ...d, ...(update.status ? { status: update.status as DoubtStatus } : {}) }, batch, 'reply', req.body.slice(0, 200));
          return { ok: true, status: update.status ?? d.status };
        }

        if (req.action === 'assign') {
          if (!staff) throw denied('Instructors and managers assign doubts.');
          if (!batch || !(batch.instructorUserIds ?? []).includes(req.instructorId)) throw invalid('Assign it to an instructor of the student’s batch.');
          const name = batch.instructorNames?.[(batch.instructorUserIds ?? []).indexOf(req.instructorId)] ?? req.instructorId;
          Object.assign(update, { assignedToId: req.instructorId, assignedToName: name, ...(d.status === 'open' ? { status: 'assigned' } : {}) });
          tx.create(msgRef, { ...base, kind: 'status', body: `Assigned to ${name}`, fromStatus: d.status, toStatus: update.status ?? d.status });
          tx.update(ref, update);
          if (req.instructorId !== actor.id) notify(tx, db, { orgId: d.orgId, userId: req.instructorId, type: 'doubt_status', title: `Doubt assigned to you: ${d.title}`, body: d.courseTitle, link: `/dashboard/doubts/${d.id}`, sourceId: d.id });
          return { ok: true };
        }

        // set_status
        const to = req.status === 'reopen' ? 'open' : (req.status as DoubtStatus);
        if (req.status === 'reopen') { if (d.status !== 'resolved') throw conflict('Only resolved doubts can be reopened.'); if (!staff && !student) throw denied(); }
        else if (!staff) {
          if (!(student && to === 'resolved')) throw denied('You can mark your own doubt resolved or reopen it.');
        }
        if (to === d.status) throw conflict(`It is already ${LABEL[to].toLowerCase()}.`);
        Object.assign(update, { status: to, ...(to === 'resolved' ? { resolvedAt: iso, resolvedById: actor.id } : {}), ...(req.status === 'reopen' ? { resolvedAt: null, resolvedById: null } : {}) });
        tx.create(msgRef, { ...base, kind: 'status', body: req.note ?? '', fromStatus: d.status, toStatus: to });
        tx.update(ref, update);
        tell(tx, db, actor, { ...d, status: to }, batch, 'status', req.note ?? `${LABEL[d.status]} → ${LABEL[to]}`);
        return { ok: true, status: to };
      });
    }
  }
}

import 'server-only';

/**
 * Strynkix LMS — attendance. One session per batch per day
 * (attendance/{batchId}_{date}), recorded by the batch's instructors or its
 * branch managers. Corrections are allowed and audited with the previous
 * statuses; students can only read their own record.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema, planDateSchema } from '@/types/validation';
import type { Batch, Enrollment } from '@/types/domain';
import type { AttendanceSession } from '@/types/academy';
import {
  assertOrg, canWorkWithBatch, conflict, denied, getDocData, invalid, loadActor, localDate, notFound, parseBody,
} from '@/lib/server/academy-scope';
import { attendanceStats, batchSessions } from '@/lib/server/academy-metrics';
import { recordInvalidation } from '@/lib/server/snapshot-invalidation';

const status = z.enum(['present', 'absent', 'late', 'excused']);

export const attendanceRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('batch_sheet'), batchId: idSchema, date: planDateSchema }).strict(),
  z.object({
    action: z.literal('save_session'), batchId: idSchema, date: planDateSchema,
    topic: z.string().trim().max(200).optional(), records: z.record(idSchema, status),
  }).strict(),
  z.object({ action: z.literal('batch_report'), batchId: idSchema, from: planDateSchema.optional(), to: planDateSchema.optional() }).strict(),
  z.object({ action: z.literal('my_attendance') }).strict(),
]);

type Services = { db: Firestore; auth: Auth };

async function loadBatch(db: Firestore, id: string): Promise<Batch> {
  const b = await getDocData<Batch>(db, `batches/${id}`);
  if (!b) throw notFound('That batch');
  return b;
}

async function roster(db: Firestore, batch: Batch): Promise<Enrollment[]> {
  const snap = await db.collection('enrollments').where('orgId', '==', batch.orgId).where('batchId', '==', batch.id).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment))
    .filter((e) => e.status === 'active' || e.status === 'completed')
    .sort((a, b) => (a.studentDisplayName ?? '').localeCompare(b.studentDisplayName ?? ''));
}

export async function handleAttendance(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(attendanceRequestSchema, body);
  const { db } = services;

  if (req.action === 'my_attendance') {
    if (actor.role !== 'student') throw denied();
    const enrollments = (await db.collection('enrollments').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get()).docs
      .map((d) => ({ id: d.id, ...d.data() } as Enrollment));
    const out = [];
    for (const e of enrollments) {
      const [sessions, batch, course] = await Promise.all([
        batchSessions(db, actor.orgId, e.batchId),
        getDocData<Batch>(db, `batches/${e.batchId}`),
        getDocData<{ title: string }>(db, `courses/${e.courseId}`),
      ]);
      const mine = sessions.filter((s) => s.records?.[actor.id]);
      out.push({
        batchId: e.batchId, batchName: batch?.name ?? 'Batch', courseId: e.courseId, courseTitle: course?.title ?? 'Course', enrollmentStatus: e.status,
        stats: attendanceStats(mine, actor.id),
        history: mine.map((s) => ({ date: s.date, topic: s.topic ?? null, status: s.records[actor.id] })).reverse(),
      });
    }
    return { batches: out };
  }

  const batch = await loadBatch(db, req.batchId);
  assertOrg(actor, batch.orgId, 'That batch');
  if (!canWorkWithBatch(actor, batch)) throw denied('Only this batch’s instructors and branch managers can take attendance.');

  if (req.action === 'batch_sheet') {
    const [students, session] = await Promise.all([roster(db, batch), getDocData<AttendanceSession>(db, `attendance/${batch.id}_${req.date}`)]);
    return {
      batch: { id: batch.id, name: batch.name, courseId: batch.courseId, branchId: batch.branchId },
      students: students.map((e) => ({ studentId: e.studentId, name: e.studentDisplayName || e.studentEmail || e.studentId, enrollmentStatus: e.status })),
      session,
    };
  }

  if (req.action === 'batch_report') {
    const [students, sessions] = await Promise.all([roster(db, batch), batchSessions(db, batch.orgId, batch.id, req.from, req.to)]);
    return {
      batch: { id: batch.id, name: batch.name, courseId: batch.courseId, branchId: batch.branchId },
      sessionCount: sessions.length,
      sessions: sessions.map((s) => ({ date: s.date, topic: s.topic ?? null, records: s.records })),
      students: students.map((e) => ({ studentId: e.studentId, name: e.studentDisplayName || e.studentEmail || e.studentId, ...attendanceStats(sessions, e.studentId) })),
    };
  }

  // save_session
  const today = localDate();
  if (req.date > today) throw invalid('Attendance can’t be recorded for a future date.');
  if (batch.startDate && req.date < batch.startDate.slice(0, 10)) throw invalid('That date is before the batch started.');
  if (['cancelled', 'archived'].includes(batch.status)) throw conflict('This batch isn’t running.');
  const students = await roster(db, batch);
  const enrolled = new Set(students.map((e) => e.studentId));
  const unknown = Object.keys(req.records).filter((id) => !enrolled.has(id));
  if (unknown.length) throw invalid('Attendance can only be recorded for students enrolled in this batch.');
  if (!Object.keys(req.records).length) throw invalid('Mark at least one student.');
  const ref = db.doc(`attendance/${batch.id}_${req.date}`);
  const iso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() as AttendanceSession) : null;
    const changed = Object.entries(req.records).filter(([id, st]) => prev?.records?.[id] !== st).map(([id, st]) => ({ studentId: id, from: prev?.records?.[id] ?? null, to: st }));
    const doc = {
      orgId: batch.orgId, branchId: batch.branchId, courseId: batch.courseId, batchId: batch.id, date: req.date,
      ...(req.topic ? { topic: req.topic } : {}), records: { ...(prev?.records ?? {}), ...req.records }, takenById: actor.id, updatedAt: iso,
    };
    if (prev) tx.update(ref, doc);
    else tx.create(ref, { ...doc, createdAt: iso });
    recordInvalidation(tx, db, { orgId: batch.orgId, branchId: batch.branchId, fromDate: req.date, toDate: req.date, reason: 'Attendance recorded or corrected for a past date', sourceType: 'attendance', sourceId: ref.id });
    if (prev && changed.length) {
      tx.create(db.collection('auditLog').doc(), {
        orgId: batch.orgId, courseId: batch.courseId, branchId: batch.branchId, targetType: 'attendance', targetId: ref.id, action: 'attendance_corrected',
        actorId: actor.id, actorRole: actor.role, changes: changed.slice(0, 200), at: FieldValue.serverTimestamp(),
      });
    }
    return { saved: true, changed: changed.length };
  });
}

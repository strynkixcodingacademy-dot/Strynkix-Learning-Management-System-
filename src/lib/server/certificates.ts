import 'server-only';

/**
 * Strynkix LMS — course completion certificates.
 * - Each course has an eligibility policy (completion %, attendance %, final
 *   exam pass, average score), set by the academy's administrators.
 * - Branch managers issue a certificate only when the student meets it. The
 *   document id is `${courseId}_${studentId}`, so a second issue is refused.
 * - Each certificate has a sequential number and a random verification code;
 *   anyone with the code can check it at /verify/{code}.
 * - Certificates are revoked (with a reason), never deleted.
 */

import { randomBytes } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema } from '@/types/validation';
import type { Batch, Course, Enrollment, Organization, UserProfile } from '@/types/domain';
import type { Certificate, CertificatePolicy } from '@/types/academy';
import {
  type Actor, assertOrg, canManageBranch, conflict, denied, getDocData, invalid, isAcademyManager, loadActor, localDate, notFound, parseBody,
} from '@/lib/server/academy-scope';
import { attendanceStats, batchSessions, courseCompletion, releasedResults } from '@/lib/server/academy-metrics';
import { codeOf, commit, pad, reserve } from '@/lib/server/counters';
import { notify } from '@/lib/server/notifications';

export const DEFAULT_POLICY = { minCompletionPercent: 100, minAttendancePercent: 0, requireFinalExamPass: false, minAveragePercent: 0, signatoryName: '', signatoryTitle: 'Director' };

export const certificateRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get_policy'), courseId: idSchema }).strict(),
  z.object({
    action: z.literal('save_policy'), courseId: idSchema,
    policy: z.object({
      minCompletionPercent: z.number().min(0).max(100), minAttendancePercent: z.number().min(0).max(100),
      requireFinalExamPass: z.boolean(), minAveragePercent: z.number().min(0).max(100),
      signatoryName: z.string().trim().min(2, 'Enter the signatory’s name.').max(120), signatoryTitle: z.string().trim().min(2).max(120),
    }).strict(),
  }).strict(),
  z.object({ action: z.literal('batch_eligibility'), batchId: idSchema }).strict(),
  z.object({ action: z.literal('issue'), courseId: idSchema, studentId: idSchema }).strict(),
  z.object({ action: z.literal('revoke'), certificateId: idSchema, reason: z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(500) }).strict(),
  z.object({ action: z.literal('get'), certificateId: idSchema }).strict(),
  z.object({ action: z.literal('my_certificates') }).strict(),
]);

type Services = { db: Firestore; auth: Auth };

export interface Eligibility {
  eligible: boolean;
  completionPercent: number;
  attendancePercent: number | null;
  averagePercent: number | null;
  finalExamPassed: boolean;
  unmet: string[];
}

async function policyFor(db: Firestore, course: Course): Promise<Omit<CertificatePolicy, 'updatedById' | 'updatedAt'>> {
  const p = await getDocData<CertificatePolicy>(db, `certificatePolicies/${course.id}`);
  return { courseId: course.id, orgId: course.orgId, ...DEFAULT_POLICY, ...(p ?? {}) };
}

export async function evaluateEligibility(db: Firestore, course: Course, enrollment: Enrollment, policy: Omit<CertificatePolicy, 'updatedById' | 'updatedAt'>): Promise<Eligibility> {
  const [completion, sessions, results] = await Promise.all([
    courseCompletion(db, course.orgId, course.id, enrollment.studentId),
    batchSessions(db, course.orgId, enrollment.batchId),
    releasedResults(db, course.orgId, enrollment.studentId),
  ]);
  const att = attendanceStats(sessions, enrollment.studentId);
  const mine = results.filter((r) => r.attempt.courseId === course.id && r.released && r.attempt.status === 'evaluated');
  // Average of each assessment's best released result.
  const best = new Map<string, number>();
  for (const r of mine) best.set(r.attempt.assessmentId, Math.max(best.get(r.attempt.assessmentId) ?? 0, r.attempt.percent ?? 0));
  const average = best.size ? Math.round(([...best.values()].reduce((s, v) => s + v, 0) / best.size) * 10) / 10 : null;
  const finalPassed = mine.some((r) => r.attempt.examType === 'final' && r.attempt.passed);
  const unmet: string[] = [];
  if (completion.percent < policy.minCompletionPercent) unmet.push(`Complete at least ${policy.minCompletionPercent}% of lessons (now ${completion.percent}%).`);
  if (policy.minAttendancePercent > 0 && (att.scheduled === 0 || att.percent < policy.minAttendancePercent)) unmet.push(`Attend at least ${policy.minAttendancePercent}% of classes (now ${att.scheduled ? att.percent : 0}%).`);
  if (policy.requireFinalExamPass && !finalPassed) unmet.push('Pass the final examination.');
  if (policy.minAveragePercent > 0 && (average === null || average < policy.minAveragePercent)) unmet.push(`Average at least ${policy.minAveragePercent}% across assessments (now ${average ?? 0}%).`);
  return { eligible: unmet.length === 0, completionPercent: completion.percent, attendancePercent: att.scheduled ? att.percent : null, averagePercent: average, finalExamPassed: finalPassed, unmet };
}

/** The student, managers of the student's branch, or an instructor of the student's batch for that course. */
async function canSeeCertificate(db: Firestore, actor: Actor, c: Certificate): Promise<boolean> {
  if (actor.role === 'student') return actor.id === c.studentId;
  if (canManageBranch(actor, c.orgId, c.branchId)) return true;
  if (actor.role !== 'instructor' || actor.orgId !== c.orgId) return false;
  const enrollment = await getDocData<Enrollment>(db, `enrollments/${c.courseId}_${c.studentId}`);
  const batch = enrollment ? await getDocData<Batch>(db, `batches/${enrollment.batchId}`) : null;
  return Boolean(batch?.instructorUserIds?.includes(actor.id));
}

export async function handleCertificates(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(certificateRequestSchema, body);
  const { db } = services;
  const iso = new Date().toISOString();

  switch (req.action) {
    case 'get_policy':
    case 'save_policy': {
      const course = await getDocData<Course>(db, `courses/${req.courseId}`);
      if (!course) throw notFound('That course');
      assertOrg(actor, course.orgId, 'That course');
      if (req.action === 'get_policy') {
        if (actor.role === 'student') throw denied();
        return { policy: await policyFor(db, course), canEdit: isAcademyManager(actor, course.orgId) };
      }
      if (!isAcademyManager(actor, course.orgId)) throw denied('Only academy administrators set certificate rules.');
      await db.runTransaction(async (tx) => {
        tx.set(db.doc(`certificatePolicies/${course.id}`), { courseId: course.id, orgId: course.orgId, ...req.policy, updatedById: actor.id, updatedAt: iso });
        tx.create(db.collection('auditLog').doc(), {
          orgId: course.orgId, courseId: course.id, targetType: 'certificate_policy', targetId: course.id, action: 'certificate_policy_update',
          actorId: actor.id, actorRole: actor.role, at: FieldValue.serverTimestamp(),
        });
      });
      return { ok: true };
    }

    case 'batch_eligibility': {
      const batch = await getDocData<Batch>(db, `batches/${req.batchId}`);
      if (!batch) throw notFound('That batch');
      assertOrg(actor, batch.orgId, 'That batch');
      const teaches = actor.role === 'instructor' && (batch.instructorUserIds ?? []).includes(actor.id);
      if (!canManageBranch(actor, batch.orgId, batch.branchId) && !teaches) throw denied();
      const course = await getDocData<Course>(db, `courses/${batch.courseId}`);
      if (!course) throw notFound('That course');
      const policy = await policyFor(db, course);
      const enrollments = (await db.collection('enrollments').where('orgId', '==', batch.orgId).where('batchId', '==', batch.id).get()).docs
        .map((d) => ({ id: d.id, ...d.data() } as Enrollment)).filter((e) => e.status === 'active' || e.status === 'completed');
      const certs = await db.getAll(...(enrollments.length ? enrollments.map((e) => db.doc(`certificates/${course.id}_${e.studentId}`)) : [db.doc('certificates/__none__')]));
      const certBy = new Map(certs.filter((s) => s.exists).map((s) => [s.id, { id: s.id, ...s.data() } as Certificate]));
      const rows = await Promise.all(enrollments.map(async (e) => ({
        studentId: e.studentId, name: e.studentDisplayName || e.studentEmail || e.studentId,
        eligibility: await evaluateEligibility(db, course, e, policy),
        certificate: certBy.get(`${course.id}_${e.studentId}`) ?? null,
      })));
      return { policy, canIssue: canManageBranch(actor, batch.orgId, batch.branchId), students: rows };
    }

    case 'issue': {
      const [course, enrollment, student] = await Promise.all([
        getDocData<Course>(db, `courses/${req.courseId}`),
        getDocData<Enrollment>(db, `enrollments/${req.courseId}_${req.studentId}`),
        getDocData<UserProfile>(db, `users/${req.studentId}`),
      ]);
      if (!course || !enrollment || !student) throw notFound('That student’s enrollment');
      assertOrg(actor, course.orgId, 'That course');
      if (!canManageBranch(actor, enrollment.orgId, enrollment.branchId)) throw denied('Only branch managers and administrators issue certificates.');
      if (!['active', 'completed'].includes(enrollment.status)) throw conflict('The student’s enrollment isn’t active or completed.');
      const policy = await policyFor(db, course);
      if (!policy.signatoryName) throw conflict('Set the certificate rules and signatory for this course first.');
      const eligibility = await evaluateEligibility(db, course, enrollment, policy);
      if (!eligibility.eligible) throw conflict(`Not eligible yet: ${eligibility.unmet.join(' ')}`, 'not_eligible');
      const [org, branch] = await Promise.all([getDocData<Organization>(db, `organizations/${course.orgId}`), getDocData<{ code?: string }>(db, `branches/${enrollment.branchId}`)]);
      const year = localDate().slice(0, 4);
      const ref = db.doc(`certificates/${course.id}_${student.id}`);
      return db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) throw conflict('A certificate has already been issued for this course.', 'duplicate');
        const counter = await reserve(tx, db, `certificate_${course.orgId}_${year}`);
        const number = `${codeOf(org?.slug ?? org?.name, 'STX')}-${codeOf(branch?.code, 'HQ')}-${year}-${pad(counter.value, 5)}`;
        const cert: Omit<Certificate, 'id'> = {
          orgId: course.orgId, branchId: enrollment.branchId, courseId: course.id, studentId: student.id, studentName: student.displayName || student.email,
          courseTitle: course.title, academyName: org?.name ?? 'Strynkix Coding Academy', certificateNumber: number,
          verificationCode: randomBytes(9).toString('base64url'), completedOn: localDate(), signatoryName: policy.signatoryName, signatoryTitle: policy.signatoryTitle,
          status: 'issued', issuedById: actor.id, issuedAt: iso,
        };
        commit(tx, counter, iso);
        tx.create(ref, cert);
        notify(tx, db, { orgId: course.orgId, userId: student.id, type: 'certificate_issued', title: `Certificate issued: ${course.title}`, body: `Certificate ${number} is ready to download.`, link: '/dashboard/certificates', sourceId: ref.id });
        tx.create(db.collection('auditLog').doc(), {
          orgId: course.orgId, courseId: course.id, branchId: enrollment.branchId, targetType: 'certificate', targetId: ref.id, action: 'certificate_issue',
          actorId: actor.id, actorRole: actor.role, studentId: student.id, certificateNumber: number, at: FieldValue.serverTimestamp(),
        });
        return { certificateId: ref.id, certificateNumber: number };
      });
    }

    case 'revoke': {
      const ref = db.doc(`certificates/${req.certificateId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That certificate');
        const c = snap.data() as Certificate;
        assertOrg(actor, c.orgId, 'That certificate');
        if (!isAcademyManager(actor, c.orgId)) throw denied('Only academy administrators revoke certificates.');
        if (c.status === 'revoked') throw conflict('It is already revoked.');
        tx.update(ref, { status: 'revoked', revokedReason: req.reason, revokedAt: iso, revokedById: actor.id });
        tx.create(db.collection('auditLog').doc(), {
          orgId: c.orgId, courseId: c.courseId, targetType: 'certificate', targetId: ref.id, action: 'certificate_revoke',
          actorId: actor.id, actorRole: actor.role, reason: req.reason, at: FieldValue.serverTimestamp(),
        });
        return { ok: true };
      });
    }

    case 'get': {
      const c = await getDocData<Certificate>(db, `certificates/${req.certificateId}`);
      if (!c || (actor.role !== 'super_admin' && actor.orgId !== c.orgId) || !(await canSeeCertificate(db, actor, c))) throw notFound('That certificate');
      return { certificate: c };
    }

    case 'my_certificates': {
      if (actor.role !== 'student') throw denied();
      const [certs, enrollments] = await Promise.all([
        db.collection('certificates').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get(),
        db.collection('enrollments').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get(),
      ]);
      const issued = certs.docs.map((d) => ({ id: d.id, ...d.data() } as Certificate));
      const pending = enrollments.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment))
        .filter((e) => ['active', 'completed'].includes(e.status) && !issued.some((c) => c.courseId === e.courseId));
      const progress = (await Promise.all(pending.map(async (e) => {
        const course = await getDocData<Course>(db, `courses/${e.courseId}`);
        if (!course) return null;
        return { courseId: course.id, courseTitle: course.title, eligibility: await evaluateEligibility(db, course, e, await policyFor(db, course)) };
      }))).filter((p) => p !== null);
      return { certificates: issued, inProgress: progress };
    }
  }
}

/** Public verification: only what a certificate shows on its face. */
export async function verifyCertificate(db: Firestore, code: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(code)) throw invalid('That verification code isn’t valid.');
  const snap = await db.collection('certificates').where('verificationCode', '==', code).limit(1).get();
  const c = snap.docs[0]?.data() as Certificate | undefined;
  if (!c) return { valid: false as const };
  return {
    valid: c.status === 'issued', status: c.status, certificateNumber: c.certificateNumber, studentName: c.studentName,
    courseTitle: c.courseTitle, academyName: c.academyName, completedOn: c.completedOn,
  };
}

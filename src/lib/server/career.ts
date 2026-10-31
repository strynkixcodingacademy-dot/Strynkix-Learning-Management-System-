import 'server-only';

/**
 * Strynkix LMS — student portfolio and resume builder.
 * - Students add, edit, hide and delete their own portfolio entries and
 *   resumes; nobody else can change them.
 * - Their instructors (batches they teach) and branch managers can view a
 *   student's visible portfolio and add a recommendation to an entry.
 * - Suggestions come only from verified records: evaluated practical work and
 *   issued certificates. A certificate cited in a resume is checked on save
 *   (it must be the student's own, issued certificate); the verification link
 *   is set by the server, so it can't be invented.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema, planDateSchema } from '@/types/validation';
import type { Enrollment, UserProfile } from '@/types/domain';
import type { AssessmentAttempt, Certificate, PortfolioEntry, Resume } from '@/types/academy';
import { type Actor, canManageBranch, conflict, denied, displayName, getDocData, invalid, loadActor, notFound, parseBody } from '@/lib/server/academy-scope';

const MAX_ENTRIES = 50;
const MAX_RESUMES = 10;
const https = z.union([z.string().trim().url('Use a full link (https://…).').max(500).refine((u) => u.startsWith('https://'), 'Links must start with https://'), z.literal('')]).optional();
const t = (max: number) => z.string().trim().max(max);
const list = (max: number, len: number) => z.array(t(len).min(1)).max(max);

const entrySchema = z.object({
  title: t(120).min(3, 'Give the project a title.'), description: t(3000).min(10, 'Describe the project (at least 10 characters).'),
  skills: list(20, 40).default([]), technologies: list(20, 40).default([]), repoUrl: https, liveUrl: https, imageUrl: https,
  completedOn: planDateSchema.optional(), courseId: idSchema.optional(), attemptId: idSchema.optional(), visible: z.boolean().default(true),
}).strict();

const resumeDataSchema = z.object({
  fullName: t(100).min(2, 'Enter your full name.'), headline: t(120).optional(), email: z.union([z.string().trim().email().max(254), z.literal('')]).optional(),
  phone: t(30).optional(), location: t(100).optional(), summary: t(1500).optional(),
  links: z.object({ github: https, linkedin: https, portfolio: https }).strict().default({}),
  education: z.array(z.object({ institution: t(160).min(1), qualification: t(160).min(1), start: t(20).optional(), end: t(20).optional(), score: t(40).optional() }).strict()).max(10).default([]),
  skills: list(40, 40).default([]),
  projects: z.array(z.object({ title: t(120).min(1), description: t(1000).min(1), technologies: t(200).optional(), url: https, portfolioEntryId: idSchema.optional() }).strict()).max(15).default([]),
  experience: z.array(z.object({ organization: t(160).min(1), role: t(120).min(1), start: t(20).optional(), end: t(20).optional(), description: t(1000).optional(), internship: z.boolean().optional() }).strict()).max(15).default([]),
  certifications: z.array(z.object({ name: t(160).min(1), issuer: t(160).min(1), date: t(20).optional(), certificateId: idSchema.optional(), verifyUrl: z.string().optional() }).strict()).max(20).default([]),
  achievements: list(15, 300).default([]),
}).strict();

export const careerRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('portfolio') }).strict(),
  z.object({ action: z.literal('save_entry'), entryId: idSchema.optional(), entry: entrySchema }).strict(),
  z.object({ action: z.literal('delete_entry'), entryId: idSchema }).strict(),
  z.object({ action: z.literal('student_portfolio'), studentId: idSchema }).strict(),
  z.object({ action: z.literal('recommend'), entryId: idSchema, note: t(500).optional(), remove: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('resumes') }).strict(),
  z.object({ action: z.literal('save_resume'), resumeId: idSchema.optional(), name: t(60).min(1, 'Name this resume version.'), template: z.enum(['classic', 'modern', 'compact']), data: resumeDataSchema }).strict(),
  z.object({ action: z.literal('delete_resume'), resumeId: idSchema }).strict(),
  z.object({ action: z.literal('suggestions') }).strict(),
]);

type Services = { db: Firestore; auth: Auth };

const student = (a: Actor) => { if (a.role !== 'student') throw denied('This is for students.'); };

async function verifiedWork(db: Firestore, a: Actor) {
  const attempts = (await db.collection('assessmentAttempts').where('orgId', '==', a.orgId).where('studentId', '==', a.id).where('status', '==', 'evaluated').get()).docs
    .map((d) => ({ id: d.id, ...d.data() } as AssessmentAttempt)).filter((x) => x.kind === 'practical');
  const courseIds = [...new Set(attempts.map((x) => x.courseId))];
  const courses = courseIds.length ? await db.getAll(...courseIds.map((id) => db.doc(`courses/${id}`))) : [];
  const title = new Map(courses.map((c) => [c.id, (c.data()?.title as string) ?? 'Course']));
  return attempts.map((x) => ({ attemptId: x.id, courseId: x.courseId, courseTitle: title.get(x.courseId) ?? '', title: x.title, repoUrl: x.practical?.repoUrl ?? null, liveUrl: x.practical?.liveUrl ?? null, description: x.practical?.text ?? '', completedOn: (x.submittedAt ?? '').slice(0, 10), score: x.score, totalMarks: x.totalMarks }));
}

/** Instructors of one of the student's batches, or managers of the student's branch. */
async function canViewStudent(db: Firestore, a: Actor, s: UserProfile): Promise<boolean> {
  if (s.role !== 'student' || (a.role !== 'super_admin' && a.orgId !== s.orgId)) return false;
  if (s.branchId && canManageBranch(a, s.orgId, s.branchId)) return true;
  if (a.role !== 'instructor') return false;
  const enr = (await db.collection('enrollments').where('orgId', '==', s.orgId).where('studentId', '==', s.id).get()).docs.map((d) => d.data() as Enrollment);
  const batches = enr.length ? await db.getAll(...enr.map((e) => db.doc(`batches/${e.batchId}`))) : [];
  return batches.some((b) => ((b.data()?.instructorUserIds as string[]) ?? []).includes(a.id));
}

export async function handleCareer(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(careerRequestSchema, body);
  const { db } = services;
  const iso = new Date().toISOString();

  switch (req.action) {
    case 'portfolio': {
      student(actor);
      const rows = (await db.collection('portfolioEntries').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get()).docs.map((d) => ({ id: d.id, ...d.data() } as PortfolioEntry));
      return { entries: rows.sort((a, b) => (b.completedOn ?? b.createdAt).localeCompare(a.completedOn ?? a.createdAt)), verifiedWork: await verifiedWork(db, actor) };
    }

    case 'save_entry': {
      student(actor);
      const e = req.entry;
      if (e.attemptId) {
        const att = await getDocData<AssessmentAttempt>(db, `assessmentAttempts/${e.attemptId}`);
        if (!att || att.studentId !== actor.id || att.status !== 'evaluated') throw invalid('That course work isn’t one of your evaluated submissions.');
      }
      if (e.courseId) {
        const enr = await getDocData<Enrollment>(db, `enrollments/${e.courseId}_${actor.id}`);
        if (!enr) throw invalid('Link only courses you are enrolled in.');
      }
      const ref = req.entryId ? db.doc(`portfolioEntries/${req.entryId}`) : db.collection('portfolioEntries').doc();
      return db.runTransaction(async (tx) => {
        if (req.entryId) {
          const prev = await tx.get(ref);
          if (!prev.exists || prev.data()!.studentId !== actor.id) throw notFound('That portfolio entry');
          // Editing an entry keeps an instructor's recommendation only if the work itself is unchanged.
          const old = prev.data() as PortfolioEntry;
          const changed = old.title !== e.title || old.description !== e.description || (old.repoUrl ?? '') !== (e.repoUrl ?? '') || (old.liveUrl ?? '') !== (e.liveUrl ?? '');
          tx.update(ref, { ...clean(e), ...(changed ? { recommendation: FieldValue.delete() } : {}), updatedAt: iso });
        } else {
          const count = (await tx.get(db.collection('portfolioEntries').where('studentId', '==', actor.id).count())).data().count;
          if (count >= MAX_ENTRIES) throw conflict(`A portfolio holds up to ${MAX_ENTRIES} projects.`);
          tx.create(ref, { ...clean(e), orgId: actor.orgId, studentId: actor.id, createdAt: iso, updatedAt: iso });
        }
        return { entryId: ref.id };
      });
    }

    case 'delete_entry': {
      student(actor);
      const ref = db.doc(`portfolioEntries/${req.entryId}`);
      const s = await ref.get();
      if (!s.exists || s.data()!.studentId !== actor.id) throw notFound('That portfolio entry');
      await ref.delete();
      return { ok: true };
    }

    case 'student_portfolio': {
      const s = await getDocData<UserProfile>(db, `users/${req.studentId}`);
      if (!s || !(await canViewStudent(db, actor, s))) throw notFound('That student');
      const rows = (await db.collection('portfolioEntries').where('orgId', '==', s.orgId).where('studentId', '==', s.id).where('visible', '==', true).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
      return { student: { id: s.id, displayName: s.displayName }, entries: rows };
    }

    case 'recommend': {
      if (!['instructor', 'branch_admin', 'university_admin', 'super_admin'].includes(actor.role)) throw denied();
      const ref = db.doc(`portfolioEntries/${req.entryId}`);
      const entry = await getDocData<PortfolioEntry>(db, `portfolioEntries/${req.entryId}`);
      const s = entry ? await getDocData<UserProfile>(db, `users/${entry.studentId}`) : null;
      if (!entry || !s || !entry.visible || !(await canViewStudent(db, actor, s))) throw notFound('That portfolio entry');
      await ref.update(req.remove ? { recommendation: FieldValue.delete() } : { recommendation: { byId: actor.id, byName: displayName(actor), ...(req.note ? { note: req.note } : {}), at: iso } });
      return { ok: true };
    }

    case 'resumes': {
      student(actor);
      const rows = (await db.collection('resumes').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get()).docs.map((d) => ({ id: d.id, ...d.data() } as Resume));
      return { resumes: rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
    }

    case 'save_resume': {
      student(actor);
      // Certifications that cite a certificate must be the student's own issued certificate; the link is set here.
      const certIds = req.data.certifications.flatMap((c) => (c.certificateId ? [c.certificateId] : []));
      const certs = certIds.length ? await db.getAll(...certIds.map((id) => db.doc(`certificates/${id}`))) : [];
      const certBy = new Map(certs.filter((s) => s.exists).map((s) => [s.id, s.data() as Certificate]));
      const certifications = req.data.certifications.map((c) => {
        if (!c.certificateId) { const { verifyUrl: _v, ...rest } = c; void _v; return rest; }
        const cert = certBy.get(c.certificateId);
        if (!cert || cert.studentId !== actor.id || cert.status !== 'issued') throw invalid('A verified certificate in your resume must be one issued to you.');
        return { name: cert.courseTitle, issuer: cert.academyName, date: cert.completedOn, certificateId: c.certificateId, verifyUrl: `/verify/${cert.verificationCode}` };
      });
      const data = { ...req.data, certifications };
      const ref = req.resumeId ? db.doc(`resumes/${req.resumeId}`) : db.collection('resumes').doc();
      return db.runTransaction(async (tx) => {
        if (req.resumeId) {
          const prev = await tx.get(ref);
          if (!prev.exists || prev.data()!.studentId !== actor.id) throw notFound('That resume');
          tx.update(ref, { name: req.name, template: req.template, data: JSON.parse(JSON.stringify(data)), updatedAt: iso });
        } else {
          const count = (await tx.get(db.collection('resumes').where('studentId', '==', actor.id).count())).data().count;
          if (count >= MAX_RESUMES) throw conflict(`You can keep up to ${MAX_RESUMES} resume versions.`);
          tx.create(ref, { orgId: actor.orgId, studentId: actor.id, name: req.name, template: req.template, data: JSON.parse(JSON.stringify(data)), createdAt: iso, updatedAt: iso });
        }
        return { resumeId: ref.id };
      });
    }

    case 'delete_resume': {
      student(actor);
      const ref = db.doc(`resumes/${req.resumeId}`);
      const s = await ref.get();
      if (!s.exists || s.data()!.studentId !== actor.id) throw notFound('That resume');
      await ref.delete();
      return { ok: true };
    }

    case 'suggestions': {
      student(actor);
      const [entries, certs, enrollments, profile] = await Promise.all([
        db.collection('portfolioEntries').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get(),
        db.collection('certificates').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).where('status', '==', 'issued').get(),
        db.collection('enrollments').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get(),
        getDocData<{ personal?: { mobile?: string; city?: string; state?: string }; academic?: { highestQualification?: string; institution?: string } }>(db, `personProfiles/${actor.id}`),
      ]);
      const courseIds = enrollments.docs.map((d) => d.data().courseId as string);
      const courses = courseIds.length ? await db.getAll(...courseIds.map((id) => db.doc(`courses/${id}`))) : [];
      return {
        basics: { fullName: actor.displayName, email: actor.email, phone: profile?.personal?.mobile ?? '', location: [profile?.personal?.city, profile?.personal?.state].filter(Boolean).join(', ') },
        education: profile?.academic?.highestQualification ? [{ institution: profile.academic.institution ?? '', qualification: profile.academic.highestQualification }] : [],
        projects: entries.docs.map((d) => ({ ...(d.data() as PortfolioEntry), id: d.id })).map((e) => ({ portfolioEntryId: e.id, title: e.title, description: e.description, technologies: e.technologies.join(', '), url: e.liveUrl || e.repoUrl || '' })),
        certificates: certs.docs.map((d) => ({ certificateId: d.id, name: (d.data() as Certificate).courseTitle, issuer: (d.data() as Certificate).academyName, date: (d.data() as Certificate).completedOn })),
        courses: courses.filter((c) => c.exists).map((c) => ({ title: c.data()!.title as string, status: enrollments.docs.find((e) => e.data().courseId === c.id)?.data().status as string })),
      };
    }
  }
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}

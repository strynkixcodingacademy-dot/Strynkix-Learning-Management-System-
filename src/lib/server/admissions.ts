import 'server-only';

/**
 * Strynkix LMS — admissions, staff onboarding and people records.
 *
 * Admission: a Branch Manager (or administrator) saves a draft step by step,
 * then confirms it. Confirmation, on the server:
 *   1. checks the course price, batch, seats and duplicates;
 *   2. creates or reuses the student login through the trusted provisioning
 *      flow (createAccount) — never a second account for the same student;
 *   3. in one transaction: assigns the admission number, enrolls the student,
 *      opens the fee account with its installment schedule, records the first
 *      payment with a receipt, stores personal details in personProfiles and
 *      writes audit entries;
 *   4. removes a newly created login again if anything fails.
 * Discounts above the confirmer's limit are recorded as pending approval.
 *
 * Personal details (date of birth, address, emergency contact, compensation)
 * live in personProfiles/{uid}, which only branch managers in scope and
 * administrators read; compensation needs finance access.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema, planDateSchema } from '@/types/validation';
import type { Batch, Course, Enrollment, Organization, UserProfile } from '@/types/domain';
import type { Admission, AssessmentAttempt, CoursePricing, FeeAccount, PersonProfile } from '@/types/academy';
import { discountAmount, grossFee, needsApproval, scheduleError } from '@/lib/finance/fees';
import { createAccount } from '@/lib/server/account-provisioning';
import {
  type Actor, assertOrg, canManageBranch, canSeeFinance, conflict, denied, displayName, getDocData, invalid, isAcademyManager,
  loadActor, localDate, notFound, parseBody,
} from '@/lib/server/academy-scope';
import { attendanceStats, batchSessions } from '@/lib/server/academy-metrics';
import { codeOf, commit, pad, reserve } from '@/lib/server/counters';
import { methodSchema, reserveReceipt, summarize } from '@/lib/server/finance';

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) => text(max).optional();
const phone = z.string().trim().regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid phone number.');

export const personalSchema = z.object({
  firstName: text(60).min(1, 'Enter the first name.'), middleName: optional(60), lastName: text(60).min(1, 'Enter the surname.'),
  dateOfBirth: planDateSchema.optional(), gender: optional(30),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254), mobile: phone,
  emergencyName: optional(100), emergencyRelation: optional(40), emergencyPhone: phone.optional(),
  guardianName: optional(100), guardianRelation: optional(40), guardianPhone: phone.optional(),
  guardianEmail: z.string().trim().toLowerCase().email('Enter a valid guardian email.').max(254).optional(),
  address: optional(300), city: optional(80), state: optional(80), pinCode: z.string().trim().regex(/^\d{6}$/, 'PIN code is 6 digits.').optional(),
}).strict();
const draftPersonalSchema = personalSchema.partial().strict();

export const academicSchema = z.object({
  highestQualification: optional(120), currentOccupation: optional(120), institution: optional(160),
  technicalExperience: optional(1000), background: optional(1000),
}).strict();

const feeSchema = z.object({
  discountType: z.enum(['none', 'fixed', 'percent']), discountValue: z.number().int().min(0).max(1_00_00_000_00),
  discountReason: optional(300), plan: z.enum(['one_time', 'installments']),
  installments: z.array(z.object({ number: z.number().int().min(1).max(24), dueDate: planDateSchema, amount: z.number().int().min(1) }).strict()).max(24),
  initialPayment: z.object({ amount: z.number().int().min(1), method: methodSchema, reference: optional(80) }).strict().optional(),
}).strict();

const professionalSchema = z.object({
  qualification: optional(160), specialization: optional(160), skills: z.array(text(40).min(1)).max(30).optional(),
  experienceYears: z.number().min(0).max(60).optional(), joiningDate: planDateSchema.optional(),
  employmentStatus: z.enum(['active', 'on_leave', 'inactive']).optional(), responsibilities: optional(1000),
}).strict();
const compensationSchema = z.object({ type: z.enum(['monthly', 'hourly', 'per_batch']), amount: z.number().int().min(0).max(1_00_00_000_00), notes: optional(300) }).strict();

export const admissionRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save_draft'), admissionId: idSchema.optional(), orgId: idSchema.optional(), branchId: idSchema,
    personal: draftPersonalSchema, academic: academicSchema.default({}), courseId: idSchema.optional(), batchId: idSchema.optional(), fee: feeSchema.optional(),
  }).strict(),
  z.object({ action: z.literal('list'), orgId: idSchema.optional(), branchId: idSchema.optional(), status: z.enum(['draft', 'confirmed', 'cancelled']).optional() }).strict(),
  z.object({ action: z.literal('get'), admissionId: idSchema }).strict(),
  z.object({ action: z.literal('options'), branchId: idSchema }).strict(),
  z.object({ action: z.literal('confirm'), admissionId: idSchema, password: z.string().min(8, 'The initial password must be at least 8 characters.').max(128) }).strict(),
  z.object({ action: z.literal('discard_draft'), admissionId: idSchema }).strict(),
  z.object({
    action: z.literal('onboard_staff'), role: z.enum(['instructor', 'content_designer', 'content_lead']), orgId: idSchema.optional(), branchId: idSchema.optional(),
    personal: personalSchema, professional: professionalSchema, compensation: compensationSchema.optional(), password: z.string().min(8).max(128),
    batchIds: z.array(idSchema).max(20).optional(),
    courseDesign: z.object({ responsibilities: z.array(z.enum(['lead', 'curriculum_architect', 'content_developer', 'assessment_designer', 'reviewer'])).min(1), assignedCourseIds: z.array(z.string().min(1).max(128)).min(1).max(100) }).strict().optional(),
  }).strict(),
  z.object({ action: z.literal('search'), q: text(120).min(2, 'Type at least 2 characters.'), branchId: idSchema.optional() }).strict(),
  z.object({ action: z.literal('person'), userId: idSchema }).strict(),
  z.object({
    action: z.literal('update_person'), userId: idSchema, personal: personalSchema.omit({ email: true }).partial().optional(),
    academic: academicSchema.optional(), professional: professionalSchema.optional(), compensation: compensationSchema.nullable().optional(),
  }).strict(),
]);

type Services = { db: Firestore; auth: Auth };
type Req = z.infer<typeof admissionRequestSchema>;

const fullName = (p: Partial<Admission['personal']>) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');

function scopeFor(actor: Actor, orgId: string, branchId: string) {
  assertOrg(actor, orgId, 'That academy');
  if (!canManageBranch(actor, orgId, branchId)) throw actor.role === 'branch_admin' ? notFound('That branch') : denied('Admissions are handled by branch managers and administrators.');
}

/** Pricing preview and validation shared by drafts (soft) and confirmation (strict). */
function priceAdmission(actor: Actor, pricing: CoursePricing, fee: z.infer<typeof feeSchema>, today: string) {
  const gross = grossFee(pricing);
  const amount = discountAmount(gross, fee.discountType, fee.discountValue);
  if (amount > 0 && !fee.discountReason) throw invalid('Give a reason for the discount.');
  const pending = needsApproval(actor.role, pricing, gross, amount);
  const agreedNow = pending ? gross : gross - amount;
  const schedule = fee.plan === 'one_time' ? [{ number: 1, dueDate: fee.installments[0]?.dueDate ?? today, amount: agreedNow }] : fee.installments;
  if (fee.plan === 'installments' && !pricing.installmentOptions.includes(schedule.length)) throw invalid(`This course allows ${pricing.installmentOptions.join(', ')} installments.`);
  const err = scheduleError(schedule, agreedNow);
  if (err) throw invalid(err);
  // The first payment can't exceed what is due even if the discount is approved later.
  if (fee.initialPayment && fee.initialPayment.amount > gross - amount) throw invalid('The first payment is more than the fee.');
  return { gross, amount, pending, agreedNow, schedule };
}

export async function handleAdmissions(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req: Req = parseBody(admissionRequestSchema, body);
  const { db } = services;
  const iso = new Date().toISOString();
  const today = localDate();

  switch (req.action) {
    case 'options': {
      const branch = await getDocData<{ orgId: string; name: string; status?: string }>(db, `branches/${req.branchId}`);
      if (!branch) throw notFound('That branch');
      scopeFor(actor, branch.orgId, req.branchId);
      const [batches, pricing, courses] = await Promise.all([
        db.collection('batches').where('orgId', '==', branch.orgId).where('branchId', '==', req.branchId).get(),
        db.collection('coursePricing').where('orgId', '==', branch.orgId).get(),
        db.collection('courses').where('orgId', '==', branch.orgId).get(),
      ]);
      const priced = new Map(pricing.docs.map((d) => [d.id, d.data() as CoursePricing]));
      const open = batches.docs.map((d) => ({ id: d.id, ...d.data() } as Batch)).filter((b) => ['upcoming', 'in_progress'].includes(b.status));
      return {
        branch: { id: req.branchId, name: branch.name },
        courses: courses.docs.filter((d) => priced.get(d.id)?.available).map((d) => {
          const p = priced.get(d.id)!;
          return { id: d.id, title: d.data().title as string, description: (d.data().tagline || d.data().description || '') as string, weeks: d.data().estimatedWeeks ?? null, pricing: p, gross: grossFee(p) };
        }),
        batches: open.map((b) => ({ id: b.id, courseId: b.courseId, name: b.name, code: b.code, startDate: b.startDate, endDate: b.endDate ?? null, instructors: b.instructorNames ?? [], seatsLeft: b.maxStudents ? b.maxStudents - (b.activeEnrollmentCount ?? 0) : null })),
      };
    }

    case 'save_draft': {
      // The academy comes from the stored branch, which must exist and be active.
      const branch = await getDocData<{ orgId: string; status?: string }>(db, `branches/${req.branchId}`);
      if (!branch || (req.orgId && req.orgId !== branch.orgId)) throw notFound('That branch');
      const orgId = branch.orgId;
      scopeFor(actor, orgId, req.branchId);
      if ((branch.status ?? 'active') !== 'active') throw conflict('This branch isn’t active.');
      const ref = req.admissionId ? db.doc(`admissions/${req.admissionId}`) : db.collection('admissions').doc();
      return db.runTransaction(async (tx) => {
        const snap = req.admissionId ? await tx.get(ref) : null;
        if (snap && !snap.exists) throw notFound('That admission');
        const prev = snap?.data() as Admission | undefined;
        if (prev && (prev.orgId !== orgId || prev.branchId !== req.branchId)) throw invalid('An admission stays in its branch.');
        if (prev && prev.status !== 'draft') throw conflict('This admission is no longer a draft.');
        const doc = {
          orgId, branchId: req.branchId, status: 'draft', personal: req.personal, academic: req.academic,
          ...(req.courseId ? { courseId: req.courseId } : {}), ...(req.batchId ? { batchId: req.batchId } : {}), ...(req.fee ? { fee: req.fee } : {}),
          updatedAt: iso,
        };
        if (prev) tx.set(ref, { ...doc, createdById: prev.createdById, createdAt: prev.createdAt });
        else tx.create(ref, { ...doc, createdById: actor.id, createdAt: iso });
        return { admissionId: ref.id };
      });
    }

    case 'list': {
      const orgId = req.orgId ?? actor.orgId;
      assertOrg(actor, orgId, 'That academy');
      let q = db.collection('admissions').where('orgId', '==', orgId);
      if (isAcademyManager(actor, orgId)) { if (req.branchId) q = q.where('branchId', '==', req.branchId); }
      else if (actor.role === 'branch_admin' && actor.branchId) q = q.where('branchId', '==', actor.branchId);
      else throw denied();
      if (req.status) q = q.where('status', '==', req.status);
      const rows = (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() } as Admission));
      return {
        admissions: rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((a) => ({
          id: a.id, status: a.status, admissionNumber: a.admissionNumber ?? null, name: fullName(a.personal), email: a.personal.email ?? '', mobile: a.personal.mobile ?? '',
          branchId: a.branchId, courseId: a.courseId ?? null, batchId: a.batchId ?? null, studentId: a.studentId ?? null, feeAccountId: a.feeAccountId ?? null,
          confirmedAt: a.confirmedAt ?? null, updatedAt: a.updatedAt,
        })),
      };
    }

    case 'get': {
      const a = await getDocData<Admission>(db, `admissions/${req.admissionId}`);
      if (!a) throw notFound('That admission');
      scopeFor(actor, a.orgId, a.branchId);
      return { admission: a };
    }

    case 'discard_draft': {
      const ref = db.doc(`admissions/${req.admissionId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That admission');
        const a = snap.data() as Admission;
        scopeFor(actor, a.orgId, a.branchId);
        if (a.status !== 'draft') throw conflict('Only drafts can be discarded.');
        tx.update(ref, { status: 'cancelled', updatedAt: iso, cancelledById: actor.id });
        return { ok: true };
      });
    }

    case 'confirm': {
      const a = await getDocData<Admission>(db, `admissions/${req.admissionId}`);
      if (!a) throw notFound('That admission');
      scopeFor(actor, a.orgId, a.branchId);
      if (a.status !== 'draft') throw conflict('This admission has already been confirmed.', 'duplicate');
      const personal = parseBody(personalSchema, a.personal);
      if (!a.courseId || !a.batchId || !a.fee) throw invalid('Choose the course, batch and fee plan before confirming.');
      const fee = parseBody(feeSchema, a.fee);
      const [course, batch, pricing, org, branch] = await Promise.all([
        getDocData<Course>(db, `courses/${a.courseId}`), getDocData<Batch>(db, `batches/${a.batchId}`),
        getDocData<CoursePricing>(db, `coursePricing/${a.courseId}`), getDocData<Organization>(db, `organizations/${a.orgId}`),
        getDocData<{ code?: string; status?: string }>(db, `branches/${a.branchId}`),
      ]);
      if (!course || course.orgId !== a.orgId) throw invalid('That course isn’t available.');
      if (!pricing?.available) throw invalid('This course has no approved price yet. The Super Admin sets course pricing.');
      if (!batch || batch.courseId !== course.id || batch.branchId !== a.branchId) throw invalid('Choose a batch of this course at this branch.');
      if (!['upcoming', 'in_progress'].includes(batch.status)) throw conflict('That batch isn’t accepting admissions.');
      const priced = priceAdmission(actor, pricing, fee, today);
      // Duplicate checks: the same person admitted to the same course, or already enrolled.
      const sameEmail = await db.collection('admissions').where('orgId', '==', a.orgId).where('personal.email', '==', personal.email).where('status', '==', 'confirmed').get();
      if (sameEmail.docs.some((d) => d.data().courseId === course.id)) throw conflict('This student has already been admitted to this course.', 'duplicate');

      const login = await createAccount(services, idToken, { role: 'student', email: personal.email, password: req.password, displayName: fullName(personal), orgId: a.orgId, branchId: a.branchId });
      const studentId = login.uid;
      try {
        return await db.runTransaction(async (tx) => {
          const admissionRef = db.doc(`admissions/${a.id}`);
          const enrollmentRef = db.doc(`enrollments/${course.id}_${studentId}`);
          const batchRef = db.doc(`batches/${batch.id}`);
          const [admSnap, enrSnap, batchSnap] = await Promise.all([tx.get(admissionRef), tx.get(enrollmentRef), tx.get(batchRef)]);
          if ((admSnap.data() as Admission).status !== 'draft') throw conflict('This admission has already been confirmed.', 'duplicate');
          const existing = enrSnap.exists ? (enrSnap.data() as Enrollment) : null;
          if (existing && ['active', 'completed'].includes(existing.status)) throw conflict('This student is already enrolled in this course.', 'duplicate');
          const b = batchSnap.data() as Batch;
          if (b.maxStudents && (b.activeEnrollmentCount ?? 0) >= b.maxStudents) throw conflict(`The batch is full (${b.maxStudents} seats).`);
          const year = today.slice(0, 4);
          const admissionCounter = await reserve(tx, db, `admission_${a.orgId}_${a.branchId}_${year}`);
          const receipt = fee.initialPayment ? await reserveReceipt(tx, db, a.orgId, a.branchId, today) : null;
          const admissionNumber = `${codeOf(org?.slug ?? org?.name, 'STX')}-${codeOf(branch?.code, 'HQ')}-${year}-${pad(admissionCounter.value)}`;
          const name = fullName(personal);

          commit(tx, admissionCounter, iso);
          const enrollment = {
            orgId: a.orgId, branchId: a.branchId, courseId: course.id, batchId: batch.id, studentId, status: 'active', enrolledAt: iso, enrolledById: actor.id,
            studentDisplayName: name, studentEmail: personal.email, updatedAt: iso,
          };
          if (existing) tx.update(enrollmentRef, enrollment);
          else tx.create(enrollmentRef, { id: enrollmentRef.id, ...enrollment, createdAt: iso });
          if (b.maxStudents) tx.update(batchRef, { activeEnrollmentCount: FieldValue.increment(1), updatedAt: iso });
          tx.set(db.doc(`personProfiles/${studentId}`), { orgId: a.orgId, branchId: a.branchId, role: 'student', personal, academic: a.academic ?? {}, admissionNumber, updatedAt: iso }, { merge: true });
          tx.update(db.doc(`users/${studentId}`), { phoneNumber: personal.mobile, 'metadata.studentIdNumber': admissionNumber, 'metadata.enrolledAt': iso, updatedAt: iso });

          const feeRef = db.collection('feeAccounts').doc();
          const paid = fee.initialPayment?.amount ?? 0;
          const feeAccount: Omit<FeeAccount, 'id'> = {
            orgId: a.orgId, branchId: a.branchId, courseId: course.id, batchId: batch.id, studentId, studentName: name, admissionId: a.id, admissionNumber,
            courseTitle: course.title, currency: 'INR', pricingVersion: pricing.version, grossFee: priced.gross,
            discount: { type: fee.discountType, value: fee.discountValue, amount: priced.amount, ...(fee.discountReason ? { reason: fee.discountReason } : {}), status: priced.amount === 0 ? 'none' : priced.pending ? 'pending' : 'approved', requestedById: actor.id, ...(priced.amount && !priced.pending ? { approvedById: actor.id } : {}) },
            agreedFee: priced.agreedNow, plan: fee.plan, installments: priced.schedule,
            totals: { paid, refunded: 0, adjustments: 0 }, status: 'active', createdById: actor.id, createdAt: iso, updatedAt: iso,
          };
          tx.create(feeRef, feeAccount);
          if (fee.initialPayment && receipt) {
            commit(tx, receipt.counter, iso);
            tx.create(db.doc(`feeTransactions/pay_adm_${a.id}`), {
              orgId: a.orgId, branchId: a.branchId, courseId: course.id, feeAccountId: feeRef.id, studentId, studentName: name, type: 'payment',
              amount: paid, method: fee.initialPayment.method, ...(fee.initialPayment.reference ? { reference: fee.initialPayment.reference } : {}),
              date: today, receiptNumber: receipt.number, reason: 'Paid at admission', createdById: actor.id, createdByName: displayName(actor), createdAt: iso,
              balanceAfter: Math.max(0, priced.agreedNow - paid),
            });
          }
          tx.update(admissionRef, { status: 'confirmed', admissionNumber, studentId, feeAccountId: feeRef.id, confirmedById: actor.id, confirmedAt: iso, updatedAt: iso });
          const log = (action: string, targetType: string, targetId: string, extra: Record<string, unknown> = {}) =>
            tx.create(db.collection('auditLog').doc(), { orgId: a.orgId, branchId: a.branchId, courseId: course.id, targetType, targetId, action, actorId: actor.id, actorRole: actor.role, ...extra, at: FieldValue.serverTimestamp() });
          log('admission_confirm', 'admission', a.id, { studentId, admissionNumber, batchId: batch.id, accountReused: login.existing });
          log('fee_account_open', 'fee_account', feeRef.id, { grossFee: priced.gross, discount: priced.amount, discountPending: priced.pending, pricingVersion: pricing.version });
          if (fee.initialPayment) log('fee_payment', 'fee_transaction', `pay_adm_${a.id}`, { amount: paid, receiptNumber: receipt!.number });
          return { admissionNumber, studentId, feeAccountId: feeRef.id, receiptTransactionId: fee.initialPayment ? `pay_adm_${a.id}` : null, discountPending: priced.pending, accountExisted: login.existing };
        });
      } catch (err) {
        // Remove a login created for this admission so a retry starts clean; an existing student's login is kept.
        // A commit can fail ambiguously (it may have been applied), so re-read the admission first and never
        // remove the login of an admission that did get confirmed.
        const stored = await getDocData<Admission>(db, `admissions/${a.id}`).catch(() => null);
        const confirmed = stored === null || stored.status === 'confirmed';
        if (!login.existing && !confirmed) {
          await services.auth.deleteUser(studentId).catch(() => undefined);
          await db.doc(`users/${studentId}`).delete().catch(() => undefined);
        }
        throw err;
      }
    }

    case 'onboard_staff': {
      const orgId = req.orgId ?? actor.orgId;
      assertOrg(actor, orgId, 'That academy');
      if (req.compensation && !canSeeFinance(actor, orgId, req.branchId ?? null)) throw denied('Only finance-authorized users record compensation.');
      const account = await createAccount(services, idToken, {
        role: req.role, email: req.personal.email, password: req.password, displayName: fullName(req.personal), orgId,
        ...(req.role === 'instructor' ? { branchId: req.branchId } : {}), ...(req.courseDesign ? { courseDesign: req.courseDesign } : {}),
      });
      if (account.existing) throw conflict('An account with this email already exists.', 'email_in_use');
      try {
        return await db.runTransaction(async (tx) => {
          const batchRefs = (req.batchIds ?? []).map((id) => db.doc(`batches/${id}`));
          const snaps = batchRefs.length ? await tx.getAll(...batchRefs) : [];
          tx.set(db.doc(`personProfiles/${account.uid}`), {
            orgId, ...(req.branchId && req.role === 'instructor' ? { branchId: req.branchId } : {}), role: req.role, personal: req.personal,
            professional: req.professional, ...(req.compensation ? { compensation: req.compensation } : {}), updatedAt: iso,
          });
          tx.update(db.doc(`users/${account.uid}`), { phoneNumber: req.personal.mobile, updatedAt: iso });
          for (const s of snaps) {
            const b = { id: s.id, ...s.data() } as Batch;
            if (!s.exists || req.role !== 'instructor' || b.orgId !== orgId || b.branchId !== req.branchId || !canManageBranch(actor, b.orgId, b.branchId)) throw invalid('Instructors can only be assigned to batches at their branch.');
            if ((b.instructorUserIds ?? []).length >= 5) throw conflict(`${b.name} already has the maximum number of instructors.`);
            tx.update(s.ref, { instructorUserIds: [...(b.instructorUserIds ?? []), account.uid], instructorNames: [...(b.instructorNames ?? []), fullName(req.personal)], updatedAt: iso });
          }
          tx.create(db.collection('auditLog').doc(), {
            orgId, courseId: null, targetType: 'user', targetId: account.uid, action: 'staff_onboard', actorId: actor.id, actorRole: actor.role,
            toRole: req.role, batches: req.batchIds ?? [], compensationRecorded: Boolean(req.compensation), at: FieldValue.serverTimestamp(),
          });
          return { userId: account.uid };
        });
      } catch (err) {
        // Same ambiguity guard: keep the login if its onboarding record was written.
        const written = await db.doc(`personProfiles/${account.uid}`).get().then((d) => d.exists).catch(() => true);
        if (!written) {
          await services.auth.deleteUser(account.uid).catch(() => undefined);
          await db.doc(`users/${account.uid}`).delete().catch(() => undefined);
        }
        throw err;
      }
    }

    case 'search': {
      const orgId = actor.orgId;
      if (!['super_admin', 'university_admin', 'branch_admin'].includes(actor.role)) throw denied();
      const branch = actor.role === 'branch_admin' ? actor.branchId! : req.branchId ?? null;
      const q = req.q.trim();
      const ids = new Set<string>();
      const [byNumber, byMobile, byEmail, byName] = await Promise.all([
        db.collection('personProfiles').where('orgId', '==', orgId).where('admissionNumber', '==', q.toUpperCase()).limit(20).get(),
        db.collection('personProfiles').where('orgId', '==', orgId).where('personal.mobile', '==', q).limit(20).get(),
        db.collection('users').where('orgId', '==', orgId).where('email', '==', q.toLowerCase()).limit(20).get(),
        db.collection('users').where('orgId', '==', orgId).where('displayName', '>=', q).where('displayName', '<=', `${q}`).limit(40).get(),
      ]);
      for (const s of [byNumber, byMobile, byEmail, byName]) s.docs.forEach((d) => ids.add(d.id));
      const users = ids.size ? await db.getAll(...[...ids].map((id) => db.doc(`users/${id}`))) : [];
      const rows = users.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() } as UserProfile))
        .filter((u) => !branch || u.branchId === branch)
        .filter((u) => isAcademyManager(actor, orgId) || ['student', 'instructor'].includes(u.role));
      return { people: rows.map((u) => ({ id: u.id, displayName: u.displayName, email: u.email, role: u.role, branchId: u.branchId ?? null, status: u.status, studentId: u.metadata?.studentIdNumber ?? null })) };
    }

    case 'person': {
      const user = await getDocData<UserProfile>(db, `users/${req.userId}`);
      if (!user) throw notFound('That person');
      assertOrg(actor, user.orgId, 'That person');
      const managed = user.branchId ? canManageBranch(actor, user.orgId, user.branchId) : isAcademyManager(actor, user.orgId);
      if (!managed) throw actor.role === 'branch_admin' ? notFound('That person') : denied();
      const finance = canSeeFinance(actor, user.orgId, user.branchId ?? null);
      const profile = await getDocData<PersonProfile>(db, `personProfiles/${user.id}`);
      const [enrollments, attempts, feeAccounts, taught] = await Promise.all([
        db.collection('enrollments').where('orgId', '==', user.orgId).where('studentId', '==', user.id).get(),
        user.role === 'student' ? db.collection('assessmentAttempts').where('orgId', '==', user.orgId).where('studentId', '==', user.id).get() : null,
        finance && user.role === 'student' ? db.collection('feeAccounts').where('orgId', '==', user.orgId).where('studentId', '==', user.id).get() : null,
        user.role === 'instructor' ? db.collection('batches').where('orgId', '==', user.orgId).where('instructorUserIds', 'array-contains', user.id).get() : null,
      ]);
      const enr = enrollments.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));
      const courseSnaps = enr.length ? await db.getAll(...enr.map((e) => db.doc(`courses/${e.courseId}`))) : [];
      const batchSnaps = enr.length ? await db.getAll(...enr.map((e) => db.doc(`batches/${e.batchId}`))) : [];
      const academic = [];
      for (let i = 0; i < enr.length; i++) {
        const e = enr[i];
        const mine = (attempts?.docs ?? []).map((d) => d.data() as AssessmentAttempt).filter((t) => t.courseId === e.courseId && t.status === 'evaluated');
        academic.push({
          courseId: e.courseId, courseTitle: (courseSnaps[i].data()?.title as string) ?? 'Course', batchId: e.batchId, batchName: (batchSnaps[i].data()?.name as string) ?? '',
          status: e.status, enrolledAt: e.enrolledAt, evaluated: mine.length,
          averagePercent: mine.length ? Math.round((mine.reduce((s, t) => s + (t.percent ?? 0), 0) / mine.length) * 10) / 10 : null,
          attendance: attendanceStats(await batchSessions(db, user.orgId, e.batchId), user.id),
        });
      }
      const { compensation, ...rest } = profile ?? ({} as Partial<PersonProfile>);
      return {
        user: { id: user.id, orgId: user.orgId, displayName: user.displayName, email: user.email, role: user.role, status: user.status, branchId: user.branchId ?? null, phoneNumber: user.phoneNumber ?? null, studentId: user.metadata?.studentIdNumber ?? null, createdAt: user.createdAt },
        profile: profile ? { ...rest, ...(finance && compensation ? { compensation } : {}) } : null,
        canSeeFinance: finance,
        academic,
        fees: feeAccounts ? feeAccounts.docs.map((d) => { const s = summarize({ id: d.id, ...d.data() } as FeeAccount, today); return { id: s.id, courseTitle: s.courseTitle, due: s.due, collected: s.collected, balance: s.balance, paymentStatus: s.paymentStatus, nextDue: s.nextDue }; }) : null,
        batchesTaught: taught ? taught.docs.map((d) => ({ id: d.id, name: d.data().name as string, courseId: d.data().courseId as string, status: d.data().status as string })) : [],
        ...(await personExtras(db, actor, user)),
      };
    }

    case 'update_person': {
      const user = await getDocData<UserProfile>(db, `users/${req.userId}`);
      if (!user) throw notFound('That person');
      assertOrg(actor, user.orgId, 'That person');
      const managed = user.branchId ? canManageBranch(actor, user.orgId, user.branchId) : isAcademyManager(actor, user.orgId);
      if (!managed || user.id === actor.id && !isAcademyManager(actor, user.orgId)) throw denied();
      if (req.compensation !== undefined && !canSeeFinance(actor, user.orgId, user.branchId ?? null)) throw denied('Only finance-authorized users change compensation.');
      const ref = db.doc(`personProfiles/${user.id}`);
      return db.runTransaction(async (tx) => {
        const prev = ((await tx.get(ref)).data() ?? {}) as Partial<PersonProfile>;
        const personal = { ...(prev.personal ?? { email: user.email }), ...(req.personal ?? {}), email: user.email };
        const update: Record<string, unknown> = { orgId: user.orgId, role: user.role, personal, updatedAt: iso, ...(user.branchId ? { branchId: user.branchId } : {}) };
        if (req.academic) update.academic = req.academic;
        if (req.professional) update.professional = { ...(prev.professional ?? {}), ...req.professional };
        if (req.compensation !== undefined) update.compensation = req.compensation ?? FieldValue.delete();
        tx.set(ref, update, { merge: true });
        if (req.personal?.mobile) tx.update(db.doc(`users/${user.id}`), { phoneNumber: req.personal.mobile, updatedAt: iso });
        tx.create(db.collection('auditLog').doc(), {
          orgId: user.orgId, courseId: null, targetType: 'user', targetId: user.id, action: 'person_update', actorId: actor.id, actorRole: actor.role,
          fields: [...Object.keys(req.personal ?? {}).map((k) => `personal.${k}`), ...(req.academic ? ['academic'] : []), ...(req.professional ? ['professional'] : []), ...(req.compensation !== undefined ? ['compensation'] : [])],
          at: FieldValue.serverTimestamp(),
        });
        return { ok: true };
      });
    }
  }
}

/** Certificates, academy/branch names and the account's audit history (Stage 8 global profile). */
async function personExtras(db: Firestore, actor: Actor, user: UserProfile) {
  const history = actor.role === 'super_admin'
    ? db.collection('auditLog').where('targetId', '==', user.id).orderBy('at', 'desc').limit(20)
    : db.collection('auditLog').where('orgId', '==', user.orgId).where('targetId', '==', user.id).orderBy('at', 'desc').limit(20);
  const [certs, org, branch, audit] = await Promise.all([
    user.role === 'student' ? db.collection('certificates').where('orgId', '==', user.orgId).where('studentId', '==', user.id).get() : null,
    getDocData<{ name: string }>(db, `organizations/${user.orgId}`),
    user.branchId ? getDocData<{ name: string }>(db, `branches/${user.branchId}`) : null,
    history.get(),
  ]);
  const actors = [...new Set(audit.docs.map((d) => d.data().actorId as string).filter((x) => x && !x.startsWith('migration:')))];
  const actorSnaps = actors.length ? await db.getAll(...actors.map((id) => db.doc(`users/${id}`))) : [];
  const actorName = new Map(actorSnaps.map((d) => [d.id, (d.data()?.displayName as string) ?? d.id]));
  return {
    academyName: org?.name ?? user.orgId, branchName: branch?.name ?? null,
    certificates: (certs?.docs ?? []).map((d) => ({ id: d.id, courseTitle: d.data().courseTitle as string, certificateNumber: d.data().certificateNumber as string, status: d.data().status as string, completedOn: d.data().completedOn as string })),
    history: audit.docs.map((d) => ({ id: d.id, action: d.data().action as string, by: actorName.get(d.data().actorId) ?? (d.data().actorId as string), reason: (d.data().reason as string) ?? null, at: (d.data().at as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? null })),
  };
}


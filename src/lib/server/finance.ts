import 'server-only';

/**
 * Strynkix LMS — course pricing and student fee ledgers.
 *
 * - Pricing (coursePricing/{courseId}) is set by the Super Admin only; every
 *   change bumps its version, keeps a history copy and is audited. A student's
 *   fee account copies the pricing at admission and never follows later changes.
 * - feeTransactions are immutable ledger entries: payment, refund, adjustment,
 *   reversal. Mistakes are corrected with a reversal (one per payment) or an
 *   adjustment, never by editing or deleting.
 * - Each fee account caches totals that are updated in the same transaction as
 *   every entry; `reconcile` recomputes them from the ledger to prove they match.
 * - Requests carry a client request id: the ledger document id is derived from
 *   it, so a retried or double-clicked payment is recorded exactly once.
 * - Branch Managers see and act on their branch only; University Admins on
 *   their academy; the Super Admin everywhere.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema, planDateSchema } from '@/types/validation';
import type { Course, Organization } from '@/types/domain';
import type { CoursePricing, FeeAccount, FeeTransaction, PaymentMethod } from '@/types/academy';
import {
  balanceOf, collectedOf, dueOf, dueSummary, discountLimitBp, fitSchedule, grossFee, paymentStatus, scheduleError,
} from '@/lib/finance/fees';
import {
  type Actor, assertOrg, canManageBranch, conflict, denied, displayName, financeScope, getDocData, invalid,
  isAcademyManager, isSuper, loadActor, localDate, notFound, parseBody,
} from '@/lib/server/academy-scope';
import { codeOf, commit, pad, reserve } from '@/lib/server/counters';

const paise = z.number().int('Amounts are in paise (whole numbers).');
const positive = paise.min(1, 'Enter an amount above zero.').max(1_00_00_000_00, 'That amount is too large.');
export const methodSchema = z.enum(['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other']);
const reference = z.string().trim().max(80).regex(/^[\w\s./#:-]*$/, 'Use letters, numbers and - / . # : in references.').optional();
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Missing request id.');
const installments = z.array(z.object({ number: z.number().int().min(1).max(24), dueDate: planDateSchema, amount: positive }).strict()).min(1).max(24);

export const pricingSchema = z.object({
  standardFee: paise.min(0).max(1_00_00_000_00),
  registrationFee: paise.min(0).max(1_00_00_000_00),
  otherFees: z.array(z.object({ label: z.string().trim().min(2).max(60), amount: positive }).strict()).max(10),
  installmentOptions: z.array(z.number().int().min(1).max(24)).min(1).max(12),
  discountLimits: z.object({ branch_admin: z.number().int().min(0).max(10000), university_admin: z.number().int().min(0).max(10000) }).strict(),
  available: z.boolean(),
}).strict();

export const financeRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_pricing'), orgId: idSchema.optional() }).strict(),
  z.object({ action: z.literal('save_pricing'), courseId: idSchema, pricing: pricingSchema }).strict(),
  z.object({ action: z.literal('accounts'), orgId: idSchema.optional(), branchId: idSchema.optional(), courseId: idSchema.optional(), status: z.enum(['all', 'paid', 'overdue', 'partial', 'pending', 'cancelled']).optional() }).strict(),
  z.object({ action: z.literal('account'), feeAccountId: idSchema }).strict(),
  z.object({ action: z.literal('record_payment'), feeAccountId: idSchema, requestId, amount: positive, method: methodSchema, reference, date: planDateSchema, note: z.string().trim().max(300).optional() }).strict(),
  z.object({ action: z.literal('record_refund'), feeAccountId: idSchema, requestId, amount: positive, method: methodSchema, reference, date: planDateSchema, reason: z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(300) }).strict(),
  z.object({ action: z.literal('add_adjustment'), feeAccountId: idSchema, requestId, amount: paise.min(-1_00_00_000_00).max(1_00_00_000_00).refine((n) => n !== 0, 'Enter a non-zero amount.'), reason: z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(300), installments: installments.optional() }).strict(),
  z.object({ action: z.literal('reverse'), transactionId: idSchema, reason: z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(300) }).strict(),
  z.object({ action: z.literal('decide_discount'), feeAccountId: idSchema, approve: z.boolean(), installments: installments.optional(), note: z.string().trim().max(300).optional() }).strict(),
  z.object({ action: z.literal('reschedule'), feeAccountId: idSchema, installments, reason: z.string().trim().min(5).max(300) }).strict(),
  z.object({ action: z.literal('receipt'), transactionId: idSchema }).strict(),
  z.object({ action: z.literal('reconcile'), feeAccountId: idSchema }).strict(),
]);

type Services = { db: Firestore; auth: Auth };

export const METHOD_LABELS: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', card: 'Card', cheque: 'Cheque', other: 'Other' };

/** Receipt numbers run per branch per calendar year: ACADEMY-BRANCH-R-2026-00001. */
export async function reserveReceipt(tx: Transaction, db: Firestore, orgId: string, branchId: string, date: string) {
  const year = date.slice(0, 4);
  const [org, branch, counter] = await Promise.all([
    tx.get(db.doc(`organizations/${orgId}`)), tx.get(db.doc(`branches/${branchId}`)), reserve(tx, db, `receipt_${orgId}_${branchId}_${year}`),
  ]);
  const number = `${codeOf((org.data()?.slug as string) ?? (org.data()?.name as string), 'STX')}-${codeOf(branch.data()?.code as string, 'HQ')}-R-${year}-${pad(counter.value, 5)}`;
  return { counter, number };
}

/** Totals recomputed from the ledger (payments minus reversals, refunds, adjustments). */
export function totalsFromLedger(entries: Pick<FeeTransaction, 'type' | 'amount' | 'reversesId'>[], byId: Map<string, Pick<FeeTransaction, 'type'>>) {
  const t = { paid: 0, refunded: 0, adjustments: 0 };
  for (const e of entries) {
    if (e.type === 'payment') t.paid += e.amount;
    else if (e.type === 'refund') t.refunded += e.amount;
    else if (e.type === 'adjustment') t.adjustments += e.amount;
    else if (e.type === 'reversal') {
      const original = e.reversesId ? byId.get(e.reversesId) : undefined;
      if (original?.type === 'refund') t.refunded -= e.amount;
      else t.paid -= e.amount;
    }
  }
  return t;
}

export function summarize(a: FeeAccount, today = localDate()) {
  const { next, overdue, installments: alloc } = dueSummary(a.installments, collectedOf(a), today);
  return {
    ...a, due: dueOf(a), collected: collectedOf(a), balance: balanceOf(a), overdue, nextDue: next ? { dueDate: next.dueDate, amount: next.remaining } : null,
    paymentStatus: paymentStatus(a, today), allocation: alloc,
  };
}

function assertAccountAccess(actor: Actor, a: Pick<FeeAccount, 'orgId' | 'branchId'>) {
  assertOrg(actor, a.orgId, 'That fee account');
  if (!canManageBranch(actor, a.orgId, a.branchId)) throw actor.role === 'branch_admin' ? notFound('That fee account') : denied('Finance is available to branch managers and administrators.');
}

export async function handleFinance(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(financeRequestSchema, body);
  const { db } = services;
  const iso = new Date().toISOString();
  const today = localDate();
  const audit = (tx: Transaction, a: Pick<FeeAccount, 'orgId' | 'branchId' | 'courseId'>, targetType: string, targetId: string, action: string, extra: Record<string, unknown> = {}) =>
    tx.create(db.collection('auditLog').doc(), { orgId: a.orgId, branchId: a.branchId, courseId: a.courseId, targetType, targetId, action, actorId: actor.id, actorRole: actor.role, ...extra, at: FieldValue.serverTimestamp() });

  switch (req.action) {
    case 'list_pricing': {
      const orgId = req.orgId ?? actor.orgId;
      assertOrg(actor, orgId, 'That academy');
      if (!['super_admin', 'university_admin', 'branch_admin'].includes(actor.role)) throw denied();
      const [courses, pricing] = await Promise.all([
        db.collection('courses').where('orgId', '==', orgId).get(),
        db.collection('coursePricing').where('orgId', '==', orgId).get(),
      ]);
      const byCourse = new Map(pricing.docs.map((d) => [d.id, d.data() as CoursePricing]));
      return {
        canEdit: isSuper(actor),
        courses: courses.docs.map((d) => ({ id: d.id, title: d.data().title as string, status: d.data().status as string, pricing: byCourse.get(d.id) ?? null, gross: byCourse.has(d.id) ? grossFee(byCourse.get(d.id)!) : null }))
          .sort((a, b) => a.title.localeCompare(b.title)),
      };
    }

    case 'save_pricing': {
      if (!isSuper(actor)) throw denied('Only the Super Admin sets or approves course pricing.');
      const course = await getDocData<Course>(db, `courses/${req.courseId}`);
      if (!course) throw notFound('That course');
      if (req.pricing.discountLimits.branch_admin > req.pricing.discountLimits.university_admin) throw invalid('A Branch Manager’s discount limit can’t be higher than the University Admin’s.');
      const ref = db.doc(`coursePricing/${course.id}`);
      return db.runTransaction(async (tx) => {
        const prev = (await tx.get(ref)).data() as CoursePricing | undefined;
        const version = (prev?.version ?? 0) + 1;
        const doc: CoursePricing = { courseId: course.id, orgId: course.orgId, currency: 'INR', ...req.pricing, version, approvedById: actor.id, updatedAt: iso };
        tx.set(ref, doc);
        tx.create(ref.collection('history').doc(String(version)), doc);
        audit(tx, { orgId: course.orgId, branchId: '', courseId: course.id }, 'course_pricing', course.id, 'pricing_update', {
          version, fromGross: prev ? grossFee(prev) : null, toGross: grossFee(doc),
        });
        return { version, gross: grossFee(doc) };
      });
    }

    case 'accounts': {
      const scope = financeScope(actor, req.orgId ?? actor.orgId, req.branchId);
      let q = db.collection('feeAccounts').where('orgId', '==', scope.orgId);
      if (scope.branchId) q = q.where('branchId', '==', scope.branchId);
      if (req.courseId) q = q.where('courseId', '==', req.courseId);
      const rows = (await q.get()).docs.map((d) => summarize({ id: d.id, ...d.data() } as FeeAccount, today))
        .filter((r) => !req.status || req.status === 'all' || r.paymentStatus === req.status)
        .map(({ allocation: _a, ...r }) => { void _a; return r; })
        .sort((a, b) => a.studentName.localeCompare(b.studentName));
      return { scope, accounts: rows };
    }

    case 'account': {
      const a = await getDocData<FeeAccount>(db, `feeAccounts/${req.feeAccountId}`);
      if (!a) throw notFound('That fee account');
      assertAccountAccess(actor, a);
      const tx = (await db.collection('feeTransactions').where('feeAccountId', '==', a.id).get()).docs
        .map((d) => ({ id: d.id, ...d.data() } as FeeTransaction)).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
      const reversed = new Set(tx.filter((t) => t.type === 'reversal').map((t) => t.reversesId));
      const pricing = await getDocData<CoursePricing>(db, `coursePricing/${a.courseId}`);
      return {
        account: summarize(a, today),
        transactions: tx.map((t) => ({ ...t, reversed: reversed.has(t.id) })),
        canApproveDiscount: a.discount.status === 'pending' && !!pricing && (isSuper(actor) || discountLimitBp(actor.role, pricing) * a.grossFee >= a.discount.amount * 10000),
        canWaive: isAcademyManager(actor, a.orgId),
      };
    }

    case 'record_payment':
    case 'record_refund':
    case 'add_adjustment': {
      const accountRef = db.doc(`feeAccounts/${req.feeAccountId}`);
      const txRef = db.doc(`feeTransactions/${req.action === 'record_payment' ? 'pay' : req.action === 'record_refund' ? 'ref' : 'adj'}_${req.requestId}`);
      return db.runTransaction(async (tx) => {
        const [accSnap, existing] = await Promise.all([tx.get(accountRef), tx.get(txRef)]);
        if (!accSnap.exists) throw notFound('That fee account');
        const a = { id: accSnap.id, ...accSnap.data() } as FeeAccount;
        assertAccountAccess(actor, a);
        // A retried request returns the entry already recorded.
        if (existing.exists) {
          const e = existing.data() as FeeTransaction;
          if (e.feeAccountId !== a.id) throw conflict('That request id was already used.');
          return { transactionId: existing.id, receiptNumber: e.receiptNumber ?? null, duplicate: true };
        }
        if (a.status === 'cancelled') throw conflict('This fee account is cancelled.');
        if ('date' in req && req.date > today) throw invalid('The date can’t be in the future.');
        const balance = balanceOf(a);
        const collected = collectedOf(a);
        if (req.action === 'record_payment') {
          // While a discount awaits approval, accept only what would be due if it is approved.
          const payable = a.discount.status === 'pending' ? Math.max(0, balance - a.discount.amount) : balance;
          if (req.amount > payable) throw invalid(`That is more than the balance of ₹${(payable / 100).toFixed(2)}${a.discount.status === 'pending' ? ' (a discount is waiting for approval)' : ''}.`);
          if (req.reference) {
            const dup = await tx.get(db.collection('feeTransactions').where('feeAccountId', '==', a.id).where('reference', '==', req.reference).where('type', '==', 'payment').limit(1));
            if (!dup.empty) throw conflict('A payment with this transaction reference is already recorded for this student.', 'duplicate_reference');
          }
        }
        if (req.action === 'record_refund' && req.amount > collected) throw invalid(`A refund can’t be more than the ₹${(collected / 100).toFixed(2)} collected.`);
        if (req.action === 'add_adjustment') {
          if (req.amount < 0 && !isAcademyManager(actor, a.orgId)) throw denied('Only academy administrators can waive fees. Ask for approval.');
          if (dueOf(a) + req.amount < collected) throw invalid('The amount due can’t go below what has already been collected. Record a refund first.');
        }
        let receiptNumber: string | undefined;
        let counter: Awaited<ReturnType<typeof reserveReceipt>>['counter'] | undefined;
        if (req.action === 'record_payment') ({ number: receiptNumber, counter } = await reserveReceipt(tx, db, a.orgId, a.branchId, req.date));
        const totals = { ...a.totals };
        if (req.action === 'record_payment') totals.paid += req.amount;
        if (req.action === 'record_refund') totals.refunded += req.amount;
        if (req.action === 'add_adjustment') totals.adjustments += req.amount;
        const after = { ...a, totals };
        let schedule = a.installments;
        if (req.action === 'add_adjustment') {
          schedule = req.installments ?? a.installments;
          const err = scheduleError(schedule, dueOf(after));
          if (err) throw invalid(`Update the installment schedule to match the new amount due: ${err}`);
        }
        const entry: Omit<FeeTransaction, 'id'> & { balanceAfter: number } = {
          orgId: a.orgId, branchId: a.branchId, courseId: a.courseId, feeAccountId: a.id, studentId: a.studentId, studentName: a.studentName,
          type: req.action === 'record_payment' ? 'payment' : req.action === 'record_refund' ? 'refund' : 'adjustment',
          amount: req.amount, date: 'date' in req ? req.date : today,
          ...('method' in req ? { method: req.method } : {}), ...('reference' in req && req.reference ? { reference: req.reference } : {}),
          ...(receiptNumber ? { receiptNumber } : {}), ...('reason' in req ? { reason: req.reason } : {}), ...('note' in req && req.note ? { reason: req.note } : {}),
          createdById: actor.id, createdByName: displayName(actor), createdAt: iso, balanceAfter: balanceOf(after),
        };
        if (counter) commit(tx, counter, iso);
        tx.create(txRef, entry);
        tx.update(accountRef, { totals, installments: schedule, status: balanceOf(after) === 0 && dueOf(after) > 0 ? 'closed' : 'active', updatedAt: iso });
        audit(tx, a, 'fee_transaction', txRef.id, `fee_${entry.type}`, { feeAccountId: a.id, amount: req.amount, ...(receiptNumber ? { receiptNumber } : {}) });
        return { transactionId: txRef.id, receiptNumber: receiptNumber ?? null, balance: balanceOf(after) };
      });
    }

    case 'reverse': {
      const origRef = db.doc(`feeTransactions/${req.transactionId}`);
      const revRef = db.doc(`feeTransactions/rev_${req.transactionId}`);
      return db.runTransaction(async (tx) => {
        const [orig, rev] = await Promise.all([tx.get(origRef), tx.get(revRef)]);
        if (!orig.exists) throw notFound('That transaction');
        const t = { id: orig.id, ...orig.data() } as FeeTransaction;
        const accountRef = db.doc(`feeAccounts/${t.feeAccountId}`);
        const a = { id: t.feeAccountId, ...(await tx.get(accountRef)).data() } as FeeAccount;
        assertAccountAccess(actor, a);
        if (rev.exists) throw conflict('This transaction has already been reversed.', 'duplicate');
        if (t.type !== 'payment' && t.type !== 'refund') throw invalid('Only payments and refunds can be reversed. Correct an adjustment with another adjustment.');
        const totals = { ...a.totals };
        if (t.type === 'payment') totals.paid -= t.amount;
        else totals.refunded -= t.amount;
        if (totals.paid - totals.refunded < 0) throw conflict('Reverse the refund first: the collected amount can’t go below zero.');
        const after = { ...a, totals };
        tx.create(revRef, {
          orgId: a.orgId, branchId: a.branchId, courseId: a.courseId, feeAccountId: a.id, studentId: a.studentId, studentName: a.studentName,
          type: 'reversal', amount: t.amount, date: today, reversesId: t.id, reason: req.reason,
          createdById: actor.id, createdByName: displayName(actor), createdAt: iso, balanceAfter: balanceOf(after),
        });
        tx.update(accountRef, { totals, status: 'active', updatedAt: iso });
        audit(tx, a, 'fee_transaction', revRef.id, 'fee_reversal', { feeAccountId: a.id, reversesId: t.id, amount: t.amount, reason: req.reason });
        return { transactionId: revRef.id, balance: balanceOf(after) };
      });
    }

    case 'decide_discount': {
      const ref = db.doc(`feeAccounts/${req.feeAccountId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That fee account');
        const a = { id: snap.id, ...snap.data() } as FeeAccount;
        assertAccountAccess(actor, a);
        if (a.discount.status !== 'pending') throw conflict('There is no discount waiting for a decision.');
        const pricing = (await tx.get(db.doc(`coursePricing/${a.courseId}`))).data() as CoursePricing | undefined;
        const allowed = isSuper(actor) || (!!pricing && discountLimitBp(actor.role, pricing) * a.grossFee >= a.discount.amount * 10000);
        if (!allowed || actor.id === a.discount.requestedById) throw denied('This discount needs approval from someone with a higher discount limit.');
        const agreedFee = req.approve ? a.grossFee - a.discount.amount : a.grossFee;
        const due = agreedFee + a.totals.adjustments;
        if (req.approve && collectedOf(a) > due) throw conflict(`More than the discounted fee has already been collected (${(collectedOf(a) / 100).toFixed(2)}). Record a refund first, then approve.`);
        const schedule = req.installments ?? fitSchedule(a.installments, due);
        const err = scheduleError(schedule, due);
        if (err) throw invalid(`Set the installments for the new amount due: ${err}`);
        tx.update(ref, {
          discount: { ...a.discount, status: req.approve ? 'approved' : 'rejected', approvedById: actor.id, ...(req.approve ? {} : { amount: 0 }) },
          agreedFee, installments: schedule, updatedAt: iso,
        });
        audit(tx, a, 'fee_account', a.id, req.approve ? 'discount_approved' : 'discount_rejected', { amount: a.discount.amount, ...(req.note ? { reason: req.note } : {}) });
        return { agreedFee };
      });
    }

    case 'reschedule': {
      const ref = db.doc(`feeAccounts/${req.feeAccountId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That fee account');
        const a = { id: snap.id, ...snap.data() } as FeeAccount;
        assertAccountAccess(actor, a);
        const err = scheduleError(req.installments, dueOf(a));
        if (err) throw invalid(err);
        tx.update(ref, { installments: req.installments, plan: req.installments.length > 1 ? 'installments' : 'one_time', updatedAt: iso });
        audit(tx, a, 'fee_account', a.id, 'fee_reschedule', { from: a.installments.length, to: req.installments.length, reason: req.reason });
        return { ok: true };
      });
    }

    case 'receipt': {
      const t = await getDocData<FeeTransaction & { balanceAfter?: number }>(db, `feeTransactions/${req.transactionId}`);
      if (!t || t.type !== 'payment') throw notFound('That receipt');
      const a = await getDocData<FeeAccount>(db, `feeAccounts/${t.feeAccountId}`);
      if (!a) throw notFound('That receipt');
      assertAccountAccess(actor, a);
      const [org, branch, reversal, admission] = await Promise.all([
        getDocData<Organization>(db, `organizations/${t.orgId}`),
        getDocData<{ name: string; code: string; location?: { city?: string; state?: string } }>(db, `branches/${t.branchId}`),
        getDocData<FeeTransaction>(db, `feeTransactions/rev_${t.id}`),
        getDocData<{ personal?: { mobile?: string; email?: string } }>(db, `admissions/${a.admissionId}`),
      ]);
      return {
        receipt: {
          receiptNumber: t.receiptNumber, date: t.date, amount: t.amount, method: METHOD_LABELS[t.method ?? 'other'], reference: t.reference ?? null,
          balanceAfter: t.balanceAfter ?? null, receivedBy: t.createdByName, recordedAt: t.createdAt, reversed: Boolean(reversal),
          academy: { name: org?.name ?? 'Strynkix Coding Academy', website: org?.website ?? null },
          branch: { name: branch?.name ?? '', code: branch?.code ?? '', city: branch?.location?.city ?? '' },
          student: { name: a.studentName, admissionNumber: a.admissionNumber, mobile: admission?.personal?.mobile ?? null, email: admission?.personal?.email ?? null },
          course: a.courseTitle, agreedFee: dueOf(a),
        },
      };
    }

    case 'reconcile': {
      const a = await getDocData<FeeAccount>(db, `feeAccounts/${req.feeAccountId}`);
      if (!a) throw notFound('That fee account');
      assertAccountAccess(actor, a);
      const entries = (await db.collection('feeTransactions').where('feeAccountId', '==', a.id).get()).docs.map((d) => ({ id: d.id, ...d.data() } as FeeTransaction));
      const fromLedger = totalsFromLedger(entries, new Map(entries.map((e) => [e.id, e])));
      return { cached: a.totals, fromLedger, matches: JSON.stringify(fromLedger) === JSON.stringify({ paid: a.totals.paid, refunded: a.totals.refunded, adjustments: a.totals.adjustments }) };
    }
  }
}

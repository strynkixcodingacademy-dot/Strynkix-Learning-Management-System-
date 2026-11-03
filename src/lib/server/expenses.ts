import 'server-only';

/**
 * Strynkix LMS — branch expenses.
 * - Categories: built-in defaults plus academy-defined ones (no code change).
 * - Expenses are recorded once per request id and are never deleted; a
 *   mistaken expense is voided with a reason (audited) and excluded from totals.
 * - Recurring expenses are schedules; their occurrences are computed
 *   (src/lib/finance/recurrence.ts). Paying one records an ordinary expense with
 *   a deterministic id, so an occurrence can't be paid twice. Nothing is marked
 *   paid automatically.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema, planDateSchema } from '@/types/validation';
import type { Expense, ExpenseCategory, RecurringExpense } from '@/types/academy';
import { isValidPeriod, occurrences, occurrenceState } from '@/lib/finance/recurrence';
import {
  type Actor, canManageBranch, conflict, denied, displayName, financeScope, getDocData, invalid, isAcademyManager, loadActor, localDate, notFound, parseBody,
} from '@/lib/server/academy-scope';
import { methodSchema } from '@/lib/server/finance';
import { recordInvalidation } from '@/lib/server/snapshot-invalidation';

export const BUILT_IN_CATEGORIES: { id: string; name: string }[] = [
  ['rent', 'Office or classroom rent'], ['instructor_salary', 'Instructor salary'], ['trainer_salary', 'Trainer salary'], ['staff_salary', 'Staff salary'],
  ['electricity', 'Electricity'], ['internet', 'Internet / Wi-Fi'], ['printing', 'Xerox and printing'], ['marketing', 'Marketing and advertising'],
  ['stationery', 'Stationery'], ['equipment', 'Equipment'], ['maintenance', 'Maintenance'], ['software', 'Software subscriptions'], ['travel', 'Travel'], ['misc', 'Miscellaneous'],
].map(([id, name]) => ({ id: `builtin_${id}`, name }));

const amount = z.number().int().min(1, 'Enter an amount above zero.').max(1_00_00_000_00);
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Missing request id.');
const https = z.union([z.string().trim().url().max(500).refine((u) => u.startsWith('https://'), 'Links must start with https://'), z.literal('')]).optional();
const optional = (max: number) => z.string().trim().max(max).optional();

export const expenseRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('categories'), orgId: idSchema.optional() }).strict(),
  z.object({ action: z.literal('add_category'), name: z.string().trim().min(2, 'Name the category.').max(60) }).strict(),
  z.object({ action: z.literal('set_category_active'), categoryId: idSchema, active: z.boolean() }).strict(),
  z.object({
    action: z.literal('add_expense'), requestId, branchId: idSchema, title: z.string().trim().min(2, 'Give the expense a title.').max(120), categoryId: idSchema,
    amount, date: planDateSchema, method: methodSchema, paidTo: optional(120), reference: optional(80), description: optional(500), notes: optional(500), documentUrl: https,
  }).strict(),
  z.object({ action: z.literal('void_expense'), expenseId: idSchema, reason: z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(300) }).strict(),
  z.object({ action: z.literal('list'), orgId: idSchema.optional(), branchId: idSchema.optional(), from: planDateSchema.optional(), to: planDateSchema.optional(), categoryId: idSchema.optional(), includeVoid: z.boolean().optional() }).strict(),
  z.object({
    action: z.literal('add_recurring'), branchId: idSchema, title: z.string().trim().min(2).max(120), categoryId: idSchema, amount,
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']), startDate: planDateSchema, endDate: planDateSchema.optional(), paidTo: optional(120),
  }).strict(),
  z.object({ action: z.literal('update_recurring'), recurringId: idSchema, amount: amount.optional(), endDate: planDateSchema.nullable().optional(), active: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('schedule'), orgId: idSchema.optional(), branchId: idSchema.optional(), from: planDateSchema, to: planDateSchema }).strict(),
  z.object({ action: z.literal('pay_occurrence'), recurringId: idSchema, period: planDateSchema, amount: amount.optional(), date: planDateSchema, method: methodSchema, reference: optional(80) }).strict(),
  z.object({ action: z.literal('cancel_occurrence'), recurringId: idSchema, period: planDateSchema, reason: z.string().trim().min(5).max(300) }).strict(),
]);

type Services = { db: Firestore; auth: Auth };

export async function categoriesFor(db: Firestore, orgId: string): Promise<ExpenseCategory[]> {
  const custom = (await db.collection('expenseCategories').where('orgId', '==', orgId).get()).docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseCategory));
  return [...BUILT_IN_CATEGORIES.map((c) => ({ ...c, orgId, builtIn: true, active: true })), ...custom];
}

async function category(db: Firestore, orgId: string, id: string): Promise<ExpenseCategory> {
  const c = (await categoriesFor(db, orgId)).find((x) => x.id === id);
  if (!c || !c.active) throw invalid('Choose an active category.');
  return c;
}

/** The branch's academy comes from the stored branch, never from the caller (and the branch must exist). */
async function branchOrg(db: Firestore, actor: Actor, branchId: string): Promise<string> {
  const b = await getDocData<{ orgId: string; status?: string }>(db, `branches/${branchId}`);
  if (!b || (actor.role !== 'super_admin' && b.orgId !== actor.orgId)) throw notFound('That branch');
  assertBranch(actor, b.orgId, branchId);
  return b.orgId;
}

function assertBranch(actor: Actor, orgId: string, branchId: string) {
  if (!canManageBranch(actor, orgId, branchId)) throw actor.role === 'branch_admin' ? notFound('That branch') : denied('Expenses are managed by branch managers and administrators.');
}

export async function handleExpenses(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(expenseRequestSchema, body);
  const { db } = services;
  const iso = new Date().toISOString();
  const today = localDate();
  const orgId = actor.orgId;
  const audit = (tx: Transaction, branchId: string, targetType: string, targetId: string, action: string, extra: Record<string, unknown> = {}) =>
    tx.create(db.collection('auditLog').doc(), { orgId, branchId, courseId: null, targetType, targetId, action, actorId: actor.id, actorRole: actor.role, ...extra, at: FieldValue.serverTimestamp() });

  switch (req.action) {
    case 'categories': {
      const scope = financeScope(actor, req.orgId ?? orgId);
      return { categories: await categoriesFor(db, scope.orgId), canManage: isAcademyManager(actor, scope.orgId) || actor.role === 'branch_admin' };
    }

    case 'add_category': {
      financeScope(actor, orgId);
      const existing = await categoriesFor(db, orgId);
      if (existing.some((c) => c.name.toLowerCase() === req.name.toLowerCase())) throw conflict('A category with this name already exists.');
      const ref = db.collection('expenseCategories').doc();
      await ref.set({ orgId, name: req.name, builtIn: false, active: true, createdById: actor.id, createdAt: iso });
      return { categoryId: ref.id };
    }

    case 'set_category_active': {
      if (!isAcademyManager(actor, orgId)) throw denied('Only academy administrators retire categories.');
      const c = await getDocData<ExpenseCategory>(db, `expenseCategories/${req.categoryId}`);
      if (!c || c.orgId !== orgId) throw notFound('That category');
      await db.doc(`expenseCategories/${c.id}`).update({ active: req.active });
      return { ok: true };
    }

    case 'add_expense': {
      const branchOrgId = await branchOrg(db, actor, req.branchId);
      if (req.date > today) throw invalid('An expense date can’t be in the future. Use a recurring schedule for future bills.');
      const cat = await category(db, branchOrgId, req.categoryId);
      const ref = db.doc(`expenses/exp_${req.requestId}`);
      return db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) return { expenseId: ref.id, duplicate: true };
        const doc: Omit<Expense, 'id'> = {
          orgId: branchOrgId, branchId: req.branchId, title: req.title, categoryId: cat.id, categoryName: cat.name, amount: req.amount, date: req.date, method: req.method,
          ...(req.paidTo ? { paidTo: req.paidTo } : {}), ...(req.reference ? { reference: req.reference } : {}), ...(req.description ? { description: req.description } : {}),
          ...(req.notes ? { notes: req.notes } : {}), ...(req.documentUrl ? { documentUrl: req.documentUrl } : {}),
          status: 'paid', createdById: actor.id, createdByName: displayName(actor), createdAt: iso,
        };
        tx.create(ref, doc);
        recordInvalidation(tx, db, { orgId: branchOrgId, branchId: req.branchId, fromDate: req.date, toDate: req.date, reason: 'Backdated expense recorded', sourceType: 'expense', sourceId: ref.id });
        audit(tx, req.branchId, 'expense', ref.id, 'expense_add', { orgId: branchOrgId, amount: req.amount, categoryId: cat.id });
        return { expenseId: ref.id };
      });
    }

    case 'void_expense': {
      const ref = db.doc(`expenses/${req.expenseId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That expense');
        const e = snap.data() as Expense;
        if (e.orgId !== orgId && actor.role !== 'super_admin') throw notFound('That expense');
        assertBranch(actor, e.orgId, e.branchId);
        if (e.status === 'void') throw conflict('This expense is already void.');
        tx.update(ref, { status: 'void', voidReason: req.reason, voidedById: actor.id, voidedAt: iso });
        recordInvalidation(tx, db, { orgId: e.orgId, branchId: e.branchId, fromDate: e.date, toDate: e.date, reason: 'Expense voided', sourceType: 'expense', sourceId: ref.id });
        audit(tx, e.branchId, 'expense', ref.id, 'expense_void', { orgId: e.orgId, amount: e.amount, reason: req.reason });
        return { ok: true };
      });
    }

    case 'list': {
      const scope = financeScope(actor, req.orgId ?? orgId, req.branchId);
      let q = db.collection('expenses').where('orgId', '==', scope.orgId);
      if (scope.branchId) q = q.where('branchId', '==', scope.branchId);
      if (req.from) q = q.where('date', '>=', req.from);
      if (req.to) q = q.where('date', '<=', req.to);
      const rows = (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() } as Expense))
        .filter((e) => (req.includeVoid || e.status === 'paid') && (!req.categoryId || e.categoryId === req.categoryId))
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
      return { scope, expenses: rows, total: rows.filter((e) => e.status === 'paid').reduce((s, e) => s + e.amount, 0) };
    }

    case 'add_recurring': {
      const branchOrgId = await branchOrg(db, actor, req.branchId);
      if (req.endDate && req.endDate < req.startDate) throw invalid('The end date must be after the start date.');
      const cat = await category(db, branchOrgId, req.categoryId);
      const ref = db.collection('recurringExpenses').doc();
      await db.runTransaction(async (tx) => {
        tx.create(ref, {
          orgId: branchOrgId, branchId: req.branchId, title: req.title, categoryId: cat.id, categoryName: cat.name, amount: req.amount, frequency: req.frequency,
          startDate: req.startDate, ...(req.endDate ? { endDate: req.endDate } : {}), ...(req.paidTo ? { paidTo: req.paidTo } : {}),
          cancelledPeriods: [], active: true, createdById: actor.id, createdAt: iso, updatedAt: iso,
        });
        audit(tx, req.branchId, 'recurring_expense', ref.id, 'recurring_expense_add', { orgId: branchOrgId, amount: req.amount, frequency: req.frequency });
      });
      return { recurringId: ref.id };
    }

    case 'update_recurring': {
      const ref = db.doc(`recurringExpenses/${req.recurringId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That recurring expense');
        const r = snap.data() as RecurringExpense;
        if (r.orgId !== orgId && actor.role !== 'super_admin') throw notFound('That recurring expense');
        assertBranch(actor, r.orgId, r.branchId);
        if (req.endDate && req.endDate < r.startDate) throw invalid('The end date must be after the start date.');
        tx.update(ref, {
          ...(req.amount !== undefined ? { amount: req.amount } : {}), ...(req.active !== undefined ? { active: req.active } : {}),
          ...(req.endDate !== undefined ? { endDate: req.endDate ?? FieldValue.delete() } : {}), updatedAt: iso,
        });
        audit(tx, r.branchId, 'recurring_expense', ref.id, 'recurring_expense_update', { orgId: r.orgId, fromAmount: r.amount, toAmount: req.amount ?? r.amount, active: req.active ?? r.active });
        return { ok: true };
      });
    }

    case 'schedule': {
      const scope = financeScope(actor, req.orgId ?? orgId, req.branchId);
      if (req.to < req.from) throw invalid('The end date must be after the start date.');
      let q = db.collection('recurringExpenses').where('orgId', '==', scope.orgId);
      if (scope.branchId) q = q.where('branchId', '==', scope.branchId);
      const schedules = (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() } as RecurringExpense));
      let pq = db.collection('expenses').where('orgId', '==', scope.orgId).where('period', '>=', req.from).where('period', '<=', req.to);
      if (scope.branchId) pq = pq.where('branchId', '==', scope.branchId);
      const paid = new Map((await pq.get()).docs.map((d) => d.data() as Expense).filter((e) => e.recurringId && e.status === 'paid').map((e) => [`${e.recurringId}_${e.period}`, e]));
      const rows = schedules.flatMap((s) => occurrences(s, req.from, req.to).map((period) => {
        const p = paid.get(`${s.id}_${period}`);
        return {
          recurringId: s.id, branchId: s.branchId, title: s.title, categoryName: s.categoryName, period, amount: p?.amount ?? s.amount,
          state: !s.active && !p ? 'cancelled' : occurrenceState(period, today, Boolean(p), s.cancelledPeriods.includes(period)), paidOn: p?.date ?? null,
        };
      })).sort((a, b) => a.period.localeCompare(b.period));
      return { schedules, occurrences: rows };
    }

    case 'pay_occurrence':
    case 'cancel_occurrence': {
      const sref = db.doc(`recurringExpenses/${req.recurringId}`);
      const eref = db.doc(`expenses/rec_${req.recurringId}_${req.period}`);
      return db.runTransaction(async (tx) => {
        const [snap, paidSnap] = await Promise.all([tx.get(sref), tx.get(eref)]);
        if (!snap.exists) throw notFound('That recurring expense');
        const s = { id: snap.id, ...snap.data() } as RecurringExpense;
        if (s.orgId !== orgId && actor.role !== 'super_admin') throw notFound('That recurring expense');
        assertBranch(actor, s.orgId, s.branchId);
        if (!isValidPeriod(s, req.period)) throw invalid('That date isn’t one of this schedule’s due dates.');
        if (paidSnap.exists && (paidSnap.data() as Expense).status === 'paid') throw conflict('This occurrence has already been paid.', 'duplicate');
        if (req.action === 'cancel_occurrence') {
          if (s.cancelledPeriods.includes(req.period)) throw conflict('It is already cancelled.');
          tx.update(sref, { cancelledPeriods: FieldValue.arrayUnion(req.period), updatedAt: iso });
          audit(tx, s.branchId, 'recurring_expense', s.id, 'recurring_occurrence_cancel', { orgId: s.orgId, period: req.period, reason: req.reason });
          return { ok: true };
        }
        if (req.date > today) throw invalid('The payment date can’t be in the future.');
        if (s.cancelledPeriods.includes(req.period)) throw conflict('This occurrence was cancelled.');
        if (paidSnap.exists) throw conflict('This occurrence was paid and voided; record a new one-time expense instead.');
        const doc: Omit<Expense, 'id'> = {
          orgId: s.orgId, branchId: s.branchId, title: s.title, categoryId: s.categoryId, categoryName: s.categoryName, amount: req.amount ?? s.amount,
          date: req.date, method: req.method, ...(s.paidTo ? { paidTo: s.paidTo } : {}), ...(req.reference ? { reference: req.reference } : {}),
          recurringId: s.id, period: req.period, status: 'paid', createdById: actor.id, createdByName: displayName(actor), createdAt: iso,
        };
        tx.create(eref, doc);
        recordInvalidation(tx, db, { orgId: s.orgId, branchId: s.branchId, fromDate: req.date, toDate: req.date, reason: 'Backdated recurring expense paid', sourceType: 'expense', sourceId: eref.id });
        audit(tx, s.branchId, 'expense', eref.id, 'expense_add', { orgId: s.orgId, amount: doc.amount, recurringId: s.id, period: req.period });
        return { expenseId: eref.id };
      });
    }
  }
}

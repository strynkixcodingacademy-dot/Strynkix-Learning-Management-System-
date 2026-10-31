import 'server-only';

/**
 * Strynkix LMS — dashboards, analytics and export data, computed on the server
 * from the underlying records for the caller's scope: a Branch Manager's
 * branch, a University Admin's academy, or (Super Admin) one academy or all.
 *
 * Wording matters: "collected" is cash received (payments − reversals −
 * refunds) in the period; "expected" is the agreed fees; "net operating
 * position" is collections minus expenses — not audited or statutory profit.
 */

import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Query } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema, planDateSchema } from '@/types/validation';
import type { Batch, Enrollment, Progress } from '@/types/domain';
import type { Admission, AssessmentAttempt, AttendanceSession, Expense, FeeAccount, FeeTransaction } from '@/types/academy';
import { balanceOf, collectedOf, dueOf, dueSummary } from '@/lib/finance/fees';
import { type Actor, denied, financeScope, getDocData, invalid, isSuper, loadActor, localDate, notFound, parseBody } from '@/lib/server/academy-scope';
import { attendanceStats, pct } from '@/lib/server/academy-metrics';

const orgParam = z.union([idSchema, z.literal('*')]).optional();
const range = { from: planDateSchema.optional(), to: planDateSchema.optional() };

export const reportRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('finance_summary'), orgId: orgParam, branchId: idSchema.optional(), ...range }).strict(),
  z.object({ action: z.literal('course_analytics'), courseId: idSchema, branchId: idSchema.optional(), batchId: idSchema.optional(), ...range }).strict(),
  z.object({ action: z.literal('academic_summary'), orgId: orgParam, branchId: idSchema.optional(), ...range }).strict(),
  z.object({
    action: z.literal('export'), dataset: z.enum(['fee_accounts', 'transactions', 'installments', 'expenses', 'admissions', 'students']),
    orgId: orgParam, branchId: idSchema.optional(), courseId: idSchema.optional(), ...range,
  }).strict(),
]);

type Services = { db: Firestore; auth: Auth };
interface Scope { orgId: string | null; branchId: string | null }

/** Resolves the scope; '*' (all academies) is Super Admin only. */
function resolveScope(actor: Actor, orgId: string | undefined, branchId: string | undefined): Scope {
  if (orgId === '*') {
    if (!isSuper(actor)) throw denied('Only the Super Admin sees every academy.');
    if (branchId) throw invalid('Choose an academy before a branch.');
    return { orgId: null, branchId: null };
  }
  return financeScope(actor, orgId ?? actor.orgId, branchId);
}

function scoped(db: Firestore, collection: string, s: Scope): Query {
  let q: Query = db.collection(collection);
  if (s.orgId) q = q.where('orgId', '==', s.orgId);
  if (s.branchId) q = q.where('branchId', '==', s.branchId);
  return q;
}

const inRange = (d: string, from?: string, to?: string) => (!from || d >= from) && (!to || d <= to);
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

/** Signed cash effect of a ledger entry (adjustments move no cash). */
function cashEffect(t: FeeTransaction, byId: Map<string, FeeTransaction>): number {
  if (t.type === 'payment') return t.amount;
  if (t.type === 'refund') return -t.amount;
  if (t.type === 'reversal') return byId.get(t.reversesId ?? '')?.type === 'refund' ? t.amount : -t.amount;
  return 0;
}

async function names(db: Firestore, collection: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const snaps = unique.length ? await db.getAll(...unique.map((id) => db.doc(`${collection}/${id}`))) : [];
  return new Map(snaps.map((s) => [s.id, ((s.data()?.name ?? s.data()?.title) as string) ?? s.id]));
}

export async function handleReports(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(reportRequestSchema, body);
  const { db } = services;
  const today = localDate();
  const month = today.slice(0, 7);

  switch (req.action) {
    case 'finance_summary': {
      const s = resolveScope(actor, req.orgId, req.branchId);
      const from = req.from ?? `${month}-01`;
      const to = req.to ?? today;
      const [accSnap, txSnap, expSnap] = await Promise.all([scoped(db, 'feeAccounts', s).get(), scoped(db, 'feeTransactions', s).get(), scoped(db, 'expenses', s).get()]);
      const accounts = accSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeAccount)).filter((a) => a.status !== 'cancelled');
      const ledger = txSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeTransaction));
      const byId = new Map(ledger.map((t) => [t.id, t]));
      const expenses = expSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Expense)).filter((e) => e.status === 'paid');
      const periodTx = ledger.filter((t) => inRange(t.date, from, to));
      const periodExp = expenses.filter((e) => inRange(e.date, from, to));
      const collected = sum(periodTx, (t) => cashEffect(t, byId));
      const expenseTotal = sum(periodExp, (e) => e.amount);
      const refunds = sum(periodTx.filter((t) => t.type === 'refund'), (t) => t.amount) - sum(periodTx.filter((t) => t.type === 'reversal' && byId.get(t.reversesId ?? '')?.type === 'refund'), (t) => t.amount);
      const overdueRows = accounts.map((a) => ({ a, d: dueSummary(a.installments, collectedOf(a), today) })).filter((x) => x.d.overdue > 0);
      const upcoming = accounts.flatMap((a) => dueSummary(a.installments, collectedOf(a), today).installments
        .filter((i) => i.remaining > 0 && i.dueDate >= today && i.dueDate <= addDays(today, 30))
        .map((i) => ({ feeAccountId: a.id, studentName: a.studentName, admissionNumber: a.admissionNumber, courseTitle: a.courseTitle, branchId: a.branchId, dueDate: i.dueDate, amount: i.remaining })))
        .sort((x, y) => x.dueDate.localeCompare(y.dueDate)).slice(0, 25);

      const group = <K extends string>(key: (x: { branchId: string; courseId?: string; orgId: string }) => K) => {
        const m = new Map<K, { expected: number; collected: number; outstanding: number; discounts: number; expenses: number; students: number }>();
        const get = (k: K) => m.get(k) ?? (m.set(k, { expected: 0, collected: 0, outstanding: 0, discounts: 0, expenses: 0, students: 0 }), m.get(k)!);
        for (const a of accounts) { const g = get(key(a)); g.expected += dueOf(a); g.outstanding += balanceOf(a); g.students++; if (a.discount.status === 'approved') g.discounts += a.discount.amount; }
        for (const t of periodTx) get(key(t)).collected += cashEffect(t, byId);
        return { m, get };
      };
      const branches = group((x) => x.branchId);
      for (const e of periodExp) branches.get(e.branchId).expenses += e.amount;
      const courses = group((x) => x.courseId ?? '');
      const academies = group((x) => x.orgId);
      for (const e of periodExp) academies.get(e.orgId).expenses += e.amount;
      const [branchNames, courseNames, orgNames] = await Promise.all([names(db, 'branches', [...branches.m.keys()]), names(db, 'courses', [...courses.m.keys()]), names(db, 'organizations', [...academies.m.keys()])]);
      const months = new Map<string, { collected: number; expenses: number }>();
      for (const t of periodTx) { const k = t.date.slice(0, 7); const v = months.get(k) ?? { collected: 0, expenses: 0 }; v.collected += cashEffect(t, byId); months.set(k, v); }
      for (const e of periodExp) { const k = e.date.slice(0, 7); const v = months.get(k) ?? { collected: 0, expenses: 0 }; v.expenses += e.amount; months.set(k, v); }
      const categories = new Map<string, number>();
      for (const e of periodExp) categories.set(e.categoryName, (categories.get(e.categoryName) ?? 0) + e.amount);
      const thisMonthTx = ledger.filter((t) => t.date.startsWith(month));

      return {
        scope: s, period: { from, to },
        totals: {
          expected: sum(accounts, dueOf), collectedToDate: sum(accounts, collectedOf), outstanding: sum(accounts, balanceOf),
          overdue: sum(overdueRows, (x) => x.d.overdue), overdueAccounts: overdueRows.length,
          collected, refunds, expenses: expenseTotal, net: collected - expenseTotal,
          discounts: sum(accounts.filter((a) => a.discount.status === 'approved' && inRange(a.createdAt.slice(0, 10), from, to)), (a) => a.discount.amount),
          thisMonthCollected: sum(thisMonthTx, (t) => cashEffect(t, byId)), thisMonthExpenses: sum(expenses.filter((e) => e.date.startsWith(month)), (e) => e.amount),
          pendingDiscounts: accounts.filter((a) => a.discount.status === 'pending').length, students: accounts.length,
        },
        byBranch: [...branches.m.entries()].map(([id, v]) => ({ id, name: branchNames.get(id) ?? id, ...v, net: v.collected - v.expenses })),
        byCourse: [...courses.m.entries()].map(([id, v]) => ({ id, name: courseNames.get(id) ?? id, ...v })),
        byAcademy: s.orgId ? [] : [...academies.m.entries()].map(([id, v]) => ({ id, name: orgNames.get(id) ?? id, ...v, net: v.collected - v.expenses })),
        byMonth: [...months.entries()].sort().map(([m, v]) => ({ month: m, ...v, net: v.collected - v.expenses })),
        byCategory: [...categories.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        recent: ledger.sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 12).map((t) => ({ id: t.id, type: t.type, amount: t.amount, date: t.date, studentName: t.studentName, receiptNumber: t.receiptNumber ?? null, method: t.method ?? null, feeAccountId: t.feeAccountId })),
        upcoming,
      };
    }

    case 'course_analytics': {
      const course = await getDocData<{ orgId: string; title: string }>(db, `courses/${req.courseId}`);
      if (!course) throw notFound('That course');
      const s = financeScope(actor, course.orgId, req.branchId);
      let eq: Query = db.collection('enrollments').where('orgId', '==', course.orgId).where('courseId', '==', req.courseId);
      if (s.branchId) eq = eq.where('branchId', '==', s.branchId);
      let enrollments = (await eq.get()).docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));
      if (req.batchId) enrollments = enrollments.filter((e) => e.batchId === req.batchId);
      enrollments = enrollments.filter((e) => inRange(e.enrolledAt.slice(0, 10), req.from, req.to));
      const students = new Set(enrollments.map((e) => e.studentId));
      const [lessons, progress, attempts, accounts, ledger] = await Promise.all([
        db.collection('lessons').where('orgId', '==', course.orgId).where('courseId', '==', req.courseId).where('status', '==', 'published').count().get(),
        db.collection('progress').where('orgId', '==', course.orgId).where('courseId', '==', req.courseId).where('status', '==', 'completed').get(),
        db.collection('assessmentAttempts').where('orgId', '==', course.orgId).where('courseId', '==', req.courseId).where('status', '==', 'evaluated').get(),
        db.collection('feeAccounts').where('orgId', '==', course.orgId).where('courseId', '==', req.courseId).get(),
        db.collection('feeTransactions').where('orgId', '==', course.orgId).where('courseId', '==', req.courseId).get(),
      ]);
      const totalLessons = lessons.data().count;
      const done = new Map<string, number>();
      for (const d of progress.docs) { const p = d.data() as Progress; if (students.has(p.studentId)) done.set(p.studentId, (done.get(p.studentId) ?? 0) + 1); }
      const completion = [...students].map((id) => pct(Math.min(done.get(id) ?? 0, totalLessons), totalLessons));
      const evaluated = attempts.docs.map((d) => d.data() as AssessmentAttempt).filter((t) => students.has(t.studentId));
      const examStats = (type: string) => {
        const rows = evaluated.filter((t) => t.examType === type);
        return { attempts: rows.length, average: rows.length ? Math.round(sum(rows, (t) => t.percent ?? 0) / rows.length) : null, passRate: rows.length ? pct(rows.filter((t) => t.passed).length, rows.length) : null };
      };
      const batchIds = [...new Set(enrollments.map((e) => e.batchId))];
      const attendance = (await Promise.all(batchIds.map(async (b) => {
        const sessions = (await db.collection('attendance').where('orgId', '==', course.orgId).where('batchId', '==', b).get()).docs.map((d) => d.data() as AttendanceSession);
        return enrollments.filter((x) => x.batchId === b).map((e) => attendanceStats(sessions, e.studentId)).filter((st) => st.scheduled).map((st) => st.percent);
      }))).flat();
      const accs = accounts.docs.map((d) => ({ id: d.id, ...d.data() } as FeeAccount)).filter((a) => students.has(a.studentId) && a.status !== 'cancelled');
      const accIds = new Set(accs.map((a) => a.id));
      const tx = ledger.docs.map((d) => ({ id: d.id, ...d.data() } as FeeTransaction)).filter((t) => accIds.has(t.feeAccountId));
      const avg = (xs: number[]) => (xs.length ? Math.round((sum(xs, (x) => x) / xs.length) * 10) / 10 : null);
      return {
        course: { id: req.courseId, title: course.title }, scope: s, totalLessons,
        students: { enrolled: enrollments.length, active: enrollments.filter((e) => e.status === 'active').length, completed: enrollments.filter((e) => e.status === 'completed').length, dropped: enrollments.filter((e) => e.status === 'dropped' || e.status === 'suspended').length },
        averages: { completion: avg(completion), attendance: avg(attendance), assessments: avg(evaluated.filter((t) => !t.examType).map((t) => t.percent ?? 0)) },
        exams: { demo: examStats('demo'), practice: examStats('practice'), final: examStats('final') },
        fees: { expected: sum(accs, dueOf), collected: sum(accs, collectedOf), outstanding: sum(accs, balanceOf), discounts: sum(accs.filter((a) => a.discount.status === 'approved'), (a) => a.discount.amount), refunds: sum(tx.filter((t) => t.type === 'refund'), (t) => t.amount) },
        batches: [...(await names(db, 'batches', batchIds)).entries()].map(([id, name]) => ({ id, name, students: enrollments.filter((e) => e.batchId === id).length })),
      };
    }

    case 'academic_summary': {
      const s = resolveScope(actor, req.orgId, req.branchId);
      const [enrSnap, admSnap, batchSnap] = await Promise.all([scoped(db, 'enrollments', s).get(), scoped(db, 'admissions', s).where('status', '==', 'confirmed').get(), scoped(db, 'batches', s).get()]);
      const enrollments = enrSnap.docs.map((d) => d.data() as Enrollment);
      const admissions = admSnap.docs.map((d) => d.data() as Admission).filter((a) => inRange((a.confirmedAt ?? '').slice(0, 10), req.from, req.to));
      const batches = batchSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Batch)).filter((b) => !['cancelled', 'archived'].includes(b.status));
      const byMonth = new Map<string, number>();
      for (const a of admissions) { const k = (a.confirmedAt ?? '').slice(0, 7); byMonth.set(k, (byMonth.get(k) ?? 0) + 1); }
      const byCourse = new Map<string, { enrolled: number; active: number; completed: number }>();
      for (const e of enrollments) { const v = byCourse.get(e.courseId) ?? { enrolled: 0, active: 0, completed: 0 }; v.enrolled++; if (e.status === 'active') v.active++; if (e.status === 'completed') v.completed++; byCourse.set(e.courseId, v); }
      const courseNames = await names(db, 'courses', [...byCourse.keys()]);
      const branchNames = await names(db, 'branches', batches.map((b) => b.branchId));
      // Every batch in scope is included (no silent cap); one attendance query per batch, run in parallel.
      const batchRows = await Promise.all(batches.map(async (b) => {
        const sessions = (await db.collection('attendance').where('orgId', '==', b.orgId).where('batchId', '==', b.id).get()).docs.map((d) => d.data() as AttendanceSession);
        const members = enrollments.filter((e) => e.batchId === b.id && e.status === 'active');
        const att = members.map((e) => attendanceStats(sessions, e.studentId)).filter((x) => x.scheduled);
        return { id: b.id, name: b.name, branch: branchNames.get(b.branchId) ?? b.branchId, courseTitle: courseNames.get(b.courseId) ?? '', status: b.status, students: members.length, classes: sessions.length, attendance: att.length ? Math.round(sum(att, (x) => x.percent) / att.length) : null };
      }));
      return {
        scope: s,
        totals: { admissions: admissions.length, activeStudents: new Set(enrollments.filter((e) => e.status === 'active').map((e) => e.studentId)).size, completed: enrollments.filter((e) => e.status === 'completed').length, runningBatches: batches.filter((b) => b.status === 'in_progress').length },
        admissionsByMonth: [...byMonth.entries()].sort().map(([m, n]) => ({ month: m, count: n })),
        courses: [...byCourse.entries()].map(([id, v]) => ({ id, title: courseNames.get(id) ?? id, ...v })).sort((a, b) => b.enrolled - a.enrolled),
        batches: batchRows,
      };
    }

    case 'export': {
      const s = resolveScope(actor, req.orgId, req.branchId);
      const branchLabel = async (ids: string[]) => names(db, 'branches', ids);
      switch (req.dataset) {
        case 'fee_accounts':
        case 'installments': {
          let q = scoped(db, 'feeAccounts', s);
          if (req.courseId) q = q.where('courseId', '==', req.courseId);
          const accs = (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() } as FeeAccount));
          const bn = await branchLabel(accs.map((a) => a.branchId));
          if (req.dataset === 'fee_accounts') {
            return { rows: accs.map((a) => ({ orgId: a.orgId, branch: bn.get(a.branchId) ?? a.branchId, admissionNumber: a.admissionNumber, student: a.studentName, course: a.courseTitle, gross: a.grossFee, discount: a.discount.status === 'approved' ? a.discount.amount : 0, discountStatus: a.discount.status, adjustments: a.totals.adjustments, due: dueOf(a), collected: collectedOf(a), balance: balanceOf(a), plan: a.plan, status: a.status })) };
          }
          return { rows: accs.flatMap((a) => dueSummary(a.installments, collectedOf(a), today).installments.map((i) => ({ orgId: a.orgId, branch: bn.get(a.branchId) ?? a.branchId, admissionNumber: a.admissionNumber, student: a.studentName, course: a.courseTitle, number: i.number, dueDate: i.dueDate, amount: i.amount, paid: i.paid, remaining: i.remaining, state: i.state }))) };
        }
        case 'transactions': {
          const rows = (await scoped(db, 'feeTransactions', s).get()).docs.map((d) => ({ id: d.id, ...d.data() } as FeeTransaction)).filter((t) => inRange(t.date, req.from, req.to) && (!req.courseId || t.courseId === req.courseId));
          const bn = await branchLabel(rows.map((t) => t.branchId));
          return { rows: rows.sort((a, b) => a.date.localeCompare(b.date)).map((t) => ({ orgId: t.orgId, branch: bn.get(t.branchId) ?? t.branchId, date: t.date, type: t.type, receiptNumber: t.receiptNumber ?? '', student: t.studentName, amount: t.amount, method: t.method ?? '', reference: t.reference ?? '', reason: t.reason ?? '', recordedBy: t.createdByName, reverses: t.reversesId ?? '' })) };
        }
        case 'expenses': {
          const rows = (await scoped(db, 'expenses', s).get()).docs.map((d) => ({ id: d.id, ...d.data() } as Expense)).filter((e) => inRange(e.date, req.from, req.to));
          const bn = await branchLabel(rows.map((e) => e.branchId));
          return { rows: rows.sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ orgId: e.orgId, branch: bn.get(e.branchId) ?? e.branchId, date: e.date, title: e.title, category: e.categoryName, amount: e.amount, method: e.method, paidTo: e.paidTo ?? '', reference: e.reference ?? '', recurring: e.recurringId ? 'yes' : 'no', status: e.status, voidReason: e.voidReason ?? '', recordedBy: e.createdByName })) };
        }
        case 'admissions': {
          const rows = (await scoped(db, 'admissions', s).get()).docs.map((d) => d.data() as Admission).filter((a) => inRange((a.confirmedAt ?? a.createdAt).slice(0, 10), req.from, req.to));
          const [bn, cn] = await Promise.all([branchLabel(rows.map((a) => a.branchId)), names(db, 'courses', rows.map((a) => a.courseId ?? ''))]);
          return { rows: rows.map((a) => ({ orgId: a.orgId, branch: bn.get(a.branchId) ?? a.branchId, admissionNumber: a.admissionNumber ?? '', status: a.status, name: [a.personal.firstName, a.personal.middleName, a.personal.lastName].filter(Boolean).join(' '), email: a.personal.email ?? '', mobile: a.personal.mobile ?? '', city: a.personal.city ?? '', course: cn.get(a.courseId ?? '') ?? '', confirmedAt: a.confirmedAt ?? '' })) };
        }
        case 'students': {
          let q = scoped(db, 'enrollments', s);
          if (req.courseId) q = q.where('courseId', '==', req.courseId);
          const rows = (await q.get()).docs.map((d) => d.data() as Enrollment);
          const [bn, cn, btn] = await Promise.all([branchLabel(rows.map((e) => e.branchId)), names(db, 'courses', rows.map((e) => e.courseId)), names(db, 'batches', rows.map((e) => e.batchId))]);
          return { rows: rows.map((e) => ({ orgId: e.orgId, branch: bn.get(e.branchId) ?? e.branchId, student: e.studentDisplayName ?? '', email: e.studentEmail ?? '', course: cn.get(e.courseId) ?? '', batch: btn.get(e.batchId) ?? '', status: e.status, enrolledAt: e.enrolledAt })) };
        }
      }
    }
  }
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

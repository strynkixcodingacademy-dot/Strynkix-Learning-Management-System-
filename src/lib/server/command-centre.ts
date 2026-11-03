import 'server-only';

/**
 * Strynkix LMS — Super Admin Command Centre (Stage 8).
 *
 * Organization-wide, read-mostly views for the Super Admin only: the caller's
 * stored profile must be an active super_admin (checked here, never taken from
 * the request). Other roles keep using the scoped routes (finance, reports,
 * admissions…), so academy and branch isolation is unchanged.
 *
 * Sources of truth are the existing collections: counts and money totals use
 * Firestore server-side aggregation (count / sum); finance uses the shared
 * ledger computation (financeSummary); lists are cursor-paginated. Nothing
 * here writes data except announcements (audited).
 */

import type { Auth } from 'firebase-admin/auth';
import { AggregateField, FieldPath, FieldValue, type Firestore, type Query } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema, planDateSchema } from '@/types/validation';
import type { Batch, Branch, Course, Enrollment, Organization, Progress, UserProfile, UserRole } from '@/types/domain';
import type { Admission, Assessment, AssessmentAttempt, AttendanceSession, Expense, FeeAccount, FeeTransaction } from '@/types/academy';
import { balanceOf, collectedOf, dueOf, dueSummary } from '@/lib/finance/fees';
import { type Actor, denied, displayName, getDocData, invalid, loadActor, localDate, notFound, parseBody } from '@/lib/server/academy-scope';
import { attendanceStats, pct } from '@/lib/server/academy-metrics';
import { financeSummary, type Scope } from '@/lib/server/reports';
import { totalsFromLedger } from '@/lib/server/finance';

const PAGE = 25;
const range = { from: planDateSchema.optional(), to: planDateSchema.optional() };
const scope = { orgId: idSchema.optional(), branchId: idSchema.optional() };
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional();
const ROLES = ['super_admin', 'university_admin', 'branch_admin', 'instructor', 'student', 'content_lead', 'content_designer'] as const;

export const commandRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('overview'), ...scope, ...range }).strict(),
  z.object({ action: z.literal('academies'), q: z.string().trim().max(100).optional(), status: z.enum(['active', 'suspended']).optional(), sort: z.enum(['created_desc', 'created_asc', 'name']).default('created_desc'), page: z.number().int().min(0).max(1000).default(0) }).strict(),
  z.object({ action: z.literal('academy'), orgId: idSchema, tab: z.enum(['overview', 'branches', 'people', 'courses', 'academics', 'finance', 'audit']), role: z.enum(ROLES).optional(), cursor, ...range }).strict(),
  z.object({ action: z.literal('branches'), orgId: idSchema.optional(), q: z.string().trim().max(100).optional(), status: z.enum(['active', 'inactive']).optional(), page: z.number().int().min(0).max(1000).default(0) }).strict(),
  z.object({ action: z.literal('branch'), branchId: idSchema, tab: z.enum(['overview', 'students', 'staff', 'courses', 'academics', 'finance', 'audit']), cursor, ...range }).strict(),
  z.object({ action: z.literal('finance_intel'), ...scope, courseId: idSchema.optional(), batchId: idSchema.optional(), ...range }).strict(),
  z.object({ action: z.literal('academic_intel'), orgId: idSchema, branchId: idSchema.optional(), courseId: idSchema.optional() }).strict(),
  z.object({
    action: z.literal('people'), q: z.string().trim().max(120).optional(), ...scope, role: z.enum(ROLES).optional(), status: z.enum(['active', 'suspended', 'invited', 'pending_verification']).optional(),
    courseId: idSchema.optional(), batchId: idSchema.optional(), cursor,
  }).strict(),
  z.object({ action: z.literal('announcements'), cursor }).strict(),
  z.object({
    action: z.literal('create_announcement'), title: z.string().trim().min(3, 'Give the announcement a title.').max(120), message: z.string().trim().min(5, 'Write the message.').max(2000),
    audience: z.object({
      scope: z.enum(['all', 'academy', 'branch']), orgId: idSchema.optional(), branchId: idSchema.optional(),
      roles: z.array(z.enum(['university_admin', 'branch_admin', 'instructor', 'student', 'content_lead', 'content_designer'])).max(6).default([]),
      courseId: idSchema.optional(), batchId: idSchema.optional(),
    }).strict(),
    publishAt: z.string().datetime({ offset: true }).optional(), expiresAt: z.string().datetime({ offset: true }).optional(),
  }).strict(),
  z.object({ action: z.literal('withdraw_announcement'), announcementId: idSchema, reason: z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(300) }).strict(),
]);

type Services = { db: Firestore; auth: Auth };

const requireSuper = (a: Actor) => { if (a.role !== 'super_admin') throw denied('The Command Centre is for the Super Admin.'); };
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const inRange = (d: string | undefined, from?: string, to?: string) => !!d && (!from || d >= from) && (!to || d <= `${to}￿`);
const count = async (q: Query) => (await q.count().get()).data().count;
const docs = <T>(snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));

function scoped(db: Firestore, collection: string, s: Scope): Query {
  let q: Query = db.collection(collection);
  if (s.orgId) q = q.where('orgId', '==', s.orgId);
  if (s.branchId) q = q.where('branchId', '==', s.branchId);
  return q;
}

async function names(db: Firestore, collection: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const snaps = unique.length ? await db.getAll(...unique.map((id) => db.doc(`${collection}/${id}`))) : [];
  return new Map(snaps.map((s) => [s.id, ((s.data()?.name ?? s.data()?.title ?? s.data()?.displayName) as string) ?? s.id]));
}

/** Resolves a scope; the branch's academy comes from the stored branch. */
async function resolve(db: Firestore, orgId?: string, branchId?: string): Promise<Scope> {
  if (branchId) {
    const b = await getDocData<Branch>(db, `branches/${branchId}`);
    if (!b || (orgId && b.orgId !== orgId)) throw notFound('That branch');
    return { orgId: b.orgId, branchId };
  }
  if (orgId && !(await getDocData(db, `organizations/${orgId}`))) throw notFound('That academy');
  return { orgId: orgId ?? null, branchId: null };
}

/** Headline numbers for a scope, all by server-side aggregation. */
export async function scopeStats(db: Firestore, s: Scope) {
  const users = scoped(db, 'users', s);
  const role = (r: UserRole) => count(users.where('role', '==', r));
  const enr = scoped(db, 'enrollments', s);
  const acc = scoped(db, 'feeAccounts', s).where('status', 'in', ['active', 'closed']);
  const [
    branches, activeBranches, students, activeStudents, instructors, managers, uniAdmins, leads, designers, courses, publishedCourses, batches, runningBatches,
    enrolled, activeEnr, completedEnr, droppedEnr, admissions, money, expenses,
  ] = await Promise.all([
    s.branchId ? Promise.resolve(1) : count(scoped(db, 'branches', { orgId: s.orgId, branchId: null })),
    s.branchId ? Promise.resolve(1) : count(scoped(db, 'branches', { orgId: s.orgId, branchId: null }).where('status', '==', 'active')),
    role('student'), count(users.where('role', '==', 'student').where('status', '==', 'active')), role('instructor'), role('branch_admin'),
    s.branchId ? Promise.resolve(0) : role('university_admin'), s.branchId ? Promise.resolve(0) : role('content_lead'), s.branchId ? Promise.resolve(0) : role('content_designer'),
    s.branchId ? Promise.resolve(null) : count(scoped(db, 'courses', { orgId: s.orgId, branchId: null })),
    s.branchId ? Promise.resolve(null) : count(scoped(db, 'courses', { orgId: s.orgId, branchId: null }).where('status', '==', 'published')),
    count(scoped(db, 'batches', s)), count(scoped(db, 'batches', s).where('status', '==', 'in_progress')),
    count(enr), count(enr.where('status', '==', 'active')), count(enr.where('status', '==', 'completed')), count(enr.where('status', 'in', ['dropped', 'suspended'])),
    count(scoped(db, 'admissions', s).where('status', '==', 'confirmed')),
    acc.aggregate({ agreed: AggregateField.sum('agreedFee'), adj: AggregateField.sum('totals.adjustments'), paid: AggregateField.sum('totals.paid'), refunded: AggregateField.sum('totals.refunded') }).get(),
    scoped(db, 'expenses', s).where('status', '==', 'paid').aggregate({ total: AggregateField.sum('amount') }).get(),
  ]);
  const m = money.data();
  const expected = (m.agreed ?? 0) + (m.adj ?? 0);
  const collected = (m.paid ?? 0) - (m.refunded ?? 0);
  return {
    branches, activeBranches, students, activeStudents, instructors, branchManagers: managers, universityAdmins: uniAdmins, courseDesigners: leads + designers,
    courses, publishedCourses, batches, runningBatches, enrollments: enrolled, activeEnrollments: activeEnr, completedEnrollments: completedEnr, withdrawnEnrollments: droppedEnr,
    admissions, expected, collected, outstanding: Math.max(0, expected - collected), expenses: expenses.data().total ?? 0,
  };
}

/** Academic figures for a scope over a period (attendance, assessments, evaluations, activity). */
async function academicSnapshot(db: Firestore, s: Scope, from: string, to: string) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [sessions, evaluated, pending, pendingDaily, exams, active, recent, courses] = await Promise.all([
    scoped(db, 'attendance', s).where('date', '>=', from).where('date', '<=', to).get(),
    scoped(db, 'assessmentAttempts', s).where('status', '==', 'evaluated').select('percent', 'evaluatedAt', 'kind', 'courseId').get(),
    count(scoped(db, 'assessmentAttempts', s).where('status', 'in', ['submitted', 'under_evaluation'])),
    s.branchId ? Promise.resolve(0) : count(scoped(db, 'submissions', { orgId: s.orgId, branchId: null }).where('status', '==', 'submitted')),
    scoped(db, 'assessments', { orgId: s.orgId, branchId: null }).where('kind', '==', 'exam').where('status', '==', 'published').select('title', 'courseId', 'orgId', 'closesAt', 'opensAt', 'examType', 'batchIds').get(),
    scoped(db, 'enrollments', s).where('status', '==', 'active').select('studentId', 'courseId', 'orgId', 'branchId', 'batchId').get(),
    scoped(db, 'progress', { orgId: s.orgId, branchId: null }).where('lastAccessedAt', '>=', cutoff).select('studentId').get(),
    scoped(db, 'courses', { orgId: s.orgId, branchId: null }).select('title', 'status', 'orgId').get(),
  ]);
  const sess = sessions.docs.map((d) => d.data() as AttendanceSession);
  let attended = 0, counted = 0;
  const byMonth = new Map<string, { a: number; c: number }>();
  for (const x of sess) {
    for (const st of Object.values(x.records ?? {})) {
      const m = byMonth.get(x.date.slice(0, 7)) ?? { a: 0, c: 0 };
      if (st !== 'excused') { counted++; m.c++; }
      if (st === 'present' || st === 'late') { attended++; m.a++; }
      byMonth.set(x.date.slice(0, 7), m);
    }
  }
  const evals = evaluated.docs.map((d) => d.data() as AssessmentAttempt).filter((t) => inRange(t.evaluatedAt, from, to));
  const activeStudents = new Set(active.docs.map((d) => d.data().studentId as string));
  const recentStudents = new Set(recent.docs.map((d) => d.data().studentId as string));
  const enrollments = active.docs.map((d) => d.data() as Enrollment);
  // Completion per course (completed lesson records / (active learners × published lessons)).
  const courseRows = courses.docs.map((d) => ({ ...(d.data() as Course), id: d.id }));
  const enrolledBy = new Map<string, number>();
  for (const e of enrollments) enrolledBy.set(e.courseId, (enrolledBy.get(e.courseId) ?? 0) + 1);
  const completion = await Promise.all(courseRows.filter((c) => enrolledBy.has(c.id)).map(async (c) => {
    const [lessons, done] = await Promise.all([
      count(db.collection('lessons').where('orgId', '==', c.orgId).where('courseId', '==', c.id).where('status', '==', 'published')),
      count(db.collection('progress').where('orgId', '==', c.orgId).where('courseId', '==', c.id).where('status', '==', 'completed')),
    ]);
    const learners = enrolledBy.get(c.id) ?? 0;
    return { courseId: c.id, title: c.title, learners, completion: Math.min(100, pct(done, learners * lessons)) };
  }));
  return {
    courses: { total: courseRows.length, published: courseRows.filter((c) => c.status === 'published').length, draft: courseRows.filter((c) => c.status === 'draft').length },
    enrolledStudents: activeStudents.size,
    averageCompletion: completion.length ? Math.round(sum(completion, (c) => c.completion) / completion.length * 10) / 10 : null,
    averageAttendance: counted ? pct(attended, counted) : null,
    averageAssessment: evals.length ? Math.round(sum(evals, (t) => t.percent ?? 0) / evals.length * 10) / 10 : null,
    pendingEvaluations: pending + pendingDaily,
    upcomingExams: exams.docs.map((d) => ({ ...(d.data() as Assessment), id: d.id })).filter((a) => (a.closesAt ?? '9') >= now).sort((a, b) => (a.opensAt ?? a.closesAt ?? '').localeCompare(b.opensAt ?? b.closesAt ?? '')).slice(0, 10)
      .map((a) => ({ id: a.id, title: a.title, courseId: a.courseId, examType: a.examType ?? null, opensAt: a.opensAt ?? null, closesAt: a.closesAt ?? null })),
    inactiveStudents: [...activeStudents].filter((id) => !recentStudents.has(id)).length,
    completionByCourse: completion.sort((a, b) => b.learners - a.learners),
    attendanceByMonth: [...byMonth.entries()].sort().map(([month, v]) => ({ month, percent: v.c ? pct(v.a, v.c) : 0 })),
  };
}

/** Admissions in a period, grouped for charts (confirmed only; drafts aren't admissions). */
async function admissionAnalytics(db: Firestore, s: Scope, from: string, to: string) {
  const today = localDate();
  const base = scoped(db, 'admissions', s).where('status', '==', 'confirmed');
  const yearStart = `${today.slice(0, 4)}-01-01T00:00:00.000Z`;
  const [total, thisYear, thisMonth, todayCount, inPeriod] = await Promise.all([
    count(base), count(base.where('confirmedAt', '>=', yearStart)), count(base.where('confirmedAt', '>=', `${today.slice(0, 7)}-01T00:00:00.000Z`)),
    count(base.where('confirmedAt', '>=', `${today}T00:00:00.000Z`)),
    base.where('confirmedAt', '>=', `${from}T00:00:00.000Z`).where('confirmedAt', '<=', `${to}T23:59:59.999Z`).select('orgId', 'branchId', 'courseId', 'confirmedAt').get(),
  ]);
  const rows = inPeriod.docs.map((d) => d.data() as Admission);
  const group = (f: (a: Admission) => string) => [...rows.reduce((m, a) => m.set(f(a), (m.get(f(a)) ?? 0) + 1), new Map<string, number>()).entries()];
  const [orgN, branchN, courseN] = await Promise.all([names(db, 'organizations', rows.map((a) => a.orgId)), names(db, 'branches', rows.map((a) => a.branchId)), names(db, 'courses', rows.map((a) => a.courseId ?? ''))]);
  const named = (pairs: [string, number][], n: Map<string, string>) => pairs.map(([id, c]) => ({ id, name: n.get(id) ?? id, count: c })).sort((a, b) => b.count - a.count);
  return {
    total, thisYear, thisMonth, today: todayCount, inPeriod: rows.length,
    byMonth: group((a) => (a.confirmedAt ?? '').slice(0, 7)).sort().map(([month, c]) => ({ month, count: c })),
    byAcademy: named(group((a) => a.orgId), orgN), byBranch: named(group((a) => a.branchId), branchN), byCourse: named(group((a) => a.courseId ?? ''), courseN),
  };
}

const ACTIVITY: Record<string, string> = {
  admission_confirm: 'Admission confirmed', account_create: 'Account created', staff_onboard: 'Staff onboarded', publish: 'Content published',
  fee_payment: 'Payment received', fee_reversal: 'Payment reversed', fee_refund: 'Refund recorded', fee_adjustment: 'Fee adjustment', discount_approved: 'Discount approved', discount_rejected: 'Discount rejected',
  expense_add: 'Expense recorded', expense_void: 'Expense voided', assessment_results_released: 'Results released', certificate_issue: 'Certificate issued', certificate_revoke: 'Certificate revoked',
  account_status: 'Account status changed', update_org: 'Academy edited', set_org_status: 'Academy status changed', update_branch: 'Branch edited', set_branch_status: 'Branch status changed',
  pricing_update: 'Course price changed', announcement_create: 'Announcement published', announcement_withdraw: 'Announcement withdrawn', change_role: 'Role changed', move_branch: 'Branch changed',
  attendance_corrected: 'Attendance corrected', attempt_evaluated: 'Submission evaluated', fee_account_open: 'Fee account opened',
};

/** Audit entries as readable activity, newest first, cursor-paginated. */
async function activity(db: Firestore, s: Scope, size: number, after?: string) {
  let q = scoped(db, 'auditLog', s).orderBy('at', 'desc');
  if (after) {
    const snap = await db.doc(`auditLog/${after}`).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const snap = await q.limit(size + 1).get();
  const rows = snap.docs.slice(0, size).map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string; orgId: string; branchId?: string; actorId: string; action: string; at?: { toDate?: () => Date } }));
  const [orgN, branchN, actorN] = await Promise.all([
    names(db, 'organizations', rows.map((r) => r.orgId)), names(db, 'branches', rows.map((r) => r.branchId ?? '')),
    names(db, 'users', rows.map((r) => (r.actorId?.startsWith('migration:') ? '' : r.actorId))),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id, action: r.action, label: ACTIVITY[r.action] ?? r.action.replace(/_/g, ' '), targetType: (r.targetType as string) ?? null, targetId: (r.targetId as string) ?? null,
      academy: orgN.get(r.orgId) ?? r.orgId ?? null, branch: r.branchId ? branchN.get(r.branchId) ?? r.branchId : null, by: actorN.get(r.actorId) ?? r.actorId,
      amount: typeof r.amount === 'number' ? r.amount : null, reason: typeof r.reason === 'string' ? r.reason : null,
      at: r.at?.toDate?.().toISOString() ?? null,
    })),
    cursor: snap.docs.length > size ? rows[rows.length - 1].id : null,
  };
}

/** Cursor-paginated people (ordered by document id, so equality filters need no extra index). */
async function peoplePage(db: Firestore, base: Query, after?: string) {
  let q = base.orderBy(FieldPath.documentId());
  if (after) q = q.startAfter(after);
  const snap = await q.limit(PAGE + 1).get();
  const users = snap.docs.slice(0, PAGE).map((d) => ({ id: d.id, ...d.data() } as UserProfile));
  return { users, cursor: snap.docs.length > PAGE ? users[users.length - 1].id : null };
}

const personRow = (u: UserProfile, orgN: Map<string, string>, branchN: Map<string, string>) => ({
  id: u.id, displayName: u.displayName, email: u.email, role: u.role, status: u.status, orgId: u.orgId, academy: orgN.get(u.orgId) ?? u.orgId,
  branchId: u.branchId ?? null, branch: u.branchId ? branchN.get(u.branchId) ?? u.branchId : null, studentId: u.metadata?.studentIdNumber ?? null,
});

async function rowsWithNames(db: Firestore, users: UserProfile[]) {
  const [orgN, branchN] = await Promise.all([names(db, 'organizations', users.map((u) => u.orgId)), names(db, 'branches', users.map((u) => u.branchId ?? ''))]);
  return users.map((u) => personRow(u, orgN, branchN));
}

async function transactionsPage(db: Firestore, s: Scope, after?: string) {
  let q = scoped(db, 'feeTransactions', s).orderBy('createdAt', 'desc');
  if (after) { const d = await db.doc(`feeTransactions/${after}`).get(); if (d.exists) q = q.startAfter(d); }
  const snap = await q.limit(PAGE + 1).get();
  const rows = docs<FeeTransaction>(snap).slice(0, PAGE);
  return { rows: rows.map((t) => ({ id: t.id, date: t.date, type: t.type, amount: t.amount, studentName: t.studentName, receiptNumber: t.receiptNumber ?? null, method: t.method ?? null, reason: t.reason ?? null, feeAccountId: t.feeAccountId, recordedBy: t.createdByName })), cursor: snap.docs.length > PAGE ? rows[rows.length - 1].id : null };
}

/** Review indicators (never automatic changes): overdue, large balances, high discounts, reversals, refunds, unusual expenses, ledger mismatches. */
export function financialAnomalies(accounts: FeeAccount[], ledger: FeeTransaction[], expenses: Expense[], today: string) {
  const byAccount = new Map<string, FeeTransaction[]>();
  for (const t of ledger) byAccount.set(t.feeAccountId, [...(byAccount.get(t.feeAccountId) ?? []), t]);
  const byId = new Map(ledger.map((t) => [t.id, t]));
  const acct = (a: FeeAccount, extra: Record<string, unknown>) => ({ feeAccountId: a.id, studentName: a.studentName, admissionNumber: a.admissionNumber, courseTitle: a.courseTitle, orgId: a.orgId, branchId: a.branchId, ...extra });
  const overdue = accounts.map((a) => ({ a, d: dueSummary(a.installments, collectedOf(a), today) })).filter((x) => x.d.overdue > 0).sort((x, y) => y.d.overdue - x.d.overdue);
  const ageDays = (iso: string) => (Date.parse(`${today}T00:00:00Z`) - Date.parse(iso)) / 86400_000;
  const large = accounts.filter((a) => dueOf(a) > 0 && balanceOf(a) / dueOf(a) >= 0.75 && ageDays(a.createdAt) >= 60).sort((x, y) => balanceOf(y) - balanceOf(x));
  // Approved or still waiting for approval: both deserve a look when they are large.
  const discounts = accounts.filter((a) => (a.discount.status === 'approved' || a.discount.status === 'pending') && a.grossFee > 0 && a.discount.amount / a.grossFee >= 0.25);
  const reversals = [...byAccount.entries()].map(([id, ts]) => ({ id, n: ts.filter((t) => t.type === 'reversal').length })).filter((x) => x.n >= 2);
  const refunds = [...byAccount.entries()].map(([id, ts]) => ({ id, n: ts.filter((t) => t.type === 'refund').length })).filter((x) => x.n >= 2);
  const reversalsByStaff = [...ledger.filter((t) => t.type === 'reversal').reduce((m, t) => m.set(t.createdByName, (m.get(t.createdByName) ?? 0) + 1), new Map<string, number>()).entries()].filter(([, n]) => n >= 3);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const mismatched = accounts.filter((a) => {
    const t = totalsFromLedger(byAccount.get(a.id) ?? [], byId);
    return t.paid !== a.totals.paid || t.refunded !== a.totals.refunded || t.adjustments !== a.totals.adjustments;
  });
  // Expenses more than 3× the median of their category (needs at least 5 in the category).
  const byCat = new Map<string, number[]>();
  for (const e of expenses) byCat.set(e.categoryName, [...(byCat.get(e.categoryName) ?? []), e.amount]);
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const unusual = expenses.filter((e) => (byCat.get(e.categoryName)?.length ?? 0) >= 5 && e.amount > 3 * median(byCat.get(e.categoryName)!));
  return {
    overdue: overdue.slice(0, 50).map((x) => acct(x.a, { overdue: x.d.overdue })), overdueCount: overdue.length,
    largeBalances: large.slice(0, 50).map((a) => acct(a, { balance: balanceOf(a), due: dueOf(a) })), largeBalanceCount: large.length,
    highDiscounts: discounts.map((a) => acct(a, { discount: a.discount.amount, percent: Math.round((a.discount.amount / a.grossFee) * 1000) / 10, reason: a.discount.reason ?? null, status: a.discount.status })),
    frequentReversals: reversals.flatMap((x) => (accountsById.has(x.id) ? [acct(accountsById.get(x.id)!, { count: x.n })] : [])),
    reversalsByStaff: reversalsByStaff.map(([name, n]) => ({ name, count: n })),
    repeatedRefunds: refunds.flatMap((x) => (accountsById.has(x.id) ? [acct(accountsById.get(x.id)!, { count: x.n })] : [])),
    unusualExpenses: unusual.slice(0, 50).map((e) => ({ id: e.id, title: e.title, category: e.categoryName, amount: e.amount, date: e.date, branchId: e.branchId, median: median(byCat.get(e.categoryName)!) })),
    inconsistentAccounts: mismatched.map((a) => acct(a, {})),
  };
}

export async function handleCommand(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  requireSuper(actor);
  const req = parseBody(commandRequestSchema, body);
  const { db } = services;
  const today = localDate();
  const defFrom = `${today.slice(0, 4)}-01-01`;

  switch (req.action) {
    case 'overview': {
      const s = await resolve(db, req.orgId, req.branchId);
      const from = req.from ?? defFrom, to = req.to ?? today;
      const [stats, admissions, academics, finance, recent, enr] = await Promise.all([
        scopeStats(db, s), admissionAnalytics(db, s, from, to), academicSnapshot(db, s, from, to), financeSummary(db, s, { from, to }), activity(db, s, 15),
        scoped(db, 'enrollments', s).where('status', '==', 'active').select('orgId', 'courseId').get(),
      ]);
      const byOrg = new Map<string, number>(), byCourse = new Map<string, number>();
      for (const d of enr.docs) { const e = d.data(); byOrg.set(e.orgId, (byOrg.get(e.orgId) ?? 0) + 1); byCourse.set(e.courseId, (byCourse.get(e.courseId) ?? 0) + 1); }
      const [orgN, courseN] = await Promise.all([names(db, 'organizations', [...byOrg.keys()]), names(db, 'courses', [...byCourse.keys()])]);
      const ft = finance.totals;
      return {
        scope: s, period: { from, to }, stats, admissions, academics,
        finance: {
          expected: ft.expected, collectedToDate: ft.collectedToDate, outstanding: ft.outstanding, overdue: ft.overdue, overdueAccounts: ft.overdueAccounts,
          collectedInPeriod: ft.collected, collectedThisMonth: ft.thisMonthCollected, discounts: ft.discounts, refunds: ft.refunds, expenses: ft.expenses, net: ft.net, pendingDiscounts: ft.pendingDiscounts,
        },
        charts: {
          admissionsByMonth: admissions.byMonth, collectionsByMonth: finance.byMonth, studentsByAcademy: [...byOrg.entries()].map(([id, n]) => ({ id, name: orgN.get(id) ?? id, count: n })).sort((a, b) => b.count - a.count),
          admissionsByBranch: admissions.byBranch.slice(0, 15), coursePopularity: [...byCourse.entries()].map(([id, n]) => ({ id, name: courseN.get(id) ?? id, count: n })).sort((a, b) => b.count - a.count).slice(0, 15),
          completionByCourse: academics.completionByCourse.slice(0, 15), attendanceByMonth: academics.attendanceByMonth, expenseCategories: finance.byCategory, outstandingByMonth: finance.outstandingByMonth,
        },
        recent: recent.rows,
      };
    }

    case 'academies': {
      let orgs = docs<Organization>(await db.collection('organizations').get());
      if (req.q) { const q = req.q.toLowerCase(); orgs = orgs.filter((o) => o.name?.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)); }
      if (req.status) orgs = orgs.filter((o) => (o.status ?? 'active') === req.status);
      orgs.sort((a, b) => (req.sort === 'name' ? (a.name ?? '').localeCompare(b.name ?? '') : req.sort === 'created_asc' ? (a.createdAt ?? '').localeCompare(b.createdAt ?? '') : (b.createdAt ?? '').localeCompare(a.createdAt ?? '')));
      const page = orgs.slice(req.page * PAGE, (req.page + 1) * PAGE);
      const rows = await Promise.all(page.map(async (o) => ({ id: o.id, name: o.name, status: o.status ?? 'active', createdAt: o.createdAt ?? null, stats: await scopeStats(db, { orgId: o.id, branchId: null }) })));
      return { total: orgs.length, page: req.page, pageSize: PAGE, academies: rows };
    }

    case 'branches': {
      if (req.orgId && !(await getDocData(db, `organizations/${req.orgId}`))) throw notFound('That academy');
      let bq: Query = db.collection('branches');
      if (req.orgId) bq = bq.where('orgId', '==', req.orgId);
      let branches = docs<Branch>(await bq.get());
      if (req.q) { const q = req.q.toLowerCase(); branches = branches.filter((b) => b.name?.toLowerCase().includes(q) || b.code?.toLowerCase().includes(q) || b.id.toLowerCase().includes(q)); }
      if (req.status) branches = branches.filter((b) => (b.status ?? 'active') === req.status);
      branches.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      const page = branches.slice(req.page * PAGE, (req.page + 1) * PAGE);
      const [orgN, mgrN] = await Promise.all([names(db, 'organizations', page.map((b) => b.orgId)), names(db, 'users', page.flatMap((b) => b.branchAdminUserIds ?? []))]);
      const rows = await Promise.all(page.map(async (b) => ({
        id: b.id, name: b.name, code: b.code, status: b.status ?? 'active', orgId: b.orgId, academy: orgN.get(b.orgId) ?? b.orgId,
        managers: (b.branchAdminUserIds ?? []).map((id) => ({ id, name: mgrN.get(id) ?? id })), stats: await scopeStats(db, { orgId: b.orgId, branchId: b.id }),
      })));
      return { total: branches.length, page: req.page, pageSize: PAGE, branches: rows };
    }

    case 'academy':
    case 'branch': {
      const s = req.action === 'academy' ? await resolve(db, req.orgId) : await resolve(db, undefined, req.branchId);
      const org = await getDocData<Organization>(db, `organizations/${s.orgId}`);
      const branch = s.branchId ? await getDocData<Branch>(db, `branches/${s.branchId}`) : null;
      const from = req.from ?? defFrom, to = req.to ?? today;
      const head = { academy: org ? { id: org.id, name: org.name, status: org.status ?? 'active', website: org.website ?? null, timezone: org.settings?.defaultTimezone ?? null, createdAt: org.createdAt ?? null } : null,
        branch: branch ? { id: branch.id, name: branch.name, code: branch.code, status: branch.status ?? 'active', city: branch.location?.city ?? null, managers: [...(await names(db, 'users', branch.branchAdminUserIds ?? [])).entries()].map(([id, name]) => ({ id, name })) } : null };
      switch (req.tab) {
        case 'overview': {
          const [stats, admissions, academics, finance] = await Promise.all([scopeStats(db, s), admissionAnalytics(db, s, from, to), academicSnapshot(db, s, from, to), financeSummary(db, s, { from, to })]);
          return { ...head, period: { from, to }, stats, admissions, academics: { ...academics, completionByCourse: academics.completionByCourse.slice(0, 10) }, finance: { totals: finance.totals, byMonth: finance.byMonth } };
        }
        case 'branches': {
          const branches = docs<Branch>(await db.collection('branches').where('orgId', '==', s.orgId).get()).sort((a, b) => a.name.localeCompare(b.name));
          const mgrN = await names(db, 'users', branches.flatMap((b) => b.branchAdminUserIds ?? []));
          return { ...head, branches: await Promise.all(branches.map(async (b) => ({ id: b.id, name: b.name, code: b.code, status: b.status ?? 'active', managers: (b.branchAdminUserIds ?? []).map((id) => mgrN.get(id) ?? id), stats: await scopeStats(db, { orgId: b.orgId, branchId: b.id }) }))) };
        }
        case 'people':
        case 'staff':
        case 'students': {
          const tab = req.tab;
          let base = scoped(db, 'users', s);
          const role = tab === 'students' ? 'student' : 'role' in req ? req.role : undefined;
          if (role) base = base.where('role', '==', role);
          else if (tab === 'staff') base = base.where('role', 'in', ['branch_admin', 'instructor']);
          const { users, cursor: next } = await peoplePage(db, base, req.cursor);
          const rows = await rowsWithNames(db, users);
          if (tab !== 'students' || !users.length) return { ...head, people: rows, cursor: next };
          // Students: course, batch, enrollment status, attendance, completion and fee status for this page.
          const ids = users.map((u) => u.id);
          const [enr, fees] = await Promise.all([
            db.collection('enrollments').where('orgId', '==', s.orgId).where('studentId', 'in', ids).get(),
            db.collection('feeAccounts').where('orgId', '==', s.orgId).where('studentId', 'in', ids).get(),
          ]);
          const enrollments = docs<Enrollment>(enr);
          const [courseN, batchN] = await Promise.all([names(db, 'courses', enrollments.map((e) => e.courseId)), names(db, 'batches', enrollments.map((e) => e.batchId))]);
          const sessionsBy = new Map<string, AttendanceSession[]>();
          await Promise.all([...new Set(enrollments.map((e) => e.batchId))].map(async (b) => sessionsBy.set(b, docs<AttendanceSession>(await db.collection('attendance').where('orgId', '==', s.orgId).where('batchId', '==', b).get()))));
          const accounts = docs<FeeAccount>(fees);
          return {
            ...head, cursor: next,
            people: rows.map((r) => ({
              ...r,
              enrollments: enrollments.filter((e) => e.studentId === r.id).map((e) => ({ courseId: e.courseId, course: courseN.get(e.courseId) ?? e.courseId, batch: batchN.get(e.batchId) ?? e.batchId, status: e.status, attendance: attendanceStats(sessionsBy.get(e.batchId) ?? [], r.id).percent })),
              fees: accounts.filter((a) => a.studentId === r.id).map((a) => ({ id: a.id, balance: balanceOf(a), overdue: dueSummary(a.installments, collectedOf(a), today).overdue })),
            })),
          };
        }
        case 'courses': {
          const coursesSnap = s.branchId
            ? null
            : await db.collection('courses').where('orgId', '==', s.orgId).select('title', 'status', 'level').get();
          const batches = docs<Batch>(await scoped(db, 'batches', s).get());
          const courseIds = s.branchId ? [...new Set(batches.map((b) => b.courseId))] : coursesSnap!.docs.map((d) => d.id);
          const titleN = coursesSnap ? new Map(coursesSnap.docs.map((d) => [d.id, d.data().title as string])) : await names(db, 'courses', courseIds);
          const rows = await Promise.all(courseIds.map(async (id) => {
            const enr = scoped(db, 'enrollments', s).where('courseId', '==', id);
            const [pricing, enrolled, active, completed, lessons, done] = await Promise.all([
              getDocData<{ standardFee: number; registrationFee: number; otherFees: { amount: number }[]; version: number; available: boolean }>(db, `coursePricing/${id}`),
              count(enr), count(enr.where('status', '==', 'active')), count(enr.where('status', '==', 'completed')),
              count(db.collection('lessons').where('orgId', '==', s.orgId).where('courseId', '==', id).where('status', '==', 'published')),
              count(db.collection('progress').where('orgId', '==', s.orgId).where('courseId', '==', id).where('status', '==', 'completed')),
            ]);
            return {
              id, title: titleN.get(id) ?? id, status: coursesSnap?.docs.find((d) => d.id === id)?.data().status ?? null,
              price: pricing ? pricing.standardFee + pricing.registrationFee + sum(pricing.otherFees, (f) => f.amount) : null, pricingVersion: pricing?.version ?? null, open: pricing?.available ?? false,
              enrolled, active, completed, lessons, completion: s.branchId ? null : Math.min(100, pct(done, active * lessons)),
              batches: batches.filter((b) => b.courseId === id).map((b) => ({ id: b.id, name: b.name, status: b.status, instructors: b.instructorNames ?? [], startDate: b.startDate, endDate: b.endDate ?? null, students: b.activeEnrollmentCount ?? null })),
            };
          }));
          return { ...head, courses: rows.sort((a, b) => b.enrolled - a.enrolled) };
        }
        case 'academics': {
          if (!s.orgId) throw invalid('Choose an academy.');
          return { ...head, ...(await academicIntel(db, s.orgId, s.branchId ?? undefined)) };
        }
        case 'finance': {
          const [summary, tx] = await Promise.all([financeSummary(db, s, { from, to }), transactionsPage(db, s, req.cursor)]);
          return { ...head, period: summary.period, totals: summary.totals, byBranch: summary.byBranch, byCourse: summary.byCourse, byMonth: summary.byMonth, byCategory: summary.byCategory, upcoming: summary.upcoming, transactions: tx.rows, cursor: tx.cursor };
        }
        case 'audit': {
          const page = await activity(db, s, PAGE, req.cursor);
          return { ...head, activity: page.rows, cursor: page.cursor };
        }
      }
      throw invalid('Unknown tab.');
    }

    case 'finance_intel': {
      const s = await resolve(db, req.orgId, req.branchId);
      const summary = await financeSummary(db, s, { from: req.from, to: req.to, courseId: req.courseId, batchId: req.batchId });
      const [acc, led, exp] = await Promise.all([scoped(db, 'feeAccounts', s).get(), scoped(db, 'feeTransactions', s).get(), scoped(db, 'expenses', s).where('status', '==', 'paid').get()]);
      const accounts = docs<FeeAccount>(acc).filter((a) => a.status !== 'cancelled' && (!req.courseId || a.courseId === req.courseId) && (!req.batchId || a.batchId === req.batchId));
      const anomalies = financialAnomalies(accounts, docs<FeeTransaction>(led), req.courseId || req.batchId ? [] : docs<Expense>(exp), today);
      const [orgN, branchN] = await Promise.all([names(db, 'organizations', accounts.map((a) => a.orgId)), names(db, 'branches', accounts.map((a) => a.branchId))]);
      const admissionsByAcademy = await Promise.all([...new Set(summary.byAcademy.map((a) => a.id))].map(async (id) => ({ id, count: await count(db.collection('admissions').where('orgId', '==', id).where('status', '==', 'confirmed')) })));
      return { scope: s, summary, anomalies, names: { academies: Object.fromEntries(orgN), branches: Object.fromEntries(branchN) }, admissionsByAcademy };
    }

    case 'academic_intel': {
      const s = await resolve(db, req.orgId, req.branchId);
      return academicIntel(db, s.orgId!, s.branchId ?? undefined, req.courseId);
    }

    case 'people': {
      const s = await resolve(db, req.orgId, req.branchId);
      const q = req.q?.trim();
      let users: UserProfile[] = [];
      let next: string | null = null;
      const keep = (u: UserProfile) => (!s.orgId || u.orgId === s.orgId) && (!s.branchId || u.branchId === s.branchId) && (!req.role || u.role === req.role) && (!req.status || u.status === req.status);
      if (q) {
        // Name prefix, exact email, exact mobile (personal record), exact user id or student ID.
        const ids = new Set<string>();
        const byName = s.orgId ? db.collection('users').where('orgId', '==', s.orgId) : db.collection('users');
        const [name, email, mobile, number, uid] = await Promise.all([
          byName.where('displayName', '>=', q).where('displayName', '<=', `${q}`).limit(50).get(),
          db.collection('users').where('email', '==', q.toLowerCase()).limit(10).get(),
          db.collection('personProfiles').where('personal.mobile', '==', q).limit(10).get(),
          db.collection('personProfiles').where('admissionNumber', '==', q.toUpperCase()).limit(10).get(),
          /^[A-Za-z0-9_-]{1,128}$/.test(q) ? db.doc(`users/${q}`).get() : Promise.resolve(null),
        ]);
        for (const snap of [name, email, mobile, number]) snap.docs.forEach((d) => ids.add(d.id));
        if (uid?.exists) ids.add(uid.id);
        const snaps = ids.size ? await db.getAll(...[...ids].map((id) => db.doc(`users/${id}`))) : [];
        users = snaps.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() } as UserProfile)).filter(keep);
      } else if (req.courseId || req.batchId) {
        // Students enrolled in the course/batch, and (for a batch) its instructors.
        let eq: Query = db.collection('enrollments');
        if (s.orgId) eq = eq.where('orgId', '==', s.orgId);
        if (req.courseId) eq = eq.where('courseId', '==', req.courseId);
        if (req.batchId) eq = eq.where('batchId', '==', req.batchId);
        const studentIds = (await eq.select('studentId').get()).docs.map((d) => d.data().studentId as string);
        const batch = req.batchId ? await getDocData<Batch>(db, `batches/${req.batchId}`) : null;
        const all = [...new Set([...studentIds, ...(batch?.instructorUserIds ?? [])])].sort();
        const start = req.cursor ? all.findIndex((id) => id > req.cursor!) : 0;
        const slice = start < 0 ? [] : all.slice(start, start + PAGE);
        const snaps = slice.length ? await db.getAll(...slice.map((id) => db.doc(`users/${id}`))) : [];
        users = snaps.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() } as UserProfile)).filter(keep);
        next = start >= 0 && start + PAGE < all.length ? slice[slice.length - 1] : null;
      } else {
        let base = scoped(db, 'users', s);
        if (req.role) base = base.where('role', '==', req.role);
        if (req.status) base = base.where('status', '==', req.status);
        const page = await peoplePage(db, base, req.cursor);
        users = page.users;
        next = page.cursor;
      }
      return { people: await rowsWithNames(db, users), cursor: next };
    }

    case 'announcements': {
      let q = db.collection('announcements').orderBy('createdAt', 'desc');
      if (req.cursor) { const d = await db.doc(`announcements/${req.cursor}`).get(); if (d.exists) q = q.startAfter(d); }
      const snap = await q.limit(PAGE + 1).get();
      const rows = snap.docs.slice(0, PAGE).map((d) => ({ id: d.id, ...d.data() }));
      return { announcements: rows, cursor: snap.docs.length > PAGE ? rows[rows.length - 1].id : null };
    }

    case 'create_announcement': {
      const a = req.audience;
      if (a.scope === 'academy' && !a.orgId) throw invalid('Choose the academy.');
      if (a.scope === 'branch' && !a.branchId) throw invalid('Choose the branch.');
      if (a.scope === 'all' && (a.orgId || a.branchId || a.courseId || a.batchId)) throw invalid('“All academies” can’t be narrowed to an academy, branch, course or batch.');
      const target = a.scope === 'branch' ? await resolve(db, a.orgId, a.branchId) : a.scope === 'academy' ? await resolve(db, a.orgId) : { orgId: null, branchId: null };
      if (a.courseId) { const c = await getDocData<Course>(db, `courses/${a.courseId}`); if (!c || c.orgId !== target.orgId) throw invalid('Choose a course of the selected academy.'); }
      if (a.batchId) { const b = await getDocData<Batch>(db, `batches/${a.batchId}`); if (!b || b.orgId !== target.orgId || (target.branchId && b.branchId !== target.branchId) || (a.courseId && b.courseId !== a.courseId)) throw invalid('Choose a batch of the selected academy, branch and course.'); }
      if ((a.courseId || a.batchId) && a.roles.some((r) => r !== 'student')) throw invalid('Course and batch announcements go to students only.');
      const iso = new Date().toISOString();
      const publishAt = req.publishAt ?? iso;
      if (req.expiresAt && req.expiresAt <= publishAt) throw invalid('The expiry must be after the publish time.');
      const ref = db.collection('announcements').doc();
      await db.runTransaction(async (tx) => {
        tx.create(ref, {
          title: req.title, message: req.message, audience: { scope: a.scope, orgId: target.orgId, branchId: target.branchId, roles: a.roles, courseId: a.courseId ?? null, batchId: a.batchId ?? null },
          publishAt, expiresAt: req.expiresAt ?? null, status: 'active', createdById: actor.id, createdByName: displayName(actor), createdAt: iso,
        });
        tx.create(db.collection('auditLog').doc(), { orgId: target.orgId ?? actor.orgId, branchId: target.branchId, courseId: null, targetType: 'announcement', targetId: ref.id, action: 'announcement_create', actorId: actor.id, actorRole: actor.role, audienceScope: a.scope, at: FieldValue.serverTimestamp() });
      });
      return { announcementId: ref.id };
    }

    case 'withdraw_announcement': {
      const ref = db.doc(`announcements/${req.announcementId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That announcement');
        if (snap.data()!.status === 'withdrawn') throw invalid('It is already withdrawn.');
        tx.update(ref, { status: 'withdrawn', withdrawnAt: new Date().toISOString(), withdrawnById: actor.id, withdrawnReason: req.reason });
        tx.create(db.collection('auditLog').doc(), { orgId: snap.data()!.audience?.orgId ?? actor.orgId, branchId: snap.data()!.audience?.branchId ?? null, courseId: null, targetType: 'announcement', targetId: ref.id, action: 'announcement_withdraw', actorId: actor.id, actorRole: actor.role, reason: req.reason, at: FieldValue.serverTimestamp() });
        return { ok: true };
      });
    }
  }
}

/**
 * Academic intelligence for an academy (optionally one branch / course):
 * course performance, students who need attention, instructor activity and
 * assessment monitoring. Neutral wording only; nothing is changed.
 */
export async function academicIntel(db: Firestore, orgId: string, branchId?: string, courseId?: string) {
  const s: Scope = { orgId, branchId: branchId ?? null };
  const now = new Date();
  const nowIso = now.toISOString();
  const since90 = new Date(now.getTime() - 90 * 86400_000).toISOString().slice(0, 10);
  const since30 = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const idle = new Date(now.getTime() - 14 * 86400_000).toISOString();
  const [enrSnap, batchSnap, sessSnap, attemptSnap, assessSnap, recentSnap, courseSnap, instrSnap] = await Promise.all([
    scoped(db, 'enrollments', s).select('studentId', 'studentDisplayName', 'courseId', 'batchId', 'status', 'enrolledAt').get(),
    scoped(db, 'batches', s).get(),
    scoped(db, 'attendance', s).where('date', '>=', since90).get(),
    scoped(db, 'assessmentAttempts', s).select('assessmentId', 'studentId', 'courseId', 'batchId', 'kind', 'examType', 'status', 'percent', 'passed', 'submittedAt', 'evaluatedAt', 'evaluatedById').get(),
    db.collection('assessments').where('orgId', '==', orgId).get(),
    db.collection('progress').where('orgId', '==', orgId).where('lastAccessedAt', '>=', idle).select('studentId', 'courseId').get(),
    db.collection('courses').where('orgId', '==', orgId).select('title', 'status').get(),
    scoped(db, 'users', s).where('role', '==', 'instructor').select('displayName', 'email', 'branchId').get(),
  ]);
  const enrollments = docs<Enrollment>(enrSnap).filter((e) => !courseId || e.courseId === courseId);
  const active = enrollments.filter((e) => e.status === 'active');
  const batches = docs<Batch>(batchSnap).filter((b) => !courseId || b.courseId === courseId);
  const batchIds = new Set(batches.map((b) => b.id));
  const sessions = docs<AttendanceSession>(sessSnap).filter((x) => batchIds.has(x.batchId));
  const attempts = docs<AssessmentAttempt>(attemptSnap).filter((t) => !courseId || t.courseId === courseId);
  const assessments = docs<Assessment>(assessSnap).filter((a) => !courseId || a.courseId === courseId);
  const recent = new Set(recentSnap.docs.map((d) => `${d.data().studentId}|${d.data().courseId}`));
  const titleN = new Map(courseSnap.docs.map((d) => [d.id, d.data().title as string]));
  const sessionsBy = new Map<string, AttendanceSession[]>();
  for (const x of sessions) sessionsBy.set(x.batchId, [...(sessionsBy.get(x.batchId) ?? []), x]);
  const avg = (xs: number[]) => (xs.length ? Math.round((sum(xs, (x) => x) / xs.length) * 10) / 10 : null);
  const courseIds = [...new Set([...enrollments.map((e) => e.courseId), ...(courseId ? [courseId] : [])])];
  const lessonsBy = new Map(await Promise.all(courseIds.map(async (id) => [id, await count(db.collection('lessons').where('orgId', '==', orgId).where('courseId', '==', id).where('status', '==', 'published'))] as const)));
  // Completed lessons per student per course, counted once per course (batched by course).
  const doneBy = new Map<string, number>();
  await Promise.all(courseIds.map(async (id) => {
    const snap = await db.collection('progress').where('orgId', '==', orgId).where('courseId', '==', id).where('status', '==', 'completed').select('studentId').get();
    for (const d of snap.docs) doneBy.set(`${(d.data() as Progress).studentId}|${id}`, (doneBy.get(`${(d.data() as Progress).studentId}|${id}`) ?? 0) + 1);
  }));
  const completionOf = (e: Enrollment) => pct(Math.min(doneBy.get(`${e.studentId}|${e.courseId}`) ?? 0, lessonsBy.get(e.courseId) ?? 0), lessonsBy.get(e.courseId) ?? 0);

  const coursePerformance = courseIds.map((id) => {
    const enr = enrollments.filter((e) => e.courseId === id);
    const act = enr.filter((e) => e.status === 'active');
    const evals = attempts.filter((t) => t.courseId === id && t.status === 'evaluated');
    const att = act.map((e) => attendanceStats(sessionsBy.get(e.batchId) ?? [], e.studentId)).filter((x) => x.scheduled).map((x) => x.percent);
    return {
      courseId: id, title: titleN.get(id) ?? id, lessons: lessonsBy.get(id) ?? 0, enrolled: enr.length, active: act.length, completed: enr.filter((e) => e.status === 'completed').length,
      completion: avg(act.map(completionOf)), attendance: avg(att),
      quiz: avg(evals.filter((t) => t.kind === 'quiz').map((t) => t.percent ?? 0)),
      assignment: avg(evals.filter((t) => ['short_answer', 'long_answer', 'practical'].includes(t.kind)).map((t) => t.percent ?? 0)),
      exam: avg(evals.filter((t) => t.kind === 'exam').map((t) => t.percent ?? 0)),
      pendingEvaluations: attempts.filter((t) => t.courseId === id && ['submitted', 'under_evaluation'].includes(t.status)).length,
    };
  }).sort((a, b) => b.enrolled - a.enrolled);

  // Students who may need attention (neutral indicators).
  const published = assessments.filter((a) => a.status === 'published' && a.kind !== 'exam' && a.closesAt && a.closesAt < nowIso);
  const batchStart = new Map(batches.map((b) => [b.id, b.startDate]));
  const attention = active.map((e) => {
    const reasons: string[] = [];
    if (!recent.has(`${e.studentId}|${e.courseId}`)) reasons.push('No lesson activity in 14 days');
    const att = attendanceStats(sessionsBy.get(e.batchId) ?? [], e.studentId);
    if (att.scheduled >= 4 && att.percent < 75) reasons.push(`Attendance ${att.percent}%`);
    const mine = attempts.filter((t) => t.studentId === e.studentId && t.courseId === e.courseId);
    const failed = mine.filter((t) => t.status === 'evaluated' && t.passed === false).length;
    if (failed >= 2) reasons.push(`${failed} assessments not passed yet`);
    const overdue = published.filter((a) => a.courseId === e.courseId && (!a.batchIds?.length || a.batchIds.includes(e.batchId)) && !mine.some((t) => t.assessmentId === a.id && t.status !== 'in_progress'));
    if (overdue.length) reasons.push(`${overdue.length} overdue ${overdue.some((a) => a.kind === 'practical') ? 'activities incl. practical work' : 'activities'}`);
    const started = batchStart.get(e.batchId);
    const completion = completionOf(e);
    if (started && Date.parse(started) < now.getTime() - 30 * 86400_000 && completion < 25) reasons.push(`Course ${completion}% complete`);
    return { studentId: e.studentId, name: e.studentDisplayName ?? e.studentId, courseId: e.courseId, course: titleN.get(e.courseId) ?? e.courseId, batchId: e.batchId, reasons, attendance: att.scheduled ? att.percent : null, completion };
  }).filter((r) => r.reasons.length).sort((a, b) => b.reasons.length - a.reasons.length);

  // Instructor activity (operational facts only).
  const instructors = docs<UserProfile>(instrSnap).map((u) => {
    const mine = batches.filter((b) => (b.instructorUserIds ?? []).includes(u.id));
    const ids = new Set(mine.map((b) => b.id));
    const students = active.filter((e) => ids.has(e.batchId));
    const evaluatedByMe = attempts.filter((t) => t.evaluatedById === u.id && t.submittedAt && t.evaluatedAt && t.evaluatedAt.slice(0, 10) >= since90);
    const hours = evaluatedByMe.map((t) => (Date.parse(t.evaluatedAt!) - Date.parse(t.submittedAt!)) / 3600_000).filter((h) => h >= 0);
    return {
      id: u.id, name: u.displayName, batches: mine.map((b) => ({ id: b.id, name: b.name })), students: students.length,
      attendanceSessions30d: sessions.filter((x) => ids.has(x.batchId) && x.date >= since30).length,
      pendingEvaluations: attempts.filter((t) => ids.has(t.batchId) && ['submitted', 'under_evaluation'].includes(t.status)).length,
      evaluated90d: evaluatedByMe.length, averageTurnaroundHours: hours.length ? Math.round((sum(hours, (h) => h) / hours.length) * 10) / 10 : null,
      completion: avg(students.map(completionOf)),
    };
  }).filter((i) => !courseId || i.batches.length).sort((a, b) => b.students - a.students);

  // Assessment monitoring.
  const assessmentRows = assessments.filter((a) => a.status !== 'draft').map((a) => {
    const mine = attempts.filter((t) => t.assessmentId === a.id);
    const eligible = active.filter((e) => e.courseId === a.courseId && (!a.batchIds?.length || a.batchIds.includes(e.batchId))).length;
    const evaluated = mine.filter((t) => t.status === 'evaluated');
    const released = a.resultRelease === 'immediate' || (a.resultRelease === 'after_close' && (!a.closesAt || a.closesAt <= nowIso)) || Boolean(a.resultsReleasedAt);
    return {
      id: a.id, title: a.title, courseId: a.courseId, course: titleN.get(a.courseId) ?? a.courseId, kind: a.kind, examType: a.examType ?? null, status: a.status,
      opensAt: a.opensAt ?? null, closesAt: a.closesAt ?? null, timing: a.opensAt && a.opensAt > nowIso ? 'upcoming' : a.closesAt && a.closesAt < nowIso ? 'completed' : 'open',
      participants: new Set(mine.filter((t) => t.status !== 'in_progress').map((t) => t.studentId)).size, eligible,
      evaluated: evaluated.length, pending: mine.filter((t) => ['submitted', 'under_evaluation'].includes(t.status)).length,
      average: avg(evaluated.map((t) => t.percent ?? 0)), resultsReleased: released,
    };
  }).sort((a, b) => (b.closesAt ?? '').localeCompare(a.closesAt ?? ''));

  return {
    scope: s, courseId: courseId ?? null, courses: courseSnap.docs.map((d) => ({ id: d.id, title: d.data().title as string })),
    coursePerformance, attention: attention.slice(0, 200), attentionTotal: attention.length, instructors, assessments: assessmentRows,
    batches: batches.map((b) => ({ id: b.id, name: b.name, courseId: b.courseId, status: b.status, students: active.filter((e) => e.batchId === b.id).length, attendance: avg(active.filter((e) => e.batchId === b.id).map((e) => attendanceStats(sessionsBy.get(b.id) ?? [], e.studentId)).filter((x) => x.scheduled).map((x) => x.percent)) })),
  };
}

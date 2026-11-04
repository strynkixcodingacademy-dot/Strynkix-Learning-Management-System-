/**
 * Strynkix LMS — the Students register: one row per student, assembled from
 * the records the academy already keeps (account, personal record, admission,
 * enrollments, attendance, results, fees, certificates). Pure, so the server
 * and the tests share it; fee fields are filled only when the caller has
 * finance access to that student's branch.
 */

import type { Batch, Course, Enrollment, UserProfile } from '@/types/domain';
import type { Admission, AssessmentAttempt, AttendanceSession, Certificate, FeeAccount, PersonProfile } from '@/types/academy';
import { balanceOf, collectedOf, dueOf, dueSummary, paymentStatus } from '@/lib/finance/fees';

export type FeeStatus = 'paid' | 'overdue' | 'partial' | 'pending' | 'none';

export interface StudentRow {
  id: string;
  studentId: string | null;
  name: string;
  email: string;
  mobile: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  age: number | null;
  guardian: { name: string | null; relation: string | null; phone: string | null; email: string | null };
  emergency: { name: string | null; relation: string | null; phone: string | null };
  address: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  college: string | null;
  qualification: string | null;
  occupation: string | null;
  branchId: string | null;
  branchName: string | null;
  batches: { id: string; name: string }[];
  courses: { id: string; title: string }[];
  enrollmentStatus: 'active' | 'completed' | 'dropped' | 'suspended' | 'not_enrolled';
  admissionDate: string | null;
  accountStatus: UserProfile['status'];
  lastActive: string | null;
  attendancePercent: number | null;
  sessionsMarked: number;
  averageScore: number | null;
  assessmentsEvaluated: number;
  certificates: number;
  /** null when the caller has no finance access for this student's branch. */
  fees: { status: FeeStatus; due: number; collected: number; balance: number; overdue: number; nextDueDate: string | null } | null;
}

export interface RegisterInput {
  students: UserProfile[];
  profiles: Map<string, PersonProfile>;
  admissions: Admission[];
  enrollments: Enrollment[];
  batches: Map<string, Pick<Batch, 'id' | 'name'>>;
  courses: Map<string, Pick<Course, 'id' | 'title'>>;
  sessions: Pick<AttendanceSession, 'records'>[];
  attempts: Pick<AssessmentAttempt, 'studentId' | 'status' | 'percent'>[];
  feeAccounts: FeeAccount[];
  certificates: Pick<Certificate, 'studentId' | 'status'>[];
  branchNames: Map<string, string>;
  /** Whether fee fields may be shown for a student of this branch. */
  canSeeFees: (branchId: string | null) => boolean;
  today: string; // YYYY-MM-DD
}

const ENROLLMENT_ORDER = ['active', 'completed', 'suspended', 'dropped'] as const;

export function ageOn(dateOfBirth: string | undefined, today: string): number | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildStudentRows(input: RegisterInput): StudentRow[] {
  const enrollmentsBy = groupBy(input.enrollments, (e) => e.studentId);
  const attemptsBy = groupBy(input.attempts.filter((a) => a.status === 'evaluated'), (a) => a.studentId);
  const feesBy = groupBy(input.feeAccounts.filter((f) => f.status !== 'cancelled'), (f) => f.studentId);
  const certsBy = groupBy(input.certificates.filter((c) => c.status === 'issued'), (c) => c.studentId);
  const admissionBy = new Map<string, Admission>();
  for (const a of input.admissions) {
    if (a.status !== 'confirmed' || !a.studentId) continue;
    const prev = admissionBy.get(a.studentId);
    if (!prev || (a.confirmedAt ?? '') < (prev.confirmedAt ?? '')) admissionBy.set(a.studentId, a); // the first admission
  }

  return input.students.map((u): StudentRow => {
    const profile = input.profiles.get(u.id);
    const p = profile?.personal;
    const ac = profile?.academic;
    const enr = enrollmentsBy.get(u.id) ?? [];
    const admission = admissionBy.get(u.id);

    let present = 0;
    let counted = 0;
    let marked = 0;
    for (const s of input.sessions) {
      const st = s.records?.[u.id];
      if (!st) continue;
      marked++;
      if (st === 'excused') continue;
      counted++;
      if (st === 'present' || st === 'late') present++;
    }

    const evaluated = attemptsBy.get(u.id) ?? [];
    const fees = feesBy.get(u.id) ?? [];
    let feeRow: StudentRow['fees'] = null;
    if (input.canSeeFees(u.branchId ?? null)) {
      if (!fees.length) {
        feeRow = { status: 'none', due: 0, collected: 0, balance: 0, overdue: 0, nextDueDate: null };
      } else {
        let due = 0, collected = 0, balance = 0, overdue = 0;
        let nextDueDate: string | null = null;
        const statuses = new Set<string>();
        for (const f of fees) {
          due += dueOf(f);
          collected += collectedOf(f);
          balance += balanceOf(f);
          const sum = dueSummary(f.installments, collectedOf(f), input.today);
          overdue += sum.overdue;
          if (sum.next && (!nextDueDate || sum.next.dueDate < nextDueDate)) nextDueDate = sum.next.dueDate;
          statuses.add(paymentStatus(f, input.today));
        }
        const status: FeeStatus = statuses.has('overdue') ? 'overdue' : balance === 0 ? 'paid' : collected > 0 ? 'partial' : 'pending';
        feeRow = { status, due, collected, balance, overdue, nextDueDate };
      }
    }

    const statusOf = ENROLLMENT_ORDER.find((s) => enr.some((e) => e.status === s));
    const batchIds = [...new Set(enr.filter((e) => e.status === 'active' || e.status === 'completed').map((e) => e.batchId))];
    const courseIds = [...new Set(enr.map((e) => e.courseId))];
    const firstEnrolled = enr.map((e) => e.enrolledAt).filter(Boolean).sort()[0] ?? null;

    return {
      id: u.id,
      studentId: profile?.admissionNumber ?? admission?.admissionNumber ?? u.metadata?.studentIdNumber ?? null,
      name: u.displayName || [p?.firstName, p?.middleName, p?.lastName].filter(Boolean).join(' ') || u.email,
      email: u.email,
      mobile: p?.mobile || u.phoneNumber || null,
      gender: p?.gender || null,
      dateOfBirth: p?.dateOfBirth || null,
      age: ageOn(p?.dateOfBirth, input.today),
      guardian: { name: p?.guardianName || null, relation: p?.guardianRelation || null, phone: p?.guardianPhone || null, email: p?.guardianEmail || null },
      emergency: { name: p?.emergencyName || null, relation: p?.emergencyRelation || null, phone: p?.emergencyPhone || null },
      address: p?.address || null,
      city: p?.city || null,
      state: p?.state || null,
      pinCode: p?.pinCode || null,
      college: ac?.institution || null,
      qualification: ac?.highestQualification || null,
      occupation: ac?.currentOccupation || null,
      branchId: u.branchId ?? null,
      branchName: u.branchId ? input.branchNames.get(u.branchId) ?? null : null,
      batches: batchIds.map((id) => ({ id, name: input.batches.get(id)?.name ?? 'Batch' })),
      courses: courseIds.map((id) => ({ id, title: input.courses.get(id)?.title ?? 'Course' })),
      enrollmentStatus: statusOf ?? 'not_enrolled',
      admissionDate: admission?.confirmedAt?.slice(0, 10) ?? firstEnrolled?.slice(0, 10) ?? u.createdAt?.slice(0, 10) ?? null,
      accountStatus: u.status,
      lastActive: u.metadata?.lastLoginAt ?? null,
      attendancePercent: counted ? round1((present / counted) * 100) : null,
      sessionsMarked: marked,
      averageScore: evaluated.length ? round1(evaluated.reduce((s, a) => s + (a.percent ?? 0), 0) / evaluated.length) : null,
      assessmentsEvaluated: evaluated.length,
      certificates: (certsBy.get(u.id) ?? []).length,
      fees: feeRow,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

import { describe, it, expect } from 'vitest';
import { ageOn, buildStudentRows, type RegisterInput } from '@/lib/students/records';
import { studentColumns } from '@/lib/students/csv';
import { toCsv } from '@/lib/export/csv';
import type { UserProfile } from '@/types/domain';
import type { FeeAccount, PersonProfile } from '@/types/academy';

const student = (id: string, over: Partial<UserProfile> = {}): UserProfile => ({
  id, orgId: 'org', branchId: 'b1', role: 'student', email: `${id}@x.test`, displayName: id.toUpperCase(), status: 'active',
  createdAt: '2026-01-05T10:00:00.000Z', updatedAt: '2026-01-05T10:00:00.000Z', ...over,
});

const fee = (over: Partial<FeeAccount> = {}): FeeAccount => ({
  id: 'f1', orgId: 'org', branchId: 'b1', courseId: 'c1', batchId: 'bt1', studentId: 'a', studentName: 'A', admissionId: 'ad1', admissionNumber: 'STX-1',
  courseTitle: 'Course', currency: 'INR', pricingVersion: 1, grossFee: 1000_00, discount: { type: 'none', value: 0, amount: 0, status: 'none' as never },
  agreedFee: 1000_00, plan: 'installments', installments: [{ number: 1, dueDate: '2026-02-01', amount: 500_00 }, { number: 2, dueDate: '2026-12-01', amount: 500_00 }],
  totals: { paid: 200_00, refunded: 0, adjustments: 0 }, status: 'active', createdById: 'm', createdAt: '', updatedAt: '', ...over,
});

function input(over: Partial<RegisterInput> = {}): RegisterInput {
  const profile: PersonProfile = {
    id: 'a', orgId: 'org', branchId: 'b1', role: 'student', admissionNumber: 'STX-0001', updatedAt: '',
    personal: { firstName: 'Asha', lastName: 'Rao', email: 'a@x.test', mobile: '+91 98765 43210', dateOfBirth: '2005-11-10', gender: 'Female',
      guardianName: 'Ravi Rao', guardianRelation: 'Father', guardianPhone: '+91 90000 00000', guardianEmail: 'ravi@x.test', city: 'Pune' },
    academic: { institution: 'COEP', highestQualification: 'B.E.' },
  };
  return {
    students: [student('a'), student('b', { status: 'suspended' })],
    profiles: new Map([['a', profile]]),
    admissions: [{ id: 'ad1', orgId: 'org', branchId: 'b1', status: 'confirmed', studentId: 'a', confirmedAt: '2026-01-10T09:00:00.000Z', admissionNumber: 'STX-0001',
      personal: profile.personal, academic: {}, createdById: 'm', createdAt: '', updatedAt: '' }],
    enrollments: [{ id: 'c1_a', orgId: 'org', branchId: 'b1', courseId: 'c1', batchId: 'bt1', studentId: 'a', status: 'active', enrolledAt: '2026-01-11T00:00:00.000Z' } as never],
    batches: new Map([['bt1', { id: 'bt1', name: 'Alpha' }]]),
    courses: new Map([['c1', { id: 'c1', title: 'Full-Stack' }]]),
    sessions: [{ records: { a: 'present' } }, { records: { a: 'late' } }, { records: { a: 'absent' } }, { records: { a: 'excused' } }, { records: { b: 'present' } }],
    attempts: [{ studentId: 'a', status: 'evaluated', percent: 80 }, { studentId: 'a', status: 'evaluated', percent: 65 }, { studentId: 'a', status: 'submitted' as never, percent: 0 }],
    feeAccounts: [fee()],
    certificates: [{ studentId: 'a', status: 'issued' }, { studentId: 'a', status: 'revoked' }],
    branchNames: new Map([['b1', 'Pune Branch']]),
    canSeeFees: () => true,
    today: '2026-11-04',
    ...over,
  };
}

describe('Students register rows', () => {
  it('combines account, personal record, admission, batches, attendance, results and fees', () => {
    const [a, b] = buildStudentRows(input());
    expect(a).toMatchObject({
      id: 'a', studentId: 'STX-0001', name: 'A', mobile: '+91 98765 43210', age: 20,
      guardian: { name: 'Ravi Rao', relation: 'Father', phone: '+91 90000 00000', email: 'ravi@x.test' },
      college: 'COEP', qualification: 'B.E.', branchName: 'Pune Branch',
      batches: [{ id: 'bt1', name: 'Alpha' }], courses: [{ id: 'c1', title: 'Full-Stack' }],
      enrollmentStatus: 'active', admissionDate: '2026-01-10',
      // present + late of 3 counted sessions; excused doesn't count against them.
      attendancePercent: 66.7, sessionsMarked: 4,
      averageScore: 72.5, assessmentsEvaluated: 2, certificates: 1,
    });
    expect(a.fees).toEqual({ status: 'overdue', due: 1000_00, collected: 200_00, balance: 800_00, overdue: 300_00, nextDueDate: '2026-02-01' });
    expect(b).toMatchObject({ id: 'b', studentId: null, accountStatus: 'suspended', enrollmentStatus: 'not_enrolled', batches: [], attendancePercent: 100, admissionDate: '2026-01-05' });
    expect(b.fees).toMatchObject({ status: 'none', balance: 0 });
  });

  it('hides fees where the caller has no finance access', () => {
    const rows = buildStudentRows(input({ canSeeFees: () => false }));
    expect(rows.every((r) => r.fees === null)).toBe(true);
  });

  it('calculates age only from a valid date', () => {
    expect(ageOn('2005-11-04', '2026-11-04')).toBe(21);
    expect(ageOn('2005-11-05', '2026-11-04')).toBe(20);
    expect(ageOn('not-a-date', '2026-11-04')).toBeNull();
    expect(ageOn(undefined, '2026-11-04')).toBeNull();
  });
});

describe('Students register export', () => {
  it('leaves fee columns out without finance access and neutralises formulas', () => {
    const rows = buildStudentRows(input());
    expect(studentColumns(false).some((c) => c.header.startsWith('Balance'))).toBe(false);
    const csv = toCsv(rows, studentColumns(true));
    const [head, first] = csv.replace(/^﻿/, '').split('\r\n');
    expect(head).toContain('"Parent/guardian name"');
    expect(head).toContain('"Balance (₹)"');
    expect(first).toContain('"\'+91 98765 43210"'); // a phone starting with + can't run as a formula
    expect(first).toContain('"800.00"');
  });
});

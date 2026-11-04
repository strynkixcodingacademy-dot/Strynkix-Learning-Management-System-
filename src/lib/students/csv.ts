/**
 * Strynkix LMS — the Students register's CSV columns (opens in Excel and
 * Google Sheets). Built with the shared exporter, which neutralises formulas.
 */

import type { CsvColumn } from '@/lib/export/csv';
import type { StudentRow } from './records';

const rupees = (paise: number) => (paise / 100).toFixed(2);

export const CSV_COLUMNS: Array<CsvColumn<StudentRow> & { finance?: boolean }> = [
  { header: 'Student ID', value: (r) => r.studentId },
  { header: 'Name', value: (r) => r.name },
  { header: 'Email', value: (r) => r.email },
  { header: 'Mobile', value: (r) => r.mobile },
  { header: 'Gender', value: (r) => r.gender },
  { header: 'Date of birth', value: (r) => r.dateOfBirth },
  { header: 'Age', value: (r) => r.age },
  { header: 'Parent/guardian name', value: (r) => r.guardian.name },
  { header: 'Guardian relation', value: (r) => r.guardian.relation },
  { header: 'Guardian phone', value: (r) => r.guardian.phone },
  { header: 'Guardian email', value: (r) => r.guardian.email },
  { header: 'Emergency contact', value: (r) => r.emergency.name },
  { header: 'Emergency relation', value: (r) => r.emergency.relation },
  { header: 'Emergency phone', value: (r) => r.emergency.phone },
  { header: 'Address', value: (r) => r.address },
  { header: 'City', value: (r) => r.city },
  { header: 'State', value: (r) => r.state },
  { header: 'PIN code', value: (r) => r.pinCode },
  { header: 'College / institution', value: (r) => r.college },
  { header: 'Highest qualification', value: (r) => r.qualification },
  { header: 'Current occupation', value: (r) => r.occupation },
  { header: 'Branch', value: (r) => r.branchName },
  { header: 'Batches', value: (r) => r.batches.map((b) => b.name).join('; ') },
  { header: 'Courses', value: (r) => r.courses.map((c) => c.title).join('; ') },
  { header: 'Enrollment status', value: (r) => r.enrollmentStatus.replace('_', ' ') },
  { header: 'Admission date', value: (r) => r.admissionDate },
  { header: 'Account status', value: (r) => r.accountStatus.replace('_', ' ') },
  { header: 'Last sign-in', value: (r) => r.lastActive?.slice(0, 10) ?? null },
  { header: 'Attendance %', value: (r) => r.attendancePercent },
  { header: 'Sessions marked', value: (r) => r.sessionsMarked },
  { header: 'Average score %', value: (r) => r.averageScore },
  { header: 'Assessments evaluated', value: (r) => r.assessmentsEvaluated },
  { header: 'Certificates', value: (r) => r.certificates },
  { header: 'Fee status', value: (r) => r.fees?.status ?? null, finance: true },
  { header: 'Total fee (₹)', value: (r) => (r.fees ? rupees(r.fees.due) : null), finance: true },
  { header: 'Paid (₹)', value: (r) => (r.fees ? rupees(r.fees.collected) : null), finance: true },
  { header: 'Balance (₹)', value: (r) => (r.fees ? rupees(r.fees.balance) : null), finance: true },
  { header: 'Overdue (₹)', value: (r) => (r.fees ? rupees(r.fees.overdue) : null), finance: true },
  { header: 'Next due date', value: (r) => r.fees?.nextDueDate ?? null, finance: true },
];

/** The columns for an export; fee columns only for finance-authorized users. */
export function studentColumns(withFinance: boolean): CsvColumn<StudentRow>[] {
  return CSV_COLUMNS.filter((c) => withFinance || !c.finance);
}

/**
 * Strynkix LMS — Daily Assignment Submission State Machine
 * Mirrors the transitions enforced in firestore.rules (docs/DAILY_LEARNING.md §3)
 * so the UI can explain why an action is unavailable before a write is attempted.
 */

import { Submission, SubmissionStatus } from '@/types/domain';

/** Statuses from which a student may (re)submit. */
const STUDENT_EDITABLE: SubmissionStatus[] = ['submitted', 'resubmit_requested'];
const GRADABLE_FROM: SubmissionStatus[] = ['submitted', 'graded', 'resubmit_requested'];
const CORRECTABLE_FROM: SubmissionStatus[] = ['submitted', 'graded'];

export function canStudentSubmit(existing: Pick<Submission, 'status'> | null): boolean {
  return existing === null || STUDENT_EDITABLE.includes(existing.status);
}

export function canReviewerGrade(status: SubmissionStatus): boolean {
  return GRADABLE_FROM.includes(status);
}

export function canReviewerRequestCorrection(status: SubmissionStatus): boolean {
  return CORRECTABLE_FROM.includes(status);
}

/** Late is derived from the server timestamp, never stored or client-asserted. */
export function isLateSubmission(submittedAt: string | undefined, deadline: string | undefined): boolean {
  if (!submittedAt || !deadline) return false;
  return new Date(submittedAt).getTime() > new Date(deadline).getTime();
}

export type DeadlineState =
  | 'upcoming'
  | 'due_soon'
  | 'overdue'
  | 'submitted_on_time'
  | 'submitted_late'
  | 'correction_requested'
  | 'graded';

const DUE_SOON_MS = 24 * 60 * 60 * 1000;

export function getDeadlineState(
  deadline: string | undefined,
  submission: Pick<Submission, 'status' | 'submittedAt'> | null,
  now: Date
): DeadlineState {
  if (submission) {
    if (submission.status === 'graded') return 'graded';
    if (submission.status === 'resubmit_requested') return 'correction_requested';
    return isLateSubmission(submission.submittedAt, deadline) ? 'submitted_late' : 'submitted_on_time';
  }
  if (!deadline) return 'upcoming';
  const remaining = new Date(deadline).getTime() - now.getTime();
  if (remaining < 0) return 'overdue';
  return remaining <= DUE_SOON_MS ? 'due_soon' : 'upcoming';
}

export const DEADLINE_STATE_LABELS: Record<DeadlineState, string> = {
  upcoming: 'Not submitted',
  due_soon: 'Not submitted — due within 24h',
  overdue: 'Overdue — not submitted',
  submitted_on_time: 'Submitted on time',
  submitted_late: 'Submitted late',
  correction_requested: 'Correction requested',
  graded: 'Graded',
};

/** Validates submission content against the assignment's submission type. */
export function getSubmissionContentError(
  submissionType: 'text' | 'code' | 'text_and_code' | undefined,
  content: { textAnswer?: string; codeContent?: string }
): string | null {
  const hasText = Boolean(content.textAnswer?.trim());
  const hasCode = Boolean(content.codeContent?.trim());
  switch (submissionType ?? 'text') {
    case 'text':
      return hasText ? null : 'A written answer is required.';
    case 'code':
      return hasCode ? null : 'Code is required.';
    case 'text_and_code':
      return hasText && hasCode ? null : 'Both a written answer and code are required.';
  }
}

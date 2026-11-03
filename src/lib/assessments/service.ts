/**
 * Strynkix LMS — browser calls for lesson activities and examinations. All of
 * them go through POST /api/assessments; answer keys never reach a student
 * before the release rules allow it.
 */

import { postWithIdToken } from '@/lib/api/authed';
import type { Assessment, AssessmentAttempt, AssessmentKeyItem, AttemptResponse, AttemptStatus } from '@/types/academy';

const call = <T>(body: Record<string, unknown>) => postWithIdToken<T>('/api/assessments', body);

/** One question as edited in the authoring form (answers included). */
export interface QuestionDraft {
  id: string;
  type: 'mcq_single' | 'mcq_multi' | 'short' | 'long';
  prompt: string;
  options?: { id: string; text: string }[];
  marks: number;
  negativeMarks?: number;
  correctOptionIds?: string[];
  modelAnswer?: string;
  explanation?: string;
}

export type AssessmentDraft = Omit<Assessment, 'id' | 'orgId' | 'status' | 'createdById' | 'createdAt' | 'updatedAt' | 'totalMarks' | 'questions' | 'resultsReleasedAt'> & { questions: QuestionDraft[] };

export interface StudentAssessmentSummary {
  id: string; courseId: string; lessonId?: string; moduleId?: string;
  kind: Assessment['kind']; examType?: Assessment['examType']; title: string;
  totalMarks: number; passingPercent: number; opensAt?: string; closesAt?: string; timeLimitMinutes?: number;
  maxAttempts: number; attemptsUsed: number; status: AttemptStatus | 'not_started'; late: boolean;
  score?: number; percent?: number; passed?: boolean; canStart: boolean;
}

export type StudentAttemptView = Omit<AssessmentAttempt, 'score' | 'percent' | 'passed' | 'feedback' | 'manualScores' | 'questionFeedback' | 'autoScore'> & {
  released: boolean;
  score?: number; percent?: number; passed?: boolean; feedback?: string;
  manualScores?: Record<string, number>; questionFeedback?: Record<string, string>;
  provisionalAutoScore?: number;
  review?: AssessmentKeyItem[]; autoMarks?: Record<string, number>;
};

export const saveAssessment = (assessment: AssessmentDraft, assessmentId?: string) =>
  call<{ assessmentId: string; totalMarks: number }>({ action: 'save', assessment, ...(assessmentId ? { assessmentId } : {}) });
export const setAssessmentStatus = (assessmentId: string, status: Assessment['status']) => call<{ ok: true }>({ action: 'set_status', assessmentId, status });
export const listCourseAssessments = (courseId: string) => call<{ canAuthor: boolean; assessments: Assessment[] }>({ action: 'list_course', courseId });
export const getAssessmentForEdit = (assessmentId: string) => call<{ assessment: Assessment; key: AssessmentKeyItem[]; locked: boolean }>({ action: 'get_for_edit', assessmentId });
export const releaseResults = (assessmentId: string) => call<{ ok: true }>({ action: 'release_results', assessmentId });
export const listAttempts = (assessmentId: string) => call<{ assessment: Assessment; key: AssessmentKeyItem[]; attempts: AssessmentAttempt[] }>({ action: 'list_attempts', assessmentId });
export const getEvaluationQueue = () => call<{ attempts: AssessmentAttempt[] }>({ action: 'evaluation_queue' });
export const evaluateAttempt = (attemptId: string, input: { manualScores: Record<string, number>; questionFeedback: Record<string, string>; feedback?: string; finalize: boolean }) =>
  call<{ status: AttemptStatus; score: number; percent: number; passed: boolean }>({ action: 'evaluate', attemptId, ...input });
export const returnAttempt = (attemptId: string, reason: string) => call<{ status: 'returned' }>({ action: 'return', attemptId, reason });

export const listStudentAssessments = (filter: { courseId?: string; lessonId?: string } = {}) =>
  call<{ assessments: StudentAssessmentSummary[] }>({ action: 'student_list', ...filter });
export const getStudentAssessment = (assessmentId: string) =>
  call<{ assessment: Assessment; attempts: StudentAttemptView[]; canStart: boolean; startBlockedReason: string | null }>({ action: 'student_get', assessmentId });
export const startAttempt = (assessmentId: string) => call<{ attemptId: string; resumed: boolean }>({ action: 'start', assessmentId });
export const saveAttemptProgress = (attemptId: string, responses: Record<string, AttemptResponse>, practical?: AssessmentAttempt['practical']) =>
  call<{ saved: true }>({ action: 'save_progress', attemptId, responses, ...(practical ? { practical } : {}) });
export const submitAttempt = (attemptId: string, responses: Record<string, AttemptResponse>, practical?: AssessmentAttempt['practical']) =>
  call<{ status: AttemptStatus; released: boolean; score?: number; percent?: number; passed?: boolean }>({ action: 'submit', attemptId, responses, ...(practical ? { practical } : {}) });

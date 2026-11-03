import 'server-only';

/**
 * Strynkix LMS — lesson activities and examinations (one engine).
 *
 * - Authors save an assessment with its answers; the server splits the answers
 *   into assessments/{id}/key/current, which is never sent to students until
 *   the release rules allow it (src/lib/assessments/grading.ts).
 * - Students start, save and submit attempts. Every attempt is its own
 *   document; nothing a student submitted is ever replaced.
 * - MCQs are scored on the server at submission; written answers and
 *   practicals are evaluated by the batch's instructors or branch managers.
 * - Once attempts exist, the questions and answers are locked so every
 *   student is graded against the same key.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema } from '@/types/validation';
import type { Batch, Course, Lesson } from '@/types/domain';
import type { Assessment, AssessmentAttempt, AssessmentKeyItem, AttemptResponse } from '@/types/academy';
import {
  QUESTION_TYPES_FOR, autoScore, canStartAttempt, finalResult, isAutoQuestion, isResultReleased, mayRevealAnswers,
  needsManualEvaluation, roundMarks, totalMarksOf,
} from '@/lib/assessments/grading';
import { notify } from '@/lib/server/notifications';
import {
  type Actor, assertOrg, canAuthorAssessments, canManageBranch, canWorkWithBatch, conflict, denied, getDocData, invalid,
  isAcademyManager, isSuper, loadActor, notFound, parseBody, studentEnrollment,
} from '@/lib/server/academy-scope';

const isoDate = z.string().datetime({ offset: true });
const MAX_QUESTIONS = 100;
const TIME_GRACE_MS = 2 * 60 * 1000;
const OPTIONAL_FIELDS = ['moduleId', 'lessonId', 'batchIds', 'examType', 'practicalMarks', 'timeLimitMinutes', 'opensAt', 'closesAt'] as const;

const questionInput = z.object({
  id: idSchema,
  type: z.enum(['mcq_single', 'mcq_multi', 'short', 'long']),
  prompt: z.string().trim().min(3, 'Write each question (at least 3 characters).').max(4000),
  options: z.array(z.object({ id: idSchema, text: z.string().trim().min(1, 'Options can’t be empty.').max(500) }).strict()).max(10).optional(),
  marks: z.number().min(0.25, 'Each question needs marks.').max(100),
  negativeMarks: z.number().min(0).max(100).optional(),
  correctOptionIds: z.array(idSchema).max(10).optional(),
  modelAnswer: z.string().trim().max(4000).optional(),
  explanation: z.string().trim().max(2000).optional(),
}).strict();

const assessmentInput = z.object({
  courseId: idSchema,
  moduleId: idSchema.optional(),
  lessonId: idSchema.optional(),
  batchIds: z.array(idSchema).max(30).optional(),
  kind: z.enum(['quiz', 'short_answer', 'long_answer', 'practical', 'exam']),
  examType: z.enum(['demo', 'practice', 'final']).optional(),
  title: z.string().trim().min(3, 'Give it a title (at least 3 characters).').max(160),
  description: z.string().trim().max(2000).default(''),
  instructions: z.string().trim().max(5000).default(''),
  questions: z.array(questionInput).max(MAX_QUESTIONS).default([]),
  practicalMarks: z.number().min(1).max(1000).optional(),
  passingPercent: z.number().min(0).max(100),
  maxAttempts: z.number().int().min(0).max(50),
  timeLimitMinutes: z.number().int().min(1).max(600).optional(),
  opensAt: isoDate.optional(),
  closesAt: isoDate.optional(),
  allowLate: z.boolean().default(false),
  allowResubmission: z.boolean().default(true),
  negativeMarking: z.boolean().default(false),
  resultRelease: z.enum(['immediate', 'after_close', 'manual']),
}).strict();

const responsesSchema = z.record(idSchema, z.object({
  optionIds: z.array(idSchema).max(10).optional(),
  text: z.string().max(20000).optional(),
}).strict());
const practicalSchema = z.object({
  text: z.string().max(20000).optional(),
  repoUrl: z.union([z.string().trim().url().max(500).refine((u) => u.startsWith('https://'), 'Links must start with https://'), z.literal('')]).optional(),
  liveUrl: z.union([z.string().trim().url().max(500).refine((u) => u.startsWith('https://'), 'Links must start with https://'), z.literal('')]).optional(),
}).strict();

export const assessmentRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), assessmentId: idSchema.optional(), assessment: assessmentInput }).strict(),
  z.object({ action: z.literal('set_status'), assessmentId: idSchema, status: z.enum(['draft', 'published', 'archived']) }).strict(),
  z.object({ action: z.literal('list_course'), courseId: idSchema }).strict(),
  z.object({ action: z.literal('get_for_edit'), assessmentId: idSchema }).strict(),
  z.object({ action: z.literal('release_results'), assessmentId: idSchema }).strict(),
  z.object({ action: z.literal('list_attempts'), assessmentId: idSchema }).strict(),
  z.object({ action: z.literal('evaluation_queue') }).strict(),
  z.object({
    action: z.literal('evaluate'), attemptId: idSchema,
    manualScores: z.record(idSchema, z.number().min(0).max(1000)).default({}),
    questionFeedback: z.record(idSchema, z.string().trim().max(2000)).default({}),
    feedback: z.string().trim().max(4000).optional(),
    finalize: z.boolean(),
  }).strict(),
  z.object({ action: z.literal('return'), attemptId: idSchema, reason: z.string().trim().min(5, 'Tell the student what to correct (at least 5 characters).').max(2000) }).strict(),
  z.object({ action: z.literal('student_list'), courseId: idSchema.optional(), lessonId: idSchema.optional() }).strict(),
  z.object({ action: z.literal('student_get'), assessmentId: idSchema }).strict(),
  z.object({ action: z.literal('start'), assessmentId: idSchema }).strict(),
  z.object({ action: z.literal('save_progress'), attemptId: idSchema, responses: responsesSchema, practical: practicalSchema.optional() }).strict(),
  z.object({ action: z.literal('submit'), attemptId: idSchema, responses: responsesSchema, practical: practicalSchema.optional() }).strict(),
]);

type Input = z.infer<typeof assessmentInput>;
type Services = { db: Firestore; auth: Auth };

/** Validates the assessment's internal consistency and splits off the answer key. */
export function prepareAssessment(input: Input): { fields: Omit<Assessment, 'id' | 'orgId' | 'status' | 'createdById' | 'createdAt' | 'updatedAt'>; key: AssessmentKeyItem[] } {
  if (input.kind === 'exam' && !input.examType) throw invalid('Choose the examination type (demo, practice or final).');
  if (input.kind !== 'exam' && input.examType) throw invalid('Only examinations have an examination type.');
  if (input.kind === 'practical') {
    if (!input.practicalMarks) throw invalid('Give the practical assignment its total marks.');
    if (input.questions.length) throw invalid('A practical assignment has instructions, not questions.');
  } else if (!input.questions.length) throw invalid('Add at least one question.');
  if (input.opensAt && input.closesAt && Date.parse(input.closesAt) <= Date.parse(input.opensAt)) throw invalid('The closing time must be after the opening time.');
  if (input.kind === 'exam' && input.allowLate) throw invalid('Examinations don’t accept late submissions.');
  const allowed = QUESTION_TYPES_FOR[input.kind];
  const ids = new Set<string>();
  const key: AssessmentKeyItem[] = [];
  const questions = input.questions.map((q, i) => {
    const n = `Question ${i + 1}`;
    if (ids.has(q.id)) throw invalid(`${n} repeats an id.`);
    ids.add(q.id);
    if (!allowed.includes(q.type)) throw invalid(`${n}: this kind of activity can’t contain that question type.`);
    if (isAutoQuestion(q)) {
      const opts = q.options ?? [];
      if (opts.length < 2) throw invalid(`${n} needs at least two options.`);
      if (new Set(opts.map((o) => o.id)).size !== opts.length) throw invalid(`${n} repeats an option.`);
      const correct = [...new Set(q.correctOptionIds ?? [])];
      if (!correct.length) throw invalid(`${n}: mark the correct answer.`);
      if (correct.some((c) => !opts.some((o) => o.id === c))) throw invalid(`${n}: the correct answer must be one of its options.`);
      if (q.type === 'mcq_single' && correct.length !== 1) throw invalid(`${n} is single-answer: mark exactly one correct option.`);
      if (q.negativeMarks && !input.negativeMarking) throw invalid(`${n} has negative marks, but negative marking is off.`);
      key.push({ questionId: q.id, correctOptionIds: correct, ...(q.explanation ? { explanation: q.explanation } : {}) });
      return { id: q.id, type: q.type, prompt: q.prompt, options: opts, marks: q.marks, ...(q.negativeMarks ? { negativeMarks: q.negativeMarks } : {}) };
    }
    if (q.options?.length || q.correctOptionIds?.length) throw invalid(`${n} is a written question and can’t have options.`);
    key.push({ questionId: q.id, ...(q.modelAnswer ? { modelAnswer: q.modelAnswer } : {}), ...(q.explanation ? { explanation: q.explanation } : {}) });
    return { id: q.id, type: q.type, prompt: q.prompt, marks: q.marks };
  });
  const base = {
    courseId: input.courseId, kind: input.kind, title: input.title, description: input.description, instructions: input.instructions,
    questions, passingPercent: input.passingPercent, maxAttempts: input.maxAttempts, allowLate: input.allowLate,
    allowResubmission: input.allowResubmission, negativeMarking: input.negativeMarking, resultRelease: input.resultRelease,
    ...(input.moduleId ? { moduleId: input.moduleId } : {}), ...(input.lessonId ? { lessonId: input.lessonId } : {}),
    ...(input.batchIds?.length ? { batchIds: [...new Set(input.batchIds)] } : {}), ...(input.examType ? { examType: input.examType } : {}),
    ...(input.practicalMarks ? { practicalMarks: input.practicalMarks } : {}), ...(input.timeLimitMinutes ? { timeLimitMinutes: input.timeLimitMinutes } : {}),
    ...(input.opensAt ? { opensAt: input.opensAt } : {}), ...(input.closesAt ? { closesAt: input.closesAt } : {}),
  };
  const totalMarks = totalMarksOf({ kind: base.kind, questions: base.questions, practicalMarks: base.practicalMarks });
  if (totalMarks <= 0) throw invalid('The total marks must be more than zero.');
  return { fields: { ...base, totalMarks }, key };
}

async function loadAssessment(db: Firestore, id: string): Promise<Assessment> {
  const a = await getDocData<Assessment>(db, `assessments/${id}`);
  if (!a) throw notFound('That activity');
  return a;
}

async function loadCourse(db: Firestore, id: string): Promise<Course> {
  const c = await getDocData<Course>(db, `courses/${id}`);
  if (!c) throw notFound('That course');
  return c;
}

async function hasAttempts(db: Firestore, assessmentId: string): Promise<boolean> {
  return !(await db.collection('assessmentAttempts').where('assessmentId', '==', assessmentId).limit(1).get()).empty;
}

async function studentAttempts(db: Firestore, assessmentId: string, studentId: string): Promise<AssessmentAttempt[]> {
  const snap = await db.collection('assessmentAttempts').where('assessmentId', '==', assessmentId).where('studentId', '==', studentId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssessmentAttempt)).sort((x, y) => y.attemptNumber - x.attemptNumber);
}

/** Can the student see this assessment at all (enrolled, right batch, published)? */
async function studentAccess(db: Firestore, actor: Actor, a: Assessment) {
  if (actor.role !== 'student' || actor.orgId !== a.orgId) throw notFound('That activity');
  const enrollment = await studentEnrollment(db, a.courseId, actor.id);
  if (!enrollment || a.status === 'draft') throw notFound('That activity');
  if (a.batchIds?.length && !a.batchIds.includes(enrollment.batchId)) throw notFound('That activity');
  return enrollment;
}

/** What a student may see of an attempt: scores only after release, answers only when revealable. */
function studentView(a: Assessment, attempt: AssessmentAttempt, attemptsUsed: number, key: AssessmentKeyItem[] | null) {
  const released = isResultReleased(a, attempt);
  const reveal = released && mayRevealAnswers(a, attempt, attemptsUsed);
  const { manualScores, questionFeedback, score, percent, passed, feedback, autoScore: auto, ...rest } = attempt;
  const autoMarks = (attempt as AssessmentAttempt & { autoMarks?: Record<string, number> }).autoMarks;
  delete (rest as Record<string, unknown>).autoMarks;
  return {
    ...rest,
    released,
    ...(released ? { score, percent, passed, feedback, questionFeedback, manualScores } : {}),
    // A provisional MCQ score is shown for mixed exams still being evaluated, labelled as such.
    ...(!released && attempt.status !== 'in_progress' && a.resultRelease === 'immediate' && auto !== undefined ? { provisionalAutoScore: auto } : {}),
    ...(reveal && key ? { review: key, autoMarks } : {}),
  };
}

function canEvaluateAttempt(actor: Actor, attempt: AssessmentAttempt, batch: Batch | null): boolean {
  if (isAcademyManager(actor, attempt.orgId)) return true;
  if (canManageBranch(actor, attempt.orgId, attempt.branchId)) return true;
  return !!batch && canWorkWithBatch(actor, batch);
}

async function batchesOf(db: Firestore, ids: string[]): Promise<Map<string, Batch>> {
  const unique = [...new Set(ids)];
  const snaps = unique.length ? await db.getAll(...unique.map((id) => db.doc(`batches/${id}`))) : [];
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, { id: s.id, ...s.data() } as Batch]));
}

function cleanResponses(a: Assessment, responses: Record<string, AttemptResponse>): Record<string, AttemptResponse> {
  const out: Record<string, AttemptResponse> = {};
  for (const q of a.questions) {
    const r = responses[q.id];
    if (!r) continue;
    if (isAutoQuestion(q)) {
      const valid = (r.optionIds ?? []).filter((id) => q.options?.some((o) => o.id === id));
      const ids = q.type === 'mcq_single' ? valid.slice(0, 1) : [...new Set(valid)];
      if (ids.length) out[q.id] = { optionIds: ids };
    } else if (r.text?.trim()) out[q.id] = { text: r.text.slice(0, q.type === 'short' ? 2000 : 20000) };
  }
  return out;
}

export async function handleAssessments(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(assessmentRequestSchema, body);
  const { db } = services;
  const now = new Date();
  const iso = now.toISOString();

  switch (req.action) {
    case 'save': {
      const input = req.assessment;
      const course = await loadCourse(db, input.courseId);
      if (!canAuthorAssessments(actor, course)) throw course.orgId === actor.orgId || isSuper(actor) ? denied() : notFound('That course');
      if (input.lessonId) {
        const lesson = await getDocData<Lesson>(db, `lessons/${input.lessonId}`);
        if (!lesson || lesson.courseId !== course.id) throw invalid('That lesson isn’t part of this course.');
        if (input.moduleId && lesson.moduleId !== input.moduleId) throw invalid('That lesson isn’t in this module.');
      }
      if (input.moduleId) {
        const mod = await getDocData<{ courseId: string }>(db, `modules/${input.moduleId}`);
        if (!mod || mod.courseId !== course.id) throw invalid('That module isn’t part of this course.');
      }
      if (input.batchIds?.length) {
        const batches = await batchesOf(db, input.batchIds);
        if (input.batchIds.some((b) => batches.get(b)?.courseId !== course.id)) throw invalid('Every batch must belong to this course.');
      }
      const { fields, key } = prepareAssessment(input);
      const ref = req.assessmentId ? db.doc(`assessments/${req.assessmentId}`) : db.collection('assessments').doc();
      const locked = req.assessmentId ? await hasAttempts(db, req.assessmentId) : false;
      return db.runTransaction(async (tx) => {
        const existing = req.assessmentId ? await tx.get(ref) : null;
        const keyRef = ref.collection('key').doc('current');
        const prevKey = existing?.exists ? (await tx.get(keyRef)).data() : undefined;
        if (existing && !existing.exists) throw notFound('That activity');
        const prev = existing?.data() as Assessment | undefined;
        if (prev && prev.courseId !== course.id) throw invalid('An activity can’t move to another course.');
        if (prev?.status === 'archived') throw conflict('Archived activities can’t be edited.');
        if (prev && locked) {
          const sameQuestions = JSON.stringify(prev.questions) === JSON.stringify(fields.questions) && JSON.stringify(prevKey?.items ?? []) === JSON.stringify(key)
            && prev.kind === fields.kind && prev.negativeMarking === fields.negativeMarking && (prev.practicalMarks ?? null) === (fields.practicalMarks ?? null);
          if (!sameQuestions) throw conflict('Students have already attempted this. Its questions, answers and marks are locked; you can still change dates, attempts and instructions.', 'locked');
        }
        const doc: Record<string, unknown> = { ...fields, orgId: course.orgId, updatedAt: iso };
        if (prev) {
          // Optional settings that were cleared are removed.
          for (const k of OPTIONAL_FIELDS) if (!(k in fields) && k in prev) doc[k] = FieldValue.delete();
          tx.update(ref, doc);
        } else tx.create(ref, { ...doc, status: 'draft', createdById: actor.id, createdAt: iso });
        tx.set(keyRef, { orgId: course.orgId, assessmentId: ref.id, items: key, updatedById: actor.id, updatedAt: iso });
        tx.create(db.collection('auditLog').doc(), {
          orgId: course.orgId, courseId: course.id, targetType: 'assessment', targetId: ref.id, action: prev ? 'assessment_edit' : 'assessment_create',
          actorId: actor.id, actorRole: actor.role, questionCount: fields.questions.length, totalMarks: fields.totalMarks, at: FieldValue.serverTimestamp(),
        });
        return { assessmentId: ref.id, totalMarks: fields.totalMarks };
      });
    }

    case 'set_status': {
      const a = await loadAssessment(db, req.assessmentId);
      const course = await loadCourse(db, a.courseId);
      if (!canAuthorAssessments(actor, course)) throw a.orgId === actor.orgId ? denied() : notFound('That activity');
      if (a.status === req.status) throw conflict(`It is already ${req.status}.`);
      if (req.status === 'draft' && await hasAttempts(db, a.id)) throw conflict('Students have attempted this, so it can’t go back to draft. Archive it instead.');
      await db.runTransaction(async (tx) => {
        tx.update(db.doc(`assessments/${a.id}`), { status: req.status, updatedAt: iso });
        tx.create(db.collection('auditLog').doc(), {
          orgId: a.orgId, courseId: a.courseId, targetType: 'assessment', targetId: a.id, action: `assessment_${req.status}`,
          actorId: actor.id, actorRole: actor.role, fromStatus: a.status, toStatus: req.status, at: FieldValue.serverTimestamp(),
        });
      });
      return { ok: true };
    }

    case 'list_course': {
      const course = await loadCourse(db, req.courseId);
      assertOrg(actor, course.orgId, 'That course');
      const author = canAuthorAssessments(actor, course);
      if (!author && !['branch_admin', 'instructor'].includes(actor.role)) throw denied();
      const snap = await db.collection('assessments').where('orgId', '==', course.orgId).where('courseId', '==', course.id).get();
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Assessment)).filter((a) => author || a.status !== 'draft');
      return { canAuthor: author, assessments: items.sort((x, y) => x.createdAt.localeCompare(y.createdAt)) };
    }

    case 'get_for_edit': {
      const a = await loadAssessment(db, req.assessmentId);
      const course = await loadCourse(db, a.courseId);
      if (!canAuthorAssessments(actor, course)) throw a.orgId === actor.orgId ? denied() : notFound('That activity');
      const key = (await db.doc(`assessments/${a.id}/key/current`).get()).data()?.items ?? [];
      return { assessment: a, key, locked: await hasAttempts(db, a.id) };
    }

    case 'release_results': {
      const a = await loadAssessment(db, req.assessmentId);
      const course = await loadCourse(db, a.courseId);
      // Releasing affects every batch and branch, so it is limited to the assessment's authors and academy administrators.
      if (!canAuthorAssessments(actor, course) && !isAcademyManager(actor, a.orgId)) throw a.orgId === actor.orgId ? denied('Only the assessment’s authors and academy administrators release results.') : notFound('That activity');
      if (a.resultRelease !== 'manual') throw conflict('This activity releases results automatically.');
      if (a.resultsReleasedAt) throw conflict('Results are already released.');
      await db.runTransaction(async (tx) => {
        tx.update(db.doc(`assessments/${a.id}`), { resultsReleasedAt: iso, updatedAt: iso });
        tx.create(db.collection('auditLog').doc(), {
          orgId: a.orgId, courseId: a.courseId, targetType: 'assessment', targetId: a.id, action: 'assessment_results_released',
          actorId: actor.id, actorRole: actor.role, at: FieldValue.serverTimestamp(),
        });
      });
      return { ok: true, resultsReleasedAt: iso };
    }

    case 'list_attempts': {
      const a = await loadAssessment(db, req.assessmentId);
      assertOrg(actor, a.orgId, 'That activity');
      const snap = await db.collection('assessmentAttempts').where('assessmentId', '==', a.id).get();
      const attempts = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssessmentAttempt));
      const batches = await batchesOf(db, attempts.map((t) => t.batchId));
      const visible = attempts.filter((t) => canEvaluateAttempt(actor, t, batches.get(t.batchId) ?? null));
      const author = canAuthorAssessments(actor, await loadCourse(db, a.courseId));
      if (!visible.length && !author && !['branch_admin', 'instructor'].includes(actor.role)) throw denied();
      // The key goes only to authors and to evaluators who have submissions to mark.
      const key = author || visible.length ? (await db.doc(`assessments/${a.id}/key/current`).get()).data()?.items ?? [] : [];
      return { assessment: a, key, attempts: visible.filter((t) => t.status !== 'in_progress').sort((x, y) => (y.submittedAt ?? '').localeCompare(x.submittedAt ?? '')) };
    }

    case 'evaluation_queue': {
      let docs: AssessmentAttempt[] = [];
      const pending = ['submitted', 'under_evaluation'];
      const col = db.collection('assessmentAttempts');
      if (isSuper(actor) || actor.role === 'university_admin') {
        docs = (await col.where('orgId', '==', actor.orgId).where('status', 'in', pending).get()).docs.map((d) => ({ id: d.id, ...d.data() } as AssessmentAttempt));
      } else if (actor.role === 'branch_admin' && actor.branchId) {
        docs = (await col.where('orgId', '==', actor.orgId).where('branchId', '==', actor.branchId).where('status', 'in', pending).get()).docs.map((d) => ({ id: d.id, ...d.data() } as AssessmentAttempt));
      } else if (actor.role === 'instructor') {
        const batchIds = (await db.collection('batches').where('orgId', '==', actor.orgId).where('instructorUserIds', 'array-contains', actor.id).get()).docs.map((d) => d.id);
        for (let i = 0; i < batchIds.length; i += 10) {
          const chunk = batchIds.slice(i, i + 10);
          const snap = await col.where('batchId', 'in', chunk).get();
          docs.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssessmentAttempt)).filter((t) => pending.includes(t.status)));
        }
      } else throw denied();
      return {
        attempts: docs.map(({ responses: _r, practical: _p, ...t }) => { void _r; void _p; return t; })
          .sort((x, y) => (x.submittedAt ?? '').localeCompare(y.submittedAt ?? '')),
      };
    }

    case 'evaluate':
    case 'return': {
      const ref = db.doc(`assessmentAttempts/${req.attemptId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That submission');
        const attempt = { id: snap.id, ...snap.data() } as AssessmentAttempt;
        assertOrg(actor, attempt.orgId, 'That submission');
        const batchSnap = await tx.get(db.doc(`batches/${attempt.batchId}`));
        const batch = batchSnap.exists ? ({ id: batchSnap.id, ...batchSnap.data() } as Batch) : null;
        if (!canEvaluateAttempt(actor, attempt, batch)) throw denied('Only this batch’s instructors and branch managers can evaluate it.');
        const aSnap = await tx.get(db.doc(`assessments/${attempt.assessmentId}`));
        const a = { id: aSnap.id, ...aSnap.data() } as Assessment;
        if (!['submitted', 'under_evaluation', ...(req.action === 'evaluate' ? ['evaluated'] : [])].includes(attempt.status)) {
          throw conflict(attempt.status === 'in_progress' ? 'The student hasn’t submitted yet.' : 'This submission can’t be changed now.');
        }
        const link = `/courses/${attempt.courseId}/activities/${attempt.assessmentId}`;
        if (req.action === 'return') {
          if (!a.allowResubmission) throw conflict('This activity doesn’t allow resubmission.');
          tx.update(ref, { status: 'returned', returnedReason: req.reason, evaluatedById: actor.id, evaluatedAt: iso });
          notify(tx, db, { orgId: attempt.orgId, userId: attempt.studentId, type: 'assessment_returned', title: `“${attempt.title}” needs corrections`, body: req.reason, link, sourceId: attempt.id });
          tx.create(db.collection('auditLog').doc(), {
            orgId: attempt.orgId, courseId: attempt.courseId, targetType: 'assessment_attempt', targetId: attempt.id, action: 'attempt_returned',
            actorId: actor.id, actorRole: actor.role, studentId: attempt.studentId, at: FieldValue.serverTimestamp(),
          });
          return { status: 'returned' };
        }
        // Manual marks: only for written questions (and the practical), within each question's marks.
        const manual: Record<string, number> = {};
        const manualIds = a.kind === 'practical' ? ['practical'] : a.questions.filter((q) => !isAutoQuestion(q)).map((q) => q.id);
        for (const [qid, marks] of Object.entries(req.manualScores)) {
          if (!manualIds.includes(qid)) throw invalid('Only written answers and practical work are marked by hand.');
          const max = qid === 'practical' ? a.practicalMarks ?? 0 : a.questions.find((q) => q.id === qid)!.marks;
          if (marks > max) throw invalid(`A mark can’t be more than ${max}.`);
          manual[qid] = roundMarks(marks);
        }
        if (attempt.status === 'evaluated' && !req.finalize) throw conflict('This is already evaluated; save the corrected marks as final.');
        if (req.finalize && manualIds.some((id) => manual[id] === undefined)) throw invalid('Give marks for every written answer before finalizing.');
        const manualTotal = Object.values(manual).reduce((s, m) => s + m, 0);
        const result = finalResult(attempt.totalMarks, a.passingPercent, attempt.autoScore ?? 0, manualTotal);
        tx.update(ref, {
          manualScores: manual, questionFeedback: req.questionFeedback, ...(req.feedback !== undefined ? { feedback: req.feedback } : {}),
          status: req.finalize ? 'evaluated' : 'under_evaluation', evaluatedById: actor.id, evaluatedAt: iso,
          ...(req.finalize ? result : {}),
        });
        if (req.finalize) {
          notify(tx, db, { orgId: attempt.orgId, userId: attempt.studentId, type: 'assessment_evaluated', title: `“${attempt.title}” was evaluated`, body: isResultReleased(a, { status: 'evaluated' }) ? `You scored ${result.score} / ${attempt.totalMarks}.` : 'Your result will be shown when results are released.', link, sourceId: attempt.id });
          tx.create(db.collection('auditLog').doc(), {
            orgId: attempt.orgId, courseId: attempt.courseId, targetType: 'assessment_attempt', targetId: attempt.id,
            action: attempt.status === 'evaluated' ? 'attempt_regraded' : 'attempt_evaluated', actorId: actor.id, actorRole: actor.role,
            studentId: attempt.studentId, score: result.score, ...(attempt.status === 'evaluated' ? { previousScore: attempt.score } : {}), at: FieldValue.serverTimestamp(),
          });
        }
        return { status: req.finalize ? 'evaluated' : 'under_evaluation', ...result };
      });
    }

    case 'student_list': {
      if (actor.role !== 'student') throw denied();
      const enrollments = (await db.collection('enrollments').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get()).docs
        .map((d) => d.data() as { courseId: string; batchId: string; status: string })
        .filter((e) => (e.status === 'active' || e.status === 'completed') && (!req.courseId || e.courseId === req.courseId));
      const out: unknown[] = [];
      const attempts = (await db.collection('assessmentAttempts').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).get()).docs
        .map((d) => ({ id: d.id, ...d.data() } as AssessmentAttempt));
      for (const e of enrollments) {
        let q = db.collection('assessments').where('orgId', '==', actor.orgId).where('courseId', '==', e.courseId).where('status', '==', 'published');
        if (req.lessonId) q = q.where('lessonId', '==', req.lessonId);
        for (const d of (await q.get()).docs) {
          const a = { id: d.id, ...d.data() } as Assessment;
          if (a.batchIds?.length && !a.batchIds.includes(e.batchId)) continue;
          const mine = attempts.filter((t) => t.assessmentId === a.id).sort((x, y) => y.attemptNumber - x.attemptNumber);
          const latest = mine[0];
          const released = latest ? isResultReleased(a, latest) : false;
          out.push({
            id: a.id, courseId: a.courseId, lessonId: a.lessonId, moduleId: a.moduleId, kind: a.kind, examType: a.examType, title: a.title,
            totalMarks: a.totalMarks, passingPercent: a.passingPercent, opensAt: a.opensAt, closesAt: a.closesAt, timeLimitMinutes: a.timeLimitMinutes,
            maxAttempts: a.maxAttempts, attemptsUsed: mine.length, status: latest?.status ?? 'not_started', late: latest?.late ?? false,
            ...(released ? { score: latest.score, percent: latest.percent, passed: latest.passed } : {}),
            canStart: canStartAttempt(a, mine, now).ok,
          });
        }
      }
      return { assessments: out };
    }

    case 'student_get': {
      const a = await loadAssessment(db, req.assessmentId);
      await studentAccess(db, actor, a);
      const mine = await studentAttempts(db, a.id, actor.id);
      const needKey = mine.some((t) => mayRevealAnswers(a, t, mine.length, now));
      const key = needKey ? ((await db.doc(`assessments/${a.id}/key/current`).get()).data()?.items as AssessmentKeyItem[]) ?? [] : null;
      const decision = canStartAttempt(a, mine, now);
      return {
        assessment: a,
        attempts: mine.map((t) => studentView(a, t, mine.length, key)),
        canStart: decision.ok, startBlockedReason: decision.ok ? null : decision.reason,
      };
    }

    case 'start': {
      const a = await loadAssessment(db, req.assessmentId);
      const enrollment = await studentAccess(db, actor, a);
      if (enrollment.status !== 'active') throw conflict('Your enrollment in this course isn’t active.');
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(db.collection('assessmentAttempts').where('assessmentId', '==', a.id).where('studentId', '==', actor.id));
        const mine = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssessmentAttempt)).sort((x, y) => y.attemptNumber - x.attemptNumber);
        if (mine[0]?.status === 'in_progress') return { attemptId: mine[0].id, resumed: true };
        const decision = canStartAttempt(a, mine, now);
        if (!decision.ok) throw conflict(decision.reason);
        const n = (mine[0]?.attemptNumber ?? 0) + 1;
        const ref = db.doc(`assessmentAttempts/${a.id}_${actor.id}_${n}`);
        let deadline: number | null = a.timeLimitMinutes ? now.getTime() + a.timeLimitMinutes * 60_000 : null;
        if (a.kind === 'exam' && a.closesAt) deadline = Math.min(deadline ?? Infinity, Date.parse(a.closesAt));
        tx.create(ref, {
          assessmentId: a.id, orgId: a.orgId, branchId: enrollment.branchId, courseId: a.courseId, batchId: enrollment.batchId,
          studentId: actor.id, studentName: actor.displayName || actor.email, kind: a.kind, ...(a.examType ? { examType: a.examType } : {}),
          title: a.title, attemptNumber: n, status: 'in_progress', resubmission: decision.resubmission, late: decision.late,
          startedAt: iso, ...(deadline && Number.isFinite(deadline) ? { deadlineAt: new Date(deadline).toISOString() } : {}),
          responses: {}, totalMarks: a.totalMarks,
        });
        return { attemptId: ref.id, resumed: false };
      });
    }

    case 'save_progress':
    case 'submit': {
      const ref = db.doc(`assessmentAttempts/${req.attemptId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const attempt = snap.exists ? ({ id: snap.id, ...snap.data() } as AssessmentAttempt) : null;
        if (!attempt || attempt.studentId !== actor.id) throw notFound('That attempt');
        if (attempt.status !== 'in_progress') throw conflict('This attempt has already been submitted.');
        const aSnap = await tx.get(db.doc(`assessments/${attempt.assessmentId}`));
        const a = { id: aSnap.id, ...aSnap.data() } as Assessment;
        if (a.status !== 'published') throw conflict('This activity is closed.');
        const overTime = attempt.deadlineAt ? now.getTime() > Date.parse(attempt.deadlineAt) + TIME_GRACE_MS : false;
        // After the time limit (plus a short grace for network delay) only the answers autosaved in time count.
        const responses = overTime ? cleanResponses(a, attempt.responses ?? {}) : cleanResponses(a, req.responses);
        const submittedPractical = overTime ? attempt.practical : req.practical;
        const practical = a.kind === 'practical' && submittedPractical ? Object.fromEntries(Object.entries(submittedPractical).filter(([, v]) => v)) : undefined;
        if (req.action === 'save_progress') {
          if (overTime) throw conflict('Time is up. Submit your answers now.', 'time_up');
          tx.update(ref, { responses, ...(practical ? { practical } : {}) });
          return { saved: true };
        }
        if (a.kind === 'practical' && !overTime && !practical?.text && !practical?.repoUrl && !practical?.liveUrl) throw invalid('Add your work: a description, a repository link or a live link.');
        const late = attempt.late || (!!a.closesAt && a.kind !== 'exam' && now.getTime() > Date.parse(a.closesAt));
        const keySnap = await tx.get(db.doc(`assessments/${a.id}/key/current`));
        const auto = autoScore(a, (keySnap.data()?.items ?? []) as AssessmentKeyItem[], responses);
        const manual = needsManualEvaluation(a);
        const autoMarks = Object.fromEntries(Object.entries(auto.perQuestion).map(([k, v]) => [k, v.marks]));
        const update: Record<string, unknown> = {
          responses, ...(practical ? { practical } : {}), submittedAt: iso, late, ...(overTime ? { overTime: true } : {}),
          autoScore: auto.score, autoMarks, status: manual ? 'submitted' : 'evaluated',
        };
        if (!manual) Object.assign(update, finalResult(attempt.totalMarks, a.passingPercent, auto.score, 0), { evaluatedAt: iso });
        tx.update(ref, update);
        const after = { ...attempt, ...update } as AssessmentAttempt;
        const released = isResultReleased(a, after, now);
        return { status: update.status, released, ...(released ? { score: update.score, percent: update.percent, passed: update.passed } : {}) };
      });
    }
  }
}

/**
 * Strynkix LMS — Stage C4 legacy quiz migration: pure classification and plan.
 *
 * Legacy lessons (saved before C1) keep each question's correctOptionId and
 * explanation inline in lesson.blocks, which students can read. The migration
 * moves those answers into the confidential lessons/{id}/answerKey/current and
 * strips them from the blocks, leaving questions, options, hints, ids and order
 * untouched. Anything ambiguous or invalid is reported for manual remediation
 * and never changed. Reports carry ids and reason codes only — never answers.
 */

import { AnswerKeyItem, LessonAnswerKey, LessonBlock, QuizBlock, ReviewState } from '@/types/domain';
import { MAX_QUIZ_QUESTIONS, answerKeyItemSchema, lessonBlockSchema } from '@/types/validation';
import { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from '@/lib/firebase/project-ids';

export type QuizFormat =
  | 'no_quiz'               // nothing to migrate
  | 'keyed'                 // C1 format: answer-free blocks + matching key (already migrated)
  | 'legacy_inline'         // answers inline, no key → migrate
  | 'inline_matches_key'    // answers inline AND an identical key → strip only
  | 'conflict'              // inline answers disagree with the key → manual
  | 'malformed';            // missing, partial or invalid answers → manual

export type QuizIssue =
  | 'question_without_answer'
  | 'partial_inline_answer'
  | 'inline_option_not_found'
  | 'key_option_not_found'
  | 'explanation_invalid'
  | 'duplicate_question_id'
  | 'too_many_questions'
  | 'key_scope_mismatch'
  | 'key_for_missing_question'
  | 'orphan_key_without_questions'
  | 'inline_conflicts_with_key'
  | 'invalid_question_block';

export interface LessonQuizState {
  lessonId: string;
  orgId: string;
  courseId: string;
  status: string;
  reviewState: ReviewState;
  blocks: LessonBlock[];
  currentKey: Pick<LessonAnswerKey, 'orgId' | 'courseId' | 'lessonId' | 'keyVersion' | 'items'> | null;
}

export interface QuizMigrationDecision {
  lessonId: string;
  orgId: string;
  courseId: string;
  status: string;
  format: QuizFormat;
  action: 'none' | 'migrate' | 'manual';
  issues: QuizIssue[];
  questionCount: number;
  /** The draft was in review or approved; its approval fingerprint no longer matches (it must be re-reviewed). */
  approvalInvalidated: boolean;
  /** Present when action === 'migrate'. */
  plan?: { blocks: LessonBlock[]; items: AnswerKeyItem[]; keyVersion: number; writeKey: boolean };
}

const isQuiz = (b: LessonBlock): b is QuizBlock => b.type === 'quiz';
const hasInline = (q: QuizBlock) => q.correctOptionId !== undefined || q.explanation !== undefined;

function strip(blocks: LessonBlock[]): LessonBlock[] {
  return blocks.map((b) => {
    if (!isQuiz(b)) return b;
    const { correctOptionId: _c, explanation: _e, ...question } = b;
    void _c;
    void _e;
    return question as QuizBlock;
  });
}

const sameItem = (a: AnswerKeyItem, b: AnswerKeyItem) => a.correctOptionId === b.correctOptionId && a.explanation === b.explanation;

export function classifyLessonQuiz(state: LessonQuizState): QuizMigrationDecision {
  const blocks = state.blocks ?? [];
  const questions = blocks.filter(isQuiz);
  const key = state.currentKey;
  const keyItems = key && Array.isArray(key.items) ? key.items : [];
  const base = {
    lessonId: state.lessonId, orgId: state.orgId, courseId: state.courseId, status: state.status,
    questionCount: questions.length, approvalInvalidated: false,
  };
  const manual = (format: QuizFormat, issues: QuizIssue[]): QuizMigrationDecision => ({ ...base, format, action: 'manual', issues: [...new Set(issues)] });

  if (questions.length === 0) {
    // A non-empty key with no questions makes the lesson impossible to complete.
    return keyItems.length > 0 ? manual('malformed', ['orphan_key_without_questions']) : { ...base, format: 'no_quiz', action: 'none', issues: [] };
  }

  const issues: QuizIssue[] = [];
  if (questions.length > MAX_QUIZ_QUESTIONS) issues.push('too_many_questions');
  if (new Set(questions.map((q) => q.id)).size !== questions.length) issues.push('duplicate_question_id');
  if (key && (key.orgId !== state.orgId || key.courseId !== state.courseId || key.lessonId !== state.lessonId)) issues.push('key_scope_mismatch');
  for (const q of strip(questions)) if (!lessonBlockSchema.safeParse(q).success) issues.push('invalid_question_block');

  const keyById = new Map(keyItems.map((i) => [i.blockId, i]));
  for (const i of keyItems) if (!questions.some((q) => q.id === i.blockId)) issues.push('key_for_missing_question');

  const items: AnswerKeyItem[] = [];
  let conflict = false;
  for (const q of questions) {
    // A block without an options list can't be checked or migrated; report it, don't crash.
    if (!Array.isArray(q.options)) { issues.push('invalid_question_block'); continue; }
    const keyed = keyById.get(q.id);
    let item: AnswerKeyItem | undefined;
    if (hasInline(q)) {
      if (typeof q.correctOptionId !== 'string' || typeof q.explanation !== 'string') { issues.push('partial_inline_answer'); continue; }
      if (!q.options.some((o) => o.id === q.correctOptionId)) { issues.push('inline_option_not_found'); continue; }
      item = { blockId: q.id, correctOptionId: q.correctOptionId, explanation: q.explanation };
      if (keyed && !sameItem(item, keyed)) conflict = true;
    } else if (keyed) {
      if (!q.options.some((o) => o.id === keyed.correctOptionId)) { issues.push('key_option_not_found'); continue; }
      item = { blockId: q.id, correctOptionId: keyed.correctOptionId, explanation: keyed.explanation };
    } else {
      issues.push('question_without_answer');
      continue;
    }
    if (!answerKeyItemSchema.safeParse(item).success) issues.push('explanation_invalid');
    items.push(item);
  }

  if (conflict) return manual('conflict', ['inline_conflicts_with_key', ...issues]);
  if (issues.length) return manual('malformed', issues);

  const inline = questions.some(hasInline);
  if (!inline) return { ...base, format: 'keyed', action: 'none', issues: [] };

  const keyMatches = Boolean(key) && keyItems.length === items.length;
  return {
    ...base,
    format: keyMatches ? 'inline_matches_key' : 'legacy_inline',
    action: 'migrate',
    issues: [],
    approvalInvalidated: state.reviewState === 'in_review' || state.reviewState === 'approved',
    plan: {
      blocks: strip(blocks),
      items,
      // An identical key keeps its version; a missing or partial key gets the next one.
      keyVersion: keyMatches ? key!.keyVersion : (key?.keyVersion ?? 0) + 1,
      writeKey: !keyMatches,
    },
  };
}

export interface QuizMigrationSummary {
  lessons: number;
  byFormat: Record<QuizFormat, number>;
  toMigrate: number;
  manual: Array<{ lessonId: string; format: QuizFormat; issues: QuizIssue[] }>;
  approvalsInvalidated: string[];
}

export function summarizeQuizMigration(decisions: QuizMigrationDecision[]): QuizMigrationSummary {
  const byFormat: Record<QuizFormat, number> = { no_quiz: 0, keyed: 0, legacy_inline: 0, inline_matches_key: 0, conflict: 0, malformed: 0 };
  for (const d of decisions) byFormat[d.format] += 1;
  return {
    lessons: decisions.length,
    byFormat,
    toMigrate: decisions.filter((d) => d.action === 'migrate').length,
    manual: decisions.filter((d) => d.action === 'manual').map((d) => ({ lessonId: d.lessonId, format: d.format, issues: d.issues })),
    approvalsInvalidated: decisions.filter((d) => d.approvalInvalidated).map((d) => d.lessonId),
  };
}

/** True when blocks still carry any answer-bearing field (revisions, versions, post-checks). */
export function blocksExposeAnswers(blocks: LessonBlock[] | undefined): boolean {
  return (blocks ?? []).some((b) => isQuiz(b) && hasInline(b));
}

export { STAGING_PROJECT_ID };

export interface MigrationTarget {
  target: 'emulator' | 'staging';
  projectId: string;
  apply: boolean;
}

/**
 * Validates where the migration may run before anything connects. Production
 * is always refused. Applying needs a local emulator, or staging with an
 * explicit confirmation flag (reserved for an approved staging run).
 */
export function assertMigrationTarget(
  opts: { target?: string; projectId?: string; apply: boolean; confirmStagingWrite: boolean },
  env: Record<string, string | undefined>
): MigrationTarget {
  const { target, projectId, apply } = opts;
  if (!projectId) throw new Error('--project is required (it is never inferred from .env files).');
  if (projectId === PRODUCTION_PROJECT_ID) throw new Error('Refusing to run against the production project.');
  if (target === 'emulator') {
    const host = env.FIRESTORE_EMULATOR_HOST ?? '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) throw new Error('--target emulator requires FIRESTORE_EMULATOR_HOST to point at a local emulator.');
    return { target, projectId, apply };
  }
  if (target === 'staging') {
    if (projectId !== STAGING_PROJECT_ID) throw new Error(`--target staging only accepts ${STAGING_PROJECT_ID}.`);
    if (env.FIRESTORE_EMULATOR_HOST) throw new Error('--target staging must not run with FIRESTORE_EMULATOR_HOST set.');
    if (apply && !opts.confirmStagingWrite) throw new Error('Writing to staging needs --confirm-staging-write (approved runs only).');
    return { target, projectId, apply };
  }
  throw new Error('--target must be "emulator" or "staging".');
}

/**
 * Stage C4 — legacy quiz classification, plan validation and target guards (pure).
 */

import { describe, it, expect } from 'vitest';
import { LessonQuizState, assertMigrationTarget, blocksExposeAnswers, classifyLessonQuiz, summarizeQuizMigration } from '@/lib/migration/quiz-key-migration';
import { LessonBlock, QuizBlock } from '@/types/domain';

const text: LessonBlock = { id: 't1', type: 'text', content: 'Intro' };
const q = (id: string, extra: Partial<QuizBlock> = {}): QuizBlock => ({
  id, type: 'quiz', question: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], hint: 'Think.', ...extra,
});
const inline = (id: string, correct = 'a') => q(id, { correctOptionId: correct, explanation: `Because ${correct}.` });
const item = (blockId: string, correct = 'a') => ({ blockId, correctOptionId: correct, explanation: `Because ${correct}.` });
const state = (blocks: LessonBlock[], key: LessonQuizState['currentKey'] = null, extra: Partial<LessonQuizState> = {}): LessonQuizState => ({
  lessonId: 'l1', orgId: 'org_a', courseId: 'c1', status: 'published', reviewState: 'none', blocks, currentKey: key, ...extra,
});
const key = (items: ReturnType<typeof item>[], keyVersion = 3) => ({ orgId: 'org_a', courseId: 'c1', lessonId: 'l1', keyVersion, items });

describe('classifyLessonQuiz — every discovered format', () => {
  it('no quiz: nothing to do', () => {
    expect(classifyLessonQuiz(state([text]))).toMatchObject({ format: 'no_quiz', action: 'none' });
  });

  it('keyed (C1 format, already migrated): nothing to do', () => {
    expect(classifyLessonQuiz(state([text, q('q1')], key([item('q1')])))).toMatchObject({ format: 'keyed', action: 'none' });
  });

  it('legacy inline: answers move to a new key, questions are preserved exactly', () => {
    const d = classifyLessonQuiz(state([text, inline('q1', 'b'), inline('q2')]));
    expect(d).toMatchObject({ format: 'legacy_inline', action: 'migrate', questionCount: 2 });
    expect(d.plan).toMatchObject({ keyVersion: 1, writeKey: true, items: [item('q1', 'b'), item('q2')] });
    expect(d.plan!.blocks).toEqual([text, q('q1'), q('q2')]);
    expect(blocksExposeAnswers(d.plan!.blocks)).toBe(false);
  });

  it('inline answers identical to an existing key: strip only, key version kept', () => {
    const d = classifyLessonQuiz(state([inline('q1')], key([item('q1')])));
    expect(d).toMatchObject({ format: 'inline_matches_key', action: 'migrate', plan: { writeKey: false, keyVersion: 3 } });
  });

  it('partly keyed, partly inline: one merged key at the next version', () => {
    const d = classifyLessonQuiz(state([q('q1'), inline('q2', 'b')], key([item('q1')])));
    expect(d).toMatchObject({ format: 'legacy_inline', plan: { writeKey: true, keyVersion: 4, items: [item('q1'), item('q2', 'b')] } });
  });

  it('inline answers that disagree with the key are a conflict for manual review', () => {
    const d = classifyLessonQuiz(state([inline('q1', 'b')], key([item('q1', 'a')])));
    expect(d).toMatchObject({ format: 'conflict', action: 'manual', issues: ['inline_conflicts_with_key'] });
    expect(d.plan).toBeUndefined();
  });

  const malformed: Array<[string, LessonQuizState, string]> = [
    ['a question with no answer anywhere', state([inline('q1'), q('q2')]), 'question_without_answer'],
    ['a correct answer without an explanation', state([q('q1', { correctOptionId: 'a' })]), 'partial_inline_answer'],
    ['an explanation without a correct answer', state([q('q1', { explanation: 'Because.' })]), 'partial_inline_answer'],
    ['a correct answer that is not an option', state([inline('q1', 'z')]), 'inline_option_not_found'],
    ['a key pointing at a missing option', state([q('q1')], key([item('q1', 'z')])), 'key_option_not_found'],
    ['an explanation too short to validate', state([q('q1', { correctOptionId: 'a', explanation: 'ok' })]), 'explanation_invalid'],
    ['duplicate question ids', state([inline('q1'), inline('q1')]), 'duplicate_question_id'],
    ['more than 20 questions', state(Array.from({ length: 21 }, (_, i) => inline(`q${i}`))), 'too_many_questions'],
    ['a key of another lesson', state([inline('q1')], { ...key([item('q1')]), lessonId: 'other' }), 'key_scope_mismatch'],
    ['a key for a question that no longer exists', state([inline('q1')], key([item('q1'), item('q9')])), 'key_for_missing_question'],
    ['a key on a lesson with no questions', state([text], key([item('q1')])), 'orphan_key_without_questions'],
    ['a question block that fails validation', state([inline('q1'), { ...inline('q2'), options: [{ id: 'a', text: 'A' }] }]), 'invalid_question_block'],
    // Regression (found in the restore rehearsal): this used to throw and abort the whole inventory.
    ['a quiz block with no options list at all', state([{ id: 'q1', type: 'quiz', question: 'Question q1?', correctOptionId: 'a', explanation: 'Because a.' } as unknown as QuizBlock]), 'invalid_question_block'],
  ];
  for (const [name, s, issue] of malformed) {
    it(`malformed: ${name} → manual, untouched`, () => {
      const d = classifyLessonQuiz(s);
      expect(d.action).toBe('manual');
      expect(d.issues).toContain(issue);
      expect(d.plan).toBeUndefined();
    });
  }

  it('flags approvals that the migration invalidates', () => {
    expect(classifyLessonQuiz(state([inline('q1')], null, { status: 'draft', reviewState: 'approved' })).approvalInvalidated).toBe(true);
    expect(classifyLessonQuiz(state([inline('q1')])).approvalInvalidated).toBe(false);
  });

  it('is idempotent: a migrated lesson classifies as keyed', () => {
    const d = classifyLessonQuiz(state([text, inline('q1')]));
    const again = classifyLessonQuiz(state(d.plan!.blocks, key(d.plan!.items, d.plan!.keyVersion)));
    expect(again).toMatchObject({ format: 'keyed', action: 'none' });
  });

  it('summaries carry ids, formats and reason codes only — never answers', () => {
    const s = summarizeQuizMigration([classifyLessonQuiz(state([inline('q1', 'b')])), classifyLessonQuiz(state([inline('q1', 'z')], null, { lessonId: 'l2' }))]);
    expect(s).toMatchObject({ lessons: 2, toMigrate: 1, manual: [{ lessonId: 'l2', format: 'malformed' }] });
    expect(JSON.stringify(s)).not.toContain('Because');
  });
});

describe('assertMigrationTarget', () => {
  const emu = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
  const opts = (o: Partial<Parameters<typeof assertMigrationTarget>[0]>) => ({ apply: false, confirmStagingWrite: false, ...o });
  it('always refuses the production project, even on an emulator', () => {
    expect(() => assertMigrationTarget(opts({ target: 'emulator', projectId: 'learning-management-syst-b9bf3', apply: true }), emu)).toThrow(/production/);
    expect(() => assertMigrationTarget(opts({ target: 'staging', projectId: 'learning-management-syst-b9bf3' }), {})).toThrow(/production/);
  });
  it('requires an explicit project and target', () => {
    expect(() => assertMigrationTarget(opts({ target: 'emulator' }), emu)).toThrow(/--project/);
    expect(() => assertMigrationTarget(opts({ projectId: 'demo-x' }), emu)).toThrow(/--target/);
  });
  it('emulator target needs a local emulator host', () => {
    expect(assertMigrationTarget(opts({ target: 'emulator', projectId: 'demo-x', apply: true }), emu)).toMatchObject({ apply: true });
    expect(() => assertMigrationTarget(opts({ target: 'emulator', projectId: 'demo-x' }), {})).toThrow(/local emulator/);
    expect(() => assertMigrationTarget(opts({ target: 'emulator', projectId: 'demo-x' }), { FIRESTORE_EMULATOR_HOST: 'firestore.example.com:443' })).toThrow(/local emulator/);
  });
  it('staging: only the staging project, never via the emulator, and writes need confirmation', () => {
    expect(assertMigrationTarget(opts({ target: 'staging', projectId: 'strynkix-live-books-staging' }), {})).toMatchObject({ apply: false });
    expect(() => assertMigrationTarget(opts({ target: 'staging', projectId: 'other-project' }), {})).toThrow(/only accepts/);
    expect(() => assertMigrationTarget(opts({ target: 'staging', projectId: 'strynkix-live-books-staging' }), emu)).toThrow(/FIRESTORE_EMULATOR_HOST/);
    expect(() => assertMigrationTarget(opts({ target: 'staging', projectId: 'strynkix-live-books-staging', apply: true }), {})).toThrow(/confirm-staging-write/);
    expect(assertMigrationTarget(opts({ target: 'staging', projectId: 'strynkix-live-books-staging', apply: true, confirmStagingWrite: true }), {})).toMatchObject({ apply: true });
  });
});

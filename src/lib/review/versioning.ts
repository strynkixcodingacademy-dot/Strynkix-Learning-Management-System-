/**
 * Strynkix LMS — what a publish writes (Stage C3). Pure; the review route
 * applies it in the same transaction as the status change and audit entry.
 *
 * The published blocks never carry answers: inline (legacy) answers are moved
 * into the key. Every quiz question must have exactly one key item, so a
 * version can never be graded against a key that doesn't match its questions.
 * The key version only advances when the answers actually change, so attempts
 * keep naming the key they were graded against.
 */

import { AnswerKeyItem, Course, LessonAnswerKey, LessonBlock, QuizBlock } from '@/types/domain';
import { splitQuizAnswers } from '@/lib/livebook/quiz';
import { ReviewError } from '@/lib/review/workflow';

export interface PublishedLessonContent {
  blocks: LessonBlock[];
  items: AnswerKeyItem[];
  /** Key version graded from now on; null when the lesson has never had a quiz. */
  keyVersion: number | null;
  keyChanged: boolean;
}

export function buildPublishedLesson(params: {
  blocks: LessonBlock[];
  /** Answers edited for the revision (answerKey/working), if any. */
  workingKey?: Pick<LessonAnswerKey, 'items'> | null;
  /** Key students are graded against now (answerKey/current), if any. */
  currentKey?: Pick<LessonAnswerKey, 'items' | 'keyVersion'> | null;
}): PublishedLessonContent {
  const { blocks, items: inline } = splitQuizAnswers(params.blocks);
  const byId = new Map((params.workingKey?.items ?? params.currentKey?.items ?? []).map((i) => [i.blockId, i]));
  for (const i of inline) byId.set(i.blockId, i);

  const questions = blocks.filter((b): b is QuizBlock => b.type === 'quiz');
  const items = questions.map((q, n) => {
    const item = byId.get(q.id);
    if (!item || !q.options.some((o) => o.id === item.correctOptionId)) {
      throw new ReviewError(409, 'assessment_incomplete', `Quiz question ${n + 1} has no valid correct answer. Fix it before publishing.`);
    }
    return { blockId: item.blockId, correctOptionId: item.correctOptionId, explanation: item.explanation };
  });

  const current = params.currentKey;
  const keyChanged = !current || JSON.stringify(items) !== JSON.stringify(current.items);
  const keyVersion = !current && items.length === 0 ? null : keyChanged ? (current?.keyVersion ?? 0) + 1 : current!.keyVersion;
  return { blocks, items, keyVersion, keyChanged: keyChanged && keyVersion !== null };
}

export const versionId = (n: number) => String(n).padStart(6, '0');

/** Course details captured in a course version. */
export function courseSnapshotFields(c: Pick<Course, 'title' | 'slug' | 'tagline' | 'description' | 'level' | 'tags' | 'prerequisites' | 'estimatedWeeks'>) {
  return {
    title: c.title ?? '', slug: c.slug ?? '', tagline: c.tagline ?? '', description: c.description ?? '', level: c.level ?? 'beginner',
    tags: c.tags ?? [], prerequisites: c.prerequisites ?? [], estimatedWeeks: c.estimatedWeeks ?? 1,
  };
}

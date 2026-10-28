/**
 * Strynkix Live Books — course structure helpers: module/lesson numbering
 * ("1.2"), lesson status for the learning path, revision notes and the
 * end-of-lesson quiz. Pure functions, unit-tested.
 */

import { Lesson, LessonBlock, Module, Progress, QuizBlock } from '@/types/domain';

export interface NumberedModule {
  module: Module;
  number: number;
  lessons: Array<{ lesson: Lesson; number: string }>;
}

/** Modules by orderIndex (numbered 1..n), each with its lessons numbered "m.l". */
export function numberCurriculum(modules: Module[], lessons: Lesson[]): NumberedModule[] {
  return [...modules]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((module, mi) => ({
      module,
      number: mi + 1,
      lessons: lessons
        .filter((l) => l.moduleId === module.id)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((lesson, li) => ({ lesson, number: `${mi + 1}.${li + 1}` })),
    }));
}

export function lessonNumber(modules: Module[], lessons: Lesson[], lessonId: string): string | null {
  for (const m of numberCurriculum(modules, lessons)) {
    const hit = m.lessons.find((l) => l.lesson.id === lessonId);
    if (hit) return hit.number;
  }
  return null;
}

export type PathStatus = 'completed' | 'in_progress' | 'not_started';

export function lessonStatus(progress: Progress[], lessonId: string): PathStatus {
  const p = progress.find((x) => x.lessonId === lessonId);
  return p?.status === 'completed' ? 'completed' : p?.status === 'in_progress' ? 'in_progress' : 'not_started';
}

/** Quiz questions of a lesson, in order. They are asked together at the end ("Quiz time"). */
export function lessonQuiz(lesson: Pick<Lesson, 'blocks'>): QuizBlock[] {
  return (lesson.blocks ?? []).filter((b): b is QuizBlock => b.type === 'quiz');
}

/** Blocks shown in the reading flow (quiz questions are moved to the end). */
export function readingBlocks(lesson: Pick<Lesson, 'blocks'>): LessonBlock[] {
  return (lesson.blocks ?? []).filter((b) => b.type !== 'quiz');
}

export const QUIZ_PASS_PERCENT = 60;

export function quizScore(questions: QuizBlock[], answers: Record<string, string>): { correct: number; total: number; percent: number; passed: boolean } {
  const total = questions.length;
  const correct = questions.filter((q) => answers[q.id] === q.correctOptionId).length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, percent, passed: total > 0 && percent >= QUIZ_PASS_PERCENT };
}

export interface RevisionNotes {
  /** Section titles, in order. */
  outline: string[];
  /** Callouts, worked-example titles and practice tasks worth revisiting. */
  keyPoints: Array<{ kind: 'note' | 'example' | 'practice'; title: string; text: string }>;
  videos: Array<{ title: string; url: string }>;
  links: Array<{ label: string; url: string; description?: string }>;
}

/** Revision notes derived from the lesson's own content (no separate authoring needed). */
export function revisionNotes(lesson: Pick<Lesson, 'blocks'>): RevisionNotes {
  const notes: RevisionNotes = { outline: [], keyPoints: [], videos: [], links: [] };
  for (const b of lesson.blocks ?? []) {
    if (b.type === 'heading' && b.level <= 2) notes.outline.push(b.text);
    else if (b.type === 'callout') notes.keyPoints.push({ kind: 'note', title: b.title || 'Key point', text: b.content });
    else if (b.type === 'worked_example') notes.keyPoints.push({ kind: 'example', title: b.title, text: b.explanation });
    else if (b.type === 'practice_task') notes.keyPoints.push({ kind: 'practice', title: b.title, text: b.expectedOutcome });
    else if (b.type === 'video') notes.videos.push({ title: b.title, url: b.url });
    else if (b.type === 'references') notes.links.push(...b.links);
  }
  return notes;
}

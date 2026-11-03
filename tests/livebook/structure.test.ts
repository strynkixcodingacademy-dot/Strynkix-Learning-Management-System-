/**
 * Live Books structure: numbering, quiz scoring, revision notes and the
 * YouTube/reference block validation.
 */

import { describe, it, expect } from 'vitest';
import { lessonNumber, lessonQuiz, numberCurriculum, readingBlocks, revisionNotes } from '@/lib/livebook/structure';
import { gradeAnswers, inlineAnswerKey } from '@/lib/livebook/quiz';
import { youtubeEmbedUrl, youtubeId } from '@/lib/livebook/video';
import { lessonBlockSchema } from '@/types/validation';
import { Lesson, LessonBlock, Module, QuizBlock } from '@/types/domain';

const mod = (id: string, orderIndex: number) => ({ id, orderIndex, title: id }) as Module;
const les = (id: string, moduleId: string, orderIndex: number, blocks: LessonBlock[] = []) => ({ id, moduleId, orderIndex, title: id, blocks }) as Lesson;
const quiz = (id: string, correct = 'a'): QuizBlock => ({
  id, type: 'quiz', question: 'Which one?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionId: correct, explanation: 'Because.',
});

describe('numbering', () => {
  const modules = [mod('m2', 2), mod('m1', 1)];
  const lessons = [les('l12', 'm1', 2), les('l11', 'm1', 1), les('l21', 'm2', 5)];
  it('numbers modules and lessons by order index', () => {
    const n = numberCurriculum(modules, lessons);
    expect(n.map((m) => [m.module.id, m.number])).toEqual([['m1', 1], ['m2', 2]]);
    expect(n[0].lessons.map((l) => l.number)).toEqual(['1.1', '1.2']);
    expect(lessonNumber(modules, lessons, 'l21')).toBe('2.1');
    expect(lessonNumber(modules, lessons, 'nope')).toBeNull();
  });
});

describe('quiz', () => {
  const blocks: LessonBlock[] = [{ id: 't', type: 'text', content: 'Hi' }, quiz('q1'), quiz('q2'), quiz('q3', 'b')];
  it('moves quiz questions out of the reading flow', () => {
    expect(readingBlocks({ blocks }).map((b) => b.id)).toEqual(['t']);
    expect(lessonQuiz({ blocks }).map((b) => b.id)).toEqual(['q1', 'q2', 'q3']);
  });
  // C4: inline (legacy) quizzes are graded by the server from their inline key, with the same pass mark.
  it('passes at 60% and rounds the score when graded from inline answers', () => {
    const items = inlineAnswerKey(blocks)!;
    expect(gradeAnswers({ items }, { q1: 'a', q2: 'a', q3: 'a' })).toMatchObject({ correct: 2, total: 3, percent: 67, passed: true });
    expect(gradeAnswers({ items }, { q1: 'a', q2: 'b', q3: 'a' })).toMatchObject({ correct: 1, percent: 33, passed: false });
    expect(inlineAnswerKey([])).toBeNull();
  });
});

describe('revision notes', () => {
  it('collects sections, key points, videos and links from the lesson', () => {
    const notes = revisionNotes({ blocks: [
      { id: 'h', type: 'heading', level: 2, text: 'Why types' },
      { id: 'c', type: 'callout', variant: 'tip', title: 'Remember', content: 'Types vanish at runtime.' },
      { id: 'v', type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Intro' },
      { id: 'r', type: 'references', links: [{ label: 'MDN', url: 'https://developer.mozilla.org' }] },
    ] });
    expect(notes.outline).toEqual(['Why types']);
    expect(notes.keyPoints[0]).toMatchObject({ kind: 'note', title: 'Remember' });
    expect(notes.videos).toEqual([{ title: 'Intro', url: 'https://youtu.be/dQw4w9WgXcQ' }]);
    expect(notes.links[0].label).toBe('MDN');
  });
});

describe('YouTube links', () => {
  it('accepts watch, share, embed and shorts links', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('rejects other hosts, http, and malformed ids', () => {
    expect(youtubeId('https://vimeo.com/123')).toBeNull();
    expect(youtubeId('http://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(youtubeId('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(youtubeId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(youtubeId('javascript:alert(1)')).toBeNull();
  });
  it('embeds from the privacy-enhanced domain with the start time', () => {
    expect(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=90');
  });
  it('lesson schema validates video and reference blocks', () => {
    expect(lessonBlockSchema.safeParse({ id: 'v1', type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Intro' }).success).toBe(true);
    expect(lessonBlockSchema.safeParse({ id: 'v2', type: 'video', url: 'https://example.com/x.mp4', title: 'Intro' }).success).toBe(false);
    expect(lessonBlockSchema.safeParse({ id: 'r1', type: 'references', links: [{ label: 'Docs', url: 'https://example.com' }] }).success).toBe(true);
    expect(lessonBlockSchema.safeParse({ id: 'r2', type: 'references', links: [{ label: 'Bad', url: 'javascript:alert(1)' }] }).success).toBe(false);
    expect(lessonBlockSchema.safeParse({ id: 'r3', type: 'references', links: [] }).success).toBe(false);
  });
});

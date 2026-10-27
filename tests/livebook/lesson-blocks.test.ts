/**
 * Strynkix LMS — Unit Tests for Live Book Lesson Block Schemas & Validation
 */

import { describe, it, expect } from 'vitest';
import {
  lessonBlockSchema,
  lessonSchema,
  imageBlockSchema,
  quizBlockSchema,
  headingBlockSchema,
  practiceTaskBlockSchema,
} from '@/types/validation';
import { LessonBlock, Lesson } from '@/types/domain';

describe('Live Book Lesson Content Block Schemas', () => {
  it('validates a formatted text block', () => {
    const block: LessonBlock = {
      id: 'block_text_1',
      type: 'text',
      content: '## Welcome to TypeScript\nTypeScript adds static typing to JavaScript.',
    };

    const parsed = lessonBlockSchema.safeParse(block);
    expect(parsed.success).toBe(true);
  });

  it('validates a heading block within levels 1-4', () => {
    const validH2 = {
      id: 'block_head_1',
      type: 'heading',
      level: 2,
      text: 'Understanding Type Annotations',
    };
    expect(headingBlockSchema.safeParse(validH2).success).toBe(true);

    const invalidH5 = {
      id: 'block_head_2',
      type: 'heading',
      level: 5, // invalid
      text: 'Deep Heading',
    };
    expect(headingBlockSchema.safeParse(invalidH5).success).toBe(false);
  });

  it('validates code example blocks with language and line highlights', () => {
    const block: LessonBlock = {
      id: 'block_code_1',
      type: 'code_example',
      code: 'interface User {\n  id: string;\n  name: string;\n}',
      language: 'typescript',
      filename: 'user.ts',
      highlightLines: [2],
      caption: 'Basic User contract interface',
    };

    const parsed = lessonBlockSchema.safeParse(block);
    expect(parsed.success).toBe(true);
  });

  it('enforces secure image URLs (requires https:// or relative asset paths)', () => {
    const validHttps = {
      id: 'block_img_1',
      type: 'image',
      url: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97',
      altText: 'Modern workstation setup',
      caption: 'Our developer environment',
    };
    expect(imageBlockSchema.safeParse(validHttps).success).toBe(true);

    const validRelative = {
      id: 'block_img_2',
      type: 'image',
      url: '/assets/architecture-diagram.png',
      altText: 'Architecture diagram',
    };
    expect(imageBlockSchema.safeParse(validRelative).success).toBe(true);

    const invalidInsecure = {
      id: 'block_img_3',
      type: 'image',
      url: 'javascript:alert(1)',
      altText: 'XSS attempt',
    };
    expect(imageBlockSchema.safeParse(invalidInsecure).success).toBe(false);

    const invalidHttp = {
      id: 'block_img_4',
      type: 'image',
      url: 'http://insecure.com/photo.jpg',
      altText: 'Insecure URL',
    };
    expect(imageBlockSchema.safeParse(invalidHttp).success).toBe(false);
  });

  it('validates callout blocks across supported variants', () => {
    const callouts = ['info', 'tip', 'warning', 'danger'] as const;

    for (const variant of callouts) {
      const block: LessonBlock = {
        id: `block_callout_${variant}`,
        type: 'callout',
        variant,
        title: `${variant.toUpperCase()} Note`,
        content: `This is a test callout for ${variant}.`,
      };
      expect(lessonBlockSchema.safeParse(block).success).toBe(true);
    }
  });

  it('validates worked example blocks with problem and solution', () => {
    const block: LessonBlock = {
      id: 'block_we_1',
      type: 'worked_example',
      title: 'Calculating Average Score',
      problem: 'Given an array of numbers, calculate their arithmetic mean.',
      solutionCode: 'export function mean(nums: number[]): number {\n  return nums.reduce((a, b) => a + b, 0) / nums.length;\n}',
      language: 'typescript',
      explanation: 'We sum all elements using Array.prototype.reduce and divide by array length.',
    };

    expect(lessonBlockSchema.safeParse(block).success).toBe(true);
  });

  it('validates multiple-choice quiz blocks and verifies correctOptionId consistency', () => {
    const validQuiz = {
      id: 'block_quiz_1',
      type: 'quiz',
      question: 'Which TypeScript keyword declares an immutable variable?',
      options: [
        { id: 'opt_var', text: 'var' },
        { id: 'opt_let', text: 'let' },
        { id: 'opt_const', text: 'const' },
      ],
      correctOptionId: 'opt_const',
      explanation: 'const declares block-scoped read-only variables.',
      hint: 'Think about constant values.',
    };

    expect(quizBlockSchema.safeParse(validQuiz).success).toBe(true);

    const invalidQuizDanglingKey = {
      id: 'block_quiz_2',
      type: 'quiz',
      question: 'Which TypeScript keyword declares an immutable variable?',
      options: [
        { id: 'opt_var', text: 'var' },
        { id: 'opt_let', text: 'let' },
      ],
      correctOptionId: 'opt_non_existent', // Inconsistent!
      explanation: 'Explanation...',
    };

    const parsed = quizBlockSchema.safeParse(invalidQuizDanglingKey);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toContain('correctOptionId must match one of the provided quiz option IDs');
    }
  });

  it('validates practice task blocks', () => {
    const block = {
      id: 'block_task_1',
      type: 'practice_task',
      title: 'Build a Fibonacci Generator',
      instructions: 'Write a TypeScript function that returns the Nth Fibonacci number.',
      starterCode: 'function fib(n: number): number {\n  // TODO: implement\n}',
      language: 'typescript',
      hints: ['Remember base cases F(0) = 0 and F(1) = 1.', 'Consider an iterative loop for O(N) performance.'],
      expectedOutcome: 'fib(7) === 13',
    };

    expect(practiceTaskBlockSchema.safeParse(block).success).toBe(true);
  });

  it('validates an entire Lesson containing multiple heterogeneous blocks', () => {
    const lesson: Lesson = {
      id: 'lesson_ts_intro',
      orgId: 'strynkix',
      courseId: 'course_fullstack_2026',
      moduleId: 'module_ts_foundations',
      title: 'Getting Started with TypeScript',
      slug: 'getting-started-typescript',
      type: 'concept',
      orderIndex: 0,
      estimatedMinutes: 20,
      status: 'published',
      createdAt: '2026-10-28T00:00:00.000Z',
      updatedAt: '2026-10-28T00:00:00.000Z',
      blocks: [
        {
          id: 'b1',
          type: 'heading',
          level: 1,
          text: 'Introduction to Static Typing',
        },
        {
          id: 'b2',
          type: 'text',
          content: 'TypeScript provides compile-time safety across engineering teams.',
        },
        {
          id: 'b3',
          type: 'callout',
          variant: 'info',
          title: 'Did you know?',
          content: 'TypeScript compiles down to plain JavaScript compatible with all modern browsers.',
        },
        {
          id: 'b4',
          type: 'code_example',
          code: 'const greeting: string = "Hello Strynkix!";',
          language: 'typescript',
        },
      ],
    };

    const parsed = lessonSchema.safeParse(lesson);
    expect(parsed.success).toBe(true);
  });
});

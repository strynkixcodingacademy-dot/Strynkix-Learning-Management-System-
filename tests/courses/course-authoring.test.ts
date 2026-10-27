import { describe, it, expect } from 'vitest';
import {
  courseSchema,
  moduleSchema,
  lessonSchema,
  quizBlockSchema,
  imageBlockSchema,
  calloutBlockSchema,
} from '@/types/validation';

describe('Stage 5: Course & Curriculum Authoring Validation', () => {
  describe('Course Schema Boundaries', () => {
    it('validates a well-formed course draft', () => {
      const valid = {
        orgId: 'strynkix',
        title: 'Distributed Systems & Microservices',
        slug: 'distributed-systems-microservices',
        tagline: 'Master zero-trust cloud backend architecture',
        description: 'Comprehensive engineering curriculum covering distributed transactions and event brokers.',
        level: 'advanced',
        tags: ['typescript', 'cloud', 'architecture'],
        prerequisites: ['Full Stack Foundations'],
        estimatedWeeks: 12,
        status: 'draft',
      };

      const result = courseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('rejects invalid uppercase or spaced slug', () => {
      const invalid = {
        orgId: 'strynkix',
        title: 'Invalid Slug Course',
        slug: 'Invalid Slug With Spaces',
        tagline: 'Short tagline here',
        description: 'Detailed description here',
        level: 'beginner',
        estimatedWeeks: 6,
      };

      const result = courseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects out-of-bounds duration (>52 weeks or <1 week)', () => {
      const invalidOver = {
        orgId: 'strynkix',
        title: 'Over 52 Weeks Course',
        slug: 'over-weeks',
        tagline: 'Tagline',
        description: 'Description',
        level: 'intermediate',
        estimatedWeeks: 60,
      };

      expect(courseSchema.safeParse(invalidOver).success).toBe(false);

      const invalidUnder = { ...invalidOver, estimatedWeeks: 0 };
      expect(courseSchema.safeParse(invalidUnder).success).toBe(false);
    });
  });

  describe('Module Schema Boundaries', () => {
    it('validates a sequential module within a course', () => {
      const validModule = {
        orgId: 'strynkix',
        courseId: 'course_cloud_1',
        title: 'Module 1: Invariant Modeling',
        slug: 'invariant-modeling',
        summary: 'Explore Zod domain schemas and runtime bounds.',
        orderIndex: 1,
        status: 'published',
      };

      const result = moduleSchema.safeParse(validModule);
      expect(result.success).toBe(true);
    });

    it('rejects negative module order index', () => {
      const invalidModule = {
        orgId: 'strynkix',
        courseId: 'course_cloud_1',
        title: 'Negative Order Module',
        slug: 'negative-order',
        summary: 'Summary',
        orderIndex: -1,
      };

      expect(moduleSchema.safeParse(invalidModule).success).toBe(false);
    });
  });

  describe('Live Book Block Validation', () => {
    it('validates a pedagogical quiz block with matching correctOptionId', () => {
      const validQuiz = {
        id: 'blk_quiz_1',
        type: 'quiz',
        question: 'Which component is the true security boundary in Firestore?',
        options: [
          { id: 'opt_1', text: 'UI guards' },
          { id: 'opt_2', text: 'Firestore Security Rules' },
        ],
        correctOptionId: 'opt_2',
        explanation: 'Firestore Security Rules enforce permissions directly on database RPC writes.',
      };

      const result = quizBlockSchema.safeParse(validQuiz);
      expect(result.success).toBe(true);
    });

    it('strictly rejects a quiz block when correctOptionId does NOT match any options', () => {
      const mismatchedQuiz = {
        id: 'blk_quiz_2',
        type: 'quiz',
        question: 'What is 2 + 2?',
        options: [
          { id: 'opt_a', text: '3' },
          { id: 'opt_b', text: '4' },
        ],
        correctOptionId: 'opt_unrelated_id',
        explanation: 'Math logic.',
      };

      const result = quizBlockSchema.safeParse(mismatchedQuiz);
      expect(result.success).toBe(false);
    });

    it('rejects image block with insecure or javascript: URL', () => {
      const insecureImage = {
        id: 'blk_img_1',
        type: 'image',
        url: 'javascript:alert(1)',
        altText: 'Malicious payload',
      };

      expect(imageBlockSchema.safeParse(insecureImage).success).toBe(false);

      const httpImage = {
        id: 'blk_img_2',
        type: 'image',
        url: 'http://insecure.com/diagram.png',
        altText: 'Insecure image',
      };
      expect(imageBlockSchema.safeParse(httpImage).success).toBe(false);

      const secureImage = {
        id: 'blk_img_3',
        type: 'image',
        url: 'https://images.unsplash.com/photo-diagram.png',
        altText: 'Secure Cloud Architecture Diagram',
      };
      expect(imageBlockSchema.safeParse(secureImage).success).toBe(true);
    });

    it('validates callout blocks and rejects invalid variant', () => {
      const validCallout = {
        id: 'blk_callout_1',
        type: 'callout',
        variant: 'tip',
        title: 'Engineering Best Practice',
        content: 'Validate at runtime before writing to persistence.',
      };
      expect(calloutBlockSchema.safeParse(validCallout).success).toBe(true);

      const invalidCallout = {
        ...validCallout,
        variant: 'invalid_variant_name',
      };
      expect(calloutBlockSchema.safeParse(invalidCallout).success).toBe(false);
    });

    it('validates a complete lesson document with mixed blocks', () => {
      const validLesson = {
        orgId: 'strynkix',
        courseId: 'course_cloud_1',
        moduleId: 'mod_1',
        title: 'Zero-Trust Data Modeling',
        slug: 'zero-trust-modeling',
        type: 'concept',
        orderIndex: 1,
        estimatedMinutes: 25,
        blocks: [
          {
            id: 'blk_1',
            type: 'text',
            content: 'In this lesson, we establish tenant boundaries.',
          },
          {
            id: 'blk_2',
            type: 'code_example',
            code: 'const schema = z.object({ orgId: idSchema });',
            language: 'typescript',
          },
        ],
        status: 'draft',
      };

      const result = lessonSchema.safeParse(validLesson);
      expect(result.success).toBe(true);
    });
  });
});

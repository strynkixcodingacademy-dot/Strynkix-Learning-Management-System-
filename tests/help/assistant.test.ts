/**
 * Help assistant — answers come only from the User Guide, respect the asker's
 * role, and fall back honestly instead of inventing features.
 */

import { describe, it, expect } from 'vitest';
import { answer, tokenize } from '@/lib/help/assistant';
import { GUIDE, topicsForRole } from '@/lib/help/guide';

describe('tokenize', () => {
  it('folds plurals and tenses so different phrasings match', () => {
    expect(tokenize('courses')).toEqual(tokenize('course'));
    expect(tokenize('batches')).toEqual(tokenize('batch'));
    expect(tokenize('submitted')).toEqual(tokenize('submit'));
    expect(tokenize('completed')).toEqual(tokenize('complete'));
    expect(tokenize('grading')).toContain(tokenize('grade')[0]);
  });

  it('expands everyday words to product words', () => {
    expect(tokenize('homework')).toContain(tokenize('assignment')[0]);
    expect(tokenize('teacher')).toContain(tokenize('instructor')[0]);
    expect(tokenize('franchise')).toContain(tokenize('branch')[0]);
  });
});

describe('answer', () => {
  const cases: Array<[string, string, string]> = [
    ['student', 'How do I submit my homework?', 'submit-assignment'],
    ['student', 'where can i see my marks', 'feedback-resubmit'],
    ['student', 'I forgot my password', 'sign-in'],
    ['student', 'how to mark a lesson complete', 'read-lesson'],
    ['instructor', 'how do I grade a submission', 'review-submissions'],
    ['instructor', 'create a daily plan for my class', 'daily-plan'],
    ['branch_admin', 'how do I add a new student', 'enroll-student'],
    ['branch_admin', 'approve a pending student account', 'people'],
    ['branch_admin', 'create a new batch', 'create-batch'],
    ['super_admin', 'open a new franchise', 'create-branch'],
    ['super_admin', 'show me branch performance reports', 'branch-analytics'],
  ];
  for (const [role, q, id] of cases) {
    it(`${role}: "${q}" → ${id}`, () => {
      const a = answer(q, role as never);
      expect(a.kind).toBe('answer');
      expect(a.topic?.id).toBe(id);
    });
  }

  it('tells a student when a task belongs to another role instead of pretending they can do it', () => {
    const a = answer('how do I create a batch', 'student');
    expect(a.topic?.id).toBe('create-batch');
    expect(a.otherRoleNote).toMatch(/Branch Manager|Super Admin/);
  });

  it('greets and offers role-specific suggestions', () => {
    const a = answer('hi', 'instructor');
    expect(a.kind).toBe('greeting');
    expect(a.suggestions.length).toBeGreaterThan(0);
  });

  it('falls back honestly for questions the guide does not cover', () => {
    for (const q of ['what is the weather in pune', 'what is the weather today', 'tell me a joke about cricket']) {
      const a = answer(q, 'student');
      expect(a.kind, q).toBe('fallback');
      expect(a.topic, q).toBeUndefined();
    }
  });

  it('every suggested question resolves to a real guide answer', () => {
    for (const role of ['student', 'instructor', 'branch_admin', 'super_admin'] as const) {
      for (const q of answer('hello', role).suggestions) {
        expect(answer(q, role).kind, `${role}: ${q}`).toBe('answer');
      }
    }
  });
});

describe('guide', () => {
  it('topic ids are unique and every topic has steps', () => {
    expect(new Set(GUIDE.map((t) => t.id)).size).toBe(GUIDE.length);
    for (const t of GUIDE) expect(t.steps.length, t.id).toBeGreaterThan(0);
  });

  it('students never see staff-only topics in their guide', () => {
    const ids = topicsForRole('student').map((t) => t.id);
    expect(ids).toContain('submit-assignment');
    expect(ids).not.toContain('create-batch');
    expect(ids).not.toContain('create-branch');
  });
});

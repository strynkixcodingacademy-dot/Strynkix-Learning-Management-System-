/** G21: in-progress quiz answers are restored only if they still fit the questions. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readQuizDraft } from '@/components/livebook/QuizTime';
import { QuizBlock } from '@/types/domain';

const q = (id: string): QuizBlock => ({ id, type: 'quiz', question: `${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] });
const questions = [q('q1'), q('q2')];
let store: Record<string, string>;

beforeEach(() => {
  store = {};
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } },
  };
});
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe('readQuizDraft', () => {
  it('restores saved answers and position', () => {
    store.k = JSON.stringify({ answers: { q1: 'b', q2: 'a' }, index: 1 });
    expect(readQuizDraft('k', questions)).toEqual({ answers: { q1: 'b', q2: 'a' }, index: 1 });
  });
  it('drops answers for unknown questions or options, and resets an out-of-range position', () => {
    store.k = JSON.stringify({ answers: { q1: 'z', q2: 'a', q9: 'a' }, index: 7 });
    expect(readQuizDraft('k', questions)).toEqual({ answers: { q2: 'a' }, index: 0 });
  });
  it('ignores missing, empty, corrupt or foreign data', () => {
    expect(readQuizDraft('k', questions)).toBeNull();
    expect(readQuizDraft(undefined, questions)).toBeNull();
    store.k = '{not json';
    expect(readQuizDraft('k', questions)).toBeNull();
    store.k = JSON.stringify({ answers: { q1: 'z' } });
    expect(readQuizDraft('k', questions)).toBeNull();
    store.k = JSON.stringify(['q1']);
    expect(readQuizDraft('k', questions)).toBeNull();
  });
  it('never fails when storage throws', () => {
    (globalThis as { window?: unknown }).window = { localStorage: { getItem: () => { throw new Error('blocked'); } } };
    expect(readQuizDraft('k', questions)).toBeNull();
  });
});

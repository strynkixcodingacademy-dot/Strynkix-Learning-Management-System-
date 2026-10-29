/**
 * Stage C3 — what a publish writes, and how review actions on a published
 * lesson are routed to its working revision (pure).
 */

import { describe, it, expect } from 'vitest';
import { buildPublishedLesson, versionId } from '@/lib/review/versioning';
import { ReviewActor, ReviewError, ReviewTarget, planContentAction } from '@/lib/review/workflow';
import { LessonBlock, QuizBlock } from '@/types/domain';

const NOW = '2026-10-29T10:00:00.000Z';
const text: LessonBlock = { id: 't1', type: 'text', content: 'Hello' };
const q = (id: string, extra: Partial<QuizBlock> = {}): QuizBlock => ({ id, type: 'quiz', question: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], ...extra });
const item = (blockId: string, correctOptionId = 'a') => ({ blockId, correctOptionId, explanation: `Because ${correctOptionId}.` });

describe('buildPublishedLesson', () => {
  it('first publish of a lesson without a quiz has no key', () => {
    expect(buildPublishedLesson({ blocks: [text] })).toEqual({ blocks: [text], items: [], keyVersion: null, keyChanged: false });
  });

  it('keeps the key version when the answers are unchanged', () => {
    const r = buildPublishedLesson({ blocks: [text, q('q1')], currentKey: { keyVersion: 4, items: [item('q1')] } });
    expect(r).toMatchObject({ keyVersion: 4, keyChanged: false, items: [item('q1')] });
  });

  it('uses the revision’s working answers and advances the key version once', () => {
    const r = buildPublishedLesson({ blocks: [q('q1'), q('q2')], workingKey: { items: [item('q1', 'b'), item('q2')] }, currentKey: { keyVersion: 4, items: [item('q1')] } });
    expect(r).toMatchObject({ keyVersion: 5, keyChanged: true, items: [item('q1', 'b'), item('q2')] });
  });

  it('drops key items for removed questions; removing every question empties the key', () => {
    expect(buildPublishedLesson({ blocks: [q('q2')], currentKey: { keyVersion: 1, items: [item('q1'), item('q2')] } }).items).toEqual([item('q2')]);
    expect(buildPublishedLesson({ blocks: [text], currentKey: { keyVersion: 1, items: [item('q1')] } })).toMatchObject({ items: [], keyVersion: 2, keyChanged: true });
  });

  it('moves legacy inline answers into the key and strips them from the published blocks', () => {
    const r = buildPublishedLesson({ blocks: [q('q1', { correctOptionId: 'b', explanation: 'Because b.' })] });
    expect(r.items).toEqual([item('q1', 'b')]);
    expect(r.keyVersion).toBe(1);
    expect(JSON.stringify(r.blocks)).not.toContain('correctOptionId');
    expect(JSON.stringify(r.blocks)).not.toContain('Because');
  });

  it('refuses to publish a question without a valid answer', () => {
    const missing = () => buildPublishedLesson({ blocks: [q('q1'), q('q2')], currentKey: { keyVersion: 1, items: [item('q1')] } });
    expect(missing).toThrow(ReviewError);
    try { missing(); } catch (e) { expect((e as ReviewError).code).toBe('assessment_incomplete'); }
    expect(() => buildPublishedLesson({ blocks: [q('q1')], currentKey: { keyVersion: 1, items: [item('q1', 'z')] } })).toThrow(/no valid correct answer/);
  });

  it('pads version ids so they sort', () => {
    expect(versionId(1)).toBe('000001');
    expect(versionId(12)).toBe('000012');
  });
});

describe('published lessons are reviewed through their revision', () => {
  const actor = (id: string, role: ReviewActor['role'], extra: Partial<ReviewActor> = {}): ReviewActor => ({ id, role, orgId: 'org_a', status: 'active', ...extra });
  const inst = actor('inst', 'instructor');
  const reviewer = actor('rev', 'content_designer', { courseDesign: { department: 'course_design', responsibilities: ['reviewer'], assignedCourseIds: ['c1'], assignedAt: NOW, assignedByUserId: 's' } });
  const sup = actor('super', 'super_admin');
  const course = { id: 'c1', orgId: 'org_a', status: 'published' as const };
  const published = (revision?: ReviewTarget['revision']): ReviewTarget => ({ type: 'lesson', id: 'l1', orgId: 'org_a', courseId: 'c1', status: 'published', lastEditedById: 'old', revision });
  const plan = (a: ReviewActor, action: Parameters<typeof planContentAction>[0]['action'], t: ReviewTarget, more: { reason?: string; comment?: string } = {}) =>
    planContentAction({ actor: a, target: t, course, action, nowIso: NOW, ...more });

  it('submit, approve and publish act on the revision; the lesson stays published', () => {
    const s = plan(inst, 'submit', published({ lastEditedById: 'inst' }));
    expect(s).toMatchObject({ subject: 'revision', patch: { status: 'published', review: { state: 'in_review', submittedById: 'inst' } } });
    expect(s.audit).toMatchObject({ revision: true, fromStatus: 'published', toStatus: 'published' });
    const a = plan(reviewer, 'approve', published({ lastEditedById: 'inst', review: s.patch.review }));
    expect(a).toMatchObject({ subject: 'revision', patch: { review: { state: 'approved' } } });
    const p = plan(sup, 'publish', published({ lastEditedById: 'inst', review: a.patch.review }));
    expect(p).toMatchObject({ subject: 'revision', patch: { status: 'published' }, audit: { override: false, revision: true } });
  });

  it('the revision’s last editor cannot approve it', () => {
    expect(() => plan(reviewer, 'approve', published({ lastEditedById: 'rev', review: { state: 'in_review', submittedById: 'inst' } }))).toThrow(/submitted or last edited/);
  });

  it('without a revision there is nothing to submit or publish', () => {
    expect(() => plan(inst, 'submit', published())).toThrow(/Start a revision/);
    expect(() => plan(sup, 'publish', published(), { reason: 'Republishing as is' })).toThrow(/Start a revision/);
  });

  it('a revision is published without approval only as an override with a reason', () => {
    expect(() => plan(sup, 'publish', published({ lastEditedById: 'inst' }))).toThrow(/needs a reason/);
    expect(plan(sup, 'publish', published({ lastEditedById: 'inst' }), { reason: 'Urgent correction for students' }).audit.override).toBe(true);
  });

  it('unpublish and archive act on the lesson, and wait until a pending revision is resolved', () => {
    expect(plan(sup, 'unpublish', published())).toMatchObject({ subject: 'target', patch: { status: 'draft' } });
    expect(() => plan(sup, 'archive', published({ lastEditedById: 'inst' }))).toThrow(/Publish or discard it first/);
  });
});

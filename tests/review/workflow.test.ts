/**
 * Stage C2 — review lifecycle decisions (pure). The server route applies these
 * inside a transaction; the emulator suite covers the route end to end.
 */

import { describe, it, expect } from 'vitest';
import { ReviewActor, ReviewError, ReviewTarget, canAuthorTarget, canEditLessonContent, canReview, planContentAction } from '@/lib/review/workflow';
import { mergeQuizQuestions } from '@/lib/server/assessment';
import { ContentAction, ContentReview, CourseDesignResponsibility, LessonBlock, QuizBlock } from '@/types/domain';

const NOW = '2026-10-29T10:00:00.000Z';
const cd = (responsibilities: CourseDesignResponsibility[], assignedCourseIds = ['c1']) => ({
  department: 'course_design' as const, responsibilities, assignedCourseIds, assignedAt: NOW, assignedByUserId: 'super',
});
const actor = (id: string, role: ReviewActor['role'], extra: Partial<ReviewActor> = {}): ReviewActor =>
  ({ id, role, orgId: 'org_a', status: 'active', ...extra });

const A = {
  super: actor('super', 'super_admin', { orgId: 'platform' }),
  uni: actor('uni', 'university_admin'),
  inst: actor('inst', 'instructor'),
  ba: actor('ba', 'branch_admin'),
  author: actor('author', 'content_designer', { courseDesign: cd(['content_developer']) }),
  lead: actor('lead', 'content_lead', { courseDesign: cd(['lead']) }),
  assess: actor('assess', 'content_designer', { courseDesign: cd(['assessment_designer']) }),
  reviewer: actor('reviewer', 'content_designer', { courseDesign: cd(['reviewer']) }),
  reviewer2: actor('reviewer2', 'instructor', { courseDesign: cd(['reviewer']) }),
  reviewerOther: actor('reviewer_other', 'content_designer', { courseDesign: cd(['reviewer'], ['c2']) }),
  reviewerAll: actor('reviewer_all', 'content_designer', { courseDesign: cd(['reviewer'], ['*']) }),
  reviewerSus: actor('reviewer_sus', 'content_designer', { status: 'suspended', courseDesign: cd(['reviewer']) }),
  reviewerB: actor('reviewer_b', 'content_designer', { orgId: 'org_b', courseDesign: cd(['reviewer'], ['*']) }),
  labelOnly: actor('label', 'content_lead'),
  stu: actor('stu', 'student'),
};

const draftCourse = { id: 'c1', orgId: 'org_a', status: 'draft' as const };
const pubCourse = { id: 'c1', orgId: 'org_a', status: 'published' as const };
const lesson = (review?: ContentReview, extra: Partial<ReviewTarget> = {}): ReviewTarget => ({
  type: 'lesson', id: 'l1', orgId: 'org_a', courseId: 'c1', status: 'draft', review, lastEditedById: 'author', ...extra,
});
const inReview = (submittedById = 'author') => ({ state: 'in_review' as const, submittedById, submittedAt: NOW });

const plan = (a: ReviewActor | null, action: ContentAction, target: ReviewTarget, more: { comment?: string; reason?: string; keyUpdatedById?: string; course?: typeof draftCourse | typeof pubCourse } = {}) =>
  planContentAction({ actor: a, target, course: more.course ?? draftCourse, action, comment: more.comment, reason: more.reason, keyUpdatedById: more.keyUpdatedById, nowIso: NOW });

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ReviewError);
    return err as ReviewError;
  }
  throw new Error('expected a refusal');
};

describe('authority', () => {
  it('authors: staff in the org, in-scope writers of draft courses, never reviewers or students', () => {
    for (const a of [A.super, A.uni, A.inst, A.ba, A.author, A.lead, A.assess]) expect(canAuthorTarget(a, lesson(), draftCourse), a.id).toBe(true);
    for (const a of [A.reviewer, A.labelOnly, A.stu, A.reviewerB, A.reviewerSus]) expect(canAuthorTarget(a, lesson(), draftCourse), a.id).toBe(false);
    // Course Design members lose authority once the course is published; staff keep lesson authoring.
    expect(canAuthorTarget(A.author, lesson(), pubCourse)).toBe(false);
    expect(canAuthorTarget(A.inst, lesson(), pubCourse)).toBe(true);
  });
  it('assessment designers author assessments but cannot write the whole lesson', () => {
    expect(canEditLessonContent(A.assess, lesson(), draftCourse)).toBe(false);
    expect(canEditLessonContent(A.author, lesson(), draftCourse)).toBe(true);
    expect(canEditLessonContent(A.inst, lesson(), draftCourse)).toBe(true);
  });
  it('reviewers: Super Admin or an active in-scope reviewer of the same org', () => {
    for (const a of [A.super, A.reviewer, A.reviewer2, A.reviewerAll]) expect(canReview(a, draftCourse), a.id).toBe(true);
    for (const a of [A.reviewerOther, A.reviewerSus, A.reviewerB, A.labelOnly, A.uni, A.inst, A.author, A.stu, null]) expect(canReview(a, draftCourse), a?.id).toBe(false);
  });
});

describe('valid transitions', () => {
  it('draft → in review → approved → published → archived', () => {
    const submitted = plan(A.author, 'submit', lesson());
    expect(submitted.patch).toEqual({ status: 'draft', review: { state: 'in_review', submittedById: 'author', submittedAt: NOW } });
    const approved = plan(A.reviewer, 'approve', lesson(submitted.patch.review), { comment: 'Looks good.' });
    expect(approved.patch.review).toMatchObject({ state: 'approved', reviewedById: 'reviewer', reviewedAt: NOW, comment: 'Looks good.', submittedById: 'author' });
    const published = plan(A.super, 'publish', lesson(approved.patch.review));
    expect(published.patch).toEqual({ status: 'published', review: { state: 'none' } });
    expect(published.audit).toMatchObject({ action: 'publish', override: false, fromStatus: 'draft', toStatus: 'published', fromReview: 'approved', toReview: 'none', actorId: 'super' });
    expect(plan(A.super, 'archive', lesson(undefined, { status: 'published' })).patch.status).toBe('archived');
  });
  it('in review → changes requested (with a comment) → resubmitted', () => {
    const changes = plan(A.reviewer, 'request_changes', lesson(inReview()), { comment: 'Fix question 2.' });
    expect(changes.patch.review).toMatchObject({ state: 'changes_requested', comment: 'Fix question 2.' });
    expect(plan(A.author, 'submit', lesson(changes.patch.review)).patch.review.state).toBe('in_review');
  });
  it('authors can withdraw or reopen an approved draft for editing', () => {
    expect(plan(A.author, 'reopen', lesson(inReview())).patch.review).toEqual({ state: 'none' });
    expect(plan(A.inst, 'reopen', lesson({ ...inReview(), state: 'approved' })).patch.review).toEqual({ state: 'none' });
  });
  it('the Super Admin unpublishes back to draft', () => {
    expect(plan(A.super, 'unpublish', lesson(undefined, { status: 'published' })).patch).toEqual({ status: 'draft', review: { state: 'none' } });
  });
  it('courses follow the same cycle', () => {
    const course: ReviewTarget = { type: 'course', id: 'c1', orgId: 'org_a', courseId: 'c1', status: 'draft', lastEditedById: 'lead', createdById: 'lead' };
    const s = plan(A.lead, 'submit', course);
    expect(plan(A.reviewer, 'approve', { ...course, review: s.patch.review }).patch.review.state).toBe('approved');
    expect(refusal(() => plan(A.author, 'submit', course)).code).toBe('not_allowed');
  });
});

describe('invalid transitions', () => {
  const cases: Array<[string, () => unknown, string]> = [
    ['submit twice', () => plan(A.author, 'submit', lesson(inReview())), 'invalid_transition'],
    ['submit an approved draft', () => plan(A.author, 'submit', lesson({ ...inReview(), state: 'approved' })), 'invalid_transition'],
    ['submit published content', () => plan(A.inst, 'submit', lesson(undefined, { status: 'published' }), { course: pubCourse }), 'invalid_transition'],
    ['approve a draft not in review', () => plan(A.reviewer, 'approve', lesson()), 'invalid_transition'],
    ['approve changes-requested content', () => plan(A.reviewer, 'approve', lesson({ ...inReview(), state: 'changes_requested' })), 'invalid_transition'],
    ['reopen a plain draft', () => plan(A.author, 'reopen', lesson()), 'invalid_transition'],
    ['publish published content', () => plan(A.super, 'publish', lesson(undefined, { status: 'published' })), 'invalid_transition'],
    ['unpublish a draft', () => plan(A.super, 'unpublish', lesson()), 'invalid_transition'],
    ['anything on archived content', () => plan(A.super, 'publish', lesson(undefined, { status: 'archived' }), { reason: 'Restoring old content' }), 'invalid_transition'],
    ['request changes without a comment', () => plan(A.reviewer, 'request_changes', lesson(inReview())), 'comment_required'],
  ];
  for (const [name, fn, code] of cases) it(name, () => expect(refusal(fn).code).toBe(code));
});

describe('self-review is refused', () => {
  it('the submitter cannot approve or request changes', () => {
    const t = lesson(inReview('reviewer'), { lastEditedById: 'author' });
    expect(refusal(() => plan(A.reviewer, 'approve', t)).code).toBe('not_allowed');
    expect(refusal(() => plan(A.reviewer, 'request_changes', t, { comment: 'x' })).code).toBe('not_allowed');
  });
  it('the last editor of the lesson cannot approve', () => {
    expect(refusal(() => plan(A.reviewer, 'approve', lesson(inReview('author'), { lastEditedById: 'reviewer' }))).code).toBe('not_allowed');
  });
  it('the last editor of the answer key cannot approve', () => {
    expect(refusal(() => plan(A.reviewer, 'approve', lesson(inReview()), { keyUpdatedById: 'reviewer' })).code).toBe('not_allowed');
  });
  it('legacy content without an editor record is attributed to its creator', () => {
    const t: ReviewTarget = { type: 'course', id: 'c1', orgId: 'org_a', courseId: 'c1', status: 'draft', createdById: 'reviewer', review: inReview('lead') };
    expect(refusal(() => plan(A.reviewer, 'approve', t)).code).toBe('not_allowed');
  });
  it('the Super Admin cannot approve their own submission either', () => {
    expect(refusal(() => plan(A.super, 'approve', lesson(inReview('super')))).code).toBe('not_allowed');
  });
  it('an independent reviewer can', () => {
    expect(plan(A.reviewer2, 'approve', lesson(inReview('author'), { lastEditedById: 'author' }), { keyUpdatedById: 'assess' }).patch.review.state).toBe('approved');
  });
});

describe('scope, account status and organization', () => {
  it('out-of-scope, suspended, label-only and unassigned staff cannot review', () => {
    for (const a of [A.reviewerOther, A.reviewerSus, A.labelOnly, A.uni, A.inst, A.author, A.stu]) {
      expect(refusal(() => plan(a, 'approve', lesson(inReview()))).code, a.id).toBe('not_allowed');
    }
  });
  it('another organization’s content is not found, even for an org-wide reviewer', () => {
    expect(refusal(() => plan(A.reviewerB, 'approve', lesson(inReview()))).code).toBe('not_found');
  });
  it('a missing profile is refused', () => {
    expect(refusal(() => plan(null, 'submit', lesson())).code).toBe('not_allowed');
  });
});

describe('publication is Super Admin only (D3)', () => {
  it('no one else publishes, unpublishes or archives', () => {
    const approved = lesson({ ...inReview(), state: 'approved', reviewedById: 'reviewer' });
    for (const a of [A.uni, A.inst, A.ba, A.lead, A.author, A.reviewer, A.stu]) {
      for (const action of ['publish', 'unpublish', 'archive'] as const) {
        expect(refusal(() => plan(a, action, action === 'unpublish' ? lesson(undefined, { status: 'published' }) : approved)).code, `${a.id} ${action}`).toBe('not_allowed');
      }
    }
  });
  it('publishing without a current approval is an override that needs a reason', () => {
    expect(refusal(() => plan(A.super, 'publish', lesson())).code).toBe('reason_required');
    expect(refusal(() => plan(A.super, 'publish', lesson(inReview()), { reason: 'too short' })).code).toBe('reason_required');
    const o = plan(A.super, 'publish', lesson(inReview()), { reason: 'Urgent fix for the live cohort' });
    expect(o.audit).toMatchObject({ override: true, reason: 'Urgent fix for the live cohort', fromReview: 'in_review' });
  });
});

describe('mergeQuizQuestions (assessment route)', () => {
  const text = (id: string): LessonBlock => ({ id, type: 'text', content: id });
  const quiz = (id: string, question = `Question ${id}?`): QuizBlock => ({ id, type: 'quiz', question, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] });
  it('replaces questions in place, drops removed ones, appends new ones, keeps every other block', () => {
    const before = [text('t1'), quiz('q1'), text('t2'), quiz('q2')];
    const after = mergeQuizQuestions(before, [quiz('q2', 'Edited q2?'), quiz('q3')]);
    expect(after.map((b) => b.id)).toEqual(['t1', 't2', 'q2', 'q3']);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[2]);
    expect((after[2] as QuizBlock).question).toBe('Edited q2?');
  });
});

/**
 * Strynkix LMS — content review lifecycle (Stage C2). Pure decisions, applied
 * by the trusted server route inside a transaction (POST /api/content/review).
 *
 *   draft ─submit→ in_review ─approve→ approved ─publish (Super Admin)→ published ─archive→ archived
 *                      │  └─request_changes→ changes_requested ─submit→ in_review
 *                      └─reopen→ draft (editable)          published ─unpublish→ draft
 *
 * `status` is the publication axis (D3: only the Super Admin publishes,
 * unpublishes or archives). `review.state` is the review cycle of a draft.
 * Content is frozen (firestore.rules) while in review or approved, so an
 * approval always covers exactly the content that was reviewed.
 *
 * Stage C3: published lessons are immutable. Changes go to a working revision
 * (lessons/{id}/revisions/working), which runs the same review cycle; publishing
 * it replaces the live content and records a new immutable version. Nobody may
 * review content they submitted or last edited. Publishing without a current
 * approval is a Super Admin override and requires a reason.
 */

import { AuditEntry, ContentAction, ContentReview, Course, CourseDesignResponsibility, EntityStatus, Lesson, LessonRevision, ReviewState, UserProfile } from '@/types/domain';
import { MIN_REASON_LENGTH } from '@/types/validation';
import { COURSE_WRITE, LESSON_WRITE, hasCourseDesignAuthority } from '@/lib/admin/course-design';

export class ReviewError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export type ReviewActor = Pick<UserProfile, 'id' | 'orgId' | 'role' | 'status' | 'courseDesign'>;

export interface ReviewTarget {
  type: 'course' | 'lesson';
  id: string;
  orgId: string;
  courseId: string;
  status: EntityStatus;
  review?: ContentReview;
  lastEditedById?: string;
  createdById?: string;
  /** Working revision of a published lesson (Stage C3), if one exists. */
  revision?: { review?: ContentReview; lastEditedById?: string };
}

/** Actions that apply to a published lesson's working revision rather than the lesson. */
const REVISION_ACTIONS: ContentAction[] = ['submit', 'reopen', 'approve', 'request_changes', 'publish'];

const STAFF_AUTHORS = ['university_admin', 'branch_admin', 'instructor'];
/** Course Design responsibilities that edit lessons; assessment designers edit quiz questions. */
export const LESSON_REVIEWABLE_WRITE: CourseDesignResponsibility[] = [...LESSON_WRITE, 'assessment_designer'];

export const reviewStateOf = (t: Pick<ReviewTarget, 'review'>): ReviewState => t.review?.state ?? 'none';

const isActive = (a: ReviewActor | null): a is ReviewActor => Boolean(a) && (a!.status ?? 'active') === 'active';

/**
 * May the actor author (edit and submit) this course or lesson? Mirrors
 * firestore.rules; for lessons, assessment designers count as authors (they
 * edit quiz questions through the assessment route).
 */
export function canAuthorTarget(
  actor: ReviewActor | null,
  target: Pick<ReviewTarget, 'type' | 'orgId'>,
  course: Pick<Course, 'id' | 'orgId' | 'status'>,
  lessonResponsibilities: CourseDesignResponsibility[] = LESSON_REVIEWABLE_WRITE
): boolean {
  if (!isActive(actor)) return false;
  if (actor.role === 'super_admin') return true;
  if (actor.orgId !== target.orgId) return false;
  // Staff edit courses only as drafts, and lessons in any course of their org.
  if (STAFF_AUTHORS.includes(actor.role)) return target.type === 'lesson' || course.status === 'draft';
  // Course Design members edit in-scope draft courses only.
  const responsibilities = target.type === 'course' ? COURSE_WRITE : lessonResponsibilities;
  return course.status === 'draft' && hasCourseDesignAuthority(actor, course, responsibilities);
}

/** May the actor write the whole lesson document (firestore.rules lesson update)? */
export function canEditLessonContent(actor: ReviewActor | null, lesson: Pick<ReviewTarget, 'orgId'>, course: Pick<Course, 'id' | 'orgId' | 'status'>): boolean {
  return canAuthorTarget(actor, { type: 'lesson', orgId: lesson.orgId }, course, LESSON_WRITE);
}

export function courseReviewTarget(c: Pick<Course, 'id' | 'orgId' | 'status' | 'review' | 'lastEditedById' | 'createdById'>): ReviewTarget {
  return { type: 'course', id: c.id, orgId: c.orgId, courseId: c.id, status: c.status, review: c.review, lastEditedById: c.lastEditedById, createdById: c.createdById };
}

export function lessonReviewTarget(
  l: Pick<Lesson, 'id' | 'orgId' | 'courseId' | 'status' | 'review' | 'lastEditedById'>,
  revision?: Pick<LessonRevision, 'review' | 'lastEditedById'> | null
): ReviewTarget {
  return {
    type: 'lesson', id: l.id, orgId: l.orgId, courseId: l.courseId, status: l.status, review: l.review, lastEditedById: l.lastEditedById,
    ...(revision ? { revision: { review: revision.review, lastEditedById: revision.lastEditedById } } : {}),
  };
}

/** May the actor review content of this course? Super Admin or an in-scope reviewer. */
export function canReview(actor: ReviewActor | null, course: Pick<Course, 'id' | 'orgId'>): boolean {
  if (!isActive(actor)) return false;
  return actor.role === 'super_admin' || hasCourseDesignAuthority(actor, course, ['reviewer']);
}

/** People who may not review this submission: its submitter and its last editors. */
export function conflictedReviewers(target: ReviewTarget, keyUpdatedById?: string): Set<string> {
  // Content saved before C2 has no editor record; the course creator is the best attribution.
  const editor = target.lastEditedById ?? target.createdById;
  return new Set([target.review?.submittedById, editor, keyUpdatedById].filter((x): x is string => Boolean(x)));
}

export interface PlannedAction {
  /** 'revision': the change applies to the working revision of a published lesson. */
  subject: 'target' | 'revision';
  patch: { status: EntityStatus; review: ContentReview };
  audit: Omit<AuditEntry, 'at'>;
}

const notAllowed = (msg = 'You can’t do that with this content.') => new ReviewError(403, 'not_allowed', msg);
const badState = (msg: string) => new ReviewError(409, 'invalid_transition', msg);

export function planContentAction(params: {
  actor: ReviewActor | null;
  target: ReviewTarget;
  course: Pick<Course, 'id' | 'orgId' | 'status'>;
  /** Last editor of the lesson's answer key, if any. */
  keyUpdatedById?: string;
  action: ContentAction;
  comment?: string;
  reason?: string;
  nowIso: string;
  /**
   * Server-computed fingerprint of the content being reviewed (Stage C3). When
   * given, approval records it and publishing refuses an approval of other content.
   */
  contentHash?: string;
}): PlannedAction {
  const { target, action } = params;
  const onRevision = target.type === 'lesson' && target.status === 'published' && REVISION_ACTIONS.includes(action);
  if (!onRevision) {
    if (target.revision && (action === 'unpublish' || action === 'archive')) {
      throw badState('This lesson has an unpublished revision. Publish or discard it first.');
    }
    return { subject: 'target', ...decide(params) };
  }
  if (!target.revision) throw badState('Start a revision in the Block Studio to change a published lesson.');
  // The revision is a draft of the next version; review it like any draft.
  const planned = decide({ ...params, target: { ...target, status: 'draft', review: target.revision.review, lastEditedById: target.revision.lastEditedById } });
  return {
    subject: 'revision',
    patch: { ...planned.patch, status: action === 'publish' ? 'published' : target.status },
    audit: { ...planned.audit, fromStatus: target.status, toStatus: 'published', revision: true },
  };
}

function decide(params: Parameters<typeof planContentAction>[0]): Omit<PlannedAction, 'subject'> {
  const { actor, target, course, keyUpdatedById, action, comment, reason, nowIso, contentHash } = params;
  if (!isActive(actor)) throw notAllowed();
  // Other organizations' content does not exist for the caller.
  if (actor.role !== 'super_admin' && actor.orgId !== target.orgId) throw new ReviewError(404, 'not_found', 'This content isn’t available.');

  const state = reviewStateOf(target);
  const isSuper = actor.role === 'super_admin';
  if (target.status === 'archived') throw badState('Archived content can’t change.');

  let next: { status: EntityStatus; review: ContentReview };
  let override = false;

  switch (action) {
    case 'submit': {
      if (!canAuthorTarget(actor, target, course)) throw notAllowed();
      if (target.status !== 'draft') throw badState('Only drafts can be submitted for review.');
      if (state !== 'none' && state !== 'changes_requested') throw badState('This draft is already in review or approved.');
      next = { status: 'draft', review: { state: 'in_review', submittedById: actor.id, submittedAt: nowIso } };
      break;
    }
    case 'reopen': {
      if (!canAuthorTarget(actor, target, course)) throw notAllowed();
      if (target.status !== 'draft' || (state !== 'in_review' && state !== 'approved')) throw badState('Only a draft in review or approved can be reopened for editing.');
      next = { status: 'draft', review: { state: 'none' } };
      break;
    }
    case 'approve':
    case 'request_changes': {
      if (!canReview(actor, course)) throw notAllowed('Only an assigned reviewer can review this content.');
      if (target.status !== 'draft' || state !== 'in_review') throw badState('Only content in review can be reviewed.');
      if (conflictedReviewers(target, keyUpdatedById).has(actor.id)) {
        throw notAllowed('You can’t review content you submitted or last edited.');
      }
      if (action === 'request_changes' && !comment) throw new ReviewError(400, 'comment_required', 'Explain what needs to change.');
      next = {
        status: 'draft',
        review: {
          ...target.review!, state: action === 'approve' ? 'approved' : 'changes_requested',
          reviewedById: actor.id, reviewedAt: nowIso, ...(comment ? { comment } : {}),
          ...(action === 'approve' && contentHash ? { approvedContentHash: contentHash } : {}),
        },
      };
      break;
    }
    case 'publish': {
      if (!isSuper) throw notAllowed('Only the Super Admin publishes content.');
      if (target.status !== 'draft') throw badState('Only drafts can be published.');
      // The approval must cover exactly the content being activated.
      const stale = state === 'approved' && contentHash !== undefined && target.review?.approvedContentHash !== contentHash;
      if (stale && !reason) {
        throw new ReviewError(409, 'stale_approval', 'This content changed after it was approved. Submit it for review again.');
      }
      if (state !== 'approved' || stale) {
        if (!reason || reason.length < MIN_REASON_LENGTH) {
          throw new ReviewError(400, 'reason_required', 'This content isn’t approved. Publishing it anyway needs a reason.');
        }
        override = true;
      }
      next = { status: 'published', review: { state: 'none' } };
      break;
    }
    case 'unpublish':
    case 'archive': {
      if (!isSuper) throw notAllowed(`Only the Super Admin can ${action} content.`);
      if (action === 'unpublish' && target.status !== 'published') throw badState('Only published content can be unpublished.');
      next = { status: action === 'archive' ? 'archived' : 'draft', review: { state: 'none' } };
      break;
    }
  }

  return {
    patch: next,
    audit: {
      orgId: target.orgId, courseId: target.courseId, targetType: target.type, targetId: target.id, action,
      actorId: actor.id, actorRole: actor.role,
      fromStatus: target.status, toStatus: next.status, fromReview: state, toReview: next.review.state,
      override, ...(comment ? { comment } : {}), ...(reason ? { reason } : {}),
    },
  };
}

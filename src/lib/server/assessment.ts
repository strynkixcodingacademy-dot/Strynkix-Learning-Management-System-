/**
 * Strynkix LMS — trusted assessment authoring (Stage C2).
 *
 * firestore.rules cannot tell quiz blocks from other blocks inside a lesson,
 * so an Assessment Designer cannot be allowed to write lessons directly. This
 * operation changes only the quiz questions: every other block stays exactly
 * as stored. The stripped lesson, the answer key (keyVersion + 1) and an audit
 * entry commit in one transaction.
 *
 * Allowed: Super Admin; University Admin, Branch Admin or Instructor of the
 * org; in-scope Course Design members (lead, curriculum_architect,
 * content_developer, assessment_designer) while the course is a draft.
 * Not while the lesson is in review or approved (content is frozen).
 *
 * Published lessons are immutable (Stage C3): their questions are edited in the
 * working revision and answerKey/working, which go live only when the revision
 * is reviewed and published.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { LessonAnswerKey, LessonBlock, LessonRevision, QuizBlock, UserProfile } from '@/types/domain';
import { assessmentUpdateRequestSchema, lessonAnswerKeySchema } from '@/types/validation';
import { splitQuizAnswers } from '@/lib/livebook/quiz';
import { ReviewError, canAuthorTarget, reviewStateOf } from '@/lib/review/workflow';
import { verifyCaller } from '@/lib/server/content-route';

const MAX_LESSON_BLOCKS = 50;

export interface AssessmentUpdateResult {
  lessonId: string;
  questionCount: number;
  keyVersion: number;
  /** True when the change went to the working revision of a published lesson. */
  revision: boolean;
}

/** Replaces quiz questions in place by id, drops removed ones and appends new ones. */
export function mergeQuizQuestions(blocks: LessonBlock[], questions: QuizBlock[]): LessonBlock[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const kept = blocks.flatMap((b): LessonBlock[] => {
    if (b.type !== 'quiz') return [b];
    const q = byId.get(b.id);
    if (!q) return [];
    byId.delete(b.id);
    return [q];
  });
  return [...kept, ...byId.values()];
}

export async function updateLessonAssessment(
  services: { db: Firestore; auth: Auth },
  idToken: string | null,
  body: unknown,
  now: () => Date = () => new Date()
): Promise<AssessmentUpdateResult> {
  const uid = await verifyCaller(services.auth, idToken);
  const parsed = assessmentUpdateRequestSchema.safeParse(body);
  if (!parsed.success) throw new ReviewError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'The request is malformed.');
  const { lessonId, questions } = parsed.data;
  const { db } = services;

  return db.runTransaction(async (tx) => {
    const lessonRef = db.doc(`lessons/${lessonId}`);
    const currentKeyRef = db.doc(`lessons/${lessonId}/answerKey/current`);
    const workingKeyRef = db.doc(`lessons/${lessonId}/answerKey/working`);
    const revisionRef = db.doc(`lessons/${lessonId}/revisions/working`);
    const [userSnap, lessonSnap, currentSnap, workingSnap, revisionSnap] = await Promise.all([
      tx.get(db.doc(`users/${uid}`)), tx.get(lessonRef), tx.get(currentKeyRef), tx.get(workingKeyRef), tx.get(revisionRef),
    ]);
    const user = userSnap.data();
    const lesson = lessonSnap.data();
    if (!lesson || typeof lesson.orgId !== 'string') throw new ReviewError(404, 'not_found', 'This lesson isn’t available.');
    const courseSnap = await tx.get(db.doc(`courses/${lesson.courseId}`));
    const course = courseSnap.data();
    if (!course || course.orgId !== lesson.orgId) throw new ReviewError(404, 'not_found', 'This lesson isn’t available.');

    const actor = user ? ({ ...user, id: uid } as UserProfile) : null;
    if (actor && actor.role !== 'super_admin' && actor.orgId !== lesson.orgId) throw new ReviewError(404, 'not_found', 'This lesson isn’t available.');
    const target = { type: 'lesson' as const, id: lessonId, orgId: lesson.orgId, courseId: lesson.courseId, status: lesson.status ?? 'draft', review: lesson.review };
    if (!canAuthorTarget(actor, target, { id: lesson.courseId, orgId: course.orgId, status: course.status ?? 'draft' })) {
      throw new ReviewError(403, 'not_allowed', 'You can’t edit this lesson’s assessment.');
    }
    if (target.status === 'archived') throw new ReviewError(409, 'invalid_transition', 'Archived content can’t change.');
    const onRevision = target.status === 'published';
    const revision = revisionSnap.data() as LessonRevision | undefined;
    const state = reviewStateOf(onRevision ? { review: revision?.review } : target);
    if (state === 'in_review' || state === 'approved') {
      throw new ReviewError(409, 'content_frozen', 'This lesson is in review or approved. Reopen it before editing.');
    }

    const merged = mergeQuizQuestions(((onRevision ? revision?.blocks : null) ?? lesson.blocks ?? []) as LessonBlock[], questions as QuizBlock[]);
    if (merged.length > MAX_LESSON_BLOCKS) throw new ReviewError(400, 'invalid_request', `A lesson can have at most ${MAX_LESSON_BLOCKS} blocks.`);
    const { blocks, items } = splitQuizAnswers(merged);
    const iso = now().toISOString();
    const current = currentSnap.data() as LessonAnswerKey | undefined;
    const working = workingSnap.data() as LessonAnswerKey | undefined;
    const key = lessonAnswerKeySchema.parse({
      orgId: lesson.orgId, courseId: lesson.courseId, lessonId,
      // The working key keeps the version it will have once published.
      keyVersion: onRevision ? working?.keyVersion ?? (current?.keyVersion ?? 0) + 1 : current ? Number(current.keyVersion) + 1 : 1,
      release: 'after_pass', items, updatedById: uid, updatedAt: iso,
    });

    if (onRevision) {
      if (revision) {
        tx.update(revisionRef, { blocks, lastEditedById: uid, updatedAt: iso });
      } else {
        tx.create(revisionRef, {
          title: lesson.title, estimatedMinutes: lesson.estimatedMinutes ?? 20, blocks, baseVersion: lesson.publishedVersion ?? 0,
          lastEditedById: uid, createdAt: iso, updatedAt: iso,
        });
      }
      tx.set(workingKeyRef, key);
    } else {
      tx.update(lessonRef, { blocks, lastEditedById: uid, updatedAt: iso });
      tx.set(currentKeyRef, key);
    }
    tx.create(db.collection('auditLog').doc(), {
      orgId: lesson.orgId, courseId: lesson.courseId, targetType: 'lesson', targetId: lessonId, action: 'assessment_update',
      actorId: uid, actorRole: actor!.role, fromStatus: target.status, toStatus: target.status, fromReview: state, toReview: state,
      override: false, revision: onRevision, comment: `${items.length} question(s), answer key v${key.keyVersion}${onRevision ? ' (revision)' : ''}`,
      at: FieldValue.serverTimestamp(),
    });
    return { lessonId, questionCount: items.length, keyVersion: key.keyVersion, revision: onRevision };
  });
}

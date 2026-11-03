/**
 * Strynkix LMS — trusted Block Studio saves (milestone G50).
 *
 * The full Studio sends the lesson's blocks with quiz answers inline; the
 * server validates them, strips the answers into the confidential answer key
 * and writes, in one transaction with a `lesson_content_update` audit entry:
 * - a draft lesson: the lesson and answerKey/current (key version + 1);
 * - a published lesson: its working revision and answerKey/working (the
 *   version the key will have once published). Published content itself is
 *   never touched (Stage C3).
 * Authority mirrors firestore.rules (canEditLessonContent); content in review
 * or approved is frozen. firestore.rules refuse client writes to answer keys.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { Course, LessonAnswerKey, LessonBlock } from '@/types/domain';
import { idSchema, lessonAnswerKeySchema, lessonBlockSchema, lessonSchema, quizAuthoringSchema } from '@/types/validation';
import { splitQuizAnswers } from '@/lib/livebook/quiz';
import { validateUserProfile } from '@/lib/auth/profile';
import { ReviewError, canEditLessonContent, isContentFrozen } from '@/lib/review/workflow';
import { verifyCaller } from '@/lib/server/content-route';

export const lessonSaveSchema = z.object({
  lessonId: idSchema,
  title: lessonSchema.shape.title,
  estimatedMinutes: lessonSchema.shape.estimatedMinutes,
  blocks: z.array(z.unknown()).max(50),
}).strict();

export async function saveLessonFromStudio(services: { db: Firestore; auth: Auth }, idToken: string | null, body: unknown) {
  const uid = await verifyCaller(services.auth, idToken);
  const parsed = lessonSaveSchema.safeParse(body);
  if (!parsed.success) throw new ReviewError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'The lesson is malformed.');
  const req = parsed.data;
  // Every block must be valid, and every quiz question complete (answer + explanation).
  const blocks: LessonBlock[] = [];
  for (const [i, raw] of req.blocks.entries()) {
    const b = lessonBlockSchema.safeParse(raw);
    if (!b.success) throw new ReviewError(400, 'invalid_request', `Block ${i + 1} is invalid: ${b.error.issues[0]?.message ?? 'check its fields'}.`);
    if (b.data.type === 'quiz' && !quizAuthoringSchema.safeParse(b.data).success) {
      throw new ReviewError(400, 'invalid_request', `Quiz question in block ${i + 1} needs a correct option and an explanation.`);
    }
    blocks.push(b.data as LessonBlock);
  }
  let split: ReturnType<typeof splitQuizAnswers>;
  try {
    split = splitQuizAnswers(blocks);
  } catch (err) {
    throw new ReviewError(400, 'invalid_request', (err as Error).message);
  }
  const { db } = services;

  return db.runTransaction(async (tx) => {
    const lessonRef = db.doc(`lessons/${req.lessonId}`);
    const [actorSnap, lessonSnap] = await Promise.all([tx.get(db.doc(`users/${uid}`)), tx.get(lessonRef)]);
    const actor = actorSnap.exists ? validateUserProfile(uid, actorSnap.data()).profile : null;
    const lesson = lessonSnap.data();
    if (!lesson) throw new ReviewError(404, 'not_found', 'This lesson isn’t available.');
    if (actor && actor.role !== 'super_admin' && actor.orgId !== lesson.orgId) throw new ReviewError(404, 'not_found', 'This lesson isn’t available.');
    const course = (await tx.get(db.doc(`courses/${lesson.courseId}`))).data();
    if (!course || course.orgId !== lesson.orgId) throw new ReviewError(404, 'not_found', 'This lesson isn’t available.');
    if (!actor || actor.status !== 'active' || !canEditLessonContent({ ...actor, id: uid }, { orgId: lesson.orgId }, { id: lesson.courseId, orgId: course.orgId, status: (course.status ?? 'draft') as Course['status'] })) {
      throw new ReviewError(403, 'not_allowed', 'You can’t edit this lesson.');
    }
    const status = lesson.status ?? 'draft';
    if (status === 'archived') throw new ReviewError(409, 'invalid_transition', 'Archived lessons can’t be edited.');
    const onRevision = status === 'published';
    const revisionRef = lessonRef.collection('revisions').doc('working');
    const [currentSnap, workingSnap, revisionSnap] = await Promise.all([
      tx.get(lessonRef.collection('answerKey').doc('current')),
      tx.get(lessonRef.collection('answerKey').doc('working')),
      tx.get(revisionRef),
    ]);
    const revision = revisionSnap.data();
    if (onRevision ? isContentFrozen({ review: revision?.review }) : isContentFrozen({ review: lesson.review })) {
      throw new ReviewError(409, 'content_frozen', 'This lesson is in review or approved. Reopen it before editing.');
    }
    const current = currentSnap.data() as LessonAnswerKey | undefined;
    const working = workingSnap.data() as LessonAnswerKey | undefined;
    const iso = new Date().toISOString();
    const keyFor = (keyVersion: number) => lessonAnswerKeySchema.parse({
      orgId: lesson.orgId, courseId: lesson.courseId, lessonId: req.lessonId, keyVersion, release: 'after_pass', items: split.items, updatedById: uid, updatedAt: iso,
    });

    let keyVersion: number | null = null;
    if (onRevision) {
      tx.set(revisionRef, {
        title: req.title, estimatedMinutes: req.estimatedMinutes, blocks: split.blocks,
        baseVersion: revision ? revision.baseVersion : lesson.publishedVersion ?? 0,
        ...(revision?.review ? { review: revision.review } : {}),
        lastEditedById: uid, createdAt: revision?.createdAt ?? iso, updatedAt: iso,
      });
      if (split.items.length > 0 || working || current) {
        keyVersion = working ? Number(working.keyVersion) : (current ? Number(current.keyVersion) : 0) + 1;
        tx.set(workingSnap.ref, keyFor(keyVersion));
      }
    } else {
      tx.update(lessonRef, { title: req.title, estimatedMinutes: req.estimatedMinutes, blocks: split.blocks, lastEditedById: uid, updatedAt: iso });
      if (split.items.length > 0 || current) {
        keyVersion = current ? Number(current.keyVersion) + 1 : 1;
        tx.set(currentSnap.ref, keyFor(keyVersion));
      }
    }
    // Counts only: the audit log never stores questions or answers.
    tx.create(db.collection('auditLog').doc(), {
      orgId: lesson.orgId, courseId: lesson.courseId, targetType: 'lesson', targetId: req.lessonId, action: 'lesson_content_update',
      actorId: uid, actorRole: actor.role, revision: onRevision, blockCount: split.blocks.length, questionCount: split.items.length,
      ...(keyVersion !== null ? { keyVersion } : {}), at: FieldValue.serverTimestamp(),
    });
    return { lessonId: req.lessonId, revision: onRevision, questionCount: split.items.length, keyVersion };
  });
}

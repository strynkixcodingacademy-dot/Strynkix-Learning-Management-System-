/**
 * Strynkix LMS — trusted review and publication transitions (Stage C2).
 * Identity, role, scope, current state and time all come from the server; the
 * state change and its audit entry commit in one transaction, with the audit
 * time set by Firestore (serverTimestamp).
 */

import { createHash } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { ContentReview, Course, EntityStatus, Lesson, LessonAnswerKey, LessonRevision, UserProfile } from '@/types/domain';
import { contentActionRequestSchema, lessonAnswerKeySchema } from '@/types/validation';
import { ReviewError, ReviewTarget, planContentAction } from '@/lib/review/workflow';
import { buildPublishedLesson, courseSnapshotFields, versionId } from '@/lib/review/versioning';
import { verifyCaller } from '@/lib/server/content-route';

export interface ContentActionResult {
  targetType: 'course' | 'lesson';
  targetId: string;
  status: EntityStatus;
  review: ContentReview;
  override: boolean;
  auditId: string;
  subject: 'target' | 'revision';
  /** Version created when the action was a publish. */
  version?: number;
}

/** JSON with sorted keys, so a fingerprint doesn't depend on field order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Fingerprint of what a reviewer approves: content plus answer key (Stage C3). */
export function contentFingerprint(content: unknown): string {
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

const notFound = () => new ReviewError(404, 'not_found', 'This content isn’t available.');

export async function performContentAction(
  services: { db: Firestore; auth: Auth },
  idToken: string | null,
  body: unknown,
  now: () => Date = () => new Date()
): Promise<ContentActionResult> {
  const uid = await verifyCaller(services.auth, idToken);
  const parsed = contentActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    const reasonIssue = parsed.error.issues.find((i) => i.path[0] === 'reason');
    throw new ReviewError(400, reasonIssue ? 'reason_required' : 'invalid_request', reasonIssue?.message ?? 'The request is malformed.');
  }
  const { targetType, targetId, action, comment, reason } = parsed.data;
  const { db } = services;

  return db.runTransaction(async (tx) => {
    const targetRef = db.doc(`${targetType === 'course' ? 'courses' : 'lessons'}/${targetId}`);
    const [userSnap, targetSnap] = await Promise.all([tx.get(db.doc(`users/${uid}`)), tx.get(targetRef)]);
    const user = userSnap.data();
    const data = targetSnap.data();
    if (!data || typeof data.orgId !== 'string') throw notFound();
    const isLesson = targetType === 'lesson';
    const courseId: string = isLesson ? data.courseId : targetId;
    const revisionRef = db.doc(`lessons/${targetId}/revisions/working`);
    const currentKeyRef = db.doc(`lessons/${targetId}/answerKey/current`);
    const workingKeyRef = db.doc(`lessons/${targetId}/answerKey/working`);
    const [courseSnap, keySnap, revisionSnap, workingSnap] = await Promise.all([
      isLesson ? tx.get(db.doc(`courses/${courseId}`)) : Promise.resolve(targetSnap),
      isLesson ? tx.get(currentKeyRef) : Promise.resolve(null),
      isLesson ? tx.get(revisionRef) : Promise.resolve(null),
      isLesson ? tx.get(workingKeyRef) : Promise.resolve(null),
    ]);
    const course = courseSnap.data();
    if (!course || course.orgId !== data.orgId) throw notFound();
    const currentKey = keySnap?.data() as LessonAnswerKey | undefined;
    const revision = revisionSnap?.data() as LessonRevision | undefined;
    const workingKey = workingSnap?.data() as LessonAnswerKey | undefined;

    const target: ReviewTarget = {
      type: targetType, id: targetId, orgId: data.orgId, courseId, status: data.status ?? 'draft',
      review: data.review, lastEditedById: data.lastEditedById, createdById: data.createdById,
      ...(revision ? { revision: { review: revision.review, lastEditedById: revision.lastEditedById } } : {}),
    };
    // What a reviewer sees and approves: the revision of a published lesson,
    // otherwise the draft itself, with the answers that would be graded.
    const reviewed = revision ?? data;
    const contentHash = contentFingerprint(isLesson
      ? { title: reviewed.title ?? null, estimatedMinutes: reviewed.estimatedMinutes ?? null, blocks: reviewed.blocks ?? [], items: ((revision ? workingKey ?? currentKey : currentKey)?.items ?? []) }
      : courseSnapshotFields(data as Course));
    const plan = planContentAction({
      actor: user ? ({ ...user, id: uid } as UserProfile) : null,
      target,
      course: { id: courseId, orgId: course.orgId, status: (course.status ?? 'draft') as Course['status'] },
      // A revision's answers are edited in the working key.
      keyUpdatedById: (revision ? workingKey ?? currentKey : currentKey)?.updatedById,
      action, comment, reason, nowIso: now().toISOString(), contentHash,
    });

    const iso = now().toISOString();
    const auditRef = db.collection('auditLog').doc();
    let version: number | undefined;

    if (action === 'publish') {
      const subjectReview = plan.subject === 'revision' ? revision!.review : data.review;
      const approvedById = subjectReview?.state === 'approved' ? subjectReview.reviewedById ?? null : null;
      const stamp = { publishedById: uid, approvedById, override: plan.audit.override, auditId: auditRef.id, publishedAt: FieldValue.serverTimestamp() };
      let n = (data.publishedVersion ?? 0) + 1;
      if (isLesson) {
        if (plan.subject === 'revision' && !data.publishedVersion) {
          // Content that was live before versioning existed becomes version 1.
          tx.create(db.doc(`lessons/${targetId}/versions/${versionId(n)}`), {
            version: n, orgId: data.orgId, courseId, lessonId: targetId, moduleId: data.moduleId ?? null, title: data.title ?? '',
            estimatedMinutes: data.estimatedMinutes ?? 0, blocks: data.blocks ?? [],
            answerKey: currentKey ? { keyVersion: currentKey.keyVersion, items: currentKey.items } : null,
            ...stamp, publishedById: data.lastEditedById ?? null, approvedById: null, override: false, baseline: true, auditId: null,
          });
          n += 1;
        }
        const source = plan.subject === 'revision' ? revision! : (data as Lesson);
        const built = buildPublishedLesson({ blocks: source.blocks ?? [], workingKey: plan.subject === 'revision' ? workingKey : null, currentKey });
        tx.update(targetRef, {
          blocks: built.blocks, status: 'published', review: { state: 'none' }, publishedVersion: n, publishedAt: iso, updatedAt: iso,
          ...(plan.subject === 'revision'
            ? { title: revision!.title, estimatedMinutes: revision!.estimatedMinutes, lastEditedById: revision!.lastEditedById }
            : {}),
        });
        if (built.keyChanged) {
          tx.set(currentKeyRef, lessonAnswerKeySchema.parse({
            orgId: data.orgId, courseId, lessonId: targetId, keyVersion: built.keyVersion, release: 'after_pass', items: built.items,
            updatedById: (plan.subject === 'revision' ? workingKey?.updatedById : currentKey?.updatedById) ?? uid, updatedAt: iso,
          }));
        }
        tx.create(db.doc(`lessons/${targetId}/versions/${versionId(n)}`), {
          version: n, orgId: data.orgId, courseId, lessonId: targetId, moduleId: data.moduleId ?? null, title: source.title ?? '',
          estimatedMinutes: source.estimatedMinutes ?? 0, blocks: built.blocks,
          answerKey: built.keyVersion === null ? null : { keyVersion: built.keyVersion, items: built.items },
          ...stamp, baseline: false,
        });
        if (revision) tx.delete(revisionRef);
        if (workingKey) tx.delete(workingKeyRef);
      } else {
        tx.update(targetRef, { status: 'published', review: { state: 'none' }, publishedVersion: n, publishedAt: iso, updatedAt: iso });
        tx.create(db.doc(`courses/${targetId}/versions/${versionId(n)}`), {
          version: n, orgId: data.orgId, courseId, ...courseSnapshotFields(data as Course), ...stamp,
        });
      }
      version = n;
    } else if (plan.subject === 'revision') {
      tx.update(revisionRef, { review: plan.patch.review, updatedAt: iso });
    } else {
      tx.update(targetRef, { status: plan.patch.status, review: plan.patch.review, updatedAt: iso });
    }

    tx.create(auditRef, { ...plan.audit, ...(version ? { version } : {}), at: FieldValue.serverTimestamp() });
    return { targetType, targetId, ...plan.patch, override: plan.audit.override, auditId: auditRef.id, subject: plan.subject, ...(version ? { version } : {}) };
  });
}

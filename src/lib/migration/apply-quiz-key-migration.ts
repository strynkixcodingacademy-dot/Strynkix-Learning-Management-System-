/**
 * Strynkix LMS — Stage C4 legacy quiz migration: inventory and apply (Admin SDK).
 *
 * Each lesson migrates in its own transaction, re-reading and re-classifying it
 * first, so a rerun or a concurrent edit can never double-apply or clobber
 * newer content. The transaction strips the inline answers, writes the answer
 * key, keeps the original blocks in lessons/{id}/legacyBackup/c4 (no client may
 * read it) and writes an auditLog entry with counts only. The run as a whole is
 * NOT atomic: lessons that fail are reported and can be retried.
 *
 * Published versions, revisions, progress, enrollments and attempts are never
 * modified; revisions and versions that still carry answers are reported.
 */

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { LessonAnswerKey, LessonBlock, ReviewState } from '@/types/domain';
import { lessonAnswerKeySchema } from '@/types/validation';
import { QuizMigrationDecision, blocksExposeAnswers, classifyLessonQuiz } from '@/lib/migration/quiz-key-migration';

export interface QuizInventory {
  decisions: QuizMigrationDecision[];
  /** Working revisions whose blocks still carry answers (staff-only; manual). */
  revisionsWithAnswers: string[];
  /** Published versions whose blocks still carry answers (staff-only, immutable; reported only). */
  versionsWithAnswers: string[];
}

function stateOf(id: string, data: FirebaseFirestore.DocumentData, key: LessonAnswerKey | undefined) {
  return {
    lessonId: id, orgId: data.orgId, courseId: data.courseId, status: data.status ?? 'draft',
    reviewState: (data.review?.state ?? 'none') as ReviewState,
    blocks: (Array.isArray(data.blocks) ? data.blocks : []) as LessonBlock[],
    currentKey: key ?? null,
  };
}

/** Read-only: classifies every lesson and scans revisions and versions. */
export async function loadQuizInventory(db: Firestore): Promise<QuizInventory> {
  const lessons = await db.collection('lessons').get();
  const keyRefs = lessons.docs.map((d) => db.doc(`lessons/${d.id}/answerKey/current`));
  const keys = keyRefs.length ? await db.getAll(...keyRefs) : [];
  const decisions = lessons.docs.map((d, i) => classifyLessonQuiz(stateOf(d.id, d.data(), keys[i].data() as LessonAnswerKey | undefined)));

  const revisions = await db.collectionGroup('revisions').get();
  const versions = await db.collectionGroup('versions').get();
  return {
    decisions,
    revisionsWithAnswers: revisions.docs.filter((d) => blocksExposeAnswers(d.data().blocks)).map((d) => d.ref.path),
    versionsWithAnswers: versions.docs.filter((d) => d.ref.parent.parent?.parent.id === 'lessons' && blocksExposeAnswers(d.data().blocks)).map((d) => d.ref.path),
  };
}

export interface QuizMigrationResult {
  migrated: string[];
  /** Lessons that no longer needed migrating when re-read inside their transaction. */
  skipped: Array<{ lessonId: string; reason: string }>;
  failed: Array<{ lessonId: string; error: string }>;
}

export async function applyQuizKeyMigration(db: Firestore, lessonIds: string[], runId: string, now: () => Date = () => new Date()): Promise<QuizMigrationResult> {
  const result: QuizMigrationResult = { migrated: [], skipped: [], failed: [] };
  for (const lessonId of lessonIds) {
    try {
      const outcome = await db.runTransaction(async (tx) => {
        const lessonRef = db.doc(`lessons/${lessonId}`);
        const keyRef = db.doc(`lessons/${lessonId}/answerKey/current`);
        const [lessonSnap, keySnap] = await Promise.all([tx.get(lessonRef), tx.get(keyRef)]);
        const data = lessonSnap.data();
        if (!data) return 'lesson_missing';
        const decision = classifyLessonQuiz(stateOf(lessonId, data, keySnap.data() as LessonAnswerKey | undefined));
        if (decision.action !== 'migrate' || !decision.plan) return `now_${decision.format}`;
        const iso = now().toISOString();
        const { plan } = decision;
        if (plan.writeKey) {
          tx.set(keyRef, lessonAnswerKeySchema.parse({
            orgId: data.orgId, courseId: data.courseId, lessonId, keyVersion: plan.keyVersion, release: 'after_pass',
            items: plan.items, updatedById: `migration_${runId}`.slice(0, 128).replace(/[^A-Za-z0-9_-]/g, '_'), updatedAt: iso,
          }));
        }
        tx.update(lessonRef, { blocks: plan.blocks, updatedAt: iso });
        // Recovery copy of the original blocks; create() fails rather than overwrite an earlier copy.
        tx.create(db.doc(`lessons/${lessonId}/legacyBackup/c4`), { runId, blocks: data.blocks, capturedAt: FieldValue.serverTimestamp() });
        tx.create(db.collection('auditLog').doc(), {
          orgId: data.orgId, courseId: data.courseId, targetType: 'lesson', targetId: lessonId, action: 'assessment_migration',
          actorId: `migration:${runId}`, actorRole: 'system', fromStatus: decision.status, toStatus: decision.status,
          fromReview: data.review?.state ?? 'none', toReview: data.review?.state ?? 'none', override: false,
          comment: `${plan.items.length} question(s) moved to answer key v${plan.keyVersion}${decision.approvalInvalidated ? '; approval must be renewed' : ''}`,
          at: FieldValue.serverTimestamp(),
        });
        return 'migrated';
      });
      if (outcome === 'migrated') result.migrated.push(lessonId);
      else result.skipped.push({ lessonId, reason: outcome });
    } catch (err) {
      // Messages from Firestore and Zod name fields, not values.
      result.failed.push({ lessonId, error: err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'unknown error' });
    }
  }
  return result;
}

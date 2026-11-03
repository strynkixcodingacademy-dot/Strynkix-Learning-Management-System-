/**
 * Strynkix LMS — trusted course-structure maintenance (milestone G28–G30, G50).
 *
 * One route for the changes that reshape a course: course details, module
 * details, module order, deleting an empty module, lesson order, moving a
 * lesson to another module and deleting a never-published draft lesson. Every
 * change is authorized and validated here, applied in one transaction with
 * an audit entry, and refused if it would alter published content:
 * - course details and modules change only while the course is a draft
 *   (published course content is immutable, Stage C3), and course details not
 *   while the course is in review or approved (the approval covers them);
 * - published lessons keep their place: only draft lessons are reordered,
 *   moved or deleted, and a lesson that was ever published is never deleted.
 * Authority mirrors firestore.rules (canAuthorTarget / canEditLessonContent);
 * deleting is Super Admin only, as in the rules.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ContentReview, Course, UserProfile } from '@/types/domain';
import { courseSchema, idSchema, moduleSchema } from '@/types/validation';
import { ReviewError, canAuthorTarget, canEditLessonContent, isContentFrozen } from '@/lib/review/workflow';
import { verifyCaller } from '@/lib/server/content-route';
import { validateUserProfile } from '@/lib/auth/profile';

// Built field by field: courseSchema's `.default([])` would otherwise fill in
// fields the request didn't send and silently wipe them.
const courseFields = z.object({
  title: courseSchema.shape.title.optional(),
  tagline: courseSchema.shape.tagline.optional(),
  description: courseSchema.shape.description.optional(),
  level: courseSchema.shape.level.optional(),
  tags: z.array(z.string().max(40)).max(15).optional(),
  prerequisites: z.array(z.string().max(100)).max(10).optional(),
  estimatedWeeks: courseSchema.shape.estimatedWeeks.optional(),
}).strict();
const moduleFields = moduleSchema.pick({ title: true, summary: true }).partial().strict();
const direction = z.enum(['up', 'down']);

export const structureRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update_course'), courseId: idSchema, fields: courseFields }).strict(),
  z.object({ action: z.literal('update_module'), moduleId: idSchema, fields: moduleFields }).strict(),
  z.object({ action: z.literal('reorder_module'), moduleId: idSchema, direction }).strict(),
  z.object({ action: z.literal('delete_module'), moduleId: idSchema }).strict(),
  z.object({ action: z.literal('reorder_lesson'), lessonId: idSchema, direction }).strict(),
  z.object({ action: z.literal('move_lesson'), lessonId: idSchema, toModuleId: idSchema }).strict(),
  z.object({ action: z.literal('delete_lesson'), lessonId: idSchema }).strict(),
]);
export type StructureRequest = z.infer<typeof structureRequestSchema>;

const notFound = () => new ReviewError(404, 'not_found', 'This content isn’t available.');
const denied = (msg = 'You can’t change this course.') => new ReviewError(403, 'not_allowed', msg);
const conflict = (msg: string) => new ReviewError(409, 'invalid_transition', msg);

type Doc = FirebaseFirestore.DocumentData & { id: string; review?: ContentReview };
const byOrder = (a: Doc, b: Doc) => (Number(a.orderIndex ?? 0) - Number(b.orderIndex ?? 0)) || a.id.localeCompare(b.id);

async function loadCourse(tx: Transaction, db: Firestore, courseId: string, actor: UserProfile): Promise<Doc> {
  const snap = await tx.get(db.doc(`courses/${courseId}`));
  const c = snap.data();
  if (!c || (actor.role !== 'super_admin' && c.orgId !== actor.orgId)) throw notFound();
  return { id: snap.id, ...c };
}

const courseRef = (c: Doc) => ({ id: c.id, orgId: c.orgId as string, status: (c.status ?? 'draft') as Course['status'] });

function requireDraftCourse(c: Doc) {
  if ((c.status ?? 'draft') !== 'draft') throw conflict('Published courses can’t be restructured; only draft courses can change.');
}

export async function changeStructure(services: { db: Firestore; auth: Auth }, idToken: string | null, body: unknown) {
  const uid = await verifyCaller(services.auth, idToken);
  const parsed = structureRequestSchema.safeParse(body);
  if (!parsed.success) throw new ReviewError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'The request is malformed.');
  const req = parsed.data;
  const { db } = services;

  return db.runTransaction(async (tx) => {
    const actorSnap = await tx.get(db.doc(`users/${uid}`));
    const actor = actorSnap.exists ? validateUserProfile(uid, actorSnap.data()).profile : null;
    if (!actor || actor.status !== 'active') throw denied();
    const reviewActor = { ...actor, id: uid };
    const iso = new Date().toISOString();
    const audit = (orgId: string, courseId: string, targetType: string, targetId: string, extra: Record<string, unknown>) =>
      tx.create(db.collection('auditLog').doc(), {
        orgId, courseId, targetType, targetId, action: req.action, actorId: uid, actorRole: actor.role, ...extra, at: FieldValue.serverTimestamp(),
      });

    switch (req.action) {
      case 'update_course': {
        const course = await loadCourse(tx, db, req.courseId, actor);
        requireDraftCourse(course);
        if (!canAuthorTarget(reviewActor, { type: 'course', orgId: course.orgId }, courseRef(course))) throw denied();
        if (isContentFrozen(course)) throw conflict('This course is in review or approved. Reopen it before editing its details.');
        const fields = Object.fromEntries(Object.entries(req.fields).filter(([, v]) => v !== undefined));
        if (!Object.keys(fields).length) throw new ReviewError(400, 'invalid_request', 'Nothing to change.');
        tx.update(db.doc(`courses/${course.id}`), { ...fields, lastEditedById: uid, updatedAt: iso });
        audit(course.orgId, course.id, 'course', course.id, { fields: Object.keys(fields).sort() });
        return { ok: true };
      }
      case 'update_module':
      case 'reorder_module':
      case 'delete_module': {
        const modSnap = await tx.get(db.doc(`modules/${req.moduleId}`));
        const mod = modSnap.data();
        if (!mod) throw notFound();
        const course = await loadCourse(tx, db, mod.courseId, actor);
        if (course.orgId !== mod.orgId) throw notFound();
        requireDraftCourse(course);
        if (req.action === 'delete_module' ? actor.role !== 'super_admin' : !canAuthorTarget(reviewActor, { type: 'course', orgId: course.orgId }, courseRef(course))) {
          throw denied(req.action === 'delete_module' ? 'Only the Super Admin deletes modules.' : undefined);
        }
        if (req.action === 'update_module') {
          const fields = Object.fromEntries(Object.entries(req.fields).filter(([, v]) => v !== undefined));
          if (!Object.keys(fields).length) throw new ReviewError(400, 'invalid_request', 'Nothing to change.');
          tx.update(modSnap.ref, { ...fields, updatedAt: iso });
          audit(course.orgId, course.id, 'module', req.moduleId, { fields: Object.keys(fields).sort() });
          return { ok: true };
        }
        if (req.action === 'delete_module') {
          const lessons = await tx.get(db.collection('lessons').where('courseId', '==', course.id).where('moduleId', '==', req.moduleId).limit(1));
          if (!lessons.empty) throw conflict('Move or delete this module’s lessons first.');
          tx.delete(modSnap.ref);
          audit(course.orgId, course.id, 'module', req.moduleId, { title: mod.title ?? '' });
          return { ok: true };
        }
        // Reorder: renumber the course's modules 1..n in the new order (modules aren't versioned).
        const mods = (await tx.get(db.collection('modules').where('courseId', '==', course.id))).docs
          .map((d) => ({ id: d.id, ...d.data() }) as Doc).filter((m) => m.orgId === course.orgId).sort(byOrder);
        const i = mods.findIndex((m) => m.id === req.moduleId);
        const j = req.direction === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= mods.length) throw conflict('This module is already at that end.');
        [mods[i], mods[j]] = [mods[j], mods[i]];
        mods.forEach((m, n) => { if (Number(m.orderIndex) !== n + 1) tx.update(db.doc(`modules/${m.id}`), { orderIndex: n + 1, updatedAt: iso }); });
        audit(course.orgId, course.id, 'module', req.moduleId, { direction: req.direction });
        return { ok: true };
      }
      case 'reorder_lesson':
      case 'move_lesson':
      case 'delete_lesson': {
        const lessonSnap = await tx.get(db.doc(`lessons/${req.lessonId}`));
        const lesson = lessonSnap.data();
        if (!lesson) throw notFound();
        const course = await loadCourse(tx, db, lesson.courseId, actor);
        if (course.orgId !== lesson.orgId) throw notFound();
        if (req.action === 'delete_lesson' ? actor.role !== 'super_admin' : !canEditLessonContent(reviewActor, { orgId: lesson.orgId }, courseRef(course))) {
          throw denied(req.action === 'delete_lesson' ? 'Only the Super Admin deletes lessons.' : 'You can’t change this lesson.');
        }
        if ((lesson.status ?? 'draft') !== 'draft') throw conflict('Published lessons keep their place. Only draft lessons can be moved, reordered or deleted.');
        if (isContentFrozen(lesson)) throw conflict('This lesson is in review or approved. Reopen it first.');

        if (req.action === 'delete_lesson') {
          if (lesson.publishedVersion) throw conflict('This lesson was published before; its history is kept, so it can’t be deleted. Archive it instead.');
          const keys = await tx.get(lessonSnap.ref.collection('answerKey'));
          keys.docs.forEach((k) => tx.delete(k.ref));
          tx.delete(lessonSnap.ref);
          audit(course.orgId, course.id, 'lesson', req.lessonId, { title: lesson.title ?? '' });
          return { ok: true };
        }
        if (req.action === 'move_lesson') {
          const target = (await tx.get(db.doc(`modules/${req.toModuleId}`))).data();
          if (!target || target.courseId !== course.id || target.orgId !== course.orgId) throw new ReviewError(400, 'invalid_request', 'Choose a module of the same course.');
          if (req.toModuleId === lesson.moduleId) throw conflict('The lesson is already in that module.');
          const siblings = (await tx.get(db.collection('lessons').where('courseId', '==', course.id).where('moduleId', '==', req.toModuleId))).docs;
          const last = siblings.reduce((max, d) => Math.max(max, Number(d.data().orderIndex ?? 0)), 0);
          tx.update(lessonSnap.ref, { moduleId: req.toModuleId, orderIndex: last + 1, lastEditedById: uid, updatedAt: iso });
          audit(course.orgId, course.id, 'lesson', req.lessonId, { fromModuleId: lesson.moduleId, toModuleId: req.toModuleId });
          return { ok: true };
        }
        // Reorder within the module: swap with the neighbour, which must also be a draft.
        const siblings = (await tx.get(db.collection('lessons').where('courseId', '==', course.id).where('moduleId', '==', lesson.moduleId))).docs
          .map((d) => ({ id: d.id, ...d.data() }) as Doc).filter((l) => l.orgId === course.orgId).sort(byOrder);
        const i = siblings.findIndex((l) => l.id === req.lessonId);
        const j = req.direction === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= siblings.length) throw conflict('This lesson is already at that end.');
        const other = siblings[j];
        if ((other.status ?? 'draft') !== 'draft' || isContentFrozen(other)) throw conflict('The neighbouring lesson is published or in review, so these two can’t swap places.');
        const a = Number(siblings[i].orderIndex ?? 0);
        let b = Number(other.orderIndex ?? 0);
        if (a === b) b = req.direction === 'up' ? a - 1 : a + 1;
        tx.update(lessonSnap.ref, { orderIndex: b, lastEditedById: uid, updatedAt: iso });
        tx.update(db.doc(`lessons/${other.id}`), { orderIndex: a, lastEditedById: uid, updatedAt: iso });
        audit(course.orgId, course.id, 'lesson', req.lessonId, { direction: req.direction, swappedWith: other.id });
        return { ok: true };
      }
    }
  });
}

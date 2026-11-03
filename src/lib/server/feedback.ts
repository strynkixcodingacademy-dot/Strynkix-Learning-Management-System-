import 'server-only';

/**
 * Strynkix LMS — structured student feedback (Stage 10).
 *
 * - Students give feedback only on things they are part of: their courses,
 *   lessons of those courses, assignments they submitted, the teaching in their
 *   batch, learning materials, their branch's facilities, their academy.
 * - One response per student per target (deterministic id). Corrections are
 *   allowed for 7 days while staff haven't acted on it (max 3 edits), with
 *   each previous version kept in history.
 * - "Hide my name" hides the student's identity in every staff view. The
 *   record still stores who submitted it (to prevent duplicates and check
 *   eligibility), and the form says so — it is not promised as anonymous.
 * - Averages appear only with at least MIN_FEEDBACK_RESPONSES responses; no
 *   rankings. Themes come from the tags students choose (no automated analysis).
 * - Instructors see feedback about their batches and courses; managers their
 *   branch or academy; facilities and overall feedback go to managers only.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore, type Query } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema, planDateSchema } from '@/types/validation';
import type { Batch, Enrollment } from '@/types/domain';
import { MIN_FEEDBACK_RESPONSES, ratingSummary } from '@/lib/engagement/streaks';
import { type Actor, canManageBranch, conflict, denied, displayName, getDocData, invalid, isAcademyManager, isSuper, loadActor, notFound, parseBody } from '@/lib/server/academy-scope';
import { notify } from '@/lib/server/notifications';

export const FEEDBACK_TARGETS = ['course', 'lesson', 'assignment', 'teaching', 'materials', 'facilities', 'overall'] as const;
export type FeedbackTarget = (typeof FEEDBACK_TARGETS)[number];
export const POSITIVE_TAGS = ['Clear explanations', 'Helpful examples', 'Good pace', 'Supportive', 'Practical and hands-on', 'Well organised', 'Useful feedback', 'Good facilities'];
export const IMPROVE_TAGS = ['Too fast', 'Too slow', 'Needs more examples', 'Unclear instructions', 'More practice needed', 'Slow feedback', 'Technical issues', 'Facilities need attention'];
const EDIT_DAYS = 7;
const MAX_EDITS = 3;

export interface FeedbackDoc {
  orgId: string; branchId: string; studentId: string; studentName: string; targetType: FeedbackTarget; targetId: string; targetLabel: string;
  courseId: string | null; batchId: string | null; instructorIds: string[]; rating: number | null; comment: string; suggestion: string; tags: string[];
  anonymous: boolean; status: 'submitted' | 'acknowledged' | 'actioned'; staffNote?: string; submittedAt: string; updatedAt: string; editCount: number;
}

export const feedbackRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('eligible') }).strict(),
  z.object({
    action: z.literal('submit'), targetType: z.enum(FEEDBACK_TARGETS), targetId: idSchema,
    rating: z.number().int().min(1).max(5).nullable().optional(), comment: z.string().trim().max(2000).default(''), suggestion: z.string().trim().max(1000).default(''),
    tags: z.array(z.enum([...POSITIVE_TAGS, ...IMPROVE_TAGS] as [string, ...string[]])).max(8).default([]), anonymous: z.boolean().default(false),
  }).strict(),
  z.object({ action: z.literal('mine') }).strict(),
  z.object({ action: z.literal('summary'), orgId: idSchema.optional(), branchId: idSchema.optional(), courseId: idSchema.optional(), batchId: idSchema.optional(), targetType: z.enum(FEEDBACK_TARGETS).optional(), from: planDateSchema.optional(), to: planDateSchema.optional() }).strict(),
  z.object({ action: z.literal('set_status'), feedbackId: z.string().regex(/^[A-Za-z0-9_-]{3,300}$/), status: z.enum(['acknowledged', 'actioned']), note: z.string().trim().max(500).optional() }).strict(),
]);

type Services = { db: Firestore; auth: Auth };
const RATED: FeedbackTarget[] = ['course', 'lesson', 'teaching', 'materials', 'facilities', 'overall'];

async function enrollmentsOf(db: Firestore, a: Actor) {
  return (await db.collection('enrollments').where('orgId', '==', a.orgId).where('studentId', '==', a.id).get()).docs
    .map((d) => ({ id: d.id, ...d.data() } as Enrollment)).filter((e) => e.status === 'active' || e.status === 'completed');
}

/** Resolves a target for this student, or refuses: the label, course, batch and instructors it relates to. */
async function resolveTarget(db: Firestore, a: Actor, type: FeedbackTarget, id: string) {
  const enr = await enrollmentsOf(db, a);
  const byCourse = (courseId: string) => enr.find((e) => e.courseId === courseId);
  const nope = () => invalid('You can only give feedback on courses, batches and activities you are part of.');
  switch (type) {
    case 'course': case 'materials': {
      const e = byCourse(id); const c = await getDocData<{ title: string; orgId: string }>(db, `courses/${id}`);
      if (!e || !c) throw nope();
      return { label: c.title, courseId: id, batchId: e.batchId, instructorIds: [] as string[] };
    }
    case 'lesson': {
      const l = await getDocData<{ title: string; courseId: string; status: string }>(db, `lessons/${id}`);
      const e = l ? byCourse(l.courseId) : undefined;
      if (!l || !e || l.status !== 'published') throw nope();
      return { label: l.title, courseId: l.courseId, batchId: e.batchId, instructorIds: [] };
    }
    case 'assignment': {
      const asm = await getDocData<{ title: string; courseId: string; orgId: string }>(db, `assessments/${id}`);
      const daily = asm ? null : await getDocData<{ title: string; courseId: string; orgId: string }>(db, `assignments/${id}`);
      const t = asm ?? daily;
      const e = t ? byCourse(t.courseId) : undefined;
      if (!t || !e) throw nope();
      const submitted = asm
        ? !(await db.collection('assessmentAttempts').where('assessmentId', '==', id).where('studentId', '==', a.id).where('status', 'in', ['submitted', 'under_evaluation', 'evaluated', 'returned']).limit(1).get()).empty
        : Boolean(await getDocData(db, `submissions/${id}_${a.id}`));
      if (!submitted) throw invalid('Give feedback on an assignment after submitting it.');
      return { label: t.title, courseId: t.courseId, batchId: e.batchId, instructorIds: [] };
    }
    case 'teaching': {
      const e = enr.find((x) => x.batchId === id);
      const b = await getDocData<Batch>(db, `batches/${id}`);
      if (!e || !b) throw nope();
      return { label: `${b.name} — teaching`, courseId: b.courseId, batchId: id, instructorIds: b.instructorUserIds ?? [] };
    }
    case 'facilities': {
      if (!a.branchId || id !== a.branchId) throw nope();
      const b = await getDocData<{ name: string }>(db, `branches/${id}`);
      return { label: `${b?.name ?? 'Branch'} — facilities`, courseId: null, batchId: null, instructorIds: [] };
    }
    case 'overall': {
      if (id !== a.orgId) throw nope();
      const o = await getDocData<{ name: string }>(db, `organizations/${id}`);
      return { label: `${o?.name ?? 'Academy'} — overall experience`, courseId: null, batchId: null, instructorIds: [] };
    }
  }
}

/** Staff visibility of one feedback record. */
function staffCanSee(a: Actor, f: FeedbackDoc, myBatches: Set<string>, myCourses: Set<string>): boolean {
  if (isSuper(a)) return true;
  if (a.orgId !== f.orgId) return false;
  if (isAcademyManager(a, f.orgId) || canManageBranch(a, f.orgId, f.branchId)) return true;
  if (a.role !== 'instructor' || f.targetType === 'facilities' || f.targetType === 'overall') return false;
  if (f.targetType === 'teaching') return f.instructorIds.includes(a.id);
  return (f.batchId !== null && myBatches.has(f.batchId)) || (f.courseId !== null && myCourses.has(f.courseId) && f.batchId !== null && myBatches.has(f.batchId));
}

/** What staff see: identity only when the student didn't hide their name. */
const forStaff = (id: string, f: FeedbackDoc) => ({
  id, targetType: f.targetType, targetId: f.targetId, targetLabel: f.targetLabel, rating: f.rating, comment: f.comment, suggestion: f.suggestion, tags: f.tags,
  status: f.status, staffNote: f.staffNote ?? null, submittedAt: f.submittedAt, branchId: f.branchId, courseId: f.courseId, batchId: f.batchId,
  student: f.anonymous ? null : { id: f.studentId, name: f.studentName },
});

export async function handleFeedback(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(feedbackRequestSchema, body);
  const { db } = services;
  const iso = new Date().toISOString();

  switch (req.action) {
    case 'eligible': {
      if (actor.role !== 'student') throw denied('Feedback is given by students.');
      const enr = await enrollmentsOf(db, actor);
      const [courses, batches, attempts, subs, existing] = await Promise.all([
        enr.length ? db.getAll(...enr.map((e) => db.doc(`courses/${e.courseId}`))) : [],
        enr.length ? db.getAll(...enr.map((e) => db.doc(`batches/${e.batchId}`))) : [],
        db.collection('assessmentAttempts').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).select('assessmentId', 'title', 'courseId', 'status').get(),
        db.collection('submissions').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).select('assignmentId', 'status').get(),
        db.collection('feedback').where('studentId', '==', actor.id).select('targetType', 'targetId', 'submittedAt', 'editCount', 'status').get(),
      ]);
      const assignments = new Map<string, string>();
      for (const d of attempts.docs) if (d.data().status !== 'in_progress') assignments.set(d.data().assessmentId, d.data().title);
      const dailyIds = subs.docs.filter((d) => d.data().status !== 'draft').map((d) => d.data().assignmentId as string);
      const dailySnaps = dailyIds.length ? await db.getAll(...dailyIds.map((id) => db.doc(`assignments/${id}`))) : [];
      for (const s of dailySnaps) if (s.exists) assignments.set(s.id, s.data()!.title as string);
      return {
        courses: courses.filter((c) => c.exists).map((c) => ({ id: c.id, title: c.data()!.title as string })),
        batches: batches.filter((b) => b.exists).map((b) => ({ id: b.id, name: b.data()!.name as string, instructors: (b.data()!.instructorNames as string[]) ?? [] })),
        assignments: [...assignments.entries()].map(([id, title]) => ({ id, title })),
        branchId: actor.branchId ?? null, orgId: actor.orgId, tags: { positive: POSITIVE_TAGS, improve: IMPROVE_TAGS }, minResponses: MIN_FEEDBACK_RESPONSES,
        existing: existing.docs.map((d) => ({ id: d.id, ...d.data() })),
      };
    }

    case 'submit': {
      if (actor.role !== 'student') throw denied('Feedback is given by students.');
      if (RATED.includes(req.targetType) && !req.rating) throw invalid('Choose a rating from 1 to 5 stars.');
      if (!req.rating && !req.comment) throw invalid('Add a rating or a comment.');
      const t = await resolveTarget(db, actor, req.targetType, req.targetId);
      const ref = db.doc(`feedback/${actor.id}_${req.targetType}_${req.targetId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? (snap.data() as FeedbackDoc) : null;
        if (prev) {
          if (prev.status !== 'submitted') throw conflict('Staff have already responded to this feedback, so it can no longer be changed.', 'locked');
          if (Date.now() - Date.parse(prev.submittedAt) > EDIT_DAYS * 86400_000) throw conflict(`Feedback can be corrected for ${EDIT_DAYS} days after submitting.`, 'locked');
          if (prev.editCount >= MAX_EDITS) throw conflict(`Feedback can be corrected at most ${MAX_EDITS} times.`, 'locked');
          tx.create(ref.collection('history').doc(String(prev.editCount)), { ...prev, replacedAt: iso });
        }
        const doc: FeedbackDoc = {
          orgId: actor.orgId, branchId: actor.branchId ?? '', studentId: actor.id, studentName: displayName(actor), targetType: req.targetType, targetId: req.targetId, targetLabel: t.label,
          courseId: t.courseId, batchId: t.batchId, instructorIds: t.instructorIds, rating: req.rating ?? null, comment: req.comment, suggestion: req.suggestion, tags: req.tags,
          anonymous: req.anonymous, status: 'submitted', submittedAt: prev?.submittedAt ?? iso, updatedAt: iso, editCount: prev ? prev.editCount + 1 : 0,
        };
        tx.set(ref, doc);
        return { feedbackId: ref.id, corrected: Boolean(prev), editsLeft: MAX_EDITS - doc.editCount };
      });
    }

    case 'mine': {
      if (actor.role !== 'student') throw denied();
      const snap = await db.collection('feedback').where('studentId', '==', actor.id).get();
      return { feedback: snap.docs.map((d) => ({ id: d.id, ...(d.data() as FeedbackDoc) })).sort((x, y) => y.submittedAt.localeCompare(x.submittedAt)), editDays: EDIT_DAYS, maxEdits: MAX_EDITS };
    }

    case 'summary': {
      if (!['super_admin', 'university_admin', 'branch_admin', 'instructor'].includes(actor.role)) throw denied();
      const orgId = isSuper(actor) ? req.orgId ?? actor.orgId : actor.orgId;
      if (req.orgId && req.orgId !== orgId) throw notFound('That academy');
      let q: Query = db.collection('feedback').where('orgId', '==', orgId);
      if (actor.role === 'branch_admin') { if (req.branchId && req.branchId !== actor.branchId) throw notFound('That branch'); q = q.where('branchId', '==', actor.branchId); }
      else if (req.branchId) q = q.where('branchId', '==', req.branchId);
      const myBatches = new Set<string>(), myCourses = new Set<string>();
      if (actor.role === 'instructor') {
        for (const d of (await db.collection('batches').where('orgId', '==', actor.orgId).where('instructorUserIds', 'array-contains', actor.id).get()).docs) { myBatches.add(d.id); myCourses.add(d.data().courseId); }
      }
      const rows = (await q.get()).docs.map((d) => ({ id: d.id, f: d.data() as FeedbackDoc }))
        .filter(({ f }) => staffCanSee(actor, f, myBatches, myCourses))
        .filter(({ f }) => (!req.courseId || f.courseId === req.courseId) && (!req.batchId || f.batchId === req.batchId) && (!req.targetType || f.targetType === req.targetType)
          && (!req.from || f.submittedAt.slice(0, 10) >= req.from) && (!req.to || f.submittedAt.slice(0, 10) <= req.to));
      const groups = new Map<string, { targetType: FeedbackTarget; targetId: string; label: string; ratings: number[]; tags: Map<string, number>; count: number }>();
      for (const { f } of rows) {
        const k = `${f.targetType}:${f.targetId}`;
        const g = groups.get(k) ?? { targetType: f.targetType, targetId: f.targetId, label: f.targetLabel, ratings: [] as number[], tags: new Map<string, number>(), count: 0 };
        g.count++; if (f.rating) g.ratings.push(f.rating);
        for (const t of f.tags) g.tags.set(t, (g.tags.get(t) ?? 0) + 1);
        groups.set(k, g);
      }
      const tagList = (m: Map<string, number>, list: string[]) => [...m.entries()].filter(([t]) => list.includes(t)).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
      const months = new Map<string, number[]>();
      for (const { f } of rows) if (f.rating) months.set(f.submittedAt.slice(0, 7), [...(months.get(f.submittedAt.slice(0, 7)) ?? []), f.rating]);
      return {
        minResponses: MIN_FEEDBACK_RESPONSES, total: rows.length,
        targets: [...groups.values()].map((g) => ({ targetType: g.targetType, targetId: g.targetId, label: g.label, responses: g.count, rating: ratingSummary(g.ratings), positive: tagList(g.tags, POSITIVE_TAGS), improve: tagList(g.tags, IMPROVE_TAGS) })).sort((a, b) => b.responses - a.responses),
        trend: [...months.entries()].sort().map(([month, r]) => ({ month, ...ratingSummary(r) })),
        comments: rows.filter(({ f }) => f.comment || f.suggestion).sort((a, b) => b.f.submittedAt.localeCompare(a.f.submittedAt)).slice(0, 200).map(({ id, f }) => forStaff(id, f)),
        canRespond: actor.role !== 'instructor',
      };
    }

    case 'set_status': {
      const ref = db.doc(`feedback/${req.feedbackId}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('That feedback');
        const f = snap.data() as FeedbackDoc;
        if (!isSuper(actor) && actor.orgId !== f.orgId) throw notFound('That feedback');
        if (!isAcademyManager(actor, f.orgId) && !canManageBranch(actor, f.orgId, f.branchId)) throw denied('Branch managers and administrators respond to feedback.');
        tx.update(ref, { status: req.status, ...(req.note ? { staffNote: req.note } : {}), respondedById: actor.id, respondedAt: iso });
        notify(tx, db, { orgId: f.orgId, userId: f.studentId, type: 'feedback_update', title: req.status === 'actioned' ? 'Your feedback was acted on' : 'Your feedback was read', body: req.note ?? f.targetLabel, link: '/dashboard/feedback', sourceId: ref.id });
        tx.create(db.collection('auditLog').doc(), { orgId: f.orgId, branchId: f.branchId, courseId: f.courseId, targetType: 'feedback', targetId: ref.id, action: 'feedback_status', actorId: actor.id, actorRole: actor.role, toStatus: req.status, at: FieldValue.serverTimestamp() });
        return { ok: true };
      });
    }
  }
}

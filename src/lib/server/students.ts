import 'server-only';

/**
 * Strynkix LMS — the Students register (POST /api/students).
 *
 * For Super Admin (any academy), University Admin (their academy) and Branch
 * Manager (their branch only). Reads the records the academy already keeps and
 * returns one row per student (src/lib/students/records.ts); fee fields only
 * where the caller has finance access. Read-only, except `log_export`, which
 * records an export in the audit log (personal data leaving the system).
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore, type Query } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema } from '@/types/validation';
import type { Batch, Course, Enrollment, UserProfile } from '@/types/domain';
import type { Admission, AssessmentAttempt, AttendanceSession, Certificate, FeeAccount, PersonProfile } from '@/types/academy';
import { assertOrg, canSeeFinance, denied, getDocData, invalid, isSuper, loadActor, localDate, notFound, parseBody, type Actor } from '@/lib/server/academy-scope';
import { buildStudentRows } from '@/lib/students/records';

/** Larger academies get the first MAX students by name and a notice. */
const MAX_STUDENTS = 5000;
const ROLES = ['super_admin', 'university_admin', 'branch_admin'] as const;

export const studentsRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), orgId: idSchema.optional(), branchId: idSchema.optional() }).strict(),
  z.object({
    action: z.literal('log_export'), orgId: idSchema.optional(), branchId: idSchema.optional(),
    count: z.number().int().min(0).max(MAX_STUDENTS), format: z.literal('csv'),
    filters: z.record(z.string().max(40), z.string().max(120)).optional(),
  }).strict(),
]);

type Services = { db: Firestore; auth: Auth };

/** The academy and branch the caller may see; a Branch Manager is always held to their branch. */
async function scopeOf(db: Firestore, actor: Actor, orgId?: string, branchId?: string) {
  if (!(ROLES as readonly string[]).includes(actor.role)) throw denied('The Students register is for branch managers and administrators.');
  const org = orgId ?? actor.orgId;
  assertOrg(actor, org, 'That academy');
  if (actor.role === 'branch_admin') {
    if (!actor.branchId) throw denied();
    if (branchId && branchId !== actor.branchId) throw notFound('That branch');
    return { orgId: org, branchId: actor.branchId };
  }
  if (branchId) {
    const b = await getDocData<{ orgId: string }>(db, `branches/${branchId}`);
    if (!b || b.orgId !== org) throw notFound('That branch');
  }
  return { orgId: org, branchId: branchId ?? null };
}

const docs = <T>(snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));

async function getAllById<T>(db: Firestore, collection: string, ids: string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => db.doc(`${collection}/${id}`));
    if (!refs.length) continue;
    for (const s of await db.getAll(...refs)) if (s.exists) out.set(s.id, { id: s.id, ...s.data() } as T);
  }
  return out;
}

export async function handleStudents(services: Services, idToken: string | null, body: unknown): Promise<unknown> {
  const actor = await loadActor(services, idToken);
  const req = parseBody(studentsRequestSchema, body);
  const { db } = services;
  const scope = await scopeOf(db, actor, req.orgId, req.branchId);

  if (req.action === 'log_export') {
    await db.collection('auditLog').add({
      orgId: scope.orgId, ...(scope.branchId ? { branchId: scope.branchId } : {}), courseId: null,
      targetType: 'students', targetId: scope.branchId ?? scope.orgId, action: 'students_export',
      actorId: actor.id, actorRole: actor.role, count: req.count, format: req.format, filters: req.filters ?? {},
      at: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  }

  // Equality filters only, so no composite indexes are needed.
  const inScope = (name: string): Query => {
    let q: Query = db.collection(name).where('orgId', '==', scope.orgId);
    if (scope.branchId) q = q.where('branchId', '==', scope.branchId);
    return q;
  };
  const financeAnywhere = canSeeFinance(actor, scope.orgId, scope.branchId);

  const [userSnap, admissions, enrollments, batches, sessions, attempts, feeAccounts, certificates, branches, academies] = await Promise.all([
    inScope('users').where('role', '==', 'student').limit(MAX_STUDENTS + 1).get(),
    inScope('admissions').where('status', '==', 'confirmed').get().then((s) => docs<Admission>(s)),
    inScope('enrollments').get().then((s) => docs<Enrollment>(s)),
    inScope('batches').get().then((s) => docs<Batch>(s)),
    inScope('attendance').select('records').get().then((s) => s.docs.map((d) => d.data() as Pick<AttendanceSession, 'records'>)),
    inScope('assessmentAttempts').where('status', '==', 'evaluated').select('studentId', 'status', 'percent').get()
      .then((s) => s.docs.map((d) => d.data() as Pick<AssessmentAttempt, 'studentId' | 'status' | 'percent'>)),
    financeAnywhere ? inScope('feeAccounts').get().then((s) => docs<FeeAccount>(s)) : Promise.resolve([] as FeeAccount[]),
    inScope('certificates').select('studentId', 'status').get().then((s) => s.docs.map((d) => d.data() as Pick<Certificate, 'studentId' | 'status'>)),
    db.collection('branches').where('orgId', '==', scope.orgId).get().then((s) => s.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? d.id }))),
    isSuper(actor) ? db.collection('organizations').get().then((s) => s.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? d.id }))) : Promise.resolve(null),
  ]);

  const all = docs<UserProfile>(userSnap).sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));
  const truncated = all.length > MAX_STUDENTS;
  const students = all.slice(0, MAX_STUDENTS);
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];
  const [profiles, courses] = await Promise.all([
    getAllById<PersonProfile>(db, 'personProfiles', students.map((s) => s.id)),
    getAllById<Course>(db, 'courses', courseIds),
  ]);

  const rows = buildStudentRows({
    students, profiles, admissions, enrollments, sessions, attempts, feeAccounts, certificates,
    batches: new Map(batches.map((b) => [b.id, b])),
    courses,
    branchNames: new Map(branches.map((b) => [b.id, b.name])),
    canSeeFees: (branchId) => canSeeFinance(actor, scope.orgId, branchId),
    today: localDate(),
  });
  if (rows.length > MAX_STUDENTS) throw invalid('Too many students to list.');

  return {
    scope: { orgId: scope.orgId, branchId: scope.branchId, lockedToBranch: actor.role === 'branch_admin' },
    academies,
    branches: scope.branchId && actor.role === 'branch_admin' ? branches.filter((b) => b.id === scope.branchId) : branches,
    batches: batches.map((b) => ({ id: b.id, name: b.name, branchId: b.branchId, courseId: b.courseId })),
    courses: [...courses.values()].map((c) => ({ id: c.id, title: c.title })),
    canSeeFinance: financeAnywhere,
    truncated,
    rows,
  };
}

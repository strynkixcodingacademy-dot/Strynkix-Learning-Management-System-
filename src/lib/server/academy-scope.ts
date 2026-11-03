import 'server-only';

/**
 * Strynkix LMS — who may do what, decided on the server from the caller's
 * stored profile (never from the request). Shared by the academy-operations
 * routes: assessments, attendance, certificates, admissions, finance,
 * expenses, reports, portfolio and resumes.
 */

import type { Auth } from 'firebase-admin/auth';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Batch, Course, Enrollment, UserProfile } from '@/types/domain';
import { validateUserProfile } from '@/lib/auth/profile';
import { hasCourseDesignAuthority } from '@/lib/admin/course-design';
import { ReviewError } from '@/lib/review/workflow';
import { verifyCaller } from '@/lib/server/content-route';

export interface Actor extends UserProfile { id: string }

export const denied = (msg = 'You don’t have permission to do this.') => new ReviewError(403, 'not_allowed', msg);
export const notFound = (what = 'That record') => new ReviewError(404, 'not_found', `${what} isn’t available.`);
export const invalid = (msg: string) => new ReviewError(400, 'invalid_request', msg);
export const conflict = (msg: string, code = 'conflict') => new ReviewError(409, code, msg);

export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? ` (${issue.path.join('.')})` : '';
    throw invalid(`${issue?.message ?? 'The request is malformed.'}${where}`);
  }
  return parsed.data;
}

/** Verifies the token and loads an active profile, or refuses. */
export async function loadActor(services: { db: Firestore; auth: Auth }, idToken: string | null): Promise<Actor> {
  const uid = await verifyCaller(services.auth, idToken);
  const snap = await services.db.doc(`users/${uid}`).get();
  const profile = snap.exists ? validateUserProfile(uid, snap.data()).profile : null;
  if (!profile || profile.status !== 'active') throw denied('Your account isn’t active.');
  return { ...profile, id: uid };
}

export const isSuper = (a: Actor) => a.role === 'super_admin';

/** Org boundary: other academies' records don't exist for anyone but a Super Admin. */
export function assertOrg(a: Actor, orgId: string, what = 'That record'): void {
  if (!isSuper(a) && a.orgId !== orgId) throw notFound(what);
}

/** Academy managers: Super Admin, or the academy's University Admin. */
export const isAcademyManager = (a: Actor, orgId: string) => isSuper(a) || (a.role === 'university_admin' && a.orgId === orgId);

/** Branch managers: academy managers, or that branch's Branch Manager. */
export const canManageBranch = (a: Actor, orgId: string, branchId: string) =>
  isAcademyManager(a, orgId) || (a.role === 'branch_admin' && a.orgId === orgId && !!a.branchId && a.branchId === branchId);

export const teachesBatch = (a: Actor, batch: Pick<Batch, 'orgId' | 'instructorUserIds'>) =>
  a.role === 'instructor' && a.orgId === batch.orgId && (batch.instructorUserIds ?? []).includes(a.id);

/** Branch managers of the batch's branch, or its instructors. */
export const canWorkWithBatch = (a: Actor, batch: Pick<Batch, 'orgId' | 'branchId' | 'instructorUserIds'>) =>
  canManageBranch(a, batch.orgId, batch.branchId) || teachesBatch(a, batch);

/**
 * Authors of activities and exams: Super Admin; University Admins and
 * instructors of the academy; Course Design members who author or design
 * assessments for that course.
 */
export function canAuthorAssessments(a: Actor, course: Pick<Course, 'id' | 'orgId'>): boolean {
  if (isSuper(a)) return true;
  if (a.orgId !== course.orgId) return false;
  if (a.role === 'university_admin' || a.role === 'instructor') return true;
  return hasCourseDesignAuthority(a, course, ['lead', 'curriculum_architect', 'assessment_designer']);
}

/**
 * Finance visibility. Branch Managers see their branch; University Admins
 * their academy; Super Admin everything. `branchId` null = academy-wide.
 */
export function canSeeFinance(a: Actor, orgId: string, branchId: string | null): boolean {
  if (isAcademyManager(a, orgId)) return true;
  return branchId !== null && canManageBranch(a, orgId, branchId);
}

/** The branch a Branch Manager is limited to, or null for academy managers. */
export function financeScope(a: Actor, orgId: string, branchId?: string | null): { orgId: string; branchId: string | null } {
  assertOrg(a, orgId, 'That academy');
  if (isAcademyManager(a, orgId)) return { orgId, branchId: branchId ?? null };
  if (a.role === 'branch_admin' && a.branchId) {
    if (branchId && branchId !== a.branchId) throw notFound('That branch');
    return { orgId, branchId: a.branchId };
  }
  throw denied('Finance is available to branch managers and administrators.');
}

export async function getDocData<T>(db: Firestore, path: string): Promise<(T & { id: string }) | null> {
  const s = await db.doc(path).get();
  return s.exists ? ({ id: s.id, ...(s.data() as DocumentData) } as T & { id: string }) : null;
}

/** The student's enrollment in a course that grants access (active or completed). */
export async function studentEnrollment(db: Firestore, courseId: string, studentId: string): Promise<Enrollment | null> {
  const e = await getDocData<Enrollment>(db, `enrollments/${courseId}_${studentId}`);
  return e && (e.status === 'active' || e.status === 'completed') ? e : null;
}

export const todayIso = () => new Date().toISOString();

/** YYYY-MM-DD in the academy's time zone (default Asia/Kolkata). */
export function localDate(d: Date = new Date(), timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export const displayName = (a: Pick<UserProfile, 'displayName' | 'email'>) => a.displayName || a.email || 'Staff';

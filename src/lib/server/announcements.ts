import 'server-only';

/**
 * Strynkix LMS — announcements for the signed-in user (Stage 8). The Super
 * Admin publishes them in the Command Centre; here each user receives only the
 * ones whose audience matches their stored profile (academy, branch, role and,
 * for students, their course or batch), between the publish and expiry time.
 * Nothing is copied per user, so a withdrawn or expired announcement simply
 * stops appearing.
 */

import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { loadActor, parseBody, type Actor } from '@/lib/server/academy-scope';

export interface AnnouncementAudience { scope: 'all' | 'academy' | 'branch'; orgId: string | null; branchId: string | null; roles: string[]; courseId: string | null; batchId: string | null }
export interface AnnouncementDoc { title: string; message: string; audience: AnnouncementAudience; publishAt: string; expiresAt: string | null; status: 'active' | 'withdrawn'; createdByName: string }

export const announcementRequestSchema = z.object({ action: z.literal('mine') }).strict();

/** Does this announcement reach this user? `enrollments` are the student's active ones. */
export function reaches(a: AnnouncementAudience, user: Pick<Actor, 'orgId' | 'branchId' | 'role'>, enrollments: { courseId: string; batchId: string }[]): boolean {
  if (a.scope !== 'all' && a.orgId !== user.orgId) return false;
  if (a.scope === 'branch' && a.branchId !== user.branchId) return false;
  if (a.roles.length && !a.roles.includes(user.role)) return false;
  if (a.courseId || a.batchId) {
    if (user.role !== 'student') return false;
    return enrollments.some((e) => (!a.courseId || e.courseId === a.courseId) && (!a.batchId || e.batchId === a.batchId));
  }
  return true;
}

export async function handleAnnouncements(services: { db: Firestore; auth: Auth }, idToken: string | null, body: unknown) {
  const actor = await loadActor(services, idToken);
  parseBody(announcementRequestSchema, body);
  const { db } = services;
  const now = new Date().toISOString();
  const [snap, enr] = await Promise.all([
    db.collection('announcements').where('status', '==', 'active').where('publishAt', '<=', now).orderBy('publishAt', 'desc').limit(100).get(),
    actor.role === 'student' ? db.collection('enrollments').where('orgId', '==', actor.orgId).where('studentId', '==', actor.id).where('status', '==', 'active').get() : null,
  ]);
  const enrollments = (enr?.docs ?? []).map((d) => ({ courseId: d.data().courseId as string, batchId: d.data().batchId as string }));
  return {
    announcements: snap.docs.map((d) => ({ id: d.id, ...(d.data() as AnnouncementDoc) }))
      .filter((a) => (!a.expiresAt || a.expiresAt > now) && reaches(a.audience, actor, enrollments))
      .slice(0, 20)
      .map((a) => ({ id: a.id, title: a.title, message: a.message, publishAt: a.publishAt, from: a.createdByName })),
  };
}

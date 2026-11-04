/**
 * Strynkix Live Books — the content half of global search: the Live Books,
 * lessons and batches the signed-in user can already open. It reads with the
 * same scoped queries as the catalog and batch pages, so Firestore rules decide
 * what is visible; nothing here widens access.
 */

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { getBatchesForTenant, getStudentEnrollments } from '@/lib/batches/service';
import { grantsContentAccess } from '@/lib/batches/scope';
import { getCourseDesignCourses } from '@/lib/courses/service';
import { getCourseWithCurriculum } from '@/lib/livebook/service';
import { matchScore } from '@/lib/navigation/catalog';
import type { TenantContext } from '@/types/auth';
import type { Course, UserProfile } from '@/types/domain';

export type ContentKind = 'course' | 'lesson' | 'batch';

export interface ContentEntry {
  kind: ContentKind;
  title: string;
  /** Shown under the title: the course of a lesson, a batch's code. */
  context: string;
  href: string;
}

/** Lessons are loaded for at most this many Live Books, to keep the index cheap. */
const MAX_COURSES_WITH_LESSONS = 15;
const TTL_MS = 5 * 60_000;

let cache: { key: string; at: number; entries: Promise<ContentEntry[]> } | null = null;

async function visibleCourses(tenant: TenantContext, uid: string, profile: UserProfile | null): Promise<Course[]> {
  if (tenant.role === 'student') {
    const courseIds = [...new Set((await getStudentEnrollments(tenant.orgId, uid)).filter((e) => grantsContentAccess(e.status)).map((e) => e.courseId))];
    const courses = await Promise.all(courseIds.map(async (id) => {
      try {
        const snap = await getDoc(doc(db, 'courses', id));
        return snap.exists() ? ({ id: snap.id, ...snap.data() } as Course) : null;
      } catch {
        return null;
      }
    }));
    return courses.filter((c): c is Course => c !== null && c.status === 'published');
  }
  if (tenant.role === 'content_lead' || tenant.role === 'content_designer') {
    return (await getCourseDesignCourses(profile ?? { orgId: tenant.orgId })).filter((c) => c.status === 'published');
  }
  const snap = await getDocs(query(collection(db, 'courses'), where('orgId', '==', tenant.orgId), where('status', '==', 'published')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Course));
}

async function buildIndex(tenant: TenantContext, uid: string, profile: UserProfile | null): Promise<ContentEntry[]> {
  const isStaff = ['super_admin', 'university_admin', 'branch_admin', 'instructor'].includes(tenant.role);
  const [courses, batches] = await Promise.all([
    visibleCourses(tenant, uid, profile).catch(() => [] as Course[]),
    isStaff ? getBatchesForTenant(tenant, uid).catch(() => []) : Promise.resolve([]),
  ]);
  const curricula = await Promise.allSettled(
    courses.slice(0, MAX_COURSES_WITH_LESSONS).map((c) => getCourseWithCurriculum(c.id, tenant.orgId, false))
  );
  const lessons = curricula.flatMap((r) => (r.status === 'fulfilled' && r.value ? r.value.lessons.map((l) => ({ lesson: l, course: r.value!.course })) : []));
  return [
    ...courses.map((c): ContentEntry => ({ kind: 'course', title: c.title, context: 'Live Book', href: `/courses/${c.id}` })),
    ...lessons.map(({ lesson, course }): ContentEntry => ({ kind: 'lesson', title: lesson.title, context: course.title, href: `/courses/${course.id}/lessons/${lesson.id}` })),
    ...batches.map((b): ContentEntry => ({ kind: 'batch', title: b.name, context: b.code, href: `/dashboard/batches/${b.id}` })),
  ];
}

/** Loads (once per user, refreshed every few minutes) what search can find. */
export function loadContentIndex(tenant: TenantContext, uid: string, profile: UserProfile | null): Promise<ContentEntry[]> {
  const key = `${uid}:${tenant.orgId}:${tenant.role}`;
  if (!cache || cache.key !== key || Date.now() - cache.at > TTL_MS) {
    const entries = buildIndex(tenant, uid, profile);
    cache = { key, at: Date.now(), entries };
    entries.catch(() => { cache = null; });
  }
  return cache.entries;
}

export function searchContent(entries: ContentEntry[], q: string, limitPerKind = 5): ContentEntry[] {
  const scored = entries
    .map((e) => ({ e, s: matchScore(q, e.title, [e.context]) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title));
  const counts: Record<ContentKind, number> = { course: 0, lesson: 0, batch: 0 };
  return scored.flatMap(({ e }) => (counts[e.kind]++ < limitPerKind ? [e] : []));
}

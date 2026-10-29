/**
 * Strynkix LMS — deterministic browser-test fixtures (Stage C6).
 *
 * Everything lives in the `demo-strynkix-e2e` emulator project, which only this
 * suite uses; resetting it therefore never touches data the tests don't own.
 * The password is an emulator-only test value, never a real credential.
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { expect, type Page } from '@playwright/test';

export const PROJECT = 'demo-strynkix-e2e';
export const PASSWORD = 'e2e-only-Passw0rd!';
export const SECRET = 'E2E-SECRET-EXPLANATION';
const FIRESTORE = '127.0.0.1:8080';
const NOW = '2026-10-29T00:00:00.000Z';

export const USERS = {
  super: { uid: 'e2e_super', role: 'super_admin' },
  uni: { uid: 'e2e_uni', role: 'university_admin' },
  ba: { uid: 'e2e_ba', role: 'branch_admin', branchId: 'e2e_branch' },
  inst: { uid: 'e2e_inst', role: 'instructor', branchId: 'e2e_branch' },
  designer: { uid: 'e2e_designer', role: 'content_designer', courseDesign: ['content_developer'] },
  reviewer: { uid: 'e2e_reviewer', role: 'content_designer', courseDesign: ['reviewer'] },
  stu: { uid: 'e2e_stu', role: 'student', branchId: 'e2e_branch' },
  stuB: { uid: 'e2e_stu_b', role: 'student', branchId: 'e2e_branch_b', orgId: 'e2e_org_b' },
  suspended: { uid: 'e2e_suspended', role: 'student', branchId: 'e2e_branch', status: 'suspended' },
  noProfile: { uid: 'e2e_noprofile', role: null },
} as const;
export type FixtureUser = keyof typeof USERS;
export const emailOf = (u: FixtureUser) => `${USERS[u].uid}@e2e.test`;

export function admin() {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  const app = getApps().find((a) => a.name === 'e2e') ?? initializeApp({ projectId: PROJECT }, 'e2e');
  return { db: getFirestore(app), auth: getAuth(app) };
}

export async function ensureAuthUsers() {
  const { auth } = admin();
  for (const key of Object.keys(USERS) as FixtureUser[]) {
    const { uid } = USERS[key];
    await auth.deleteUser(uid).catch(() => undefined);
    await auth.createUser({ uid, email: emailOf(key), password: PASSWORD, displayName: `E2E ${key}` });
  }
}

const quiz = (id: string, question: string) => ({
  id, type: 'quiz', question, options: [{ id: 'opt_a', text: 'Option A' }, { id: 'opt_b', text: 'Option B' }],
});

/** Clears the suite's own emulator project and writes the canonical dataset. */
export async function resetData() {
  const res = await fetch(`http://${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Emulator reset failed: ${res.status}`);
  const { db } = admin();
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);

  await put('organizations/e2e_org', { id: 'e2e_org', name: 'E2E Academy', slug: 'e2e', status: 'active', settings: { defaultTimezone: 'Asia/Kolkata' }, createdAt: NOW, updatedAt: NOW });
  await put('organizations/e2e_org_b', { id: 'e2e_org_b', name: 'Other Academy', slug: 'other', status: 'active', createdAt: NOW, updatedAt: NOW });
  await put('branches/e2e_branch', { id: 'e2e_branch', orgId: 'e2e_org', name: 'E2E Branch', code: 'E2E', status: 'active', createdAt: NOW, updatedAt: NOW });
  await put('branches/e2e_branch_b', { id: 'e2e_branch_b', orgId: 'e2e_org_b', name: 'Other Branch', code: 'OTH', status: 'active', createdAt: NOW, updatedAt: NOW });

  for (const key of Object.keys(USERS) as FixtureUser[]) {
    const u = USERS[key] as { uid: string; role: string | null; branchId?: string; orgId?: string; status?: string; courseDesign?: string[] };
    if (!u.role) continue; // unprovisioned: login exists, profile doesn't
    await put(`users/${u.uid}`, {
      id: u.uid, email: emailOf(key), displayName: `E2E ${key}`, role: u.role, orgId: u.orgId ?? 'e2e_org', status: u.status ?? 'active',
      ...(u.branchId ? { branchId: u.branchId } : {}),
      ...(u.courseDesign ? { courseDesign: { department: 'course_design', responsibilities: u.courseDesign, assignedCourseIds: ['e2e_course'], assignedAt: NOW, assignedByUserId: 'e2e_super' } } : {}),
      createdAt: NOW, updatedAt: NOW,
    });
  }

  const course = (id: string, title: string, status: string) => put(`courses/${id}`, {
    id, orgId: 'e2e_org', title, slug: id, tagline: `${title} tagline`, description: `${title} description for browser tests.`, level: 'beginner',
    tags: [], prerequisites: [], estimatedWeeks: 4, status, createdById: 'e2e_inst', lastEditedById: 'e2e_inst', createdAt: NOW, updatedAt: NOW,
  });
  await course('e2e_course', 'E2E Live Course', 'published');
  await course('e2e_hidden', 'E2E Out Of Scope Course', 'draft');
  await put('modules/e2e_mod', { id: 'e2e_mod', orgId: 'e2e_org', courseId: 'e2e_course', title: 'E2E Module', slug: 'm1', summary: 'Module for browser tests.', orderIndex: 1, status: 'published', createdAt: NOW, updatedAt: NOW });

  const lesson = (id: string, title: string, orderIndex: number, blocks: unknown[], extra: Record<string, unknown> = {}) => put(`lessons/${id}`, {
    id, orgId: 'e2e_org', courseId: 'e2e_course', moduleId: 'e2e_mod', title, slug: id, type: 'concept', orderIndex, estimatedMinutes: 10,
    status: 'published', lastEditedById: 'e2e_inst', blocks: [{ id: 't1', type: 'text', content: `${title} reading content.` }, ...blocks],
    createdAt: NOW, updatedAt: NOW, ...extra,
  });
  const key = (lessonId: string, items: Array<[string, string]>) => put(`lessons/${lessonId}/answerKey/current`, {
    orgId: 'e2e_org', courseId: 'e2e_course', lessonId, keyVersion: 1, release: 'after_pass',
    items: items.map(([blockId, correctOptionId]) => ({ blockId, correctOptionId, explanation: `${SECRET} for ${blockId}.` })),
    updatedById: 'e2e_inst', updatedAt: NOW,
  });
  await lesson('e2e_quiz', 'E2E Quiz Lesson', 1, [quiz('q1', 'Which option is right for question one?'), quiz('q2', 'Which option is right for question two?')], { publishedVersion: 1 });
  await key('e2e_quiz', [['q1', 'opt_b'], ['q2', 'opt_a']]);
  await lesson('e2e_quiz_pass', 'E2E Passing Quiz', 2, [quiz('q1', 'Pick the right option to pass?')], { publishedVersion: 1 });
  await key('e2e_quiz_pass', [['q1', 'opt_a']]);
  await lesson('e2e_plain', 'E2E Reading Lesson', 3, []);
  await lesson('e2e_draft', 'E2E Draft Lesson', 4, [], { status: 'draft' });

  await put('batches/e2e_batch', {
    id: 'e2e_batch', orgId: 'e2e_org', branchId: 'e2e_branch', courseId: 'e2e_course', name: 'E2E Batch', code: 'E2E-B',
    instructorUserIds: ['e2e_inst'], instructorNames: ['E2E inst'], startDate: NOW, endDate: '2027-04-30T00:00:00.000Z', maxStudents: 30,
    activeEnrollmentCount: 1, status: 'in_progress', createdById: 'e2e_ba', createdAt: NOW, updatedAt: NOW,
  });
  await put('enrollments/e2e_course_e2e_stu', {
    id: 'e2e_course_e2e_stu', orgId: 'e2e_org', branchId: 'e2e_branch', courseId: 'e2e_course', batchId: 'e2e_batch', studentId: 'e2e_stu',
    status: 'active', enrolledAt: NOW, enrolledById: 'e2e_ba', studentName: 'E2E stu', studentEmail: emailOf('stu'), createdAt: NOW, updatedAt: NOW,
  });
}

export async function signIn(page: Page, user: FixtureUser) {
  await page.goto('/login');
  await page.locator('input[type="email"]').first().fill(emailOf(user));
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

export async function signInAs(page: Page, user: FixtureUser) {
  await signIn(page, user);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

/** An emulator ID token for direct API probes (forged or stale requests). */
export async function idTokenFor(user: FixtureUser): Promise<string> {
  const res = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailOf(user), password: PASSWORD, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`Emulator sign-in failed for ${user}`);
  return json.idToken;
}

/**
 * Records the bodies of Firestore and API responses seen by the page, so a test
 * can assert that no answer key ever reached the browser.
 */
export function collectResponses(page: Page): string[] {
  const bodies: string[] = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes(':8080') && !url.includes('/api/')) return;
    const text = await Promise.race([res.text().catch(() => ''), new Promise<string>((r) => setTimeout(() => r(''), 3000))]);
    bodies.push(text);
  });
  return bodies;
}

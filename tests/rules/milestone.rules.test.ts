/**
 * LMS completion milestone — Firestore rules.
 *   G38: University Admins read the people of their own academy only.
 *   G22/G23: quiz attempt history is listed only by its student and the staff of its batch.
 *   G44: the audit log viewer's query (academy-scoped, newest first, paged) and its limits.
 *   G14: the paged People and Courses queries (filters in Firestore, cursors, counts).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, updateDoc, where, Firestore, Timestamp } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NOW = '2026-10-30T00:00:00.000Z';
let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-strynkix-milestone',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (p: string, d: Record<string, unknown>) => setDoc(doc(db, p), d);
    const user = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
      put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@x.test`, displayName: uid, createdAt: NOW, updatedAt: NOW, ...extra });
    await put('branches/b1', { orgId: 'org_a', name: 'B1', status: 'active' });
    await put('branches/bx', { orgId: 'org_b', name: 'BX', status: 'active' });
    await user('super', 'super_admin');
    await user('uni', 'university_admin');
    await user('uni_sus', 'university_admin', { status: 'suspended' });
    await user('uni_b', 'university_admin', { orgId: 'org_b' });
    await user('ba', 'branch_admin', { branchId: 'b1' });
    await user('stu', 'student', { branchId: 'b1' });
    await user('stu_b', 'student', { orgId: 'org_b', branchId: 'bx' });
    await user('stu2', 'student', { branchId: 'b1' });
    await user('inst', 'instructor', { branchId: 'b1' });
    await user('inst_other', 'instructor', { branchId: 'b1' });
    await user('ba_b2', 'branch_admin', { branchId: 'b2' });
    await put('branches/b2', { orgId: 'org_a', name: 'B2', status: 'active' });
    await put('batches/bt1', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', instructorUserIds: ['inst'], status: 'in_progress' });
    await put('progress/stu_c1_l1', { orgId: 'org_a', courseId: 'c1', lessonId: 'l1', moduleId: 'm1', studentId: 'stu', batchId: 'bt1', status: 'in_progress' });
    await put('auditLog/a1', { orgId: 'org_a', courseId: null, targetType: 'user', targetId: 'stu', action: 'account_suspend', actorId: 'uni', at: Timestamp.fromMillis(1000) });
    await put('auditLog/a2', { orgId: 'org_a', courseId: 'c1', targetType: 'lesson', targetId: 'l1', action: 'publish', actorId: 'super', at: Timestamp.fromMillis(2000) });
    await put('auditLog/b1', { orgId: 'org_b', courseId: null, targetType: 'user', targetId: 'stu_b', action: 'account_create', actorId: 'uni_b', at: Timestamp.fromMillis(3000) });
    for (const n of ['000001', '000002']) {
      await put(`progress/stu_c1_l1/quizAttempts/${n}`, { orgId: 'org_a', courseId: 'c1', lessonId: 'l1', studentId: 'stu', batchId: 'bt1', attemptNumber: Number(n), correct: 1, total: 2, percent: 50, passed: false, answers: { q1: 'a' }, attemptedAt: NOW, keyVersion: 1 });
    }
  });
});

describe('G38 — University Admin people access is academy-scoped', () => {
  it('lists and reads the people of their own academy', async () => {
    await assertSucceeds(getDocs(query(collection(as('uni'), 'users'), where('orgId', '==', 'org_a'))));
    await assertSucceeds(getDoc(doc(as('uni'), 'users/stu')));
  });

  it('cannot list or read another academy’s people, even by guessing ids', async () => {
    await assertFails(getDocs(query(collection(as('uni'), 'users'), where('orgId', '==', 'org_b'))));
    await assertFails(getDocs(collection(as('uni'), 'users')));
    await assertFails(getDoc(doc(as('uni'), 'users/stu_b')));
    await assertFails(getDoc(doc(as('uni_b'), 'users/stu')));
  });

  it('a suspended University Admin reads nobody else', async () => {
    await assertFails(getDocs(query(collection(as('uni_sus'), 'users'), where('orgId', '==', 'org_a'))));
    await assertFails(getDoc(doc(as('uni_sus'), 'users/stu')));
  });
});

describe('G22/G23 — quiz attempt history listing', () => {
  const attempts = (uid: string, ...filters: Array<[string, string]>) =>
    getDocs(query(collection(as(uid), 'progress', 'stu_c1_l1', 'quizAttempts'), ...filters.map(([f, v]) => where(f, '==', v))));

  it('the student lists their own attempts (with the filters the app sends)', async () => {
    await assertSucceeds(attempts('stu', ['orgId', 'org_a'], ['studentId', 'stu']));
  });

  it('staff of the batch list them with a batch filter', async () => {
    await assertSucceeds(attempts('inst', ['orgId', 'org_a'], ['batchId', 'bt1']));
    await assertSucceeds(attempts('ba', ['orgId', 'org_a'], ['batchId', 'bt1']));
    await assertSucceeds(attempts('uni', ['orgId', 'org_a'], ['batchId', 'bt1']));
  });

  it('other students, unassigned instructors, other branches and other academies are refused', async () => {
    await assertFails(attempts('stu2', ['orgId', 'org_a'], ['studentId', 'stu']));
    await assertFails(attempts('stu2', ['orgId', 'org_a']));
    await assertFails(attempts('inst_other', ['orgId', 'org_a'], ['batchId', 'bt1']));
    await assertFails(attempts('ba_b2', ['orgId', 'org_a'], ['batchId', 'bt1']));
    await assertFails(attempts('uni_b', ['orgId', 'org_a'], ['batchId', 'bt1']));
    await assertFails(attempts('stu_b', ['orgId', 'org_a'], ['studentId', 'stu']));
  });
});

describe('G44 — audit log viewer access', () => {
  const page = (uid: string, orgId: string, action?: string[]) => getDocs(query(collection(as(uid), 'auditLog'),
    where('orgId', '==', orgId), ...(action ? [where('action', 'in', action)] : []), orderBy('at', 'desc'), limit(26)));

  it('the University Admin pages through every entry of their academy, also by category', async () => {
    const snap = await assertSucceeds(page('uni', 'org_a'));
    if (snap.docs.map((d) => d.id).join() !== 'a2,a1') throw new Error(`unexpected entries ${snap.docs.map((d) => d.id)}`);
    await assertSucceeds(page('uni', 'org_a', ['account_suspend', 'account_create']));
    await assertSucceeds(page('super', 'org_b'));
  });

  it('nobody else lists an academy’s audit log; nobody writes or deletes entries', async () => {
    await assertFails(page('uni', 'org_b'));
    await assertFails(page('uni_b', 'org_a'));
    await assertFails(page('uni_sus', 'org_a'));
    for (const uid of ['ba', 'inst', 'stu']) await assertFails(page(uid, 'org_a'));
    await assertFails(getDoc(doc(as('ba'), 'auditLog/a1')));
    await assertFails(setDoc(doc(as('super'), 'auditLog/forged'), { orgId: 'org_a', action: 'publish', actorId: 'super' }));
    await assertFails(updateDoc(doc(as('super'), 'auditLog/a1'), { action: 'nothing' }));
    await assertFails(deleteDoc(doc(as('uni'), 'auditLog/a1')));
  });
});

describe('G14 — paged People and Courses queries pass the rules and page correctly', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (let i = 0; i < 7; i++) {
        await setDoc(doc(db, `users/p${i}`), { role: 'student', orgId: 'org_a', branchId: i < 4 ? 'b1' : 'b2', status: i === 6 ? 'suspended' : 'active', email: `p${i}@x.test`, displayName: `Person ${i}` });
      }
      for (let i = 0; i < 5; i++) await setDoc(doc(db, `courses/k${i}`), { orgId: 'org_a', title: `Course ${i}`, status: i % 2 ? 'published' : 'draft' });
      await setDoc(doc(db, 'courses/kb'), { orgId: 'org_b', title: 'Other', status: 'draft' });
    });
  });

  const people = (uid: string, scope: Array<[string, string]>, extra: Parameters<typeof query>[1][] = []) =>
    query(collection(as(uid), 'users'), ...scope.map(([f, v]) => where(f, '==', v)), where('role', 'in', ['branch_admin', 'instructor', 'student']), ...extra);

  it('a University Admin pages through students by name, with a cursor, and counts them', async () => {
    const first = await assertSucceeds(getDocs(query(people('uni', [['orgId', 'org_a']]), orderBy('displayName'), limit(3))));
    const ids = first.docs.map((d) => d.id);
    const second = await assertSucceeds(getDocs(query(people('uni', [['orgId', 'org_a']]), orderBy('displayName'), startAfter(first.docs[2]), limit(3))));
    if (second.docs.some((d) => ids.includes(d.id))) throw new Error('pages overlap');
    await assertSucceeds(getCountFromServer(query(collection(as('uni'), 'users'), where('orgId', '==', 'org_a'), where('role', '==', 'student'))));
    await assertSucceeds(getDocs(query(people('uni', [['orgId', 'org_a']]), where('status', '==', 'suspended'), orderBy('displayName'), limit(3))));
    await assertSucceeds(getDocs(query(people('uni', [['orgId', 'org_a']]), where('email', '==', 'p2@x.test'), limit(3))));
  });

  it('a Branch Manager pages only within their branch; another academy is refused', async () => {
    await assertSucceeds(getDocs(query(people('ba', [['orgId', 'org_a'], ['branchId', 'b1']]), orderBy('displayName'), limit(3))));
    await assertFails(getDocs(query(people('ba', [['orgId', 'org_a']]), orderBy('displayName'), limit(3))));
    await assertFails(getCountFromServer(query(collection(as('ba'), 'users'), where('orgId', '==', 'org_a'), where('role', '==', 'student'))));
    await assertFails(getDocs(query(people('uni', [['orgId', 'org_b']]), orderBy('displayName'), limit(3))));
  });

  it('authors page their academy’s courses by title, filtered by status; students never list them', async () => {
    const page = await assertSucceeds(getDocs(query(collection(as('inst'), 'courses'), where('orgId', '==', 'org_a'), where('status', '==', 'draft'), orderBy('title'), limit(2))));
    if (page.docs.some((d) => d.data().status !== 'draft')) throw new Error('status filter not applied');
    await assertSucceeds(getDocs(query(collection(as('super'), 'courses'), orderBy('title'), limit(2))));
    await assertFails(getDocs(query(collection(as('inst'), 'courses'), where('orgId', '==', 'org_b'), orderBy('title'), limit(2))));
    await assertFails(getDocs(query(collection(as('stu'), 'courses'), where('orgId', '==', 'org_a'), orderBy('title'), limit(2))));
  });
});


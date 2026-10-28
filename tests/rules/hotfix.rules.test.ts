/**
 * Strynkix LMS — tests for firestore.hotfix.rules (committed app + two minimal fixes).
 * Proves the fixes close the holes AND that the committed app's existing access
 * model still works, so the hotfix can ship before the enrollment migration.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'strynkix-lms-hotfix',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.hotfix.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (uid: string, role: string, orgId: string) =>
      setDoc(doc(db, `users/${uid}`), { role, orgId, branchId: 'b1', status: 'active', email: `${uid}@x.test`, displayName: uid });
    await user('inst_a', 'instructor', 'org_a');
    await user('inst_rival', 'instructor', 'org_b');
    await user('stu_a', 'student', 'org_a');
    await setDoc(doc(db, 'courses/c1'), { orgId: 'org_a', title: 'C1', status: 'published' });
    await setDoc(doc(db, 'modules/m1'), { orgId: 'org_a', courseId: 'c1', title: 'M1', status: 'published' });
    await setDoc(doc(db, 'lessons/l1'), { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'L1', status: 'published' });
    await setDoc(doc(db, 'assignments/a1'), { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'A1', status: 'published' });
  });
});

describe('hotfix — closes the cross-tenant overwrite', () => {
  it('a foreign-org instructor cannot overwrite a module, lesson or assignment by relabelling orgId', async () => {
    const db = as('inst_rival');
    await assertFails(setDoc(doc(db, 'lessons/l1'), { orgId: 'org_b', courseId: 'c1', moduleId: 'm1', title: 'Defaced', status: 'published' }));
    await assertFails(setDoc(doc(db, 'modules/m1'), { orgId: 'org_b', courseId: 'c1', title: 'Defaced', status: 'published' }));
    await assertFails(setDoc(doc(db, 'assignments/a1'), { orgId: 'org_b', courseId: 'c1', title: 'Defaced', status: 'published' }));
  });

  it('existing behaviour preserved: an instructor still creates and edits content in their own org', async () => {
    const db = as('inst_a');
    await assertSucceeds(updateDoc(doc(db, 'lessons/l1'), { title: 'L1 edited' }));
    await assertSucceeds(setDoc(doc(db, 'lessons/l2'), { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'L2', status: 'draft' }));
    await assertSucceeds(updateDoc(doc(db, 'modules/m1'), { title: 'M1 edited' }));
    await assertFails(updateDoc(doc(db, 'lessons/l1'), { orgId: 'org_b' }));
  });
});

describe('hotfix — closes active self-signup', () => {
  it('self-signup cannot create an active student, or one with no status', async () => {
    await assertFails(setDoc(doc(as('newcomer'), 'users/newcomer'), { role: 'student', orgId: 'org_a', status: 'active', email: 'n@x.test', displayName: 'N' }));
    await assertFails(setDoc(doc(as('newcomer'), 'users/newcomer'), { role: 'student', orgId: 'org_a', email: 'n@x.test', displayName: 'N' }));
    await assertFails(setDoc(doc(as('newcomer'), 'users/newcomer'), { role: 'pending_verification', orgId: 'org_a', email: 'n@x.test', displayName: 'N' }));
  });

  it('self-signup can still create a pending student, which then has no content access', async () => {
    await assertSucceeds(setDoc(doc(as('newcomer'), 'users/newcomer'), { role: 'student', orgId: 'org_a', status: 'pending_verification', email: 'n@x.test', displayName: 'N' }));
    await assertFails(getDoc(doc(as('newcomer'), 'lessons/l1')));
  });
});

describe('hotfix — committed app access model unchanged', () => {
  it('an active student still reads published content in their org (no enrollment gating yet)', async () => {
    await assertSucceeds(getDoc(doc(as('stu_a'), 'courses/c1')));
    await assertSucceeds(getDoc(doc(as('stu_a'), 'lessons/l1')));
  });
});

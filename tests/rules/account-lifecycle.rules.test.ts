/**
 * Stage C5 — account lifecycle and audit against firestore.rules. Membership
 * and account status change only through the audited server routes; no client
 * can escalate itself, keep membership on an ineligible role, or read, forge,
 * change or delete account audit entries outside its authority.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NOW = '2026-10-29T00:00:00.000Z';
let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
const cd = (responsibilities: string[], assignedCourseIds: string[], assignedByUserId = 'super') => ({
  department: 'course_design', responsibilities, assignedCourseIds, assignedAt: NOW, assignedByUserId,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'strynkix-lms-lifecycle',
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
      put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@x.test`, displayName: uid, ...extra });
    await put('branches/b1', { orgId: 'org_a', name: 'B1', status: 'active' });
    await user('super', 'super_admin');
    await user('uni', 'university_admin');
    await user('uni_b', 'university_admin', { orgId: 'org_b' });
    await user('ba', 'branch_admin', { branchId: 'b1' });
    await user('inst', 'instructor', { branchId: 'b1' });
    await user('inst_member', 'instructor', { branchId: 'b1', courseDesign: cd(['reviewer'], ['c1']) });
    await user('designer', 'content_designer', { courseDesign: cd(['content_developer'], ['c1']) });
    await user('stu', 'student', { branchId: 'b1' });
    await user('stu_pending', 'student', { branchId: 'b1', status: 'pending_verification' });
    await put('courses/c1', { orgId: 'org_a', title: 'C1', status: 'draft', createdById: 'inst' });
    const entry = (id: string, extra: Record<string, unknown>) => put(`auditLog/${id}`, {
      orgId: 'org_a', targetType: 'user', targetId: 'designer', actorId: 'super', actorRole: 'super_admin', at: NOW, ...extra,
    });
    await entry('acct', { courseId: null, action: 'account_suspend', fromStatus: 'active', toStatus: 'suspended' });
    await entry('member', { courseId: null, action: 'membership_assign', membershipAfter: { responsibilities: ['content_developer'], assignedCourseIds: ['c1'] } });
    await entry('content', { courseId: 'c1', targetType: 'lesson', targetId: 'l1', action: 'approve' });
  });
});

describe('C5 — membership changes only through the server', () => {
  it('no client grants, edits or removes membership — Super Admin, University Admin, the member, or a self-grant', async () => {
    await assertFails(updateDoc(doc(as('super'), 'users/inst'), { courseDesign: cd(['lead'], ['*']) }));
    await assertFails(updateDoc(doc(as('super'), 'users/designer'), { courseDesign: cd(['lead'], ['c1']) }));
    await assertFails(updateDoc(doc(as('super'), 'users/designer'), { courseDesign: deleteField() }));
    await assertFails(updateDoc(doc(as('uni'), 'users/inst'), { courseDesign: cd(['lead'], ['c1'], 'uni') }));
    await assertFails(updateDoc(doc(as('designer'), 'users/designer'), { courseDesign: cd(['lead'], ['*'], 'designer') }));
    await assertFails(updateDoc(doc(as('inst'), 'users/inst'), { courseDesign: cd(['reviewer'], ['c1'], 'inst') }));
    await assertFails(setDoc(doc(as('super'), 'users/new_member'), { role: 'content_designer', orgId: 'org_a', status: 'active', email: 'n@x.test', displayName: 'N', courseDesign: cd(['lead'], ['c1']) }));
  });

  it('membership cannot survive a change to an ineligible role', async () => {
    await assertFails(updateDoc(doc(as('uni'), 'users/inst_member'), { role: 'student' }));
    await assertFails(updateDoc(doc(as('ba'), 'users/inst_member'), { role: 'student' }));
    // Positive control: the same change for an instructor without membership still works.
    await assertSucceeds(updateDoc(doc(as('uni'), 'users/inst'), { role: 'student' }));
  });
});

describe('C5 — account status changes only through the server', () => {
  it('no client approves, suspends or reactivates an account', async () => {
    await assertFails(updateDoc(doc(as('super'), 'users/designer'), { status: 'suspended' }));
    await assertFails(updateDoc(doc(as('uni'), 'users/stu_pending'), { status: 'active' }));
    await assertFails(updateDoc(doc(as('ba'), 'users/stu'), { status: 'suspended' }));
    await assertFails(updateDoc(doc(as('stu_pending'), 'users/stu_pending'), { status: 'active' }));
  });

  it('self-escalation stays impossible', async () => {
    await assertFails(updateDoc(doc(as('stu'), 'users/stu'), { role: 'super_admin' }));
    await assertFails(updateDoc(doc(as('inst'), 'users/inst'), { role: 'university_admin' }));
    await assertFails(updateDoc(doc(as('ba'), 'users/ba'), { branchId: 'b2' }));
    await assertFails(setDoc(doc(as('stu'), 'users/stu'), { role: 'student', orgId: 'org_a', status: 'active', email: 'stu@x.test', displayName: 'stu' }));
  });

  it('regression: legitimate profile edits still work', async () => {
    await assertSucceeds(updateDoc(doc(as('stu'), 'users/stu'), { displayName: 'New name', updatedAt: NOW }));
    await assertSucceeds(updateDoc(doc(as('ba'), 'users/stu'), { displayName: 'Renamed by manager' }));
    await assertSucceeds(updateDoc(doc(as('super'), 'users/designer'), { displayName: 'Renamed by super' }));
  });
});

describe('C5 — audit log', () => {
  it('account entries are readable only by the Super Admin and that org’s University Admin', async () => {
    for (const id of ['acct', 'member']) {
      await assertSucceeds(getDoc(doc(as('super'), `auditLog/${id}`)));
      await assertSucceeds(getDoc(doc(as('uni'), `auditLog/${id}`)));
      for (const uid of ['uni_b', 'ba', 'inst', 'designer', 'stu']) await assertFails(getDoc(doc(as(uid), `auditLog/${id}`)));
    }
  });

  it('regression: content entries stay readable by authors and in-scope members, and their history query still works', async () => {
    for (const uid of ['inst', 'ba', 'designer']) await assertSucceeds(getDoc(doc(as(uid), 'auditLog/content')));
    await assertSucceeds(getDocs(query(collection(as('designer'), 'auditLog'), where('orgId', '==', 'org_a'), where('courseId', '==', 'c1'), where('targetId', '==', 'l1'))));
    await assertFails(getDoc(doc(as('stu'), 'auditLog/content')));
  });

  it('nobody forges, edits or deletes audit entries from a client', async () => {
    for (const uid of ['super', 'uni', 'ba']) {
      await assertFails(setDoc(doc(as(uid), `auditLog/forged_${uid}`), { orgId: 'org_a', courseId: null, targetType: 'user', targetId: 'stu', action: 'account_suspend', actorId: uid, at: NOW }));
      await assertFails(updateDoc(doc(as(uid), 'auditLog/acct'), { reason: 'rewritten' }));
      await assertFails(deleteDoc(doc(as(uid), 'auditLog/member')));
    }
  });
});

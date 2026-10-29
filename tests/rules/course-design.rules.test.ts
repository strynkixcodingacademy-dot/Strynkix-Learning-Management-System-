/**
 * Strynkix LMS — Course Design membership (Stage B) against firestore.rules.
 * Membership administration (Super Admin only), authority from
 * courseDesign.responsibilities + assignedCourseIds, fail-closed denials, and
 * regression of instructor / branch-admin draft authoring and D3 publishing.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where, Firestore } from 'firebase/firestore';
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
    projectId: 'strynkix-lms-coursedesign',
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
    await user('super_sus', 'super_admin', { status: 'suspended' });
    await user('uni', 'university_admin');
    await user('ba', 'branch_admin', { branchId: 'b1' });
    await user('inst', 'instructor', { branchId: 'b1' });
    await user('stu', 'student', { branchId: 'b1' });
    await user('designer_c1', 'content_designer', { courseDesign: cd(['content_developer'], ['c1']) });
    await user('architect_all', 'content_designer', { courseDesign: cd(['curriculum_architect'], ['*']) });
    await user('lead_all', 'content_lead', { courseDesign: cd(['lead'], ['*']) });
    await user('lead_label', 'content_lead');
    await user('reviewer_c1', 'content_designer', { courseDesign: cd(['reviewer', 'assessment_designer'], ['c1']) });
    await user('designer_sus', 'content_designer', { status: 'suspended', courseDesign: cd(['content_developer'], ['c1']) });
    await user('designer_b', 'content_designer', { orgId: 'org_b', courseDesign: cd(['content_developer', 'curriculum_architect'], ['*']) });
    await user('malformed', 'content_designer', { courseDesign: { department: 'course_design', responsibilities: ['content_developer'], assignedCourseIds: ['c1'] } });
    await user('stu_cd', 'student', { branchId: 'b1', courseDesign: cd(['content_developer'], ['c1']) });
    await user('target', 'content_designer');
    await user('target_sus', 'content_designer', { status: 'suspended' });
    const course = (id: string, status: string, orgId = 'org_a') => put(`courses/${id}`, { orgId, title: id, status, createdById: 'super' });
    await course('c1', 'draft');
    await course('c2', 'draft');
    await course('cpub', 'published');
    await course('cb', 'draft', 'org_b');
    await put('modules/m1', { orgId: 'org_a', courseId: 'c1', title: 'M1', status: 'draft' });
    await put('modules/mpub', { orgId: 'org_a', courseId: 'cpub', title: 'MP', status: 'published' });
    const lesson = (id: string, courseId: string, status = 'draft', orgId = 'org_a') =>
      put(`lessons/${id}`, { orgId, courseId, moduleId: 'm1', title: id, status, blocks: [] });
    await lesson('l1', 'c1');
    await lesson('l2', 'c2');
    await lesson('lpub', 'cpub', 'published');
    await lesson('lb', 'cb', 'draft', 'org_b');
    await put('assignments/a1', { orgId: 'org_a', courseId: 'c1', title: 'A1', status: 'published' });
  });
});

const grant = (by: string, uid: string, membership: unknown, extra: Record<string, unknown> = {}) =>
  updateDoc(doc(as(by), `users/${uid}`), { courseDesign: membership, updatedAt: NOW, ...extra });

describe('Membership administration — only an active Super Admin', () => {
  // Stage C5: membership changes go through the audited server route
  // (tests/emulator/account-admin.emulator.test.ts); client writes are refused, even the Super Admin's.
  it('the Super Admin can no longer assign, update or revoke membership with a client write', async () => {
    await assertFails(grant('super', 'target', cd(['content_developer'], ['c1'])));
    await assertFails(grant('super', 'inst', cd(['curriculum_architect'], ['c1'])));
    await assertFails(grant('super', 'target', cd(['lead'], ['*'])));
    await assertFails(updateDoc(doc(as('super'), 'users/designer_c1'), { courseDesign: deleteField() }));
  });

  it('Super Admin creates a content account without membership (granted afterwards by the server)', async () => {
    const profile = { role: 'content_designer', orgId: 'org_a', status: 'active', email: 'n@x.test', displayName: 'N' };
    await assertFails(setDoc(doc(as('super'), 'users/new1'), { ...profile, courseDesign: cd(['content_developer'], ['c1']) }));
    await assertFails(setDoc(doc(as('super'), 'users/new2'), { ...profile, courseDesign: cd(['content_developer'], ['c1'], 'new2') }));
    await assertSucceeds(setDoc(doc(as('super'), 'users/new3'), profile));
  });

  it('denies malformed memberships, forged assigners and unsafe scopes', async () => {
    await assertFails(grant('super', 'target', cd(['content_developer'], ['c1'], 'someone_else')));
    await assertFails(grant('super', 'target', cd(['content_developer'], ['*', 'c1'])));
    await assertFails(grant('super', 'target', cd(['content_developer'], [])));
    await assertFails(grant('super', 'target', cd([], ['c1'])));
    await assertFails(grant('super', 'target', cd(['publisher'], ['c1'])));
    await assertFails(grant('super', 'target', cd(['content_developer', 'content_developer'], ['c1'])));
    await assertFails(grant('super', 'target', { ...cd(['content_developer'], ['c1']), canPublish: true }));
    await assertFails(grant('super', 'target', { ...cd(['content_developer'], ['c1']), department: 'sales' }));
    await assertFails(grant('super', 'target', { ...cd(['content_developer'], ['c1']), assignedAt: 'yesterday' }));
  });

  it('denies assignment to suspended, ineligible or own accounts, and by a suspended Super Admin', async () => {
    await assertFails(grant('super', 'target_sus', cd(['content_developer'], ['c1'])));
    await assertFails(grant('super', 'stu', cd(['content_developer'], ['c1'])));
    await assertFails(grant('super', 'ba', cd(['content_developer'], ['c1'])));
    await assertFails(grant('super', 'uni', cd(['content_developer'], ['c1'])));
    await assertFails(grant('super', 'super', cd(['lead'], ['*'])));
    // ...including by switching their own role to an eligible one in the same write.
    await assertFails(grant('super', 'super', cd(['lead'], ['*']), { role: 'content_lead' }));
    await assertFails(grant('super_sus', 'target', cd(['content_developer'], ['c1'], 'super_sus')));
  });

  it('University Admins, Branch Admins, leads and designers cannot assign, change or revoke membership', async () => {
    await assertFails(grant('uni', 'inst', cd(['content_developer'], ['c1'], 'uni')));
    await assertFails(grant('ba', 'inst', cd(['content_developer'], ['c1'], 'ba')));
    await assertFails(grant('lead_all', 'target', cd(['content_developer'], ['c1'], 'lead_all')));
    await assertFails(grant('architect_all', 'target', cd(['content_developer'], ['c1'], 'architect_all')));
    await assertFails(updateDoc(doc(as('uni'), 'users/designer_c1'), { courseDesign: deleteField() }));
    await assertFails(updateDoc(doc(as('uni'), 'users/designer_c1'), { role: 'instructor' }));
  });

  it('no self-assignment or escalation through one\'s own profile', async () => {
    await assertFails(grant('target', 'target', cd(['lead'], ['*'], 'target')));
    await assertFails(grant('designer_c1', 'designer_c1', cd(['content_developer'], ['*'], 'designer_c1')));
    await assertFails(updateDoc(doc(as('designer_c1'), 'users/designer_c1'), { role: 'super_admin' }));
    await assertFails(updateDoc(doc(as('designer_c1'), 'users/designer_c1'), { orgId: 'org_b' }));
    await assertFails(updateDoc(doc(as('inst'), 'users/inst'), { courseDesign: cd(['lead'], ['*'], 'inst') }));
    await assertSucceeds(updateDoc(doc(as('designer_c1'), 'users/designer_c1'), { displayName: 'Renamed', updatedAt: NOW }));
  });

  it('no membership can be created through self-signup or by other administrators', async () => {
    const membership = cd(['content_developer'], ['*'], 'newbie');
    await assertFails(setDoc(doc(as('newbie'), 'users/newbie'), { role: 'student', orgId: 'org_a', status: 'pending_verification', email: 'n@x.test', displayName: 'N', courseDesign: membership }));
    await assertFails(setDoc(doc(as('uni'), 'users/u_new'), { role: 'instructor', orgId: 'org_a', status: 'active', email: 'n@x.test', displayName: 'N', courseDesign: cd(['content_developer'], ['c1'], 'uni') }));
    await assertFails(setDoc(doc(as('ba'), 'users/b_new'), { role: 'instructor', orgId: 'org_a', branchId: 'b1', status: 'active', email: 'n@x.test', displayName: 'N', courseDesign: cd(['content_developer'], ['c1'], 'ba') }));
    await assertFails(setDoc(doc(as('uni'), 'users/u_new2'), { role: 'content_designer', orgId: 'org_a', status: 'active', email: 'n@x.test', displayName: 'N' }));
  });

  it('a signed-in account with no profile cannot manage membership', async () => {
    await assertFails(grant('ghost', 'target', cd(['content_developer'], ['c1'], 'ghost')));
  });

  it('existing admin edits that do not touch membership still work', async () => {
    await assertSucceeds(updateDoc(doc(as('uni'), 'users/inst'), { displayName: 'Inst renamed' }));
    await assertSucceeds(updateDoc(doc(as('ba'), 'users/stu'), { displayName: 'Stu renamed' }));
    await assertSucceeds(updateDoc(doc(as('super'), 'users/designer_c1'), { displayName: 'Designer renamed' }));
    // Stage C5: status changes go through the audited account-status route.
    await assertFails(updateDoc(doc(as('super'), 'users/designer_c1'), { status: 'suspended' }));
  });
});

describe('Course Design authority — responsibilities and scope', () => {
  it('a content developer reads and edits lessons of in-scope draft courses only', async () => {
    const db = as('designer_c1');
    await assertSucceeds(getDoc(doc(db, 'courses/c1')));
    await assertSucceeds(getDoc(doc(db, 'lessons/l1')));
    await assertSucceeds(getDocs(query(collection(db, 'lessons'), where('orgId', '==', 'org_a'), where('courseId', '==', 'c1'))));
    await assertSucceeds(updateDoc(doc(db, 'lessons/l1'), { lastEditedById: 'designer_c1', title: 'Edited' }));
    await assertSucceeds(setDoc(doc(db, 'lessons/l_new'), { lastEditedById: 'designer_c1', orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'New', status: 'draft', blocks: [] }));
    await assertFails(getDoc(doc(db, 'courses/c2')));
    await assertFails(getDoc(doc(db, 'lessons/l2')));
    await assertFails(updateDoc(doc(db, 'lessons/l2'), { lastEditedById: 'designer_c1', title: 'Out of scope' }));
    await assertFails(getDocs(query(collection(db, 'courses'), where('orgId', '==', 'org_a'))));
  });

  it('responsibilities gate the action: a content developer cannot edit course details or modules', async () => {
    await assertFails(updateDoc(doc(as('designer_c1'), 'courses/c1'), { lastEditedById: 'designer_c1', title: 'Renamed' }));
    await assertFails(updateDoc(doc(as('designer_c1'), 'modules/m1'), { title: 'Renamed' }));
  });

  it('an org-wide curriculum architect edits any draft course in their org, never published ones', async () => {
    const db = as('architect_all');
    await assertSucceeds(getDocs(query(collection(db, 'courses'), where('orgId', '==', 'org_a'))));
    await assertSucceeds(updateDoc(doc(db, 'courses/c2'), { lastEditedById: 'architect_all', title: 'Renamed' }));
    await assertSucceeds(setDoc(doc(db, 'modules/m_new'), { orgId: 'org_a', courseId: 'c2', title: 'New module', status: 'draft' }));
    await assertFails(updateDoc(doc(db, 'courses/cpub'), { lastEditedById: 'architect_all', title: 'Renamed' }));
    await assertFails(updateDoc(doc(db, 'lessons/lpub'), { lastEditedById: 'architect_all', title: 'Renamed' }));
    await assertFails(setDoc(doc(db, 'modules/m_pub'), { orgId: 'org_a', courseId: 'cpub', title: 'X', status: 'draft' }));
  });

  it('no Course Design member publishes, unpublishes or archives (D3)', async () => {
    await assertFails(updateDoc(doc(as('lead_all'), 'courses/c1'), { lastEditedById: 'lead_all', status: 'published' }));
    await assertFails(updateDoc(doc(as('lead_all'), 'lessons/l1'), { lastEditedById: 'lead_all', status: 'published' }));
    await assertFails(updateDoc(doc(as('architect_all'), 'courses/c2'), { lastEditedById: 'architect_all', status: 'archived' }));
    await assertFails(setDoc(doc(as('designer_c1'), 'lessons/l_pub'), { lastEditedById: 'designer_c1', orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'X', status: 'published', blocks: [] }));
    await assertFails(setDoc(doc(as('architect_all'), 'courses/c_new_pub'), { lastEditedById: 'architect_all', orgId: 'org_a', title: 'X', status: 'published', createdById: 'architect_all' }));
  });

  it('reviewers and assessment designers can read in scope but not write', async () => {
    await assertSucceeds(getDoc(doc(as('reviewer_c1'), 'lessons/l1')));
    await assertFails(updateDoc(doc(as('reviewer_c1'), 'lessons/l1'), { lastEditedById: 'reviewer_c1', title: 'X' }));
    await assertFails(updateDoc(doc(as('reviewer_c1'), 'courses/c1'), { lastEditedById: 'reviewer_c1', title: 'X' }));
  });

  it('fails closed: role label alone, suspended, malformed, cross-org, students with a membership map', async () => {
    for (const uid of ['lead_label', 'designer_sus', 'malformed', 'stu_cd']) {
      await assertFails(getDoc(doc(as(uid), 'courses/c1')));
      await assertFails(updateDoc(doc(as(uid), 'lessons/l1'), { title: 'X' }));
    }
    await assertFails(getDoc(doc(as('designer_b'), 'courses/c1')));
    await assertFails(updateDoc(doc(as('designer_b'), 'lessons/l1'), { lastEditedById: 'designer_b', title: 'X' }));
    await assertFails(getDoc(doc(as('designer_c1'), 'courses/cb')));
    await assertFails(getDoc(doc(as('ghost'), 'courses/c1')));
  });

  it('membership grants no access to people, assignments or answer keys', async () => {
    await assertFails(getDoc(doc(as('lead_all'), 'users/designer_c1')));
    await assertFails(getDoc(doc(as('lead_all'), 'users/stu')));
    await assertFails(getDoc(doc(as('lead_all'), 'assignments/a1')));
    await assertFails(getDoc(doc(as('lead_all'), 'assignments/a1/keys/k1')));
    await assertFails(setDoc(doc(as('lead_all'), 'assignments/a1/keys/k1'), { answer: 'b' }));
  });

  it('revoking membership removes access immediately', async () => {
    await assertSucceeds(getDoc(doc(as('designer_c1'), 'lessons/l1')));
    // The server route revokes (Stage C5); simulated here with a trusted write.
    await testEnv.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'users/designer_c1'), { courseDesign: deleteField() }));
    await assertFails(getDoc(doc(as('designer_c1'), 'lessons/l1')));
  });
});

describe('Regression — instructor and branch-admin draft authoring unchanged', () => {
  it('instructors create and edit drafts without any membership, and cannot publish', async () => {
    const db = as('inst');
    await assertSucceeds(setDoc(doc(db, 'courses/i_new'), { lastEditedById: 'inst', orgId: 'org_a', title: 'I', status: 'draft', createdById: 'inst' }));
    await assertSucceeds(updateDoc(doc(db, 'courses/c2'), { lastEditedById: 'inst', title: 'Edited by instructor' }));
    await assertSucceeds(setDoc(doc(db, 'modules/i_mod'), { orgId: 'org_a', courseId: 'c2', title: 'M', status: 'draft' }));
    // Stage C3: published lessons change only through a working revision.
    await assertFails(updateDoc(doc(db, 'lessons/lpub'), { lastEditedById: 'inst', title: 'Edited published lesson content' }));
    await assertSucceeds(updateDoc(doc(db, 'lessons/l1'), { lastEditedById: 'inst', title: 'Edited draft lesson content' }));
    await assertFails(updateDoc(doc(db, 'lessons/l1'), { lastEditedById: 'inst', status: 'published' }));
    await assertFails(updateDoc(doc(db, 'courses/c2'), { lastEditedById: 'inst', status: 'published' }));
  });

  it('branch admins create and edit drafts as before', async () => {
    const db = as('ba');
    await assertSucceeds(setDoc(doc(db, 'courses/b_new'), { lastEditedById: 'ba', orgId: 'org_a', title: 'B', status: 'draft', createdById: 'ba' }));
    await assertSucceeds(setDoc(doc(db, 'modules/b_mod'), { orgId: 'org_a', courseId: 'c1', title: 'M', status: 'draft' }));
    await assertSucceeds(setDoc(doc(db, 'lessons/b_les'), { lastEditedById: 'ba', orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'L', status: 'draft', blocks: [] }));
    await assertFails(updateDoc(doc(db, 'courses/c1'), { lastEditedById: 'ba', status: 'published' }));
  });

  // Stage C2: publishing moved to the audited review route (D3 is enforced there).
  it('the Super Admin publishes only through the audited route; students still cannot read drafts', async () => {
    await assertFails(updateDoc(doc(as('super'), 'courses/c1'), { lastEditedById: 'super', status: 'published' }));
    await assertFails(getDoc(doc(as('stu'), 'courses/c2')));
  });
});

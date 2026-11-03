/**
 * Academy operations — every new collection is server-only. No browser, not
 * even the Super Admin or the record's own student, can read or write it
 * directly; all access goes through the authorized API routes.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NOW = '2026-10-30T00:00:00.000Z';
let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

const COLLECTIONS = [
  'assessments', 'assessmentAttempts', 'attendance', 'certificatePolicies', 'certificates', 'admissions', 'personProfiles', 'counters',
  'coursePricing', 'feeAccounts', 'feeTransactions', 'expenseCategories', 'expenses', 'recurringExpenses', 'portfolioEntries', 'resumes',
  // Stage 8–9
  'announcements', 'reportSnapshots', 'snapshotJobs', 'snapshotLocks', 'snapshotInvalidations', 'reconciliationReviews',
  // Stage 10
  'achievements', 'achievementSettings', 'engagementSettings', 'notificationPreferences', 'feedback', 'doubts', 'activities', 'activityRegistrations',
];

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-strynkix-academy-ops',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { if (testEnv) await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
      setDoc(doc(db, `users/${uid}`), { role, orgId: 'org_a', status: 'active', email: `${uid}@x.test`, displayName: uid, createdAt: NOW, updatedAt: NOW, ...extra });
    await user('super', 'super_admin');
    await user('ba', 'branch_admin', { branchId: 'b1' });
    await user('stu', 'student', { branchId: 'b1' });
    for (const c of COLLECTIONS) {
      await setDoc(doc(db, `${c}/rec1`), { orgId: 'org_a', branchId: 'b1', studentId: 'stu', amount: 100, status: 'issued' });
    }
    await setDoc(doc(db, 'assessments/rec1/key/current'), { orgId: 'org_a', items: [{ questionId: 'q1', correctOptionIds: ['a'] }] });
  });
});

describe('server-only academy collections', () => {
  for (const c of COLLECTIONS) {
    it(`${c}: no direct reads or writes, even for the Super Admin or the record’s own student`, async () => {
      for (const uid of ['super', 'ba', 'stu']) {
        const db = as(uid);
        await assertFails(getDoc(doc(db, `${c}/rec1`)));
        await assertFails(getDocs(query(collection(db, c), where('orgId', '==', 'org_a'))));
        await assertFails(setDoc(doc(db, `${c}/new`), { orgId: 'org_a', branchId: 'b1', studentId: uid }));
        await assertFails(updateDoc(doc(db, `${c}/rec1`), { amount: 0, status: 'paid' }));
        await assertFails(deleteDoc(doc(db, `${c}/rec1`)));
      }
    });
  }
  it('exam answer keys are unreadable', async () => {
    for (const uid of ['super', 'ba', 'stu']) await assertFails(getDoc(doc(as(uid), 'assessments/rec1/key/current')));
  });
});

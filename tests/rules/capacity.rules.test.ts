/**
 * Strynkix LMS — batch capacity (owner decision D2).
 * On a capped batch, an enrollment write that adds or removes an active seat
 * must move activeEnrollmentCount by exactly that amount in the same atomic
 * write and never past maxStudents, so racing enrollments cannot overfill it.
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, increment, setDoc, writeBatch, Firestore } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ORG = 'strynkix';
const NOW = '2026-10-01T00:00:00.000Z';
let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'strynkix-lms-capacity',
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
    await put('branches/br', { orgId: ORG, name: 'Br', status: 'active' });
    await put('courses/c1', { orgId: ORG, title: 'C1', status: 'published' });
    await put('users/ba', { role: 'branch_admin', orgId: ORG, branchId: 'br', status: 'active', email: 'ba@x.test', displayName: 'BA' });
    await put('users/ba2', { role: 'branch_admin', orgId: ORG, branchId: 'br', status: 'active', email: 'ba2@x.test', displayName: 'BA2' });
    for (const s of ['s1', 's2', 's3']) {
      await put(`users/${s}`, { role: 'student', orgId: ORG, branchId: 'br', status: 'active', email: `${s}@x.test`, displayName: s });
    }
    const batch = (id: string, extra: Record<string, unknown>) => put(`batches/${id}`, {
      orgId: ORG, branchId: 'br', courseId: 'c1', name: id, code: id, instructorUserIds: [], startDate: NOW, status: 'in_progress', ...extra,
    });
    await batch('cap1', { maxStudents: 1, activeEnrollmentCount: 0 });
    await batch('cap2', { maxStudents: 2, activeEnrollmentCount: 0 });
    await batch('open', {});
  });
});

const enrollment = (studentId: string, batchId: string, status = 'active') => ({
  orgId: ORG, branchId: 'br', courseId: 'c1', batchId, studentId, status, enrolledAt: NOW,
});

/** The service's write: enrollment + seat counter, atomically. */
function enrollWithSeat(db: Firestore, studentId: string, batchId: string) {
  const w = writeBatch(db);
  w.set(doc(db, `enrollments/c1_${studentId}`), enrollment(studentId, batchId));
  w.update(doc(db, `batches/${batchId}`), { activeEnrollmentCount: increment(1) });
  return w.commit();
}

const seats = async (batchId: string) => {
  let n = -1;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    n = (await getDoc(doc(ctx.firestore(), `batches/${batchId}`))).data()!.activeEnrollmentCount;
  });
  return n;
};

describe('D2 — capped batches', () => {
  it('fixed: two concurrent enrollments into a 1-seat batch — exactly one succeeds', async () => {
    const results = await Promise.allSettled([enrollWithSeat(as('ba'), 's1', 'cap1'), enrollWithSeat(as('ba2'), 's2', 'cap1')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await seats('cap1')).toBe(1);
  });

  it('an enrollment that skips the seat counter is rejected', async () => {
    await assertFails(setDoc(doc(as('ba'), 'enrollments/c1_s1'), enrollment('s1', 'cap2')));
  });

  it('the counter cannot be bumped by more than one seat, or past maxStudents', async () => {
    const db = as('ba');
    const w = writeBatch(db);
    w.set(doc(db, 'enrollments/c1_s1'), enrollment('s1', 'cap2'));
    w.update(doc(db, 'batches/cap2'), { activeEnrollmentCount: increment(2) });
    await assertFails(w.commit());
    await assertSucceeds(enrollWithSeat(db, 's1', 'cap2'));
    await assertSucceeds(enrollWithSeat(db, 's2', 'cap2'));
    await assertFails(enrollWithSeat(db, 's3', 'cap2'));
  });

  it('withdrawing frees exactly one seat, which can then be reused', async () => {
    const db = as('ba');
    await assertSucceeds(enrollWithSeat(db, 's1', 'cap1'));
    // Withdrawal without giving the seat back is rejected (counter would drift).
    await assertFails(setDoc(doc(db, 'enrollments/c1_s1'), { ...enrollment('s1', 'cap1', 'dropped') }));
    const w = writeBatch(db);
    w.update(doc(db, 'enrollments/c1_s1'), { status: 'dropped' });
    w.update(doc(db, 'batches/cap1'), { activeEnrollmentCount: increment(-1) });
    await assertSucceeds(w.commit());
    expect(await seats('cap1')).toBe(0);
    await assertSucceeds(enrollWithSeat(db, 's2', 'cap1'));
  });

  it('reactivation into a full batch is rejected', async () => {
    const db = as('ba');
    await assertSucceeds(enrollWithSeat(db, 's1', 'cap1'));
    await testEnv.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'enrollments/c1_s2'), enrollment('s2', 'cap1', 'dropped')));
    const w = writeBatch(db);
    w.update(doc(db, 'enrollments/c1_s2'), { status: 'active' });
    w.update(doc(db, 'batches/cap1'), { activeEnrollmentCount: increment(1) });
    await assertFails(w.commit());
  });

  it('moving an active student between capped batches moves the seat', async () => {
    const db = as('ba');
    await assertSucceeds(enrollWithSeat(db, 's1', 'cap2'));
    const w = writeBatch(db);
    w.update(doc(db, 'enrollments/c1_s1'), { batchId: 'cap1' });
    w.update(doc(db, 'batches/cap1'), { activeEnrollmentCount: increment(1) });
    w.update(doc(db, 'batches/cap2'), { activeEnrollmentCount: increment(-1) });
    await assertSucceeds(w.commit());
    expect([await seats('cap1'), await seats('cap2')]).toEqual([1, 0]);
  });
});

describe('D2 — uncapped batches are unaffected', () => {
  it('enrollments in a batch without maxStudents need no counter', async () => {
    await assertSucceeds(setDoc(doc(as('ba'), 'enrollments/c1_s1'), enrollment('s1', 'open')));
  });
});

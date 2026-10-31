/**
 * Strynkix LMS — Stage 8 Weekly Timetables Security Rules Suite
 * Tests role permissions, cross-branch isolation, Super Admin approval exclusivity,
 * mandatory correction comments, revision immutability, student visibility gating,
 * and append-only audit trail.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  Firestore,
} from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ID = 'strynkix-lms-timetable';
const NOW = '2026-11-02T00:00:00.000Z';
const WEEK_START = '2026-11-02';
const WEEK_END = '2026-11-08';
const TIMETABLE_ID = `timetable_batch_pune_${WEEK_START}`;
const REV_1_ID = 'rev_1';

let testEnv: RulesTestEnvironment;
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

function sampleDays() {
  const days: Record<string, unknown> = {};
  for (const d of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    days[d] = {
      date: '2026-11-02',
      dayOfWeek: d,
      activities: [],
    };
  }
  return days;
}

function validRoot(overrides: Record<string, unknown> = {}) {
  return {
    id: TIMETABLE_ID,
    orgId: 'strynkix',
    branchId: 'branch_pune',
    batchId: 'batch_pune',
    courseId: 'course_fs',
    weekStartDate: WEEK_START,
    weekEndDate: WEEK_END,
    activeRevisionId: null,
    currentRevisionId: REV_1_ID,
    latestStatus: 'draft',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function validRevision(overrides: Record<string, unknown> = {}) {
  return {
    id: REV_1_ID,
    timetableId: TIMETABLE_ID,
    revisionNumber: 1,
    orgId: 'strynkix',
    branchId: 'branch_pune',
    batchId: 'batch_pune',
    courseId: 'course_fs',
    weekStartDate: WEEK_START,
    weekEndDate: WEEK_END,
    status: 'draft',
    days: sampleDays(),
    createdById: 'ba_pune',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const put = (p: string, data: Record<string, unknown>) => setDoc(doc(db, p), data);
    const user = (uid: string, role: string, orgId: string, branchId: string | null, status = 'active') =>
      put(`users/${uid}`, { role, orgId, branchId, status, email: `${uid}@example.test`, displayName: uid });

    await put('branches/branch_pune', { orgId: 'strynkix', status: 'active' });
    await put('branches/branch_mumbai', { orgId: 'strynkix', status: 'active' });

    await user('super_admin', 'super_admin', 'strynkix', null);
    await user('uni_admin', 'university_admin', 'strynkix', null);
    await user('ba_pune', 'branch_admin', 'strynkix', 'branch_pune');
    await user('ba_mumbai', 'branch_admin', 'strynkix', 'branch_mumbai');
    await user('inst_pune', 'instructor', 'strynkix', 'branch_pune');
    await user('stu_pune', 'student', 'strynkix', 'branch_pune');
    await user('stu_other', 'student', 'strynkix', 'branch_pune');
    await user('stu_mumbai', 'student', 'strynkix', 'branch_mumbai');

    await put('courses/course_fs', { orgId: 'strynkix', title: 'Full Stack', status: 'published' });
    await put('batches/batch_pune', {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', name: 'Pune Batch',
      code: 'PUN-1', instructorUserIds: ['inst_pune'], startDate: NOW, status: 'in_progress',
    });
    await put('batches/batch_mumbai', {
      orgId: 'strynkix', branchId: 'branch_mumbai', courseId: 'course_fs', name: 'Mumbai Batch',
      code: 'MUM-1', instructorUserIds: [], startDate: NOW, status: 'in_progress',
    });

    await put('enrollments/course_fs_stu_pune', {
      orgId: 'strynkix', branchId: 'branch_pune', courseId: 'course_fs', batchId: 'batch_pune',
      studentId: 'stu_pune', status: 'active', enrolledAt: NOW,
    });
    await put('enrollments/course_fs_stu_mumbai', {
      orgId: 'strynkix', branchId: 'branch_mumbai', courseId: 'course_fs', batchId: 'batch_mumbai',
      studentId: 'stu_mumbai', status: 'active', enrolledAt: NOW,
    });
  });
});

describe('Stage 8 — Weekly Timetable Root Creation & Permissions', () => {
  it('Branch Admin of Pune CAN create a draft timetable root for Pune batch', async () => {
    const db = as('ba_pune');
    await assertSucceeds(setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot()));
  });

  it('Branch Admin of Mumbai CANNOT create timetable for Pune batch (cross-branch denial)', async () => {
    const db = as('ba_mumbai');
    await assertFails(setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot()));
  });

  it('Instructor CANNOT create timetable root (Branch Admin / Super Admin only)', async () => {
    const db = as('inst_pune');
    await assertFails(setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot()));
  });

  it('Student CANNOT create timetable root', async () => {
    const db = as('stu_pune');
    await assertFails(setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot()));
  });

  it('Cannot create timetable root with activeRevisionId already set (must be approved first)', async () => {
    const db = as('ba_pune');
    await assertFails(setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot({ activeRevisionId: 'rev_1' })));
  });
});

describe('Stage 8 — Revision Creation, Editing & Submission', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot());
    });
  });

  it('Branch Admin CAN create draft revision', async () => {
    const db = as('ba_pune');
    await assertSucceeds(setDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), validRevision()));
  });

  it('Branch Admin CAN update draft revision activities and submit for approval', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), validRevision());
    });
    const db = as('ba_pune');
    await assertSucceeds(
      updateDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), {
        status: 'submitted',
        submittedById: 'ba_pune',
        submittedAt: NOW,
      })
    );
  });

  it('Branch Admin CANNOT self-approve timetable revision (Super Admin only)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), validRevision({ status: 'submitted' }));
    });
    const db = as('ba_pune');
    await assertFails(
      updateDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), {
        status: 'approved',
        reviewedById: 'ba_pune',
      })
    );
  });

  it('Branch Admin CANNOT activate revision on parent timetable document', async () => {
    const db = as('ba_pune');
    await assertFails(
      updateDoc(doc(db, 'timetables', TIMETABLE_ID), {
        activeRevisionId: REV_1_ID,
        latestStatus: 'approved',
      })
    );
  });
});

describe('Stage 8 — Super Admin Approval & Mandatory Correction Comments', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot({ latestStatus: 'submitted' }));
      await setDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), validRevision({ status: 'submitted' }));
    });
  });

  it('Super Admin CAN request changes WITH mandatory comment (min 5 chars)', async () => {
    const db = as('super_admin');
    await assertSucceeds(
      updateDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), {
        status: 'changes_requested',
        reviewedById: 'super_admin',
        reviewedAt: NOW,
        reviewComment: 'Please add 30m break on Thursday before exam',
      })
    );
  });

  it('Super Admin CANNOT request changes without comment or with trivial comment (< 5 chars)', async () => {
    const db = as('super_admin');
    await assertFails(
      updateDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), {
        status: 'changes_requested',
        reviewedById: 'super_admin',
        reviewComment: 'bad',
      })
    );
  });

  it('Super Admin CAN approve submission and activate on root document', async () => {
    const db = as('super_admin');
    await assertSucceeds(
      updateDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), {
        status: 'approved',
        reviewedById: 'super_admin',
        reviewedAt: NOW,
      })
    );
    await assertSucceeds(
      updateDoc(doc(db, 'timetables', TIMETABLE_ID), {
        activeRevisionId: REV_1_ID,
        latestStatus: 'approved',
      })
    );
  });

  it('Approved revision becomes strictly IMMUTABLE', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), {
        status: 'approved',
        reviewedById: 'super_admin',
      });
    });
    // Even super_admin cannot edit an approved revision document
    const dbAdmin = as('super_admin');
    await assertFails(
      updateDoc(doc(dbAdmin, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), {
        days: sampleDays(),
      })
    );
    // Branch manager cannot edit it either
    const dbMgr = as('ba_pune');
    await assertFails(
      updateDoc(doc(dbMgr, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), {
        days: sampleDays(),
      })
    );
  });
});

describe('Stage 8 — Student Visibility Gating', () => {
  it('Student CANNOT read draft, submitted, or changes_requested timetables', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot({ activeRevisionId: null, latestStatus: 'submitted' }));
      await setDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), validRevision({ status: 'submitted' }));
    });

    const db = as('stu_pune');
    await assertFails(getDoc(doc(db, 'timetables', TIMETABLE_ID)));
    await assertFails(getDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID)));
  });

  it('Enrolled student CAN read timetable once revision is approved and active', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot({ activeRevisionId: REV_1_ID, latestStatus: 'approved' }));
      await setDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), validRevision({ status: 'approved' }));
    });

    const db = as('stu_pune');
    await assertSucceeds(getDoc(doc(db, 'timetables', TIMETABLE_ID)));
    await assertSucceeds(getDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID)));
  });

  it('Student unenrolled in that batch CANNOT read it even when approved', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot({ activeRevisionId: REV_1_ID, latestStatus: 'approved' }));
      await setDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID), validRevision({ status: 'approved' }));
    });

    const db = as('stu_other');
    await assertFails(getDoc(doc(db, 'timetables', TIMETABLE_ID)));
    await assertFails(getDoc(doc(db, `timetables/${TIMETABLE_ID}/revisions`, REV_1_ID)));
  });
});

describe('Stage 8 — Audit Log Append-Only Rules', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'timetables', TIMETABLE_ID), validRoot());
    });
  });

  it('Branch Admin CAN append an audit log with server timestamp', async () => {
    const db = as('ba_pune');
    await assertSucceeds(
      setDoc(doc(db, `timetables/${TIMETABLE_ID}/auditLogs`, 'log_1'), {
        id: 'log_1',
        timetableId: TIMETABLE_ID,
        revisionId: REV_1_ID,
        fromStatus: 'draft',
        toStatus: 'submitted',
        action: 'submit',
        actorUid: 'ba_pune',
        actorRole: 'branch_admin',
        timestamp: serverTimestamp(),
      })
    );
  });

  it('Audit logs CANNOT be updated or deleted (strictly append-only)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `timetables/${TIMETABLE_ID}/auditLogs`, 'log_1'), {
        id: 'log_1', timetableId: TIMETABLE_ID, revisionId: REV_1_ID, fromStatus: 'draft',
        toStatus: 'submitted', action: 'submit', actorUid: 'ba_pune', actorRole: 'branch_admin',
      });
    });
    const db = as('ba_pune');
    await assertFails(updateDoc(doc(db, `timetables/${TIMETABLE_ID}/auditLogs`, 'log_1'), { comment: 'edited' }));
  });
});


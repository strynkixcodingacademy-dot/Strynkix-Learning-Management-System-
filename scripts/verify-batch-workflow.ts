/**
 * Strynkix LMS — Stage 6 Batch, Enrollment & Instructor Workflow Verification
 *
 * Runs against the local Firestore emulator only, using authenticated rules
 * contexts and the same schemas, IDs and payload shapes as src/lib/batches:
 * 1. Branch admin creates and edits a batch (immutable fields protected)
 * 2. Branch admin enrolls students (cross-branch and duplicate records rejected)
 * 3. Enrolled student opens course and records batch-tagged progress
 * 4. Assigned instructor sees batches, roster, and progress; others do not
 * 5. Withdraw removes access; reactivate restores it
 * 6. Archiving preserves instructors and closes enrollment
 * 7. Cross-organization isolation
 */

import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Batch, Enrollment, Progress } from '../src/types/domain';
import { batchSchema, batchUpdateSchema, enrollmentSchema } from '../src/types/validation';
import { enrollmentIdFor } from '../src/lib/batches/scope';
import { buildRosterProgress } from '../src/lib/batches/roster';

const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
// A dedicated emulator project: this script clears its data, so it must never
// share a project with seeded dev data.
const PROJECT_ID = process.env.VERIFY_PROJECT_ID || 'strynkix-verify-batches';

const ORG = 'strynkix';
const COURSE = 'course_stage6_fullstack';
const BATCH = 'batch_stage6_pune';

function assertLocalEmulator() {
  const [hostName] = FIRESTORE_HOST.split(':');
  if (!['127.0.0.1', 'localhost'].includes(hostName)) {
    throw new Error(`Refusing to run: Firestore emulator host must be local (got ${FIRESTORE_HOST}).`);
  }
}

async function expectAllowed(label: string, op: () => Promise<unknown>) {
  try {
    await op();
  } catch (err) {
    throw new Error(`Expected ALLOWED: ${label}\n  ${(err as Error).message}`);
  }
  console.log(`  ✓ ${label}`);
}

async function expectDenied(label: string, op: () => Promise<unknown>) {
  try {
    await op();
  } catch (err) {
    if ((err as { code?: string }).code === 'permission-denied') {
      console.log(`  ✓ ${label}`);
      return;
    }
    throw err;
  }
  throw new Error(`SECURITY VIOLATION — expected DENIED: ${label}`);
}

async function seed(testEnv: RulesTestEnvironment) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const put = (p: string, data: Record<string, unknown>) => setDoc(doc(db, p), data);
    const user = (uid: string, role: string, orgId: string, branchId: string | null, displayName: string) =>
      put(`users/${uid}`, { id: uid, role, orgId, branchId, status: 'active', email: `${uid}@example.test`, displayName });

    await put(`organizations/${ORG}`, { name: 'Strynkix', status: 'active' });
    await put('organizations/rival_org', { name: 'Rival', status: 'active' });
    await put('branches/branch_pune', { orgId: ORG, name: 'Pune', code: 'PUN', status: 'active' });
    await put('branches/branch_mumbai', { orgId: ORG, name: 'Mumbai', code: 'MUM', status: 'active' });

    await user('wf_ba_pune', 'branch_admin', ORG, 'branch_pune', 'Pune Manager');
    await user('wf_uni_rival', 'university_admin', 'rival_org', null, 'Rival Admin');
    await user('wf_inst_priya', 'instructor', ORG, 'branch_pune', 'Priya');
    await user('wf_inst_kiran', 'instructor', ORG, 'branch_pune', 'Kiran');
    await user('wf_inst_other', 'instructor', ORG, 'branch_pune', 'Unassigned Instructor');
    await user('wf_stu_aarav', 'student', ORG, 'branch_pune', 'Aarav Patel');
    await user('wf_stu_diya', 'student', ORG, 'branch_pune', 'Diya Sharma');
    await user('wf_stu_mumbai', 'student', ORG, 'branch_mumbai', 'Mumbai Student');

    await put(`courses/${COURSE}`, { id: COURSE, orgId: ORG, title: 'Full Stack (Stage 6)', status: 'published' });
    await put('modules/wf_mod_1', { id: 'wf_mod_1', orgId: ORG, courseId: COURSE, title: 'M1', orderIndex: 0, status: 'published' });
    for (const [i, lessonId] of ['wf_les_1', 'wf_les_2'].entries()) {
      await put(`lessons/${lessonId}`, {
        id: lessonId, orgId: ORG, courseId: COURSE, moduleId: 'wf_mod_1', title: `Lesson ${i + 1}`,
        orderIndex: i, status: 'published', blocks: [],
      });
    }
  });
}

async function main() {
  console.log('================================================================');
  console.log('  Stage 6: Batch, Enrollment & Instructor Workflow Verification');
  console.log('================================================================\n');
  assertLocalEmulator();

  const [host, port] = FIRESTORE_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host,
      port: parseInt(port, 10),
    },
  });

  try {
    await testEnv.clearFirestore();
    await seed(testEnv);
    const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();
    const admin = as('wf_ba_pune');
    const now = new Date().toISOString();

    // -------------------------------------------------------------------------
    console.log('[Step 1] Branch admin creates and edits a batch...');
    const parsedBatch = batchSchema.parse({
      orgId: ORG,
      branchId: 'branch_pune',
      courseId: COURSE,
      name: 'Pune Full Stack Evening',
      code: 'pun-fs-eve',
      instructorUserIds: ['wf_inst_priya'],
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2027-03-31T00:00:00.000Z',
      maxStudents: 25,
    });
    const batchRecord = { id: BATCH, ...parsedBatch, createdById: 'wf_ba_pune', createdAt: now, updatedAt: now };
    await expectAllowed('batch created with validated course, branch and instructor', () =>
      setDoc(doc(admin, 'batches', BATCH), batchRecord)
    );
    const edit = batchUpdateSchema.parse({ name: 'Pune Full Stack Evening (Mon–Thu)', instructorUserIds: ['wf_inst_priya', 'wf_inst_kiran'] });
    await expectAllowed('batch renamed and second instructor assigned', () =>
      updateDoc(doc(admin, 'batches', BATCH), { ...edit, updatedAt: now })
    );
    await expectDenied('batch courseId cannot be changed', () =>
      updateDoc(doc(admin, 'batches', BATCH), { courseId: 'some_other_course' })
    );
    console.log('');

    // -------------------------------------------------------------------------
    console.log('[Step 2] Branch admin enrolls students...');
    const enrollmentFor = (studentId: string, displayName: string) => ({
      id: enrollmentIdFor(COURSE, studentId),
      ...enrollmentSchema.parse({
        orgId: ORG,
        branchId: 'branch_pune',
        courseId: COURSE,
        batchId: BATCH,
        studentId,
        status: 'active',
        enrolledAt: now,
        enrolledById: 'wf_ba_pune',
        studentDisplayName: displayName,
        studentEmail: `${studentId}@example.test`,
      }),
      createdAt: now,
      updatedAt: now,
    });
    await expectAllowed('Aarav enrolled', () =>
      setDoc(doc(admin, 'enrollments', enrollmentIdFor(COURSE, 'wf_stu_aarav')), enrollmentFor('wf_stu_aarav', 'Aarav Patel'))
    );
    await expectDenied('a second enrollment record for the same student and course is rejected', () =>
      setDoc(doc(admin, 'enrollments', 'duplicate_aarav'), enrollmentFor('wf_stu_aarav', 'Aarav Patel'))
    );
    await expectDenied('student from another branch cannot be enrolled', () =>
      setDoc(
        doc(admin, 'enrollments', enrollmentIdFor(COURSE, 'wf_stu_mumbai')),
        enrollmentFor('wf_stu_mumbai', 'Mumbai Student')
      )
    );
    await expectDenied('student cannot enroll themselves', () =>
      setDoc(doc(as('wf_stu_diya'), 'enrollments', enrollmentIdFor(COURSE, 'wf_stu_diya')), enrollmentFor('wf_stu_diya', 'Diya Sharma'))
    );
    console.log('');

    // -------------------------------------------------------------------------
    console.log('[Step 3] Enrolled student learns; unenrolled student is blocked...');
    const aarav = as('wf_stu_aarav');
    await expectAllowed('Aarav lists own enrollments', () =>
      getDocs(query(collection(aarav, 'enrollments'), where('orgId', '==', ORG), where('studentId', '==', 'wf_stu_aarav')))
    );
    await expectAllowed('Aarav opens course and batch', async () => {
      await getDoc(doc(aarav, 'courses', COURSE));
      await getDoc(doc(aarav, 'batches', BATCH));
    });
    await expectAllowed('Aarav records batch-tagged progress (lesson 1 completed)', () =>
      setDoc(doc(aarav, 'progress', `wf_stu_aarav_${COURSE}_wf_les_1`), {
        id: `wf_stu_aarav_${COURSE}_wf_les_1`,
        orgId: ORG, courseId: COURSE, moduleId: 'wf_mod_1', lessonId: 'wf_les_1',
        studentId: 'wf_stu_aarav', batchId: BATCH, status: 'completed', timeSpentSeconds: 120,
        lastAccessedAt: now, completedAt: now, createdAt: now, updatedAt: now,
      })
    );
    await expectDenied('unenrolled Diya cannot open the course', () => getDoc(doc(as('wf_stu_diya'), 'courses', COURSE)));
    console.log('');

    // -------------------------------------------------------------------------
    console.log('[Step 4] Instructor workflow...');
    await expectAllowed('Diya enrolled (no activity yet)', () =>
      setDoc(doc(admin, 'enrollments', enrollmentIdFor(COURSE, 'wf_stu_diya')), enrollmentFor('wf_stu_diya', 'Diya Sharma'))
    );
    const priya = as('wf_inst_priya');
    const myBatches = await getDocs(
      query(collection(priya, 'batches'), where('orgId', '==', ORG), where('instructorUserIds', 'array-contains', 'wf_inst_priya'))
    );
    if (myBatches.size !== 1) throw new Error(`Expected 1 assigned batch, got ${myBatches.size}`);
    console.log('  ✓ Priya sees exactly her assigned batch');

    const batch = { id: BATCH, ...myBatches.docs[0].data() } as Batch;
    const roster = (await getDocs(query(
      collection(priya, 'enrollments'),
      where('orgId', '==', ORG), where('branchId', '==', batch.branchId), where('batchId', '==', BATCH)
    ))).docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));
    const progress = (await getDocs(query(
      collection(priya, 'progress'),
      where('orgId', '==', ORG), where('batchId', '==', BATCH), where('courseId', '==', COURSE)
    ))).docs.map((d) => ({ id: d.id, ...d.data() } as Progress));
    const rows = buildRosterProgress(roster, progress, ['wf_les_1', 'wf_les_2']);
    const aaravRow = rows.find((r) => r.enrollment.studentId === 'wf_stu_aarav');
    const diyaRow = rows.find((r) => r.enrollment.studentId === 'wf_stu_diya');
    if (aaravRow?.state !== 'tracked' || aaravRow.percentage !== 50) {
      throw new Error(`Aarav roster row incorrect: ${JSON.stringify(aaravRow)}`);
    }
    if (diyaRow?.state !== 'no_activity') throw new Error(`Diya roster row incorrect: ${JSON.stringify(diyaRow)}`);
    console.log('  ✓ Roster shows Aarav at 50% and Diya as "no activity yet" (not 0%)');

    await expectDenied('unassigned instructor cannot read the roster', () =>
      getDocs(query(
        collection(as('wf_inst_other'), 'enrollments'),
        where('orgId', '==', ORG), where('branchId', '==', 'branch_pune'), where('batchId', '==', BATCH)
      ))
    );
    await expectDenied('unassigned instructor cannot read batch progress', () =>
      getDocs(query(
        collection(as('wf_inst_other'), 'progress'),
        where('orgId', '==', ORG), where('batchId', '==', BATCH), where('courseId', '==', COURSE)
      ))
    );
    await expectDenied('instructor cannot change enrollment status', () =>
      updateDoc(doc(priya, 'enrollments', enrollmentIdFor(COURSE, 'wf_stu_aarav')), { status: 'completed' })
    );
    console.log('');

    // -------------------------------------------------------------------------
    console.log('[Step 5] Withdraw and reactivate...');
    const aaravEnrollment = doc(admin, 'enrollments', enrollmentIdFor(COURSE, 'wf_stu_aarav'));
    await expectAllowed('Aarav withdrawn', () => updateDoc(aaravEnrollment, { status: 'dropped', updatedAt: now }));
    await expectDenied('withdrawn Aarav loses course access', () => getDoc(doc(aarav, 'lessons', 'wf_les_2')));
    await expectDenied('withdrawn Aarav cannot record progress', () =>
      setDoc(doc(aarav, 'progress', `wf_stu_aarav_${COURSE}_wf_les_2`), {
        orgId: ORG, courseId: COURSE, moduleId: 'wf_mod_1', lessonId: 'wf_les_2',
        studentId: 'wf_stu_aarav', batchId: BATCH, status: 'in_progress', timeSpentSeconds: 30,
      })
    );
    await expectAllowed('Aarav reactivated', () => updateDoc(aaravEnrollment, { status: 'active', updatedAt: now }));
    await expectAllowed('reactivated Aarav regains course access', () => getDoc(doc(aarav, 'lessons', 'wf_les_2')));
    console.log('');

    // -------------------------------------------------------------------------
    console.log('[Step 6] Archive batch...');
    const archive = batchUpdateSchema.parse({ status: 'archived' });
    await expectAllowed('batch archived with a status-only update', () =>
      updateDoc(doc(admin, 'batches', BATCH), { ...archive, updatedAt: now })
    );
    const archived = (await getDoc(doc(admin, 'batches', BATCH))).data() as Batch;
    if (archived.instructorUserIds.length !== 2) {
      throw new Error(`Archiving changed instructors: ${JSON.stringify(archived.instructorUserIds)}`);
    }
    console.log('  ✓ Instructor assignments preserved after archiving');
    const diyaEnrollment = doc(admin, 'enrollments', enrollmentIdFor(COURSE, 'wf_stu_diya'));
    await expectAllowed('Diya withdrawn from the archived batch', () => updateDoc(diyaEnrollment, { status: 'dropped' }));
    await expectDenied('dropped enrollment cannot be reactivated into an archived batch', () =>
      updateDoc(diyaEnrollment, { status: 'active' })
    );
    console.log('');

    // -------------------------------------------------------------------------
    console.log('[Step 7] Cross-organization isolation...');
    await expectDenied('rival-org admin cannot read the batch', () => getDoc(doc(as('wf_uni_rival'), 'batches', BATCH)));
    await expectDenied('rival-org admin cannot read enrollments', () =>
      getDoc(doc(as('wf_uni_rival'), 'enrollments', enrollmentIdFor(COURSE, 'wf_stu_aarav')))
    );
    console.log('');

    console.log('================================================================');
    console.log('  All Stage 6 Batch & Enrollment Workflow Checks Passed');
    console.log('================================================================\n');
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((err) => {
  console.error('\n❌ Batch workflow verification failed:', err);
  process.exit(1);
});

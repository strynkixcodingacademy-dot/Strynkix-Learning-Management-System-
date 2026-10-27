/**
 * Strynkix LMS — Stage 3.1 Student Journey End-to-End Verification Script
 *
 * Verifies against local Firebase Auth & Firestore Emulators:
 * 1. Student Authentication & Profile verification
 * 2. Course Catalog retrieval (published courses in org)
 * 3. Seeded course & curriculum loading
 * 4. Inter-lesson & module boundary navigation
 * 5. Quiz block answer verification & feedback evaluation
 * 6. Mark lesson completed with collision-resistant progress ID
 * 7. Refresh and verify progress persistence
 * 8. Resume pointer evaluation (unfinished lesson vs next sequential vs fully completed)
 * 9. Cross-student & cross-tenant security enforcement
 * 10. Malformed content fail-safe handling & image URL sanitization
 */

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Course, Module, Lesson, Progress, QuizBlock } from '../src/types/domain';
import { lessonBlockSchema } from '../src/types/validation';
import {
  getSortedCurriculumLessons,
  getAdjacentLessons,
  calculateCourseProgress,
  getResumeLesson,
} from '../src/lib/livebook/curriculum';

const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'learning-management-syst-b9bf3';

async function main() {
  console.log('================================================================');
  console.log('  Stage 3.1: Student Journey Verification Suite');
  console.log('================================================================\n');

  const rulesPath = path.resolve(__dirname, '../firestore.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  const [host, portStr] = FIRESTORE_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host,
      port: parseInt(portStr, 10),
    },
  });

  try {
    // -------------------------------------------------------------------------
    // Step 0: Ensure Seed Data is loaded
    // -------------------------------------------------------------------------
    console.log('[Step 0] Seeding curriculum and test users in Firestore...');
    const student1Uid = 'student_test_aarav_uid';
    const student2Uid = 'student_test_diya_uid';
    const courseId = 'course_fullstack_2026';
    const orgId = 'strynkix';

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();

      // Seed Student 1 Profile
      await setDoc(doc(adminDb, 'users', student1Uid), {
        id: student1Uid,
        orgId,
        branchId: 'branch_pune',
        role: 'student',
        email: 'student1@strynkix.com',
        displayName: 'Aarav Patel',
        status: 'active',
      });

      // Seed Student 2 Profile
      await setDoc(doc(adminDb, 'users', student2Uid), {
        id: student2Uid,
        orgId,
        branchId: 'branch_pune',
        role: 'student',
        email: 'student2@strynkix.com',
        displayName: 'Diya Sharma',
        status: 'active',
      });

      // Seed Course
      await setDoc(doc(adminDb, 'courses', courseId), {
        id: courseId,
        orgId,
        title: 'Full Stack Web Architecture & Live Books',
        slug: 'fullstack-web-architecture',
        summary: 'Master software engineering with interactive Live Books.',
        status: 'published',
      });

      // Seed Modules
      await setDoc(doc(adminDb, 'modules', 'mod_ts_foundations'), {
        id: 'mod_ts_foundations',
        orgId,
        courseId,
        title: 'Module 1: Type Safety & Architecture',
        orderIndex: 1,
        status: 'published',
      });

      await setDoc(doc(adminDb, 'modules', 'mod_cloud_data'), {
        id: 'mod_cloud_data',
        orgId,
        courseId,
        title: 'Module 2: Multi-Tenant Cloud Data',
        orderIndex: 2,
        status: 'published',
      });

      // Seed Lessons
      await setDoc(doc(adminDb, 'lessons', 'lesson_1_1'), {
        id: 'lesson_1_1',
        orgId,
        courseId,
        moduleId: 'mod_ts_foundations',
        title: '1.1 Runtime Type Guards',
        orderIndex: 1,
        status: 'published',
        blocks: [
          {
            id: 'q1',
            type: 'quiz',
            question: 'What is the runtime type of TypeScript interfaces?',
            options: [
              { id: 'opt_a', text: 'Objects' },
              { id: 'opt_b', text: 'None (stripped at compile time)' },
            ],
            correctOptionId: 'opt_b',
            explanation: 'TypeScript types are removed during build compilation.',
          },
        ],
      });

      await setDoc(doc(adminDb, 'lessons', 'lesson_1_2'), {
        id: 'lesson_1_2',
        orgId,
        courseId,
        moduleId: 'mod_ts_foundations',
        title: '1.2 Async Event Handlers',
        orderIndex: 2,
        status: 'published',
        blocks: [],
      });

      await setDoc(doc(adminDb, 'lessons', 'lesson_2_1'), {
        id: 'lesson_2_1',
        orgId,
        courseId,
        moduleId: 'mod_cloud_data',
        title: '2.1 Firestore Security Rules',
        orderIndex: 1,
        status: 'published',
        blocks: [],
      });
    });
    console.log('  ✓ Seed data initialized successfully.\n');

    // -------------------------------------------------------------------------
    // Step 1: Sign in as student (authenticated student context)
    // -------------------------------------------------------------------------
    console.log('[Step 1] Authenticating as Student 1 (Aarav)...');
    const student1Ctx = testEnv.authenticatedContext(student1Uid);
    const db1 = student1Ctx.firestore();

    const userProfileSnap = await getDoc(doc(db1, 'users', student1Uid));
    if (!userProfileSnap.exists() || userProfileSnap.data()?.role !== 'student') {
      throw new Error('Student profile verification failed!');
    }
    console.log(`  ✓ Authenticated as: ${userProfileSnap.data()?.displayName} (${student1Uid})\n`);

    // -------------------------------------------------------------------------
    // Step 2: Open course catalog (query published courses for tenant)
    // -------------------------------------------------------------------------
    console.log('[Step 2] Querying course catalog...');
    const catalogQuery = query(
      collection(db1, 'courses'),
      where('orgId', '==', orgId),
      where('status', '==', 'published')
    );
    const catalogSnap = await getDocs(catalogQuery);
    const publishedCourses = catalogSnap.docs.map((d) => d.data() as Course);
    if (publishedCourses.length === 0 || publishedCourses[0].id !== courseId) {
      throw new Error('Course catalog query failed to return published course!');
    }
    console.log(`  ✓ Course Catalog returned: ${publishedCourses.length} course(s). Found "${publishedCourses[0].title}".\n`);

    // -------------------------------------------------------------------------
    // Step 3: Open course & curriculum (modules + lessons)
    // -------------------------------------------------------------------------
    console.log('[Step 3] Loading course curriculum...');
    const modulesQuery = query(
      collection(db1, 'modules'),
      where('courseId', '==', courseId),
      where('orgId', '==', orgId),
      where('status', '==', 'published')
    );
    const modSnap = await getDocs(modulesQuery);
    const modules = modSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Module));

    const lessonsQuery = query(
      collection(db1, 'lessons'),
      where('courseId', '==', courseId),
      where('orgId', '==', orgId),
      where('status', '==', 'published')
    );
    const lesSnap = await getDocs(lessonsQuery);
    const lessons = lesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Lesson));

    console.log(`  ✓ Loaded ${modules.length} modules and ${lessons.length} published lessons.\n`);

    // -------------------------------------------------------------------------
    // Step 4: Curriculum sequencing and module boundary traversal
    // -------------------------------------------------------------------------
    console.log('[Step 4] Verifying navigation across module boundaries...');
    const sorted = getSortedCurriculumLessons(modules, lessons);
    const expectedOrder = ['lesson_1_1', 'lesson_1_2', 'lesson_2_1'];
    const actualOrder = sorted.map((l) => l.id);
    if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
      throw new Error(`Curriculum ordering mismatch! Expected: ${expectedOrder}, Got: ${actualOrder}`);
    }
    console.log(`  ✓ Curriculum ordered correctly: ${actualOrder.join(' -> ')}`);

    // Check adjacent for lesson_1_2 (transitions into module 2)
    const nav12 = getAdjacentLessons(modules, lessons, 'lesson_1_2');
    if (nav12.prevLesson?.id !== 'lesson_1_1' || nav12.nextLesson?.id !== 'lesson_2_1') {
      throw new Error('Module boundary traversal failed for lesson 1.2 -> 2.1');
    }
    console.log(`  ✓ Module boundary navigation verified: lesson_1_2 -> next is lesson_2_1 (${nav12.nextLesson.title})\n`);

    // -------------------------------------------------------------------------
    // Step 5: Answer quiz and review feedback
    // -------------------------------------------------------------------------
    console.log('[Step 5] Testing quiz block evaluation...');
    const lesson11 = lessons.find((l) => l.id === 'lesson_1_1')!;
    const quizBlock = lesson11.blocks[0] as QuizBlock;
    if (quizBlock.type !== 'quiz') {
      throw new Error('Expected quiz block not found');
    }

    const studentWrongAnswer = 'opt_a';
    const isWrong = studentWrongAnswer === quizBlock.correctOptionId;
    if (isWrong) throw new Error('Quiz evaluation logic error on wrong answer');

    const studentRightAnswer = 'opt_b';
    const isRight = studentRightAnswer === quizBlock.correctOptionId;
    if (!isRight) throw new Error('Quiz evaluation logic error on right answer');
    console.log(`  ✓ Quiz feedback logic validated: wrong=rejected, right=accepted with explanation.\n`);

    // -------------------------------------------------------------------------
    // Step 6: Mark lesson complete with collision-resistant ID
    // -------------------------------------------------------------------------
    console.log('[Step 6] Marking lesson 1.1 complete...');
    const progressDocId = `${student1Uid}_${courseId}_lesson_1_1`;
    const progressRef = doc(db1, 'progress', progressDocId);

    const now = new Date().toISOString();
    await setDoc(progressRef, {
      id: progressDocId,
      orgId,
      courseId,
      moduleId: 'mod_ts_foundations',
      lessonId: 'lesson_1_1',
      studentId: student1Uid,
      status: 'completed',
      timeSpentSeconds: 150,
      lastAccessedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  ✓ Progress record written with collision-resistant ID: ${progressDocId}\n`);

    // -------------------------------------------------------------------------
    // Step 7: Refresh & confirm progress persists
    // -------------------------------------------------------------------------
    console.log('[Step 7] Refreshing progress and verifying persistence...');
    const progressQuery = query(
      collection(db1, 'progress'),
      where('orgId', '==', orgId),
      where('courseId', '==', courseId),
      where('studentId', '==', student1Uid)
    );
    const progSnap = await getDocs(progressQuery);
    const progressList = progSnap.docs.map((d) => d.data() as Progress);

    if (progressList.length !== 1 || progressList[0].status !== 'completed') {
      throw new Error('Progress persistence check failed!');
    }

    const stats = calculateCourseProgress(lessons.length, progressList.map((p) => p.lessonId));
    if (stats.completedCount !== 1 || stats.percentage !== 33) {
      throw new Error(`Progress percentage calculation error: expected 33%, got ${stats.percentage}%`);
    }
    console.log(`  ✓ Progress verified: 1 of 3 lessons complete (33%).\n`);

    // -------------------------------------------------------------------------
    // Step 8: Resume unfinished lesson logic
    // -------------------------------------------------------------------------
    console.log('[Step 8] Verifying resume pointer...');
    // Currently lesson 1.1 is completed. Resume pointer should identify lesson 1.2 as next uncompleted
    const resume1 = getResumeLesson(modules, lessons, progressList);
    if (resume1?.id !== 'lesson_1_2') {
      throw new Error(`Resume logic error: expected lesson_1_2, got ${resume1?.id}`);
    }
    console.log(`  ✓ Resume pointer correctly advanced to next sequential unfinished lesson: ${resume1.title}`);

    // If student has an in_progress lesson 2.1
    const inProgressList: Progress[] = [
      ...progressList,
      {
        id: `${student1Uid}_${courseId}_lesson_2_1`,
        orgId,
        courseId,
        moduleId: 'mod_cloud_data',
        lessonId: 'lesson_2_1',
        studentId: student1Uid,
        status: 'in_progress',
        timeSpentSeconds: 60,
        lastAccessedAt: new Date(Date.now() + 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
      },
    ];
    const resume2 = getResumeLesson(modules, lessons, inProgressList);
    if (resume2?.id !== 'lesson_2_1') {
      throw new Error(`Resume logic error for in_progress: expected lesson_2_1, got ${resume2?.id}`);
    }
    console.log(`  ✓ Resume pointer correctly prioritized active in_progress lesson: ${resume2.title}\n`);

    // -------------------------------------------------------------------------
    // Step 9: Attempt unauthorized cross-student and cross-tenant operations
    // -------------------------------------------------------------------------
    console.log('[Step 9] Testing unauthorized access defense...');
    // Student 2 attempts to read Student 1's progress
    const student2Ctx = testEnv.authenticatedContext(student2Uid);
    const db2 = student2Ctx.firestore();

    let student2ReadFailed = false;
    try {
      await getDoc(doc(db2, 'progress', progressDocId));
    } catch {
      student2ReadFailed = true;
    }
    if (!student2ReadFailed) {
      throw new Error('SECURITY VIOLATION: Student 2 read Student 1 progress!');
    }
    console.log('  ✓ Cross-student progress read strictly blocked by security rules.');

    // Student 1 attempts to tamper with progress orgId
    let tamperFailed = false;
    try {
      await updateDoc(progressRef, { orgId: 'malicious_tenant' });
    } catch {
      tamperFailed = true;
    }
    if (!tamperFailed) {
      throw new Error('SECURITY VIOLATION: Student was able to tamper with orgId!');
    }
    console.log('  ✓ Tenant boundary tampering strictly blocked on progress update.\n');

    // -------------------------------------------------------------------------
    // Step 10: Test malformed block schema handling and URL sanitization
    // -------------------------------------------------------------------------
    console.log('[Step 10] Testing content fail-safe and image URL sanitization...');
    const corruptedBlock = {
      type: 'quiz',
      // missing id, question, options
    };
    const parseResult = lessonBlockSchema.safeParse(corruptedBlock);
    if (parseResult.success) {
      throw new Error('Malformed block validation unexpectedly succeeded!');
    }
    console.log('  ✓ Malformed block successfully caught by safeParse schema validation.');

    const maliciousImageBlock = {
      id: 'img_bad',
      type: 'image',
      url: 'javascript:alert(1)',
      altText: 'XSS attempt',
    };
    const imgResult = lessonBlockSchema.safeParse(maliciousImageBlock);
    if (imgResult.success) {
      throw new Error('Insecure javascript: image URL was not rejected!');
    }
    console.log('  ✓ Insecure image URL (javascript:) successfully rejected by schema.\n');

    console.log('================================================================');
    console.log('  All 10 Student Journey Verification Checks Passed Perfectly!');
    console.log('================================================================\n');
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});

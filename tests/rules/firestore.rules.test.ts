/**
 * Strynkix LMS — Automated Firestore Security Rules Test Suite
 * Validates tenant isolation, branch manager boundaries, role escalation guards,
 * and student sandboxing against local Firestore emulator.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ID = 'strynkix-lms';
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rulesPath = path.resolve(__dirname, '../../firestore.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

describe('1. Default Deny & Unauthenticated Access', () => {
  it('denies unauthenticated read on organizations', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const orgDoc = doc(unauthDb, 'organizations/strynkix');
    await assertFails(getDoc(orgDoc));
  });

  it('denies unauthenticated write on user profiles', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const userDoc = doc(unauthDb, 'users/intruder');
    await assertFails(
      setDoc(userDoc, {
        role: 'super_admin',
        orgId: 'strynkix',
        email: 'intruder@test.com',
      })
    );
  });
});

describe('2. Anti-Tamper & Role Escalation Defense', () => {
  it('strictly forbids a client from self-assigning super_admin role during signup', async () => {
    const studentAuth = testEnv.authenticatedContext('student_malicious');
    const db = studentAuth.firestore();

    const profileDoc = doc(db, 'users/student_malicious');
    await assertFails(
      setDoc(profileDoc, {
        role: 'super_admin',
        orgId: 'strynkix',
        email: 'malicious@test.com',
        displayName: 'Attacker',
      })
    );
  });

  it('strictly forbids a client from self-assigning branch_admin role during signup', async () => {
    const studentAuth = testEnv.authenticatedContext('student_malicious_branch');
    const db = studentAuth.firestore();

    const profileDoc = doc(db, 'users/student_malicious_branch');
    await assertFails(
      setDoc(profileDoc, {
        role: 'branch_admin',
        orgId: 'strynkix',
        email: 'branch_attacker@test.com',
        displayName: 'Branch Attacker',
      })
    );
  });

  it('allows public self-signup ONLY as student with valid bounds', async () => {
    const studentAuth = testEnv.authenticatedContext('student_valid');
    const db = studentAuth.firestore();

    const profileDoc = doc(db, 'users/student_valid');
    await assertSucceeds(
      setDoc(profileDoc, {
        role: 'student',
        orgId: 'strynkix',
        email: 'student@strynkix.com',
        displayName: 'Valid Student',
      })
    );
  });

  it('prevents student from updating their role to super_admin on their existing profile', async () => {
    // Setup initial student profile via admin context
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/student_1'), {
        role: 'student',
        orgId: 'strynkix',
        email: 'student1@strynkix.com',
        displayName: 'Student One',
      });
    });

    const studentAuth = testEnv.authenticatedContext('student_1');
    const db = studentAuth.firestore();

    const profileDoc = doc(db, 'users/student_1');
    await assertFails(
      updateDoc(profileDoc, {
        role: 'super_admin',
      })
    );
  });

  it('prevents student from altering their orgId on their profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/student_1'), {
        role: 'student',
        orgId: 'strynkix',
        email: 'student1@strynkix.com',
        displayName: 'Student One',
      });
    });

    const studentAuth = testEnv.authenticatedContext('student_1');
    const db = studentAuth.firestore();

    const profileDoc = doc(db, 'users/student_1');
    await assertFails(
      updateDoc(profileDoc, {
        orgId: 'different_tenant',
      })
    );
  });

  it('strictly prevents student from altering account status on their profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/student_1'), {
        role: 'student',
        orgId: 'strynkix',
        status: 'active',
        email: 'student1@strynkix.com',
        displayName: 'Student One',
      });
    });

    const studentAuth = testEnv.authenticatedContext('student_1');
    const db = studentAuth.firestore();

    const profileDoc = doc(db, 'users/student_1');
    await assertFails(
      updateDoc(profileDoc, {
        status: 'suspended',
      })
    );
  });

  it('strictly prevents a suspended user from updating their own profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/suspended_user'), {
        role: 'student',
        orgId: 'strynkix',
        status: 'suspended',
        email: 'suspended@strynkix.com',
        displayName: 'Suspended User',
      });
    });

    const suspendedAuth = testEnv.authenticatedContext('suspended_user');
    const db = suspendedAuth.firestore();

    const profileDoc = doc(db, 'users/suspended_user');
    // Attempting to unsuspend itself or even change displayName MUST FAIL
    await assertFails(
      updateDoc(profileDoc, {
        status: 'active',
        displayName: 'Attempted Self-Unsuspend',
      })
    );
    await assertFails(
      updateDoc(profileDoc, {
        displayName: 'Just changing name',
      })
    );
  });
});

describe('3. Multi-Tenant Organization & Branch Isolation', () => {
  beforeEach(async () => {
    // Seed test profiles and organizations
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();

      // Orgs
      await setDoc(doc(adminDb, 'organizations/strynkix'), { name: 'Strynkix Academy' });
      await setDoc(doc(adminDb, 'organizations/other_academy'), { name: 'Other Academy' });

      // Super Admin
      await setDoc(doc(adminDb, 'users/super_admin_user'), {
        role: 'super_admin',
        orgId: 'strynkix',
        email: 'admin@strynkix.com',
        displayName: 'Super Admin',
      });

      // Branch Admin for Pune
      await setDoc(doc(adminDb, 'users/branch_admin_pune'), {
        role: 'branch_admin',
        orgId: 'strynkix',
        branchId: 'branch_pune',
        email: 'pune@strynkix.com',
        displayName: 'Pune Branch Admin',
      });

      // Student in Strynkix
      await setDoc(doc(adminDb, 'users/student_strynkix'), {
        role: 'student',
        orgId: 'strynkix',
        branchId: 'branch_pune',
        email: 'student@strynkix.com',
        displayName: 'Strynkix Student',
      });

      // Course in Other Academy
      await setDoc(doc(adminDb, 'courses/other_course'), {
        orgId: 'other_academy',
        title: 'Secret Course',
        status: 'published',
      });
    });
  });

  it('super_admin can read all organizations', async () => {
    const superAdmin = testEnv.authenticatedContext('super_admin_user').firestore();
    await assertSucceeds(getDoc(doc(superAdmin, 'organizations/strynkix')));
    await assertSucceeds(getDoc(doc(superAdmin, 'organizations/other_academy')));
  });

  it('student cannot read courses belonging to another organization', async () => {
    const student = testEnv.authenticatedContext('student_strynkix').firestore();
    await assertFails(getDoc(doc(student, 'courses/other_course')));
  });

  it('branch_admin cannot create a batch for a branch they do not manage', async () => {
    const branchAdmin = testEnv.authenticatedContext('branch_admin_pune').firestore();
    await assertFails(
      setDoc(doc(branchAdmin, 'batches/batch_mumbai_1'), {
        orgId: 'strynkix',
        branchId: 'branch_mumbai', // mismatch with branch_pune
        name: 'Mumbai Batch',
      })
    );
  });

  it('branch_admin can create a batch for their assigned branch', async () => {
    const branchAdmin = testEnv.authenticatedContext('branch_admin_pune').firestore();
    await assertSucceeds(
      setDoc(doc(branchAdmin, 'batches/batch_pune_1'), {
        orgId: 'strynkix',
        branchId: 'branch_pune',
        name: 'Pune Batch Alpha',
      })
    );
  });
});

describe('4. Student Sandboxing & Submission Integrity', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();

      await setDoc(doc(adminDb, 'users/student_alice'), {
        role: 'student',
        orgId: 'strynkix',
        email: 'alice@strynkix.com',
        displayName: 'Alice',
      });

      await setDoc(doc(adminDb, 'users/student_bob'), {
        role: 'student',
        orgId: 'strynkix',
        email: 'bob@strynkix.com',
        displayName: 'Bob',
      });

      await setDoc(doc(adminDb, 'users/instructor_dave'), {
        role: 'instructor',
        orgId: 'strynkix',
        email: 'dave@strynkix.com',
        displayName: 'Instructor Dave',
      });

      await setDoc(doc(adminDb, 'progress/alice_lesson1'), {
        orgId: 'strynkix',
        studentId: 'student_alice',
        courseId: 'course_1',
        moduleId: 'module_1',
        lessonId: 'lesson_1',
        timeSpentSeconds: 120,
        status: 'in_progress',
      });

      // Seed a draft lesson
      await setDoc(doc(adminDb, 'lessons/draft_lesson'), {
        orgId: 'strynkix',
        courseId: 'course_1',
        moduleId: 'module_1',
        title: 'Unpublished Draft Lesson',
        status: 'draft',
      });
    });
  });

  it('alice can update her own progress record', async () => {
    const alice = testEnv.authenticatedContext('student_alice').firestore();
    await assertSucceeds(
      updateDoc(doc(alice, 'progress/alice_lesson1'), {
        timeSpentSeconds: 240,
        status: 'completed',
      })
    );
  });

  it('student cannot mutate courseId on their existing progress record', async () => {
    const alice = testEnv.authenticatedContext('student_alice').firestore();
    await assertFails(
      updateDoc(doc(alice, 'progress/alice_lesson1'), {
        courseId: 'tampered_course',
        timeSpentSeconds: 300,
      })
    );
  });

  it('student cannot read unpublished draft lesson', async () => {
    const alice = testEnv.authenticatedContext('student_alice').firestore();
    await assertFails(getDoc(doc(alice, 'lessons/draft_lesson')));
  });

  it('bob cannot read or update alice progress record', async () => {
    const bob = testEnv.authenticatedContext('student_bob').firestore();
    await assertFails(getDoc(doc(bob, 'progress/alice_lesson1')));
    await assertFails(
      updateDoc(doc(bob, 'progress/alice_lesson1'), {
        timeSpentSeconds: 500,
      })
    );
  });

  it('student can create an assignment submission without self-assigned score', async () => {
    const alice = testEnv.authenticatedContext('student_alice').firestore();
    await assertSucceeds(
      setDoc(doc(alice, 'submissions/sub_alice_assign1'), {
        orgId: 'strynkix',
        assignmentId: 'assign_1',
        batchId: 'batch_pune_1',
        studentId: 'student_alice',
        status: 'submitted',
        submissionUrl: 'https://github.com/alice/assignment1',
      })
    );
  });

  it('student CANNOT self-assign a grade score on their submission', async () => {
    const alice = testEnv.authenticatedContext('student_alice').firestore();
    await assertFails(
      setDoc(doc(alice, 'submissions/sub_alice_cheating'), {
        orgId: 'strynkix',
        assignmentId: 'assign_1',
        batchId: 'batch_pune_1',
        studentId: 'student_alice',
        status: 'submitted',
        score: 100, // Privilege violation
      })
    );
  });

  it('instructor can grade student submission with score and feedback', async () => {
    // Seed alice submission
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'submissions/sub_alice_assign1'), {
        orgId: 'strynkix',
        assignmentId: 'assign_1',
        batchId: 'batch_pune_1',
        studentId: 'student_alice',
        status: 'submitted',
        submissionUrl: 'https://github.com/alice/assignment1',
      });
    });

    const instructor = testEnv.authenticatedContext('instructor_dave').firestore();
    await assertSucceeds(
      updateDoc(doc(instructor, 'submissions/sub_alice_assign1'), {
        score: 95,
        feedback: 'Excellent clean code structure and thorough test coverage!',
        status: 'graded',
      })
    );
  });
});

describe('5. Profile State Security: Suspended & Unprovisioned Accounts', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();

      // Seed a published course
      await setDoc(doc(adminDb, 'courses/active_course'), {
        orgId: 'strynkix',
        title: 'Full Stack Foundations',
        status: 'published',
      });

      // Seed an active student
      await setDoc(doc(adminDb, 'users/active_student'), {
        role: 'student',
        orgId: 'strynkix',
        status: 'active',
        email: 'active@strynkix.com',
        displayName: 'Active Student',
      });

      // Seed a suspended student
      await setDoc(doc(adminDb, 'users/suspended_student'), {
        role: 'student',
        orgId: 'strynkix',
        status: 'suspended',
        email: 'suspended@strynkix.com',
        displayName: 'Suspended Student',
      });
    });
  });

  it('active student can read published courses in their org', async () => {
    const student = testEnv.authenticatedContext('active_student').firestore();
    await assertSucceeds(getDoc(doc(student, 'courses/active_course')));
  });

  it('suspended student is strictly DENIED access to published courses in their org', async () => {
    const suspended = testEnv.authenticatedContext('suspended_student').firestore();
    await assertFails(getDoc(doc(suspended, 'courses/active_course')));
  });

  it('unprovisioned user (no /users/{uid} document) is strictly DENIED access to courses', async () => {
    const unprovisioned = testEnv.authenticatedContext('unprovisioned_stranger').firestore();
    await assertFails(getDoc(doc(unprovisioned, 'courses/active_course')));
  });

  it('suspended user is strictly DENIED read access to organization details', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations/strynkix'), {
        name: 'Strynkix Academy',
      });
    });

    const suspended = testEnv.authenticatedContext('suspended_student').firestore();
    await assertFails(getDoc(doc(suspended, 'organizations/strynkix')));
  });

  it('suspended branch_admin is strictly DENIED creating batches', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/suspended_branch_admin'), {
        role: 'branch_admin',
        orgId: 'strynkix',
        branchId: 'branch_pune',
        status: 'suspended',
        email: 'suspended_mgr@strynkix.com',
        displayName: 'Suspended Manager',
      });
    });

    const suspendedAdmin = testEnv.authenticatedContext('suspended_branch_admin').firestore();
    await assertFails(
      setDoc(doc(suspendedAdmin, 'batches/batch_illegal'), {
        orgId: 'strynkix',
        branchId: 'branch_pune',
        name: 'Illegal Batch',
      })
    );
  });
});

describe('6. Granular Tenant & Branch Boundary Regressions', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();

      // University Admin
      await setDoc(doc(adminDb, 'users/uni_admin_user'), {
        role: 'university_admin',
        orgId: 'strynkix',
        status: 'active',
        email: 'uni@strynkix.com',
        displayName: 'University Admin',
      });

      // Branch Admin Pune
      await setDoc(doc(adminDb, 'users/branch_admin_pune'), {
        role: 'branch_admin',
        orgId: 'strynkix',
        branchId: 'branch_pune',
        status: 'active',
        email: 'pune_mgr@strynkix.com',
        displayName: 'Pune Manager',
      });

      // Batch in Pune
      await setDoc(doc(adminDb, 'batches/batch_pune_existing'), {
        orgId: 'strynkix',
        branchId: 'branch_pune',
        name: 'Pune Batch Alpha',
      });

      // Submissions: One in Pune, one in Mumbai
      await setDoc(doc(adminDb, 'submissions/sub_pune_student'), {
        orgId: 'strynkix',
        branchId: 'branch_pune',
        assignmentId: 'assign_1',
        studentId: 'student_pune_1',
        status: 'submitted',
        submissionUrl: 'https://github.com/strynkix/lab1',
      });

      await setDoc(doc(adminDb, 'submissions/sub_mumbai_student'), {
        orgId: 'strynkix',
        branchId: 'branch_mumbai',
        assignmentId: 'assign_1',
        studentId: 'student_mumbai_1',
        status: 'submitted',
        submissionUrl: 'https://github.com/strynkix/lab2',
      });
    });
  });

  it('branch_admin cannot alter orgId on batch update', async () => {
    const puneAdmin = testEnv.authenticatedContext('branch_admin_pune').firestore();
    await assertFails(
      updateDoc(doc(puneAdmin, 'batches/batch_pune_existing'), {
        orgId: 'rogue_org',
        name: 'Hijacked Org Batch',
      })
    );
  });

  it('branch_admin cannot grade a submission from a different branch', async () => {
    const puneAdmin = testEnv.authenticatedContext('branch_admin_pune').firestore();
    await assertFails(
      updateDoc(doc(puneAdmin, 'submissions/sub_mumbai_student'), {
        score: 88,
        status: 'graded',
      })
    );
  });

  it('branch_admin can grade a submission within their assigned branch', async () => {
    const puneAdmin = testEnv.authenticatedContext('branch_admin_pune').firestore();
    await assertSucceeds(
      updateDoc(doc(puneAdmin, 'submissions/sub_pune_student'), {
        score: 92,
        feedback: 'Great work on this Pune batch lab!',
        status: 'graded',
      })
    );
  });

  it('university_admin cannot modify their own profile via university_admin rule', async () => {
    const uniAdmin = testEnv.authenticatedContext('uni_admin_user').firestore();
    // Attempting to elevate itself or mutate status must fail
    await assertFails(
      updateDoc(doc(uniAdmin, 'users/uni_admin_user'), {
        role: 'super_admin',
      })
    );
  });
});

describe('7. Stage 3.1 Live Book Lesson Progress & Security Invariants', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();

      // Active student 1 in 'strynkix' org
      await setDoc(doc(adminDb, 'users/student_aarav'), {
        role: 'student',
        orgId: 'strynkix',
        branchId: 'branch_pune',
        status: 'active',
        email: 'aarav@strynkix.com',
        displayName: 'Aarav Patel',
      });

      // Active student 2 in 'strynkix' org
      await setDoc(doc(adminDb, 'users/student_diya'), {
        role: 'student',
        orgId: 'strynkix',
        branchId: 'branch_pune',
        status: 'active',
        email: 'diya@strynkix.com',
        displayName: 'Diya Sharma',
      });

      // Suspended student in 'strynkix' org
      await setDoc(doc(adminDb, 'users/student_suspended'), {
        role: 'student',
        orgId: 'strynkix',
        status: 'suspended',
        email: 'suspended_user@strynkix.com',
        displayName: 'Suspended Student',
      });

      // Published course, module, and lesson in 'strynkix' org
      await setDoc(doc(adminDb, 'courses/course_fullstack_2026'), {
        orgId: 'strynkix',
        title: 'Full Stack Course',
        status: 'published',
      });

      await setDoc(doc(adminDb, 'modules/mod_ts_foundations'), {
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        title: 'TypeScript Foundations',
        status: 'published',
      });

      await setDoc(doc(adminDb, 'lessons/lesson_published_valid'), {
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        moduleId: 'mod_ts_foundations',
        title: 'Published Lesson',
        status: 'published',
      });

      // Draft (unpublished) lesson in 'strynkix' org
      await setDoc(doc(adminDb, 'lessons/lesson_draft_hidden'), {
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        moduleId: 'mod_ts_foundations',
        title: 'Secret Draft Lesson',
        status: 'draft',
      });

      // Foreign lesson belonging to another organization
      await setDoc(doc(adminDb, 'lessons/lesson_external_tenant'), {
        orgId: 'competitor_academy',
        courseId: 'course_other',
        moduleId: 'mod_other',
        title: 'Competitor Lesson',
        status: 'published',
      });

      // Pre-existing progress for Aarav
      await setDoc(doc(adminDb, 'progress/student_aarav_course_fullstack_2026_lesson_published_valid'), {
        id: 'student_aarav_course_fullstack_2026_lesson_published_valid',
        studentId: 'student_aarav',
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        moduleId: 'mod_ts_foundations',
        lessonId: 'lesson_published_valid',
        status: 'in_progress',
        timeSpentSeconds: 120,
      });
    });
  });

  it('active student CAN create progress for a published lesson in their org with matching course/module', async () => {
    const studentDb = testEnv.authenticatedContext('student_diya').firestore();
    const progressDoc = doc(studentDb, 'progress/student_diya_course_fullstack_2026_lesson_published_valid');

    await assertSucceeds(
      setDoc(progressDoc, {
        id: 'student_diya_course_fullstack_2026_lesson_published_valid',
        studentId: 'student_diya',
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        moduleId: 'mod_ts_foundations',
        lessonId: 'lesson_published_valid',
        status: 'in_progress',
        timeSpentSeconds: 60,
      })
    );
  });

  it('student CANNOT create progress for an unpublished (draft) lesson', async () => {
    const studentDb = testEnv.authenticatedContext('student_diya').firestore();
    const progressDoc = doc(studentDb, 'progress/student_diya_draft_progress');

    await assertFails(
      setDoc(progressDoc, {
        id: 'student_diya_draft_progress',
        studentId: 'student_diya',
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        moduleId: 'mod_ts_foundations',
        lessonId: 'lesson_draft_hidden',
        status: 'in_progress',
        timeSpentSeconds: 60,
      })
    );
  });

  it('student CANNOT create progress for a lesson from another organization (cross-tenant)', async () => {
    const studentDb = testEnv.authenticatedContext('student_diya').firestore();
    const progressDoc = doc(studentDb, 'progress/student_diya_cross_tenant_progress');

    await assertFails(
      setDoc(progressDoc, {
        id: 'student_diya_cross_tenant_progress',
        studentId: 'student_diya',
        orgId: 'strynkix',
        courseId: 'course_other',
        moduleId: 'mod_other',
        lessonId: 'lesson_external_tenant',
        status: 'in_progress',
        timeSpentSeconds: 60,
      })
    );
  });

  it('student CANNOT create progress with mismatched courseId or moduleId', async () => {
    const studentDb = testEnv.authenticatedContext('student_diya').firestore();
    const progressDoc = doc(studentDb, 'progress/student_diya_mismatched_progress');

    await assertFails(
      setDoc(progressDoc, {
        id: 'student_diya_mismatched_progress',
        studentId: 'student_diya',
        orgId: 'strynkix',
        courseId: 'fake_course_id', // does not match actual lesson courseId
        moduleId: 'mod_ts_foundations',
        lessonId: 'lesson_published_valid',
        status: 'in_progress',
        timeSpentSeconds: 60,
      })
    );
  });

  it('student CAN update their own progress timeSpentSeconds and status', async () => {
    const studentDb = testEnv.authenticatedContext('student_aarav').firestore();
    const progressDoc = doc(studentDb, 'progress/student_aarav_course_fullstack_2026_lesson_published_valid');

    await assertSucceeds(
      updateDoc(progressDoc, {
        status: 'completed',
        timeSpentSeconds: 300,
        completedAt: new Date().toISOString(),
      })
    );
  });

  it('student CANNOT tamper with studentId, orgId, courseId, moduleId, or lessonId on update', async () => {
    const studentDb = testEnv.authenticatedContext('student_aarav').firestore();
    const progressDoc = doc(studentDb, 'progress/student_aarav_course_fullstack_2026_lesson_published_valid');

    // Attempting to reassign studentId
    await assertFails(
      updateDoc(progressDoc, {
        studentId: 'student_diya',
      })
    );

    // Attempting to reassign orgId
    await assertFails(
      updateDoc(progressDoc, {
        orgId: 'hacked_org',
      })
    );

    // Attempting to reassign lessonId
    await assertFails(
      updateDoc(progressDoc, {
        lessonId: 'another_lesson',
      })
    );
  });

  it('student CANNOT read another student progress document', async () => {
    const diyaDb = testEnv.authenticatedContext('student_diya').firestore();
    const aaravProgress = doc(diyaDb, 'progress/student_aarav_course_fullstack_2026_lesson_published_valid');

    await assertFails(getDoc(aaravProgress));
  });

  it('suspended student CANNOT read or write progress', async () => {
    const suspendedDb = testEnv.authenticatedContext('student_suspended').firestore();
    const progressDoc = doc(suspendedDb, 'progress/student_suspended_progress');

    await assertFails(getDoc(progressDoc));
    await assertFails(
      setDoc(progressDoc, {
        id: 'student_suspended_progress',
        studentId: 'student_suspended',
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        moduleId: 'mod_ts_foundations',
        lessonId: 'lesson_published_valid',
        status: 'in_progress',
        timeSpentSeconds: 30,
      })
    );
  });
});

describe('8. Stage 4 Organization & Branch Administrative Governance', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();

      // Super Admin
      await setDoc(doc(adminDb, 'users/super_admin_alex'), {
        role: 'super_admin',
        orgId: 'strynkix',
        status: 'active',
        email: 'alex@strynkix.com',
        displayName: 'Alex SuperAdmin',
      });

      // Suspended Super Admin
      await setDoc(doc(adminDb, 'users/super_admin_suspended'), {
        role: 'super_admin',
        orgId: 'strynkix',
        status: 'suspended',
        email: 'suspended_admin@strynkix.com',
        displayName: 'Suspended Admin',
      });

      // University Admin in strynkix
      await setDoc(doc(adminDb, 'users/uni_admin_strynkix'), {
        role: 'university_admin',
        orgId: 'strynkix',
        status: 'active',
        email: 'uni@strynkix.com',
        displayName: 'Uni Admin',
      });

      // Branch Admin in strynkix branch_pune
      await setDoc(doc(adminDb, 'users/branch_admin_pune_user'), {
        role: 'branch_admin',
        orgId: 'strynkix',
        branchId: 'branch_pune',
        status: 'active',
        email: 'pune_mgr@strynkix.com',
        displayName: 'Pune Manager',
      });

      // Student in strynkix
      await setDoc(doc(adminDb, 'users/student_rohit'), {
        role: 'student',
        orgId: 'strynkix',
        branchId: 'branch_pune',
        status: 'active',
        email: 'rohit@strynkix.com',
        displayName: 'Rohit Student',
      });

      // Pre-existing organization
      await setDoc(doc(adminDb, 'organizations/strynkix'), {
        name: 'Strynkix Academy',
        slug: 'strynkix-academy',
        status: 'active',
      });
    });
  });

  it('super_admin CAN create and update an organization', async () => {
    const superAdminDb = testEnv.authenticatedContext('super_admin_alex').firestore();
    const newOrgRef = doc(superAdminDb, 'organizations/partner_university');

    await assertSucceeds(
      setDoc(newOrgRef, {
        name: 'Partner Engineering University',
        slug: 'partner-university',
        status: 'active',
      })
    );

    await assertSucceeds(
      updateDoc(newOrgRef, {
        name: 'Partner University of Technology',
      })
    );
  });

  it('non-super-admin (student, branch_admin, uni_admin) CANNOT create an organization', async () => {
    const studentDb = testEnv.authenticatedContext('student_rohit').firestore();
    await assertFails(
      setDoc(doc(studentDb, 'organizations/rogue_org'), {
        name: 'Rogue Academy',
        slug: 'rogue-academy',
        status: 'active',
      })
    );

    const branchAdminDb = testEnv.authenticatedContext('branch_admin_pune_user').firestore();
    await assertFails(
      setDoc(doc(branchAdminDb, 'organizations/branch_mgr_org'), {
        name: 'Branch Manager Org',
        slug: 'branch-mgr-org',
        status: 'active',
      })
    );

    const uniAdminDb = testEnv.authenticatedContext('uni_admin_strynkix').firestore();
    await assertFails(
      setDoc(doc(uniAdminDb, 'organizations/uni_admin_org'), {
        name: 'Uni Admin Org',
        slug: 'uni-admin-org',
        status: 'active',
      })
    );
  });

  it('super_admin CAN create branches under any organization', async () => {
    const superAdminDb = testEnv.authenticatedContext('super_admin_alex').firestore();
    const branchRef = doc(superAdminDb, 'branches/branch_bengaluru');

    await assertSucceeds(
      setDoc(branchRef, {
        orgId: 'strynkix',
        name: 'Bengaluru Campus',
        code: 'BLR-01',
        status: 'active',
      })
    );
  });

  it('university_admin CAN create a branch within their own orgId', async () => {
    const uniAdminDb = testEnv.authenticatedContext('uni_admin_strynkix').firestore();
    const branchRef = doc(uniAdminDb, 'branches/branch_mumbai_uni');

    await assertSucceeds(
      setDoc(branchRef, {
        orgId: 'strynkix',
        name: 'Mumbai Campus',
        code: 'MUM-01',
        status: 'active',
      })
    );
  });

  it('university_admin CANNOT create a branch in another orgId', async () => {
    const uniAdminDb = testEnv.authenticatedContext('uni_admin_strynkix').firestore();
    const branchRef = doc(uniAdminDb, 'branches/branch_foreign');

    await assertFails(
      setDoc(branchRef, {
        orgId: 'competitor_academy',
        name: 'Foreign Campus',
        code: 'FOR-01',
        status: 'active',
      })
    );
  });

  it('branch_admin and student CANNOT create branches', async () => {
    const branchAdminDb = testEnv.authenticatedContext('branch_admin_pune_user').firestore();
    await assertFails(
      setDoc(doc(branchAdminDb, 'branches/branch_illegal_mgr'), {
        orgId: 'strynkix',
        name: 'Illegal Manager Branch',
        code: 'ILL-01',
        status: 'active',
      })
    );

    const studentDb = testEnv.authenticatedContext('student_rohit').firestore();
    await assertFails(
      setDoc(doc(studentDb, 'branches/branch_illegal_student'), {
        orgId: 'strynkix',
        name: 'Illegal Student Branch',
        code: 'STU-01',
        status: 'active',
      })
    );
  });

  it('suspended super_admin is strictly DENIED write operations', async () => {
    const suspendedAdminDb = testEnv.authenticatedContext('super_admin_suspended').firestore();
    await assertFails(
      setDoc(doc(suspendedAdminDb, 'organizations/suspended_created_org'), {
        name: 'Suspended Org',
        slug: 'suspended-org',
        status: 'active',
      })
    );
  });
});



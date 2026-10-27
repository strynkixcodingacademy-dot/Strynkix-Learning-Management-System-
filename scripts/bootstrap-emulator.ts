/**
 * Strynkix Coding Academy LMS — Local Emulator Trusted Bootstrap Script
 *
 * PURPOSE:
 * Securely provisions the initial Strynkix Academy multi-tenant topology
 * and administrative accounts in the local Firebase Auth and Firestore emulators.
 *
 * SECURITY INVARIANTS:
 * 1. Strictly refuses execution against production or live cloud resources.
 * 2. Authenticates or provisions accounts in Firebase Auth first, retrieving
 *    the authoritative, cryptographically verified UID before writing profile records.
 * 3. Never grants administrative privileges to arbitrary, client-supplied UIDs.
 * 4. Idempotent: can be executed safely multiple times.
 */

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Local Emulator Endpoints
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'learning-management-syst-b9bf3';

// Enforce local-only execution safety
function assertLocalEnvironment(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: bootstrap-emulator script must NEVER be run in production.');
  }

  const [authIp] = AUTH_HOST.split(':');
  const [firestoreIp] = FIRESTORE_HOST.split(':');

  const isLocalAuth = authIp === '127.0.0.1' || authIp === 'localhost';
  const isLocalFirestore = firestoreIp === '127.0.0.1' || firestoreIp === 'localhost';

  if (!isLocalAuth || !isLocalFirestore) {
    throw new Error(
      `FATAL: Refusing to run bootstrap script. Emulator hosts must resolve to localhost. Detected: Auth=${AUTH_HOST}, Firestore=${FIRESTORE_HOST}`
    );
  }
}

interface SeedUser {
  email: string;
  password: string;
  displayName: string;
  role: 'super_admin' | 'university_admin' | 'branch_admin' | 'instructor' | 'student';
  orgId: string;
  branchId?: string;
  status: 'active';
}

const SEED_USERS: SeedUser[] = [
  {
    email: 'admin@strynkix.com',
    password: 'SuperAdmin@Strynkix2026!',
    displayName: 'Strynkix Super Admin',
    role: 'super_admin',
    orgId: 'strynkix',
    status: 'active',
  },
  {
    email: 'uniadmin@strynkix.com',
    password: 'UniAdmin@Strynkix2026!',
    displayName: 'Strynkix University Admin',
    role: 'university_admin',
    orgId: 'strynkix',
    status: 'active',
  },
  {
    email: 'manager.pune@strynkix.com',
    password: 'BranchManager@Pune2026!',
    displayName: 'Pune Branch Manager',
    role: 'branch_admin',
    orgId: 'strynkix',
    branchId: 'branch_pune',
    status: 'active',
  },
  {
    email: 'instructor@strynkix.com',
    password: 'Instructor@Strynkix2026!',
    displayName: 'Lead Instructor Priya',
    role: 'instructor',
    orgId: 'strynkix',
    branchId: 'branch_pune',
    status: 'active',
  },
  {
    email: 'student1@strynkix.com',
    password: 'Student1@Strynkix2026!',
    displayName: 'Aarav Patel',
    role: 'student',
    orgId: 'strynkix',
    branchId: 'branch_pune',
    status: 'active',
  },
  {
    email: 'student2@strynkix.com',
    password: 'Student2@Strynkix2026!',
    displayName: 'Diya Sharma',
    role: 'student',
    orgId: 'strynkix',
    branchId: 'branch_pune',
    status: 'active',
  },
];

/**
 * Creates or retrieves a user from the Firebase Auth Emulator via REST API.
 * Returns the authoritative UID.
 */
async function ensureAuthUser(user: SeedUser): Promise<string> {
  const signUpUrl = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`;
  const signInUrl = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`;

  // Attempt creation
  try {
    const createRes = await fetch(signUpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        displayName: user.displayName,
        returnSecureToken: true,
      }),
    });

    const createData = (await createRes.json()) as { localId?: string; error?: { message?: string } };

    if (createRes.ok && createData.localId) {
      return createData.localId;
    }

    // If account already exists in emulator, sign in to retrieve authoritative UID
    if (createData.error?.message === 'EMAIL_EXISTS') {
      const signInRes = await fetch(signInUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          password: user.password,
          returnSecureToken: true,
        }),
      });

      const signInData = (await signInRes.json()) as { localId?: string };
      if (signInRes.ok && signInData.localId) {
        return signInData.localId;
      }
    }

    throw new Error(`Failed to provision Auth account for ${user.email}: ${JSON.stringify(createData)}`);
  } catch (err) {
    throw new Error(`Auth emulator unreachable at http://${AUTH_HOST}: ${(err as Error).message}`);
  }
}

async function main() {
  console.log('================================================================');
  console.log('  Strynkix LMS — Local Emulator Trusted Bootstrap Execution');
  console.log('================================================================');

  assertLocalEnvironment();

  const [host, portStr] = FIRESTORE_HOST.split(':');
  const firestorePort = parseInt(portStr, 10) || 8080;

  const rulesPath = path.resolve(__dirname, '../firestore.rules');
  const rules = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : '';

  console.log(`Connecting to Firestore emulator at ${FIRESTORE_HOST}...`);
  console.log(`Connecting to Auth emulator at ${AUTH_HOST}...`);

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port: firestorePort,
      rules,
    },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const now = new Date().toISOString();

      // 1. Seed Root Organization
      const orgRef = doc(db, 'organizations/strynkix');
      const orgSnap = await getDoc(orgRef);
      if (!orgSnap.exists()) {
        await setDoc(orgRef, {
          id: 'strynkix',
          name: 'Strynkix Coding Academy',
          slug: 'strynkix',
          status: 'active',
          tier: 'enterprise',
          createdAt: now,
          updatedAt: now,
        });
        console.log('✓ Provisioned Organization: organizations/strynkix (Strynkix Coding Academy)');
      } else {
        console.log('✓ Organization organizations/strynkix already exists.');
      }

      // 2. Seed Initial Branch (Pune Campus)
      const branchRef = doc(db, 'branches/branch_pune');
      const branchSnap = await getDoc(branchRef);
      if (!branchSnap.exists()) {
        await setDoc(branchRef, {
          id: 'branch_pune',
          orgId: 'strynkix',
          name: 'Pune Campus',
          slug: 'pune-campus',
          city: 'Pune',
          state: 'Maharashtra',
          country: 'India',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        });
        console.log('✓ Provisioned Branch: branches/branch_pune (Pune Campus)');
      } else {
        console.log('✓ Branch branches/branch_pune already exists.');
      }

      // 3. Seed Course, Modules, and Live Book Lessons
      const courseRef = doc(db, 'courses/course_fullstack_2026');
      await setDoc(courseRef, {
        id: 'course_fullstack_2026',
        orgId: 'strynkix',
        title: 'Full Stack Software Engineering',
        slug: 'fullstack-software-engineering',
        tagline: 'Production-ready web architecture with Next.js, TypeScript, and Cloud Firestore.',
        description:
          'A modern, hands-on engineering track inspired by real-world academy curricula. Build resilient multi-tenant architectures, interactive Live Books, and verified zero-trust security barriers.',
        level: 'intermediate',
        tags: ['TypeScript', 'Next.js', 'Firebase', 'Security'],
        prerequisites: ['JavaScript Basics', 'Web Fundamentals'],
        estimatedWeeks: 16,
        status: 'published',
        createdAt: now,
        updatedAt: now,
      });
      console.log('✓ Provisioned Course: courses/course_fullstack_2026');

      // Module 1
      const mod1Ref = doc(db, 'modules/mod_ts_foundations');
      await setDoc(mod1Ref, {
        id: 'mod_ts_foundations',
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        title: 'Type-Safe Software Architecture',
        slug: 'typesafe-software-architecture',
        summary: 'Compile-time type systems, zero-trust domain validation, and safe data flow.',
        orderIndex: 1,
        status: 'published',
        createdAt: now,
        updatedAt: now,
      });

      // Module 2
      const mod2Ref = doc(db, 'modules/mod_cloud_data');
      await setDoc(mod2Ref, {
        id: 'mod_cloud_data',
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        title: 'Multi-Tenant Cloud Data & Security',
        slug: 'multitenant-cloud-security',
        summary: 'Cloud Firestore security rules, tenant isolation, and suspension enforcement.',
        orderIndex: 2,
        status: 'published',
        createdAt: now,
        updatedAt: now,
      });
      console.log('✓ Provisioned Modules: mod_ts_foundations & mod_cloud_data');

      // Lesson 1.1: Type Safety & Zero-Trust Domain Models
      const lesson11Ref = doc(db, 'lessons/lesson_ts_architecture');
      await setDoc(lesson11Ref, {
        id: 'lesson_ts_architecture',
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        moduleId: 'mod_ts_foundations',
        title: 'Type Safety & Zero-Trust Domain Models',
        slug: 'type-safety-domain-models',
        type: 'concept',
        orderIndex: 1,
        estimatedMinutes: 15,
        status: 'published',
        createdAt: now,
        updatedAt: now,
        blocks: [
          {
            id: 'b_head_1',
            type: 'heading',
            level: 1,
            text: 'Why Static Types Are Not Enough at Runtime Boundaries',
          },
          {
            id: 'b_text_1',
            type: 'text',
            content:
              'In modern web applications, TypeScript provides incredible developer ergonomics and catches logical errors at compile time. However, once code runs in the user\'s browser or receives incoming JSON over the wire, types disappear completely.\n\nA resilient architecture treats all external inputs — including query parameters, localStorage, and API bodies — as untrusted until validated through explicit runtime schemas.',
          },
          {
            id: 'b_callout_1',
            type: 'callout',
            variant: 'info',
            title: 'Core Architectural Principle',
            content:
              'Never trust type assertions (`as MyType`) on network responses. Always parse untrusted payloads using validation libraries like Zod to guarantee schema integrity before state ingestion.',
          },
          {
            id: 'b_code_1',
            type: 'code_example',
            language: 'typescript',
            filename: 'types/user.ts',
            highlightLines: [7, 8],
            code: `import { z } from 'zod';

export const userProfileSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  role: z.enum(['student', 'instructor', 'branch_admin', 'super_admin']),
  email: z.string().email(),
  displayName: z.string().min(2).max(100),
  status: z.enum(['active', 'suspended']).default('active'),
});

export type UserProfile = z.infer<typeof userProfileSchema>;`,
            caption: 'Deriving compile-time TypeScript types directly from runtime Zod schemas.',
          },
          {
            id: 'b_worked_1',
            type: 'worked_example',
            title: 'Handling Malformed API Responses Safely',
            problem:
              'A student profile document in Firestore is missing the mandatory `orgId` tenant boundary due to a legacy migration. How should our auth context handle this without crashing or granting rogue access?',
            solutionCode: `export function validateProfile(raw: unknown): UserProfile | null {
  const result = userProfileSchema.safeParse(raw);
  if (!result.success) {
    console.error('Schema validation failed:', result.error.format());
    return null; // Deny access safely
  }
  return result.data;
}`,
            language: 'typescript',
            explanation:
              'Using `safeParse` returns an object with a boolean `success` flag rather than throwing an uncaught exception, allowing the application to gracefully set status to "error" or "no_profile".',
          },
          {
            id: 'b_quiz_1',
            type: 'quiz',
            question:
              'What happens to TypeScript type annotations when your Next.js application is built for production?',
            options: [
              { id: 'opt_1', text: 'They are converted to runtime JavaScript instanceof checks' },
              { id: 'opt_2', text: 'They are completely stripped during compilation and do not exist at runtime' },
              { id: 'opt_3', text: 'They are saved in a hidden metadata bundle for browser validation' },
            ],
            correctOptionId: 'opt_2',
            explanation:
              'TypeScript types are strictly a compile-time tool. JavaScript runtimes have no native knowledge of TypeScript interfaces or type aliases.',
            hint: 'Think about what JavaScript engines (V8) actually execute in the browser.',
          },
          {
            id: 'b_task_1',
            type: 'practice_task',
            title: 'Create an Immutable Batch Schema',
            instructions:
              'Open your local editor. Create a Zod schema `batchSchema` requiring `id`, `orgId`, `branchId`, and an array of `instructorUserIds` with at least one instructor UID.\nVerify with a test script.',
            starterCode: `import { z } from 'zod';

export const batchSchema = z.object({
  // TODO: Add fields
});`,
            language: 'typescript',
            hints: ['Use z.array(z.string()).min(1) for instructorUserIds'],
            expectedOutcome: 'batchSchema.parse({ id: "b1", orgId: "strynkix", branchId: "pune", instructorUserIds: ["dave"] }) succeeds.',
          },
        ],
      });

      // Lesson 1.2: Asynchronous Observers & Race Condition Defense
      const lesson12Ref = doc(db, 'lessons/lesson_state_observers');
      await setDoc(lesson12Ref, {
        id: 'lesson_state_observers',
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        moduleId: 'mod_ts_foundations',
        title: 'Asynchronous Observers & Race Condition Defense',
        slug: 'asynchronous-observers-race-conditions',
        type: 'interactive_code',
        orderIndex: 2,
        estimatedMinutes: 20,
        status: 'published',
        createdAt: now,
        updatedAt: now,
        blocks: [
          {
            id: 'b12_head_1',
            type: 'heading',
            level: 1,
            text: 'Mitigating Asynchronous Race Conditions in React Observers',
          },
          {
            id: 'b12_text_1',
            type: 'text',
            content:
              'When subscribing to real-time authentication or Firestore listeners, network responses arrive asynchronously. If a user logs out quickly after logging in, an in-flight profile fetch could resolve *after* the logout action, causing an unauthenticated state to be overwritten with stale profile data.',
          },
          {
            id: 'b12_callout_1',
            type: 'callout',
            variant: 'warning',
            title: 'Concurrency Risk',
            content:
              'Always increment an active sequence token or use cleanup flags inside `useEffect` or observer callbacks to discard stale asynchronous promises.',
          },
          {
            id: 'b12_code_1',
            type: 'code_example',
            language: 'typescript',
            filename: 'context/AuthContext.tsx',
            highlightLines: [2, 7],
            code: `const activeSequenceRef = useRef<number>(0);

const loadUserProfile = async (user: User | null) => {
  const sequenceId = ++activeSequenceRef.current;
  const docSnap = await getDoc(userDocRef);

  // If another auth change triggered while we were awaiting, discard this result
  if (sequenceId !== activeSequenceRef.current) {
    return;
  }

  setProfile(docSnap.data());
};`,
            caption: 'Sequence counter tokens prevent stale overwrites across fast state transitions.',
          },
          {
            id: 'b12_quiz_1',
            type: 'quiz',
            question:
              'Why is using a sequence token or cleanup flag essential when fetching asynchronous profile data?',
            options: [
              { id: 'opt_perf', text: 'To compress network payloads for faster download' },
              { id: 'opt_stale', text: 'To prevent out-of-order network responses from overwriting a newer session state' },
              { id: 'opt_sec', text: 'To encrypt sensitive credentials in memory' },
            ],
            correctOptionId: 'opt_stale',
            explanation:
              'Asynchronous responses have no arrival order guarantees. A slow initial request can easily arrive after a fast subsequent logout unless discarded.',
          },
        ],
      });

      // Lesson 2.1: Multi-Tenant Isolation & Least Privilege Rules
      const lesson21Ref = doc(db, 'lessons/lesson_firestore_security');
      await setDoc(lesson21Ref, {
        id: 'lesson_firestore_security',
        orgId: 'strynkix',
        courseId: 'course_fullstack_2026',
        moduleId: 'mod_cloud_data',
        title: 'Multi-Tenant Isolation & Least Privilege Rules',
        slug: 'multitenant-isolation-least-privilege',
        type: 'exercise',
        orderIndex: 1,
        estimatedMinutes: 25,
        status: 'published',
        createdAt: now,
        updatedAt: now,
        blocks: [
          {
            id: 'b21_head_1',
            type: 'heading',
            level: 1,
            text: 'Enforcing Tenant & Branch Barriers in Firestore Security Rules',
          },
          {
            id: 'b21_text_1',
            type: 'text',
            content:
              'In a multi-tenant academy architecture, tenants must never view or mutate data belonging to other organizations. Furthermore, branch managers must be strictly scoped to their assigned branch location.',
          },
          {
            id: 'b21_callout_1',
            type: 'callout',
            variant: 'danger',
            title: 'Zero-Trust Rule Enforcement',
            content:
              'UI route guards can be bypassed by modifying client JavaScript or invoking Firestore APIs directly. All security invariants must be verified in `firestore.rules`.',
          },
          {
            id: 'b21_quiz_1',
            type: 'quiz',
            question:
              'Can a client-side user modify their account status from "suspended" to "active" if Firestore rules enforce `isAccountActive()` on self-updates?',
            options: [
              { id: 'opt_yes', text: 'Yes, if they use the Firebase JavaScript SDK directly' },
              { id: 'opt_no', text: 'No, Firestore evaluates rules on the server and rejects the write with PERMISSION_DENIED' },
            ],
            correctOptionId: 'opt_no',
            explanation:
              'Firestore Security Rules are executed atomically on Google Cloud servers before committing writes to storage. Client tampering is impossible.',
          },
        ],
      });
      console.log('✓ Provisioned Live Book Lessons: 3 interactive lessons seeded');


      // 4. Authenticate, verify, and provision Seed Accounts
      console.log('\nProvisioning seed accounts...');
      for (const seed of SEED_USERS) {
        const uid = await ensureAuthUser(seed);

        const userDocRef = doc(db, 'users', uid);
        await setDoc(
          userDocRef,
          {
            id: uid,
            orgId: seed.orgId,
            branchId: seed.branchId || null,
            role: seed.role,
            email: seed.email,
            displayName: seed.displayName,
            status: seed.status,
            createdAt: now,
            updatedAt: now,
          },
          { merge: true }
        );

        console.log(`✓ [${seed.role.toUpperCase()}] ${seed.email} -> UID: ${uid}`);
      }

      console.log('\n================================================================');
      console.log('  Bootstrap Completed Successfully!');
      console.log('  All accounts provisioned with verified Firebase Auth UIDs.');
      console.log('  Credentials are for local emulator testing only.');
      console.log('================================================================\n');
    });
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((err) => {
  console.error('\n❌ Bootstrap failed with error:', err);
  process.exit(1);
});

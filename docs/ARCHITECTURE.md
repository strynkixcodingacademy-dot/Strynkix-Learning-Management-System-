# Strynkix Coding Academy LMS — Architecture & Domain Specification

> **Phase**: Foundation  
> **Status**: Approved Foundation Blueprint  
> **Target Production Engine**: Next.js (App Router, TypeScript, Tailwind CSS), Cloud Firestore, Firebase Authentication, Vercel

---

## 1. Product Vision & Pedagogical Model

Strynkix Coding Academy LMS is engineered as a modern, multi-tenant learning management system inspired by leading high-velocity engineering academies such as **Kalvium** and its **Live Books** learning paradigm.

### 1.1 The "Live Books" Learning Experience
Unlike traditional video-heavy LMS platforms, education at Strynkix centers around interactive **Live Books**:
- **Granular Bite-Sized Units**: Learning modules broken down into conceptual narratives, inline code snippets, and active reflection exercises.
- **Micro-Milestones**: Immediate check-for-understanding tasks and coding exercises embedded directly within lesson blocks.
- **Continuous Progress Tracking**: Automatic, asynchronous telemetry tracking students' time spent, lesson completion status, and project milestone checkpoints.

---

## 2. Multi-Tenant Hierarchy

The platform is architected from day one for multi-tenancy, while maintaining zero overhead for Strynkix's initial single-academy deployment (1 Super Admin, 1 Branch Manager, 2 Students).

```
[ Organization (Root Tenant: Strynkix) ]
  ├── [ Branch (e.g. Pune Hub / Remote Online) ]
  │     └── [ Batch (e.g. Full-Stack Alpha 2026) ]
  │           └── [ Enrollments (Student UIDs) ]
  └── [ Course (e.g. Software Engineering Foundations) ]
        └── [ Module (Live Book Chapters) ]
              ├── [ Lesson (Interactive Units) ]
              └── [ Assignment (Coding Milestones) ]
                    └── [ Submissions (Graded Deliverables) ]
```

### 2.1 Tenant Isolation Invariants
1. **`orgId` Enforcement**: Every single tenant-owned collection document **must** carry `orgId`. Firestore Security Rules forbid querying across tenant boundaries without matching `orgId`.
2. **`branchId` Boundary**: Branch-level entities (`branches`, `batches`, `enrollments`, and branch-restricted user profiles) enforce `branchId`. A `branch_admin` cannot view or mutate documents belonging to another branch.
3. **Immutable Identity**: Once created, the `orgId`, `branchId`, and `studentId` fields are strictly immutable across all client-issued `update` operations.

---

## 3. Initial Roles & Access Matrix

| Role | Scope | Description & Access Boundaries |
| :--- | :--- | :--- |
| **`super_admin`** | System-Wide | Platform operator. Can manage organizations, branches, global settings, courses, and assign administrative roles. |
| **`university_admin`** | Organization | Institutional leader. Full visibility across all branches, courses, and batches within their assigned `orgId`. |
| **`branch_admin`** | Single Branch | Branch manager. Manages batches, assigns instructors, and tracks student cohorts strictly inside their assigned `branchId`. |
| **`instructor`** | Assigned Batches | Teaching staff. Access to course materials, active batch rosters, and authorized to grade and review student `submissions`. |
| **`student`** | Self / Enrolled | Learner. Can read published courses/modules/lessons they are enrolled in; can only read/write their own `progress` and `submissions`. |

---

## 4. Zero-Trust Security Requirements

1. **No Password Storage**: Passwords never touch application databases; handled exclusively by Firebase Authentication.
2. **No Client Role Escalation**:
   - Public self-registration or onboarding endpoints **never** allow specifying a privileged role (`super_admin`, `university_admin`, `branch_admin`, `instructor`).
   - Browser client requests are **never** trusted for authorization.
   - User roles are securely persisted in the root `/users/{uid}` document and validated in Firestore Security Rules via `get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role`.
3. **Identity Mapping**: Firebase Auth `uid` is unconditionally mapped as the document ID for `/users/{uid}`.
4. **Deny By Default**: All Firestore collections deny all read and write operations unless an explicit allow condition is satisfied.
5. **Storage Abuse & DoS Protection**: All client-writable payloads are subject to strict string length and array length caps enforced both at runtime via Zod and at the database layer via Security Rules.
6. **No Admin Credentials in Frontend**: Firebase Admin SDK credentials and private keys are never packaged or exposed in client bundles.

---

## 5. Domain Collections Specification

### 5.1 `organizations`
- **Path**: `/organizations/{orgId}`
- **Ownership**: System / Super Admin
- **Attributes**: `name`, `slug`, `logoUrl`, `website`, `status`, `settings: { allowedEmailDomains, defaultTimezone, features }`, `createdAt`, `updatedAt`

### 5.2 `branches`
- **Path**: `/branches/{branchId}`
- **Ownership**: `orgId`
- **Attributes**: `orgId`, `name`, `code`, `location: { city, state, country, isRemote }`, `branchAdminUserIds`, `status`, `createdAt`, `updatedAt`

### 5.3 `users`
- **Path**: `/users/{uid}` (Document ID == Firebase Auth UID)
- **Ownership**: `orgId`
- **Attributes**: `orgId`, `branchId` (optional/mandatory for branch staff & students), `role`, `email`, `displayName`, `photoURL`, `phoneNumber`, `status`, `metadata`, `createdAt`, `updatedAt`

### 5.4 `courses`
- **Path**: `/courses/{courseId}`
- **Ownership**: `orgId`
- **Attributes**: `orgId`, `title`, `slug`, `tagline`, `description`, `level`, `tags`, `prerequisites`, `estimatedWeeks`, `status`, `createdById`, `createdAt`, `updatedAt`

### 5.5 `batches`
- **Path**: `/batches/{batchId}`
- **Ownership**: `orgId`, `branchId`
- **Attributes**: `orgId`, `branchId`, `courseId`, `name`, `code`, `instructorUserIds`, `startDate`, `endDate`, `maxStudents`, `status`, `createdAt`, `updatedAt`

### 5.6 `modules`
- **Path**: `/modules/{moduleId}`
- **Ownership**: `orgId`, `courseId`
- **Attributes**: `orgId`, `courseId`, `title`, `slug`, `summary`, `orderIndex`, `status`, `createdAt`, `updatedAt`

### 5.7 `lessons` (Live Books)
- **Path**: `/lessons/{lessonId}`
- **Ownership**: `orgId`, `courseId`, `moduleId`
- **Attributes**: `orgId`, `courseId`, `moduleId`, `title`, `slug`, `type`, `orderIndex`, `estimatedMinutes`, `blocks: [ { id, type, content, metadata } ]`, `status`, `createdAt`, `updatedAt`

### 5.8 `enrollments`
- **Path**: `/enrollments/{enrollmentId}`
- **Ownership**: `orgId`, `branchId`, `studentId`
- **Attributes**: `orgId`, `branchId`, `courseId`, `batchId`, `studentId`, `status`, `enrolledAt`, `completedAt`, `createdAt`, `updatedAt`

### 5.9 `progress`
- **Path**: `/progress/{progressId}`
- **Ownership**: `orgId`, `studentId`
- **Attributes**: `orgId`, `courseId`, `moduleId`, `lessonId`, `studentId`, `status`, `timeSpentSeconds`, `lastAccessedAt`, `completedAt`, `createdAt`, `updatedAt`

### 5.10 `assignments`
- **Path**: `/assignments/{assignmentId}`
- **Ownership**: `orgId`, `courseId`
- **Attributes**: `orgId`, `courseId`, `moduleId`, `lessonId`, `title`, `description`, `starterCodeUrl`, `totalPoints`, `rubric`, `deadline`, `status`, `createdById`, `createdAt`, `updatedAt`

### 5.11 `submissions`
- **Path**: `/submissions/{submissionId}`
- **Ownership**: `orgId`, `assignmentId`, `studentId`
- **Attributes**: `orgId`, `assignmentId`, `batchId`, `studentId`, `submissionUrl`, `codeContent`, `notes`, `status`, `score`, `feedback`, `gradedByUserId`, `gradedAt`, `submittedAt`, `createdAt`, `updatedAt`

---

## 6. Firebase MCP & Tooling Integration

### 6.1 Official Firebase MCP Specification
The official Firebase Model Context Protocol (MCP) server is distributed directly as part of `firebase-tools`:
- **Command**: `firebase mcp` or `npx -y firebase-tools@latest mcp`
- **Protocol**: `stdio` transport
- **Capabilities**: Project inspection, Firestore schema introspection, Security Rules syntax auditing, Custom Claims management.
- **Client Configuration** (`mcp_config.json`):
  ```json
  {
    "mcpServers": {
      "firebase": {
        "command": "firebase",
        "args": ["mcp"]
      }
    }
  }
  ```

---

## 7. Developer & Production Runbook

### 7.1 Runtime Standard
- **Recommended Node.js Version**: Node.js 22 LTS or Node.js 20 LTS.
- **Engines Configuration**: Specified in `package.json` (`>=20.0.0`) and pinned via `.nvmrc`.

### 7.2 Scripts
- `npm run dev`: Launch local Next.js development server.
- `npm run build`: Production bundle compilation with strict type checking.
- `npm run typecheck`: Run TypeScript compiler diagnostics (`tsc --noEmit`).
- `npm run lint`: ESLint check.
- `npm run test:unit`: Run Vitest unit tests (auth + livebook).
- `npm run test:emulator`: Execute Firestore Security Rules against local emulator.
- `npm run test`: Run complete test verification suite.
- `npm run seed:emulator`: Execute trusted seed script against running emulators.
- `npm run bootstrap:emulator`: Start Auth and Firestore emulators, seed initial Strynkix topology, and exit.

---

## 8. Interactive Live Books Engine Architecture (Stage 3)

### 8.1 Pedagogical Vision
Inspired by structured engineering academy platforms such as Kalvium, the Live Books engine transforms static educational text into an interactive digital textbook runtime. Each lesson is composed of typed content blocks that combine conceptual exposition, syntax-highlighted code demonstrations, self-paced worked examples, knowledge check quizzes, and hands-on practice tasks.

### 8.2 Discriminated LessonBlock Content Schema
All lesson content is defined as a discriminated union `LessonBlock` (`type` discriminant):
1. **`text`**: Narrative markdown and conceptual descriptions.
2. **`heading`**: Levels 1–4 with semantic HTML hierarchy and anchor targets.
3. **`code_example`**: Zero-dependency syntax-styled blocks with copy-to-clipboard, filename tabs, line numbers, and selective line highlighting.
4. **`image`**: Secure responsive images restricted to `https://` or relative `/assets` URLs.
5. **`callout`**: High-contrast notices (`info`, `tip`, `warning`, `danger`) with distinct icons.
6. **`worked_example`**: Problem scenarios paired with step-by-step code walkthroughs and key engineering takeaways.
7. **`quiz`**: Client-side interactive multiple-choice questions with instant feedback, hints, and explanatory answers.
8. **`practice_task`**: Real-world coding instructions with starter code, expandable hints, and expected outcome criteria.

### 8.3 Code Practice Safety & Future Isolated-Runner Architecture
- **Stage 3 Safety Posture**: Student code is **never** executed on the application server or inside unverified client eval sandboxes. Practice tasks provide copyable starter templates and verification steps for execution in the student's local workspace.
- **Future Isolated-Runner Roadmap**:
  - *Browser-Side Sandbox*: Sandboxed `WebAssembly` runtimes (e.g., Pyodide for Python, QuickJS/WebContainers for JavaScript/TypeScript) running inside isolated WebWorkers with restricted memory and zero network access.
  - *Server-Side Sandbox*: Ephemeral microVMs (AWS Firecracker or Google Cloud gVisor/Run) with strict CPU limits, memory quotas (128MB), no root access, read-only root filesystems, and strict 5-second timeouts.

### 8.4 Multi-Tenant Progress Telemetry
Student progress is stored under `/progress/{studentId}_{lessonId}` in Cloud Firestore:
- **Tenant & Student Scoping**: Writes require `studentId == request.auth.uid` and `orgId == getUserOrgId()`.
- **Field Immutability**: Rules strictly prevent students from altering `studentId`, `orgId`, `courseId`, `moduleId`, or `lessonId` on existing progress records.
- **Sequential Resume**: Automatically tracks `lastAccessedAt` and `status` (`not_started`, `in_progress`, `completed`) to deep-link returning students directly to their next unfinished lesson.


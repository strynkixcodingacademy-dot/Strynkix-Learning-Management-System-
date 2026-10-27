# Strynkix Coding Academy LMS — Foundation Phase

A production-conscious, multi-tenant Learning Management System inspired by modern engineering education platforms like Kalvium and its interactive **Live Books** learning experience.

---

## 1. Project Overview & Topology

The platform provides a unified learning runtime with strict multi-tenant boundaries. The initial deployment serves:
- **1 Super Admin**
- **1 Branch Manager**
- **2 Students**

The architecture is built from the foundation to scale to multiple partner academies, university branches, instructors, interactive coding modules, and automated assessments without requiring architectural rewrites.

---

## 2. Core Architecture & Domain Models

For in-depth specifications, refer to [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Domain Entities ([src/types/domain.ts](src/types/domain.ts))
1. **`organizations`**: Multi-tenant root (e.g. Strynkix Coding Academy).
2. **`branches`**: Physical/virtual campus hubs (e.g. Pune Hub, Remote).
3. **`users`**: Profiles with document ID matching the Firebase Auth UID.
4. **`courses`**: Syllabus specifications, level tracks, and prerequisites.
5. **`batches`**: Branch-level cohorts with assigned instructors.
6. **`modules`**: Curriculum chapters for organizing Live Books.
7. **`lessons`**: Bite-sized interactive Live Books with markdown, code snippets, and reflection tasks.
8. **`enrollments`**: Multi-tenant mapping linking students to batches and courses.
9. **`progress`**: Granular tracking of time spent and lesson completion.
10. **`assignments`**: Milestones with structured grading rubrics.
11. **`submissions`**: Student deliverables and instructor review feedback.

---

## 3. Zero-Trust Security Invariants

- **No Public Administrative Signup**: Roles are strictly assigned through trusted server-side workflows. Public endpoints can never grant `super_admin`, `university_admin`, `branch_admin`, or `instructor` privileges.
- **Client 0-Trust**: Roles and tenant boundaries (`orgId`, `branchId`) are stored in `/users/{uid}` and validated strictly via Firestore Security Rules.
- **Identity Integrity**: Firebase Auth UID is unconditionally used as the Firestore user document ID.
- **Storage Protection**: All payloads are validated at runtime via Zod ([src/types/validation.ts](src/types/validation.ts)) with explicit length and size boundaries.
- **No Secret Leaks**: Firebase Admin SDK credentials and private keys are never included in client-side code.

---

## 4. Getting Started

### Prerequisites
- **Node.js**: Recommended Active LTS (`v20.x` or `v22.x`). Pin configured in [.nvmrc](.nvmrc).
- **Java Runtime**: OpenJDK 17+ (required for Firebase Local Emulator Suite).
- **Firebase CLI**: `npm install -g firebase-tools` or via `npx -y firebase-tools@latest`.

### Environment Configuration
Copy the template to `.env.local`:
```bash
cp .env.example .env.local
```
> **Note**: `.env.example` contains variable names only. Never commit credentials to version control.

### Installation & Verification
```bash
# Install dependencies
npm install

# Run TypeScript type check
npm run typecheck

# Run ESLint validation
npm run lint

# Build production bundle
npm run build

# Start local dev server
npm run dev
```

---

## 5. Firebase Tooling & MCP Integration

- **Official Firebase MCP Server**:
  Integrated directly into the Firebase CLI (`firebase mcp` / `npx -y firebase-tools@latest mcp`).
  To connect in Antigravity IDE, configure your `mcp_config.json`:
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
  *(Requires running `firebase login` on your host machine beforehand).*
- **Local Emulator Suite**:
  All security rules and tenant isolation checks are validated using `@firebase/rules-unit-testing` against the local Firestore and Auth emulators before deploying to live environments.

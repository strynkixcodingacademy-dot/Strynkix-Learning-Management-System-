# Trusted Server-Side Operations — Assessment & Recommendation

> Status: **recommendation only.** No privileged backend has been implemented or deployed.

## 1. Current architecture

All reads and writes go from the browser through the Firebase client SDK. Firestore Security Rules are the only enforcement boundary. That works for checks a rule can express against a bounded set of documents. It does not work for:

| Need | Why rules cannot do it |
| :--- | :--- |
| Batch capacity (`maxStudents`) | Rules cannot count documents. Two admins enrolling at once can both pass a client-side count. |
| "One active enrollment per student per course" across batches | Enforced today by the deterministic enrollment ID, which is sufficient. Anything wider (for example, one active batch per student overall) would need a server. |
| Creating Firebase Auth accounts for staff and students | Client SDKs can only sign up the current user. Provisioning other users needs the Admin SDK. |
| Bulk operations (migration, CSV enrollment) | Need privileged credentials and transactions over queries. |
| Audit logs that users cannot forge | Client-written logs are only as trustworthy as the rules on them. |

## 2. Options

| | **A. Next.js Route Handlers + Firebase Admin SDK (on Vercel)** | **B. Cloud Functions for Firebase (callable / HTTPS)** |
| :--- | :--- | :--- |
| Firebase plan | **Works on Spark.** Admin SDK calls to Auth and Firestore are ordinary API usage within free quotas. | **Requires Blaze** (pay-as-you-go billing) to deploy functions. |
| Infrastructure change | None new: same Vercel project as the app. | Enables Cloud Functions, Cloud Build and Artifact Registry on the GCP project. |
| Caller authentication | Client sends a Firebase ID token; the handler calls `verifyIdToken(token, true)` (checks revocation). | Callable functions verify the token automatically (`context.auth`). |
| Authorization | Load the caller's `/users/{uid}` with the Admin SDK and reuse `src/lib/batches/scope.ts` (already pure and server-safe). | Same logic, deployed separately. |
| Secrets | Service-account credentials in a server-only Vercel env var (never `NEXT_PUBLIC_`). Better: Workload Identity Federation with Vercel OIDC, so there is no long-lived key. | Runtime service account; no key handling. |
| Code sharing | Same repo, types, Zod schemas and scope helpers. | Separate build target; shares code only through packaging. |
| Main risk | A leaked service-account key bypasses all rules. Mitigate with least privilege, WIF, and key rotation. | Billing exposure and a second deployment surface. |

## 3. Recommendation: Option A

Use Next.js Route Handlers with the Firebase Admin SDK, deployed with the existing Vercel app:
- It is the only option compatible with the Spark plan and the "no billing changes" constraint.
- It adds no new infrastructure.
- It reuses the existing validation and scope code.

Minimum design for the first privileged endpoints (`POST /api/enrollments`, `POST /api/users`):
1. `export const runtime = 'nodejs'` (the Admin SDK does not run on the edge runtime, which is deprecated in this Next version), and `import 'server-only'` in the Admin SDK module.
2. Verify the `Authorization: Bearer <ID token>` with `verifyIdToken(token, /* checkRevoked */ true)`. Reject on any failure (fail closed).
3. Load the caller's profile with the Admin SDK. Require `status == 'active'` and check scope with `canManageBatchScope`.
4. Validate the body with the existing Zod schemas.
5. Perform the write in an Admin SDK transaction. For capacity, keep a counter on the batch (`activeEnrollmentCount`) updated in the same transaction as the enrollment, or count enrollments inside the transaction (Admin SDK transactions support queries).
6. Write an audit document in the same transaction.
7. Then tighten the rules so clients can no longer create enrollments directly (`allow create: if false` for non-super-admins), so the server path is the only path.
8. Credentials: a dedicated service account with only the roles it needs (Firebase Authentication Admin, Cloud Datastore User), supplied through Workload Identity Federation or a server-only env var. Never committed, never logged.

**Considerations, not blockers:**
- Vercel's Hobby plan is for non-commercial use. A commercial academy should check whether it needs Vercel Pro.
- Add rate limiting to account-provisioning endpoints.

## 4. Why it is not implemented in Stage 6.1
- It needs a new dependency (`firebase-admin`) and a credential decision (service-account key vs. Workload Identity Federation). That is an infrastructure and security decision for the project owner.
- A route handler would ship in the production build. Without approved credentials it would only fail closed, which adds surface without adding value.
- The local emulator path could be built safely later: the Admin SDK honours `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` without credentials. The migration applier (`src/lib/migration/apply-enrollment-migration.ts`) is the natural first piece to port.

/**
 * Strynkix LMS — Firebase Admin SDK (server only).
 *
 * - Emulators (FIRESTORE_EMULATOR_HOST set): no credentials are used.
 * - Otherwise: a service account from FIREBASE_ADMIN_PROJECT_ID,
 *   FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY (staging only).
 * - The production project is refused unless an approved procedure sets
 *   ALLOW_PRODUCTION_ADMIN=true (not set anywhere in this repository).
 *
 * Never import this from client code; route.ts files import it behind
 * `import 'server-only'`.
 */

import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';

import { PRODUCTION_PROJECT_ID } from '@/lib/firebase/project-ids';

export { PRODUCTION_PROJECT_ID };
const APP_NAME = 'strynkix-server';

export interface AdminServices {
  app: App;
  db: Firestore;
  auth: Auth;
  projectId: string;
}

let cached: AdminServices | null = null;

export class AdminConfigError extends Error {}

export function resolveAdminProjectId(env: NodeJS.ProcessEnv = process.env): string {
  const projectId = env.FIREBASE_ADMIN_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || '';
  if (!projectId) throw new AdminConfigError('Server Firebase project is not configured.');
  return projectId;
}

/** Throws before any connection is made if the configuration is unsafe. */
export function assertSafeAdminConfig(env: NodeJS.ProcessEnv = process.env): { projectId: string; emulator: boolean } {
  const projectId = resolveAdminProjectId(env);
  const emulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (emulator && !env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new AdminConfigError('FIRESTORE_EMULATOR_HOST is set without FIREBASE_AUTH_EMULATOR_HOST; refusing to verify tokens against a live project.');
  }
  if (!emulator && projectId === PRODUCTION_PROJECT_ID && env.ALLOW_PRODUCTION_ADMIN !== 'true') {
    throw new AdminConfigError('Server-side Admin access to the production project is not enabled.');
  }
  if (!emulator && (!env.FIREBASE_ADMIN_CLIENT_EMAIL || !env.FIREBASE_ADMIN_PRIVATE_KEY)) {
    throw new AdminConfigError('Server Firebase credentials are not configured.');
  }
  return { projectId, emulator };
}

export function getAdminServices(env: NodeJS.ProcessEnv = process.env): AdminServices {
  if (cached) return cached;
  const { projectId, emulator } = assertSafeAdminConfig(env);
  const app = getApps().some((a) => a.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(
        emulator
          ? { projectId }
          : {
              projectId,
              credential: cert({
                projectId,
                clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
                // Env stores the key with literal "\n"; restore real newlines.
                privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, '\n'),
              }),
            },
        APP_NAME
      );
  cached = { app, db: getFirestore(app), auth: getAuth(app), projectId };
  return cached;
}

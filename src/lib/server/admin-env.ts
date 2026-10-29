/**
 * Strynkix LMS — environment lock-down for operator CLIs that use the Admin
 * SDK (export, migration). Call after the target has been validated and before
 * the first getAdminServices(): nothing ambient can then choose another
 * project, credential or endpoint.
 * - Never probe the GCE metadata server: google-auth otherwise tries
 *   169.254.169.254 / metadata.google.internal, even against the emulator.
 * - Ignore Application Default Credentials: the only credential source is
 *   FIREBASE_ADMIN_* (staging); the emulator target uses none at all.
 * Not used by the Next.js server routes (Vercel), whose behaviour is unchanged.
 */
export function pinAdminEnvironment(target: 'emulator' | 'staging', projectId: string, env: NodeJS.ProcessEnv = process.env): void {
  env.METADATA_SERVER_DETECTION = 'none';
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  env.FIREBASE_ADMIN_PROJECT_ID = projectId;
  env.GCLOUD_PROJECT = projectId;
  env.GOOGLE_CLOUD_PROJECT = projectId;
  if (target === 'emulator') {
    delete env.FIREBASE_ADMIN_CLIENT_EMAIL;
    delete env.FIREBASE_ADMIN_PRIVATE_KEY;
    // The Admin guard insists on both emulator hosts; these CLIs never touch Auth.
    env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  }
}

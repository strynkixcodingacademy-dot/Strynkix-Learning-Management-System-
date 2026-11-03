/** Creates the suite's emulator logins and baseline data once per run (Stage C6). */
import { ensureAuthUsers, resetData, PROJECT } from './fixtures';

export default async function globalSetup() {
  if (!PROJECT.startsWith('demo-')) throw new Error('Browser tests run only against a demo- emulator project.');
  if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_EMULATOR_HUB) {
    throw new Error('Start the emulators first: npm run test:e2e');
  }
  await ensureAuthUsers();
  await resetData();
}

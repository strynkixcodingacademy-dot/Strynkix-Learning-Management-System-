/**
 * Strynkix LMS — browser end-to-end tests (Stage C6).
 * Run with `npm run test:e2e`: starts the Auth + Firestore emulators under the
 * dedicated `demo-strynkix-e2e` project, then `next dev` pointed at them.
 * Uses the locally installed Google Chrome (no browser download).
 */

import { defineConfig } from '@playwright/test';

const PORT = 3201;
export const E2E_PROJECT = 'demo-strynkix-e2e';

export default defineConfig({
  testDir: './e2e',
  // Journeys share one emulator dataset and reset it; run them one at a time.
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // A production build served with `next start`: works next to a developer's
  // running `next dev`, and exercises the real compiled app. It rebuilds `.next`
  // with emulator settings, so run `npm run build` again before relying on it.
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    timeout: 600_000,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: E2E_PROJECT,
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_ADMIN_PROJECT_ID: E2E_PROJECT,
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    },
  },
});

/** G52: missing Admin configuration is reported by variable name, never by value. */
import { describe, it, expect } from 'vitest';
import { AdminConfigError, assertSafeAdminConfig, missingAdminVariables } from '@/lib/server/firebase-admin';

describe('Admin configuration errors', () => {
  it('names exactly the missing credential variables', () => {
    expect(missingAdminVariables({ FIREBASE_ADMIN_PROJECT_ID: 'strynkix-live-books-staging' } as unknown as NodeJS.ProcessEnv)).toEqual(['FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY']);
    expect(missingAdminVariables({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'x', FIREBASE_ADMIN_CLIENT_EMAIL: 'a', FIREBASE_ADMIN_PRIVATE_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toEqual([]);
    expect(() => assertSafeAdminConfig({ FIREBASE_ADMIN_PROJECT_ID: 'strynkix-live-books-staging', FIREBASE_ADMIN_CLIENT_EMAIL: 'sa@x' } as unknown as NodeJS.ProcessEnv))
      .toThrow(/FIREBASE_ADMIN_PRIVATE_KEY/);
  });
  it('never echoes a value in the error', () => {
    try {
      assertSafeAdminConfig({ FIREBASE_ADMIN_PROJECT_ID: 'strynkix-live-books-staging', FIREBASE_ADMIN_PRIVATE_KEY: 'SECRET-VALUE' } as unknown as NodeJS.ProcessEnv);
    } catch (err) {
      expect(err).toBeInstanceOf(AdminConfigError);
      expect((err as Error).message).not.toContain('SECRET-VALUE');
    }
  });
  it('still refuses production', () => {
    expect(() => assertSafeAdminConfig({ FIREBASE_ADMIN_PROJECT_ID: 'learning-management-syst-b9bf3', FIREBASE_ADMIN_CLIENT_EMAIL: 'a', FIREBASE_ADMIN_PRIVATE_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toThrow(/production/);
  });
});

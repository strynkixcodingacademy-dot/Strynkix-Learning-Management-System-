/**
 * Strynkix LMS — Firebase Environment Configuration Validator
 * Validates public client configuration and emulator flags.
 */

import { z } from 'zod';

const firebaseEnvSchema = z.object({
  apiKey: z.string().min(1, 'NEXT_PUBLIC_FIREBASE_API_KEY is required in production'),
  authDomain: z.string().min(1, 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN is required in production'),
  projectId: z.string().min(1, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID is required'),
  storageBucket: z.string().optional(),
  messagingSenderId: z.string().optional(),
  appId: z.string().optional(),
  measurementId: z.string().optional(),
  useEmulator: z.boolean(),
  authEmulatorHost: z.string().optional(),
  firestoreEmulatorHost: z.string().optional(),
});

export type FirebaseClientConfig = z.infer<typeof firebaseEnvSchema>;

export function getFirebaseConfig(): FirebaseClientConfig {
  const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';

  // In emulator, build-time, or dev mode, provide safe placeholders if environment variables are unset
  const isPrerenderOrServer = typeof window === 'undefined';
  const defaultProjectId = 'learning-management-syst-b9bf3';

  const rawConfig = {
    apiKey:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      (useEmulator || isPrerenderOrServer ? 'build-mock-api-key' : ''),
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
      (useEmulator || isPrerenderOrServer ? `${defaultProjectId}.firebaseapp.com` : ''),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || defaultProjectId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
    useEmulator,
    authEmulatorHost: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
    firestoreEmulatorHost: process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
  };

  // Only enforce strict validation in live production browser environments
  if (!useEmulator && process.env.NODE_ENV === 'production' && !isPrerenderOrServer) {
    const result = firebaseEnvSchema.safeParse(rawConfig);
    if (!result.success) {
      console.error('Invalid Firebase configuration in production browser:', result.error.format());
      throw new Error('Firebase configuration validation failed.');
    }
    return result.data;
  }

  return rawConfig;
}

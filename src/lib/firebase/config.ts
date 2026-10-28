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

  // Staging public web client configuration fallback (for hosting environments like Vercel where .env.local is omitted)
  const defaultProjectId = 'strynkix-live-books-staging';
  const defaultApiKey = 'AIzaSyBlSt-d1Muunm9dDA2jHgW7zwOPuwngyCI';
  const defaultAuthDomain = 'strynkix-live-books-staging.firebaseapp.com';
  const defaultStorageBucket = 'strynkix-live-books-staging.firebasestorage.app';
  const defaultMessagingSenderId = '490375217281';
  const defaultAppId = '1:490375217281:web:777d784f5a4597fa1f8d80';
  const defaultMeasurementId = 'G-ZS9FDW7Q8E';

  const rawConfig = {
    apiKey:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      (useEmulator ? 'build-mock-api-key' : defaultApiKey),
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
      (useEmulator ? `${defaultProjectId}.firebaseapp.com` : defaultAuthDomain),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || defaultProjectId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || defaultStorageBucket,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || defaultMessagingSenderId,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || defaultAppId,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || defaultMeasurementId,
    useEmulator,
    authEmulatorHost: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
    firestoreEmulatorHost: process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
  };

  // Only enforce strict validation in live production browser environments
  const isPrerenderOrServer = typeof window === 'undefined';
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

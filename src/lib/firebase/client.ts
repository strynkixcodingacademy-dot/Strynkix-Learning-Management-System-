/**
 * Strynkix LMS — Firebase Client SDK Initialization
 * Initializes the client SDK with automatic fallback to local Emulators
 * when NEXT_PUBLIC_USE_FIREBASE_EMULATOR is enabled.
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from 'firebase/firestore';
import { getFirebaseConfig } from './config';

const config = getFirebaseConfig();

const app: FirebaseApp =
  getApps().length === 0
    ? initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
        measurementId: config.measurementId,
      })
    : getApp();

const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app);

// Connect to Emulators if configured and running client-side
if (config.useEmulator && typeof window !== 'undefined') {
  const [authHost, authPort] = config.authEmulatorHost?.split(':') || ['127.0.0.1', '9099'];
  const [dbHost, dbPort] = config.firestoreEmulatorHost?.split(':') || ['127.0.0.1', '8080'];

  // Prevent multiple emulator connections in hot-reloading dev environment
  const globalWithEmulators = window as unknown as {
    _FIREBASE_EMULATORS_CONNECTED_?: boolean;
  };

  if (!globalWithEmulators._FIREBASE_EMULATORS_CONNECTED_) {
    try {
      connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true });
      connectFirestoreEmulator(db, dbHost, Number(dbPort));
      globalWithEmulators._FIREBASE_EMULATORS_CONNECTED_ = true;
      console.info(`[Firebase Client] Connected to local Emulators (Auth: ${authHost}:${authPort}, Firestore: ${dbHost}:${dbPort})`);
    } catch (err) {
      console.warn('[Firebase Client] Emulator connection warning:', err);
    }
  }
}

export { app, auth, db };

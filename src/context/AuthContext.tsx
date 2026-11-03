'use client';

/**
 * Strynkix LMS — Client Authentication Context & Observer
 * Manages Firebase Auth observer lifecycle, asynchronous Firestore profile
 * synchronization, race-condition mitigation, and safe state transitions.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { AuthContextValue, AuthStatus, TenantContext } from '@/types/auth';
import { UserProfile } from '@/types/domain';
import { validateUserProfile, formatAuthError } from '@/lib/auth/profile';
import { setAcademyTimeZone } from '@/lib/learning/metrics';
import { syncOwnEmail } from '@/lib/account/service';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  // Counter to prevent stale asynchronous profile reads from overwriting a newer auth state
  const activeSequenceRef = useRef<number>(0);
  // Live listener on the signed-in user's own profile (milestone G08).
  const profileListenerRef = useRef<(() => void) | null>(null);
  const stopProfileListener = useCallback(() => {
    profileListenerRef.current?.();
    profileListenerRef.current = null;
  }, []);

  /**
   * Applies a later change to the signed-in user's profile without a reload:
   * suspension, reactivation, role, academy or branch changes, or deletion.
   * Firestore rules and the server routes remain the actual enforcement; this
   * only keeps the screen in step with them.
   */
  const applyLiveProfile = useCallback((firebaseUser: User, snap: DocumentSnapshot) => {
    if (!snap.exists()) {
      setProfile(null);
      setTenant(null);
      setStatus('no_profile');
      setError('Your account is authenticated, but no Strynkix LMS profile has been assigned.');
      return;
    }
    const validation = validateUserProfile(firebaseUser.uid, snap.data() as Record<string, unknown>);
    if (!validation.isValid || !validation.profile) {
      setProfile(null);
      setTenant(null);
      setStatus('error');
      setError(validation.error || 'User profile data is invalid or malformed.');
      return;
    }
    setProfile(validation.profile);
    if (validation.isSuspended) {
      setTenant(null);
      setStatus('suspended');
      setError(validation.error || 'Your account has been suspended. Please contact your academy administrator.');
      return;
    }
    const next = validation.profile;
    setTenant((t) => (t && t.orgId === next.orgId && t.branchId === next.branchId && t.role === next.role ? t : { orgId: next.orgId, branchId: next.branchId, role: next.role }));
    setStatus('authenticated');
    setError(null);
  }, []);

  const startProfileListener = useCallback((firebaseUser: User, sequenceId: number) => {
    stopProfileListener();
    profileListenerRef.current = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (sequenceId === activeSequenceRef.current) applyLiveProfile(firebaseUser, snap);
      },
      (err) => console.warn('[AuthContext] Live profile updates stopped:', err.code ?? 'error')
    );
  }, [applyLiveProfile, stopProfileListener]);

  /**
   * Loads the Firestore profile for a given Firebase Auth user.
   * Guarantees race-condition safety via sequence tokens.
   */
  const loadUserProfile = useCallback(async (firebaseUser: User | null) => {
    const sequenceId = ++activeSequenceRef.current;
    stopProfileListener();

    if (!firebaseUser) {
      setUser(null);
      setProfile(null);
      setTenant(null);
      setStatus('unauthenticated');
      setError(null);
      return;
    }

    setUser(firebaseUser);
    setStatus('loading');
    setError(null);

    try {
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      const docSnapshot = await getDoc(userDocRef);

      // Verify that this asynchronous result matches the latest active auth state
      if (sequenceId !== activeSequenceRef.current) {
        return;
      }

      if (!docSnapshot.exists()) {
        // Authenticated in Firebase Auth, but no LMS record provisioned in Firestore.
        // SECURITY INVARIANT: Do NOT auto-create a profile or grant default access.
        setProfile(null);
        setTenant(null);
        setStatus('no_profile');
        setError('Your account is authenticated, but no Strynkix LMS profile has been assigned.');
        return;
      }

      const rawData = docSnapshot.data() as Record<string, unknown>;
      const validation = validateUserProfile(firebaseUser.uid, rawData);

      if (sequenceId !== activeSequenceRef.current) {
        return;
      }

      if (!validation.isValid || !validation.profile) {
        setProfile(null);
        setTenant(null);
        setStatus('error');
        setError(validation.error || 'User profile data is invalid or malformed.');
        return;
      }

      if (validation.isSuspended) {
        setProfile(validation.profile);
        setTenant(null);
        setStatus('suspended');
        setError(validation.error || 'Your account has been suspended. Please contact your academy administrator.');
        // Keep listening: a reactivation applies without signing in again.
        startProfileListener(firebaseUser, sequenceId);
        return;
      }

      // Academy time zone (D4) must be known before any page computes "today".
      try {
        const org = await getDoc(doc(db, 'organizations', validation.profile.orgId));
        setAcademyTimeZone(org.exists() ? (org.data().settings?.defaultTimezone as string | undefined) : undefined);
      } catch {
        setAcademyTimeZone(undefined);
      }
      if (sequenceId !== activeSequenceRef.current) {
        return;
      }

      // Valid, active profile loaded
      setProfile(validation.profile);
      setTenant({
        orgId: validation.profile.orgId,
        branchId: validation.profile.branchId,
        role: validation.profile.role,
      });
      setStatus('authenticated');
      setError(null);
      startProfileListener(firebaseUser, sequenceId);
      // A verified email change made from My Profile (G06) is copied to the profile by the server.
      if (firebaseUser.email && firebaseUser.email.toLowerCase() !== validation.profile.email.toLowerCase()) {
        syncOwnEmail().catch(() => { /* retried on the next sign-in */ });
      }
    } catch (err: unknown) {
      if (sequenceId !== activeSequenceRef.current) {
        return;
      }

      console.error('[AuthContext] Failed to load user profile document:', err);
      setProfile(null);
      setTenant(null);
      setStatus('error');
      setError('Failed to load profile. Please verify your network connection.');
    }
  }, [startProfileListener, stopProfileListener]);

  // Listen to Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        loadUserProfile(currentUser);
      },
      (authError) => {
        console.error('[AuthContext] Firebase Auth observer error:', authError);
        setStatus('error');
        const code = 'code' in authError ? (authError as { code: string }).code : '';
        setError(formatAuthError(code));
      }
    );

    return () => {
      unsubscribe();
      stopProfileListener();
    };
  }, [loadUserProfile, stopProfileListener]);

  /**
   * Signs in a user with email and password.
   * Credentials are never stored or logged.
   */
  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      setError(null);
      setStatus('loading');

      try {
        const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
        await loadUserProfile(userCredential.user);
      } catch (err: unknown) {
        const firebaseErr = err as { code?: string; message?: string };
        const safeMessage = formatAuthError(firebaseErr.code || '');
        setError(safeMessage);
        setStatus('unauthenticated');
        throw new Error(safeMessage);
      }
    },
    [loadUserProfile]
  );

  /**
   * Signs out the currently authenticated user.
   */
  const signOut = useCallback(async (): Promise<void> => {
    try {
      stopProfileListener();
      await firebaseSignOut(auth);
      activeSequenceRef.current++;
      setUser(null);
      setProfile(null);
      setTenant(null);
      setStatus('unauthenticated');
      setError(null);
    } catch (err) {
      console.error('[AuthContext] Sign out error:', err);
      throw new Error('Sign out failed. Please try again.');
    }
  }, [stopProfileListener]);

  /**
   * Refreshes the active user's profile from Firestore.
   */
  const refreshProfile = useCallback(async (): Promise<void> => {
    if (auth.currentUser) {
      await loadUserProfile(auth.currentUser);
    }
  }, [loadUserProfile]);

  const value: AuthContextValue = {
    user,
    profile,
    tenant,
    status,
    error,
    signIn,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access the authenticated session context.
 * Must be used within an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
}

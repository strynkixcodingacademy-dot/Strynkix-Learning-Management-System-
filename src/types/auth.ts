/**
 * Strynkix LMS — Authentication & Session Context Types
 * Strongly typed representation of authentication states, user profiles,
 * and multi-tenant authorization boundaries.
 */

import { User } from 'firebase/auth';
import { UserProfile, UserRole } from './domain';

export type AuthStatus =
  | 'loading'          // Initial observer check in progress
  | 'unauthenticated'  // No active Firebase Auth session
  | 'authenticated'    // Valid Firebase Auth user with active LMS profile
  | 'no_profile'       // Valid Firebase Auth user, but no profile provisioned in Firestore
  | 'suspended'        // Profile found, but account status is suspended or inactive
  | 'error';           // Error occurred during authentication or profile loading

export interface TenantContext {
  orgId: string;
  branchId?: string;
  role: UserRole;
}

export interface AuthContextValue {
  /** The raw Firebase Auth user instance (or null) */
  user: User | null;
  /** The verified LMS UserProfile loaded from Firestore /users/{uid} */
  profile: UserProfile | null;
  /** Derived tenant and role boundaries for convenient UI binding */
  tenant: TenantContext | null;
  /** Current authentication lifecycle status */
  status: AuthStatus;
  /** Human-readable error message, if status is 'error' or 'suspended' */
  error: string | null;
  /** Authenticate using email and password */
  signIn: (email: string, password: string) => Promise<void>;
  /** Sign out of the current session */
  signOut: () => Promise<void>;
  /** Force refresh the Firestore user profile document */
  refreshProfile: () => Promise<void>;
}

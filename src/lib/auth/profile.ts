/**
 * Strynkix LMS — User Profile Parser & Validator
 * Validates Firestore profile documents, checks status, and protects against
 * malformed or unauthorized state.
 */

import { UserProfile, UserRole } from '@/types/domain';

const VALID_ROLES: UserRole[] = [
  'super_admin',
  'university_admin',
  'branch_admin',
  'instructor',
  'student',
];

export interface ProfileValidationResult {
  isValid: boolean;
  profile: UserProfile | null;
  isSuspended: boolean;
  error?: string;
}

/**
 * Validates raw Firestore document data against the UserProfile contract.
 * Never grants default administrative roles or assumes validity.
 */
export function validateUserProfile(
  uid: string,
  data: Record<string, unknown> | undefined
): ProfileValidationResult {
  if (!data) {
    return {
      isValid: false,
      profile: null,
      isSuspended: false,
      error: 'Profile document does not exist in Firestore.',
    };
  }

  // Check required core fields
  const role = data.role as UserRole;
  const orgId = typeof data.orgId === 'string' ? data.orgId.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  const status = typeof data.status === 'string' ? data.status : 'active';
  const branchId = typeof data.branchId === 'string' ? data.branchId.trim() : undefined;

  if (!orgId) {
    return {
      isValid: false,
      profile: null,
      isSuspended: false,
      error: 'Profile is missing required tenant boundary (orgId).',
    };
  }

  if (!VALID_ROLES.includes(role)) {
    return {
      isValid: false,
      profile: null,
      isSuspended: false,
      error: `Profile contains unrecognized or invalid role: ${String(data.role)}`,
    };
  }

  // Branch manager and student require a branchId
  if ((role === 'branch_admin' || role === 'student') && !branchId) {
    return {
      isValid: false,
      profile: null,
      isSuspended: false,
      error: `Role "${role}" requires an assigned branchId.`,
    };
  }

  // Check account status. Mirrors isAccountActive() in firestore.rules: any
  // status other than 'active' (suspended, invited, pending_verification) blocks access.
  const isSuspended = status !== 'active';
  const isAwaitingActivation = status === 'pending_verification' || status === 'invited';

  const profile: UserProfile = {
    id: uid,
    orgId,
    branchId,
    role,
    email: email || '',
    displayName: displayName || 'Academy Member',
    photoURL: typeof data.photoURL === 'string' ? data.photoURL : undefined,
    phoneNumber: typeof data.phoneNumber === 'string' ? data.phoneNumber : undefined,
    status: isAwaitingActivation ? (status as UserProfile['status']) : isSuspended ? 'suspended' : 'active',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };

  let error: string | undefined;
  if (isAwaitingActivation) {
    error = 'Your account is awaiting activation by an academy administrator.';
  } else if (isSuspended) {
    error = 'This account has been suspended by the academy administrator.';
  }

  return {
    isValid: true,
    profile,
    isSuspended,
    error,
  };
}

/**
 * Maps Firebase Auth error codes to safe, human-readable messages without leaking
 * account existence or internal configuration details.
 */
export function formatAuthError(errorCode: string): string {
  switch (errorCode) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password. Please verify your credentials.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/too-many-requests':
      return 'Too many failed login attempts. Access has been temporarily locked for security. Please try again later.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/network-request-failed':
      return 'Network error connecting to authentication service. Please check your connection.';
    default:
      return 'An error occurred during authentication. Please try again.';
  }
}

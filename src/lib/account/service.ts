/**
 * Strynkix LMS — account self-service and people management.
 * Self-service only touches the presentation fields the rules allow
 * (displayName, phoneNumber, updatedAt). People queries are scoped exactly as
 * the /users and /enrollments rules require for each role.
 */

import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, db } from '@/lib/firebase/client';
import { TenantContext } from '@/types/auth';
import { Enrollment, UserProfile, UserStatus } from '@/types/domain';

export interface OwnProfileInput {
  displayName: string;
  phoneNumber: string;
}

/** Returns an error message, or null when the input is valid. */
export function validateOwnProfile(input: OwnProfileInput): string | null {
  const name = input.displayName.trim();
  if (name.length < 2) return 'Display name must be at least 2 characters.';
  if (name.length > 100) return 'Display name must be 100 characters or fewer.';
  const phone = input.phoneNumber.trim();
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) return 'Enter a phone number with digits only, e.g. +91 98765 43210.';
  return null;
}

export async function updateOwnProfile(uid: string, input: OwnProfileInput): Promise<void> {
  const error = validateOwnProfile(input);
  if (error) throw new Error(error);
  await updateDoc(doc(db, 'users', uid), {
    displayName: input.displayName.trim(),
    phoneNumber: input.phoneNumber.trim(),
    updatedAt: new Date().toISOString(),
  });
}

export async function sendOwnPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

// -----------------------------------------------------------------------------
// People
// -----------------------------------------------------------------------------

export const PEOPLE_ROLES = ['student', 'instructor', 'branch_admin'] as const;

/** Users the caller may manage, with the same scoping the rules enforce. */
export async function getPeople(tenant: TenantContext): Promise<UserProfile[]> {
  const coll = collection(db, 'users');
  let q;
  if (tenant.role === 'super_admin') q = query(coll, where('orgId', '==', tenant.orgId));
  else if (tenant.role === 'branch_admin' && tenant.branchId) q = query(coll, where('orgId', '==', tenant.orgId), where('branchId', '==', tenant.branchId));
  else return [];
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as UserProfile))
    .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
}

/** Enrollments in the caller's scope, used to show which batches each student is in. */
export async function getScopeEnrollments(tenant: TenantContext): Promise<Enrollment[]> {
  const coll = collection(db, 'enrollments');
  let q;
  if (tenant.role === 'super_admin') q = query(coll, where('orgId', '==', tenant.orgId));
  else if (tenant.role === 'branch_admin' && tenant.branchId) q = query(coll, where('orgId', '==', tenant.orgId), where('branchId', '==', tenant.branchId));
  else return [];
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));
}

export type StatusAction = 'approve' | 'suspend' | 'reactivate';

/** Which status change is offered for a person, or null when none applies. */
export function statusActionFor(person: UserProfile, viewer: { uid: string; role: TenantContext['role'] }): StatusAction | null {
  if (person.id === viewer.uid) return null;
  if (person.role === 'super_admin' || person.role === 'university_admin') return null;
  if (viewer.role === 'branch_admin' && !['student', 'instructor'].includes(person.role)) return null;
  if (person.status === 'pending_verification' || person.status === 'invited') return 'approve';
  if (person.status === 'active') return 'suspend';
  if (person.status === 'suspended') return 'reactivate';
  return null;
}

const NEXT_STATUS: Record<StatusAction, UserStatus> = { approve: 'active', suspend: 'suspended', reactivate: 'active' };

export async function changePersonStatus(person: UserProfile, action: StatusAction): Promise<UserStatus> {
  const status = NEXT_STATUS[action];
  await updateDoc(doc(db, 'users', person.id), { status, updatedAt: new Date().toISOString() });
  return status;
}

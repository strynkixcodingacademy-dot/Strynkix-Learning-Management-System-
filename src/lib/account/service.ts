/**
 * Strynkix LMS — account self-service and people management.
 * Self-service only touches the presentation fields the rules allow
 * (displayName, phoneNumber, updatedAt). People queries are scoped exactly as
 * the /users and /enrollments rules require for each role.
 */

import { collection, doc, getCountFromServer, getDocs, limit, orderBy, query, startAfter, updateDoc, where, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail, updatePassword, verifyBeforeUpdateEmail } from 'firebase/auth';
import { auth, db } from '@/lib/firebase/client';
import { postWithIdToken } from '@/lib/api/authed';
import { TenantContext } from '@/types/auth';
import { Enrollment, UserProfile, UserRole, UserStatus } from '@/types/domain';

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
  if (tenant.role === 'super_admin' || tenant.role === 'university_admin') q = query(coll, where('orgId', '==', tenant.orgId));
  else if (tenant.role === 'branch_admin' && tenant.branchId) q = query(coll, where('orgId', '==', tenant.orgId), where('branchId', '==', tenant.branchId));
  else return [];
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as UserProfile))
    .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
}

// -----------------------------------------------------------------------------
// People pagination (milestone G14): filters run in Firestore, one page at a time.
// -----------------------------------------------------------------------------
export const PEOPLE_PAGE_SIZE = 25;
export type PeopleRoleFilter = 'all' | 'student' | 'instructor' | 'branch_admin' | 'content';
export type PeopleStatusFilter = 'all' | 'active' | 'pending' | 'suspended';
const CONTENT_ROLES: UserRole[] = ['content_lead', 'content_designer'];

/** Roles each manager sees on the People page (academy admins and the content team are Super-Admin-managed). */
export function visiblePeopleRoles(role: UserRole): UserRole[] {
  if (role === 'super_admin') return ['branch_admin', 'instructor', 'student', ...CONTENT_ROLES];
  if (role === 'university_admin') return ['branch_admin', 'instructor', 'student'];
  if (role === 'branch_admin') return ['instructor', 'student'];
  return [];
}

function scopeConstraints(tenant: TenantContext): QueryConstraint[] | null {
  if (tenant.role === 'super_admin' || tenant.role === 'university_admin') return [where('orgId', '==', tenant.orgId)];
  if (tenant.role === 'branch_admin' && tenant.branchId) return [where('orgId', '==', tenant.orgId), where('branchId', '==', tenant.branchId)];
  return null;
}

function roleConstraint(tenant: TenantContext, role: PeopleRoleFilter): QueryConstraint {
  const visible = visiblePeopleRoles(tenant.role);
  if (role === 'all') return where('role', 'in', visible);
  if (role === 'content') return where('role', 'in', CONTENT_ROLES.filter((r) => visible.includes(r)));
  return where('role', '==', visible.includes(role) ? role : '__none__');
}

function statusConstraints(status: PeopleStatusFilter): QueryConstraint[] {
  if (status === 'active') return [where('status', '==', 'active')];
  if (status === 'suspended') return [where('status', '==', 'suspended')];
  if (status === 'pending') return [where('status', 'in', ['pending_verification', 'invited'])];
  return [];
}

export interface PeoplePage { people: UserProfile[]; cursor: QueryDocumentSnapshot | null; hasMore: boolean }

export async function getPeoplePage(
  tenant: TenantContext,
  filters: { role: PeopleRoleFilter; status: PeopleStatusFilter; email?: string },
  after: QueryDocumentSnapshot | null,
  pageSize = PEOPLE_PAGE_SIZE
): Promise<PeoplePage> {
  const scope = scopeConstraints(tenant);
  if (!scope) return { people: [], cursor: null, hasMore: false };
  const email = filters.email?.trim().toLowerCase();
  const snap = await getDocs(query(collection(db, 'users'),
    ...scope, roleConstraint(tenant, filters.role), ...statusConstraints(filters.status),
    // A full email names one person: equality filters only, no ordering (no extra index).
    ...(email ? [where('email', '==', email), limit(pageSize + 1)] : [orderBy('displayName'), ...(after ? [startAfter(after)] : []), limit(pageSize + 1)])));
  const docs = snap.docs.slice(0, pageSize);
  return { people: docs.map((d) => ({ id: d.id, ...d.data() } as UserProfile)), cursor: docs.length ? docs[docs.length - 1] : null, hasMore: snap.docs.length > pageSize };
}

/** Totals for the People tiles, counted by Firestore (no documents are read). */
export async function countPeople(tenant: TenantContext): Promise<{ students: number; instructors: number; pending: number; suspended: number }> {
  const scope = scopeConstraints(tenant);
  if (!scope) return { students: 0, instructors: 0, pending: 0, suspended: 0 };
  const count = async (...c: QueryConstraint[]) => (await getCountFromServer(query(collection(db, 'users'), ...scope, ...c))).data().count;
  const [students, instructors, pending, suspended] = await Promise.all([
    count(where('role', '==', 'student')),
    count(where('role', '==', 'instructor')),
    count(roleConstraint(tenant, 'all'), ...statusConstraints('pending')),
    count(roleConstraint(tenant, 'all'), ...statusConstraints('suspended')),
  ]);
  return { students, instructors, pending, suspended };
}

/** Enrollments of the given students only (the page on screen), in the caller's scope. */
export async function getEnrollmentsForStudents(tenant: TenantContext, studentIds: string[]): Promise<Enrollment[]> {
  const scope = scopeConstraints(tenant);
  if (!scope || !studentIds.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < studentIds.length; i += 30) chunks.push(studentIds.slice(i, i + 30));
  const snaps = await Promise.all(chunks.map((ids) => getDocs(query(collection(db, 'enrollments'), ...scope, where('studentId', 'in', ids)))));
  return snaps.flatMap((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment)));
}

/** Enrollments in the caller's scope, used to show which batches each student is in. */
export async function getScopeEnrollments(tenant: TenantContext): Promise<Enrollment[]> {
  const coll = collection(db, 'enrollments');
  let q;
  if (tenant.role === 'super_admin' || tenant.role === 'university_admin') q = query(coll, where('orgId', '==', tenant.orgId));
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
  // Mirrors canChangeAccountStatus on the server: academy admins manage branch roles only.
  if (viewer.role === 'university_admin' && !['branch_admin', 'student', 'instructor'].includes(person.role)) return null;
  if (person.status === 'pending_verification' || person.status === 'invited') return 'approve';
  if (person.status === 'active') return 'suspend';
  if (person.status === 'suspended') return 'reactivate';
  return null;
}

const NEXT_STATUS: Record<StatusAction, UserStatus> = { approve: 'active', suspend: 'suspended', reactivate: 'active' };

/**
 * Approves, suspends or reactivates an account through the audited server route
 * (Stage C5). Suspension also revokes Course Design membership and ends the
 * user's sessions.
 */
export async function changePersonStatus(person: UserProfile, action: StatusAction): Promise<UserStatus> {
  const res = await postWithIdToken<{ status: UserStatus }>('/api/admin/account-status', { userId: person.id, action });
  return res.status ?? NEXT_STATUS[action];
}

const AUTH_MESSAGES: Record<string, string> = {
  'auth/wrong-password': 'Your current password is incorrect.',
  'auth/invalid-credential': 'Your current password is incorrect.',
  'auth/weak-password': 'Choose a stronger password (at least 8 characters).',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/requires-recent-login': 'For your security, sign out and sign in again, then retry.',
  'auth/email-already-in-use': 'Another account already uses that email address.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/network-request-failed': 'We couldn’t reach the server. Check your connection and try again.',
  'auth/operation-not-allowed': 'Email changes aren’t enabled for this academy. Ask your administrator to update it.',
};

function authMessage(err: unknown, fallback: string): Error {
  const code = (err as { code?: string }).code ?? '';
  return new Error(AUTH_MESSAGES[code] ?? fallback);
}

/** Confirms the current password (Firebase requires a recent sign-in for sensitive changes). Never stored or logged. */
async function reauthenticate(currentPassword: string) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Sign in again to continue.');
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  } catch (err) {
    throw authMessage(err, 'We couldn’t confirm your current password.');
  }
  return user;
}

/** Milestone G05: change your own password while signed in. */
export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error('Choose a password of at least 8 characters.');
  if (newPassword === currentPassword) throw new Error('Choose a password different from your current one.');
  const user = await reauthenticate(currentPassword);
  try {
    await updatePassword(user, newPassword);
  } catch (err) {
    throw authMessage(err, 'Your password couldn’t be changed.');
  }
}

/**
 * Milestone G06: change your own sign-in email. Firebase sends a verification
 * link to the new address; the email changes only when it is opened, and the
 * profile is updated by the server on the next sign-in (syncOwnEmail).
 */
export async function requestOwnEmailChange(currentPassword: string, newEmail: string): Promise<void> {
  const email = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email address.');
  const user = await reauthenticate(currentPassword);
  if (email === user.email?.toLowerCase()) throw new Error('That is already your email address.');
  try {
    await verifyBeforeUpdateEmail(user, email);
  } catch (err) {
    throw authMessage(err, 'We couldn’t start the email change.');
  }
}

/** Copies a verified sign-in email change onto the profile (server-side, audited). */
export async function syncOwnEmail(): Promise<{ email: string; changed: boolean }> {
  return postWithIdToken('/api/account/email-sync', {});
}


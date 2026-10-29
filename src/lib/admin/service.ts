/**
 * Strynkix LMS — Administrative Firestore Service Layer
 * Secure, schema-validated operations for organizations, branches, and tenant topology.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  arrayUnion,
  query,
  where,
} from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase/client';
import { getFirebaseConfig } from '@/lib/firebase/config';
import { Organization, Branch, Course, CourseDesignProfile, UserProfile } from '@/types/domain';
import { organizationSchema, branchSchema } from '@/types/validation';
import { validateUserProfile } from '@/lib/auth/profile';
import { postWithIdToken } from '@/lib/api/authed';
import {
  ALL_COURSES,
  Actor,
  MembershipInput,
  validateMembershipAssignment,
  validateMembershipRevocation,
} from './course-design';

// Firestore rejects `undefined` field values, and Zod keeps optional keys as
// `undefined`, so blank optional form fields must be dropped before writing.
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Loads all organizations from Firestore.
 * Requires super_admin privilege according to Firestore Security Rules.
 */
export async function getOrganizations(): Promise<Organization[]> {
  const orgsCollection = collection(db, 'organizations');
  const snap = await getDocs(orgsCollection);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Organization));
}

/**
 * Loads a single organization by ID.
 * Accessible to super_admin or active members of that organization.
 */
export async function getOrganization(orgId: string): Promise<Organization | null> {
  const orgDocRef = doc(db, 'organizations', orgId);
  const snap = await getDoc(orgDocRef);
  if (!snap.exists()) {
    return null;
  }
  return { id: snap.id, ...snap.data() } as Organization;
}

/**
 * Creates or updates an organization in Firestore.
 * Strictly validates against organizationSchema before issuing writes.
 * Requires super_admin privilege.
 */
export async function createOrganization(params: {
  id: string;
  name: string;
  slug: string;
  website?: string;
  logoUrl?: string;
  defaultTimezone?: string;
  allowedEmailDomains?: string[];
  liveBooksEnabled?: boolean;
}): Promise<Organization> {
  const now = new Date().toISOString();

  // Validate payload
  const rawOrg = {
    name: params.name,
    slug: params.slug,
    website: params.website ? params.website : undefined,
    logoUrl: params.logoUrl ? params.logoUrl : undefined,
    status: 'active' as const,
    settings: {
      allowedEmailDomains: params.allowedEmailDomains || [],
      defaultTimezone: params.defaultTimezone || 'Asia/Kolkata',
      features: {
        liveBooksEnabled: params.liveBooksEnabled ?? true,
        interactivePlaygrounds: true,
        peerReviews: false,
      },
    },
  };

  const validation = organizationSchema.safeParse(rawOrg);
  if (!validation.success) {
    const errorMsg = validation.error.issues.map((i) => i.message).join('; ');
    throw new Error(`Invalid organization data: ${errorMsg}`);
  }

  const orgDocRef = doc(db, 'organizations', params.id);
  const orgRecord: Organization = withoutUndefined({
    id: params.id,
    ...validation.data,
    createdAt: now,
    updatedAt: now,
  });

  await setDoc(orgDocRef, orgRecord);
  return orgRecord;
}

/**
 * Loads branches from Firestore.
 * If orgId is provided, filters by tenant boundary.
 */
export async function getBranches(orgId?: string): Promise<Branch[]> {
  const branchesRef = collection(db, 'branches');
  const branchesQuery = orgId
    ? query(branchesRef, where('orgId', '==', orgId))
    : branchesRef;

  const snap = await getDocs(branchesQuery);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Branch));
}

/**
 * Creates a branch under an organization.
 * Validates payload against branchSchema.
 * Enforces organization existence and tenant boundaries.
 */
export async function createBranch(params: {
  id: string;
  orgId: string;
  name: string;
  code: string;
  city?: string;
  state?: string;
  country: string;
  isRemote?: boolean;
  branchAdminUserIds?: string[];
}): Promise<Branch> {
  const now = new Date().toISOString();

  const rawBranch = {
    orgId: params.orgId,
    name: params.name,
    code: params.code,
    location: {
      city: params.city || undefined,
      state: params.state || undefined,
      country: params.country,
      isRemote: params.isRemote ?? false,
    },
    branchAdminUserIds: params.branchAdminUserIds || [],
    status: 'active' as const,
  };

  const validation = branchSchema.safeParse(rawBranch);
  if (!validation.success) {
    const errorMsg = validation.error.issues.map((i) => i.message).join('; ');
    throw new Error(`Invalid branch data: ${errorMsg}`);
  }

  const branchDocRef = doc(db, 'branches', params.id);
  const branchRecord: Branch = withoutUndefined({
    id: params.id,
    ...validation.data,
    location: withoutUndefined(validation.data.location),
    createdAt: now,
    updatedAt: now,
  });

  await setDoc(branchDocRef, branchRecord);
  return branchRecord;
}

// -----------------------------------------------------------------------------
// Account provisioning
// -----------------------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 8;

export interface ProvisionInput {
  email: string;
  password: string;
  displayName: string;
  orgId: string;
  /** Required for branch roles; content team accounts are academy-wide. */
  branchId: string;
  /** Optional Course Design membership; never defaulted. Super Admin only (enforced by rules). */
  courseDesign?: MembershipInput;
}

export interface ProvisionedAccount {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  branchId: string;
  orgId: string;
  /** True when an existing account of the same role in this branch was reused. */
  existing?: boolean;
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';

/**
 * Temporary password from the browser's cryptographic RNG (rejection sampling,
 * so every character is equally likely). New users should change it on first
 * sign-in with the reset link.
 */
export function generateTempPassword(length = 14): string {
  const out: string[] = [];
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  const bytes = new Uint8Array(1);
  while (out.length < length) {
    crypto.getRandomValues(bytes);
    if (bytes[0] < limit) out.push(PASSWORD_ALPHABET[bytes[0] % PASSWORD_ALPHABET.length]);
  }
  return out.join('');
}

/** Returns an error message for invalid input, or null. */
export function validateProvisionInput(input: ProvisionInput): string | null {
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address.';
  if (input.displayName.trim().length < 2) return 'Please enter a full name (at least 2 characters).';
  if (input.password.trim().length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  return null;
}

type ProvisionRole = 'branch_admin' | 'instructor' | 'student' | 'content_lead' | 'content_designer';
const ACADEMY_WIDE: ProvisionRole[] = ['content_lead', 'content_designer'];

/**
 * Creates the Firebase Auth login on a throwaway secondary app (so the admin
 * stays signed in), then writes the profile with the ADMIN's session, so the
 * Firestore rules decide whether this admin may create this role in this
 * branch. If the profile write fails, the new login is deleted again so a
 * retry doesn't hit "email already exists" for an account nobody can use.
 */
async function provisionAccount(role: ProvisionRole, params: ProvisionInput): Promise<ProvisionedAccount> {
  const invalid = validateProvisionInput(params);
  if (invalid) throw new Error(invalid);
  if (params.courseDesign) {
    // Check membership against a stand-in for the new account before any login exists.
    const actor = await loadActor();
    const courses = await loadCourses(params.courseDesign.assignedCourseIds);
    const membershipError = validateMembershipAssignment({
      actor,
      target: { id: '__new__', orgId: params.orgId, role, status: 'active', email: params.email, displayName: params.displayName, createdAt: '', updatedAt: '' },
      input: params.courseDesign,
      courses,
    });
    if (membershipError) throw new Error(membershipError);
  }
  const email = params.email.trim().toLowerCase();
  const displayName = params.displayName.trim();

  const config = getFirebaseConfig();
  const tempApp = initializeApp(
    {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
      measurementId: config.measurementId,
    },
    `Provision_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
  const tempAuth = getAuth(tempApp);

  try {
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(tempAuth, email, params.password.trim());
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/email-already-in-use') {
        // Reuse only an account of the same role in the same branch; anything
        // else (another branch, another role) must be handled by an administrator.
        if (role !== 'branch_admin' && !ACADEMY_WIDE.includes(role)) {
          const existing = await getDocs(
            query(
              collection(db, 'users'),
              where('orgId', '==', params.orgId),
              where('branchId', '==', params.branchId),
              where('email', '==', email)
            )
          ).catch(() => null);
          const match = existing?.docs.find((d) => d.data().role === role);
          if (match) {
            return {
              uid: match.id,
              email,
              displayName: (match.data().displayName as string) || displayName,
              role,
              branchId: params.branchId,
              orgId: params.orgId,
              existing: true,
            };
          }
        }
        throw new Error('An account with this email address already exists. Use a different email, or ask the Super Admin to check it.');
      }
      if (code === 'auth/weak-password') throw new Error(`The password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      if (code === 'auth/invalid-email') throw new Error('Invalid email format.');
      if (code === 'auth/operation-not-allowed') throw new Error('Email/password sign-in is not enabled for this Firebase project.');
      throw new Error((err as Error).message || 'Failed to create the login.');
    }

    const uid = credential.user.uid;
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'users', uid), {
        id: uid,
        email,
        displayName,
        role,
        orgId: params.orgId,
        ...(ACADEMY_WIDE.includes(role) ? {} : { branchId: params.branchId }),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      // Roll back the login: the temp app is still signed in as the new user.
      await credential.user.delete().catch((e) => console.error('Could not roll back new login', e));
      const denied = (err as { code?: string }).code === 'permission-denied';
      throw new Error(denied ? 'You are not allowed to create this account for that branch.' : (err as Error).message || 'Failed to save the profile.');
    }

    // Membership was validated before the login was created (see provisionAccount);
    // it is granted through the audited server route once the profile exists.
    if (params.courseDesign) {
      try {
        await postWithIdToken('/api/admin/course-design', { action: 'assign', userId: uid, membership: params.courseDesign });
      } catch (err) {
        throw new Error(`The account was created, but Course Design membership could not be granted: ${(err as Error).message}. Grant it from People.`);
      }
    }

    if (role === 'branch_admin') {
      try {
        await updateDoc(doc(db, 'branches', params.branchId), { branchAdminUserIds: arrayUnion(uid), updatedAt: now });
      } catch (err) {
        console.warn('Could not link the manager on the branch document:', err);
      }
    }
    return { uid, email, displayName, role, branchId: params.branchId, orgId: params.orgId };
  } finally {
    await signOut(tempAuth).catch(() => {});
    await deleteApp(tempApp).catch(() => {});
  }
}

/** Creates a Branch Manager account (Super Admin). */
export function createBranchManager(params: ProvisionInput): Promise<ProvisionedAccount> {
  return provisionAccount('branch_admin', params);
}

/**
 * Creates a Course Design team account (Super Admin). Academy-wide: no branch.
 * The role is a label; authority comes only from `courseDesign` (never defaulted).
 */
export async function createContentMember(
  role: 'content_lead' | 'content_designer',
  params: Omit<ProvisionInput, 'branchId'>
): Promise<ProvisionedAccount & { profile: UserProfile }> {
  const account = await provisionAccount(role, { ...params, branchId: '' });
  const profile = await loadTarget(account.uid);
  if (!profile) throw new Error('The account was created but its profile could not be read back.');
  return { ...account, profile };
}

async function loadActor(): Promise<Actor | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const snap = await getDoc(doc(db, 'users', uid));
  const parsed = validateUserProfile(uid, snap.exists() ? snap.data() : undefined);
  return parsed.profile ? { uid, role: parsed.profile.role, status: parsed.profile.status } : null;
}

async function loadTarget(userId: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', userId));
  return snap.exists() ? validateUserProfile(userId, snap.data()).profile : null;
}

async function loadCourses(ids: string[]): Promise<Course[]> {
  const explicit = ids.filter((id) => id !== ALL_COURSES);
  const snaps = await Promise.all(explicit.map((id) => getDoc(doc(db, 'courses', id)).catch(() => null)));
  return snaps.flatMap((s) => (s?.exists() ? [{ id: s.id, ...s.data() } as Course] : []));
}

/**
 * Grants or updates Course Design membership on an existing account.
 * Super Admin only. The checks run here first (clear messages) and again on
 * the server, which writes the change and its audit entry together (Stage C5).
 */
export async function assignCourseDesignMembership(userId: string, input: MembershipInput): Promise<CourseDesignProfile> {
  const [actor, target, courses] = await Promise.all([loadActor(), loadTarget(userId), loadCourses(input.assignedCourseIds)]);
  const error = validateMembershipAssignment({ actor, target, input, courses });
  if (error) throw new Error(error);
  const res = await postWithIdToken<{ courseDesign: CourseDesignProfile }>('/api/admin/course-design', { action: 'assign', userId, membership: input });
  return res.courseDesign;
}

/** Removes Course Design membership. Super Admin only; audited on the server. */
export async function revokeCourseDesignMembership(userId: string): Promise<void> {
  const [actor, target] = await Promise.all([loadActor(), loadTarget(userId)]);
  const error = validateMembershipRevocation({ actor, target });
  if (error) throw new Error(error);
  await postWithIdToken('/api/admin/course-design', { action: 'revoke', userId });
}

/** Creates a student account in a branch (Branch Manager or Super Admin). */
export function createStudent(params: ProvisionInput): Promise<ProvisionedAccount> {
  return provisionAccount('student', params);
}

/** Creates an instructor account in a branch (Branch Manager or Super Admin). */
export function createInstructor(params: ProvisionInput): Promise<ProvisionedAccount> {
  return provisionAccount('instructor', params);
}

/**
 * Loads profiles for a list of manager user IDs.
 */
export async function getBranchManagers(managerUids: string[]): Promise<{ id: string; displayName: string; email: string }[]> {
  if (!managerUids || managerUids.length === 0) return [];
  const profiles = await Promise.all(
    managerUids.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
          const data = snap.data();
          return {
            id: uid,
            displayName: (data.displayName as string) || 'Manager',
            email: (data.email as string) || '',
          };
        }
      } catch (err) {
        console.warn('Failed to fetch manager profile:', uid, err);
      }
      return null;
    })
  );
  return profiles.filter((p): p is { id: string; displayName: string; email: string } => p !== null);
}

/**
 * Branch managers grouped by branch, read from their profiles (the source of
 * truth) rather than the branch's branchAdminUserIds list, which can lag.
 */
export async function getManagersByBranch(orgId?: string): Promise<Record<string, { id: string; displayName: string; email: string }[]>> {
  const coll = collection(db, 'users');
  const q = orgId
    ? query(coll, where('orgId', '==', orgId), where('role', '==', 'branch_admin'))
    : query(coll, where('role', '==', 'branch_admin'));
  const snap = await getDocs(q);
  const out: Record<string, { id: string; displayName: string; email: string }[]> = {};
  for (const d of snap.docs) {
    const data = d.data();
    const branchId = data.branchId as string | undefined;
    if (!branchId || data.status === 'suspended') continue;
    (out[branchId] ??= []).push({ id: d.id, displayName: (data.displayName as string) || 'Branch Manager', email: (data.email as string) || '' });
  }
  return out;
}

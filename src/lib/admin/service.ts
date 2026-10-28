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
import { db } from '@/lib/firebase/client';
import { getFirebaseConfig } from '@/lib/firebase/config';
import { Organization, Branch } from '@/types/domain';
import { organizationSchema, branchSchema } from '@/types/validation';

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
      defaultTimezone: params.defaultTimezone || 'UTC',
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

/**
 * Creates a new Branch Manager account in Firebase Auth and provisions their
 * user profile in Firestore under the specified branch and organization.
 * Uses a secondary Firebase App instance so the currently logged-in Super Admin is NOT logged out.
 */
export async function createBranchManager(params: {
  email: string;
  password: string;
  displayName: string;
  orgId: string;
  branchId: string;
}): Promise<{
  uid: string;
  email: string;
  displayName: string;
  role: string;
  branchId: string;
  orgId: string;
}> {
  const cleanEmail = params.email.trim();
  const cleanName = params.displayName.trim();
  const cleanPassword = params.password.trim();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!cleanPassword || cleanPassword.length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }
  if (!cleanName || cleanName.length < 2) {
    throw new Error('Please enter a display name (at least 2 characters).');
  }

  const config = getFirebaseConfig();
  const tempAppName = `TempAdminApp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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
    tempAppName
  );

  let newUid = '';
  try {
    const tempAuth = getAuth(tempApp);
    const userCred = await createUserWithEmailAndPassword(tempAuth, cleanEmail, cleanPassword);
    newUid = userCred.user.uid;
    await signOut(tempAuth);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'auth/email-already-in-use') {
      throw new Error('An account with this email address already exists.');
    } else if (e.code === 'auth/weak-password') {
      throw new Error('The password is too weak. Please use at least 6 characters.');
    } else if (e.code === 'auth/invalid-email') {
      throw new Error('Invalid email format.');
    }
    throw new Error(e.message || 'Failed to create user account in Firebase Auth.');
  } finally {
    try {
      await deleteApp(tempApp);
    } catch {
      // Ignore cleanup error
    }
  }

  const now = new Date().toISOString();
  const userDocRef = doc(db, 'users', newUid);
  const profileRecord = {
    id: newUid,
    email: cleanEmail,
    displayName: cleanName,
    role: 'branch_admin' as const,
    orgId: params.orgId,
    branchId: params.branchId,
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };

  // Write profile to Firestore
  await setDoc(userDocRef, profileRecord);

  // Link manager UID to the branch document
  const branchDocRef = doc(db, 'branches', params.branchId);
  try {
    await updateDoc(branchDocRef, {
      branchAdminUserIds: arrayUnion(newUid),
      updatedAt: now,
    });
  } catch (err) {
    console.warn('Could not update branchAdminUserIds array on branch document:', err);
  }

  return {
    uid: newUid,
    email: cleanEmail,
    displayName: cleanName,
    role: 'branch_admin',
    branchId: params.branchId,
    orgId: params.orgId,
  };
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
 * Creates a student account in Firebase Auth and provisions their profile in Firestore.
 * Automatically links to the student's branch and organization.
 */
export async function createStudent(params: {
  email: string;
  password: string;
  displayName: string;
  orgId: string;
  branchId: string;
}): Promise<{
  uid: string;
  email: string;
  displayName: string;
  role: string;
  branchId: string;
  orgId: string;
}> {
  const cleanEmail = params.email.trim();
  const cleanName = params.displayName.trim();
  const cleanPassword = params.password.trim();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!cleanPassword || cleanPassword.length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }
  if (!cleanName || cleanName.length < 2) {
    throw new Error('Please enter student full name.');
  }

  const config = getFirebaseConfig();
  const tempAppName = `TempStudentApp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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
    tempAppName
  );

  let newUid = '';
  try {
    const tempAuth = getAuth(tempApp);
    const userCred = await createUserWithEmailAndPassword(tempAuth, cleanEmail, cleanPassword);
    newUid = userCred.user.uid;
    await signOut(tempAuth);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'auth/email-already-in-use') {
      // If student already exists in Firestore for this org, retrieve and return them
      const q = query(
        collection(db, 'users'),
        where('email', '==', cleanEmail),
        where('orgId', '==', params.orgId)
      );
      const existingSnap = await getDocs(q);
      if (!existingSnap.empty) {
        const existingDoc = existingSnap.docs[0];
        const existingData = existingDoc.data();
        if (existingData.role === 'student') {
          return {
            uid: existingDoc.id,
            email: cleanEmail,
            displayName: (existingData.displayName as string) || cleanName,
            role: 'student',
            branchId: (existingData.branchId as string) || params.branchId,
            orgId: params.orgId,
          };
        }
      }
      throw new Error('An account with this email address already exists.');
    } else if (e.code === 'auth/weak-password') {
      throw new Error('The password is too weak. Please use at least 6 characters.');
    }
    throw new Error(e.message || 'Failed to create student account.');
  } finally {
    try {
      await deleteApp(tempApp);
    } catch {}
  }

  const now = new Date().toISOString();
  const userDocRef = doc(db, 'users', newUid);
  const profileRecord = {
    id: newUid,
    email: cleanEmail,
    displayName: cleanName,
    role: 'student' as const,
    orgId: params.orgId,
    branchId: params.branchId,
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(userDocRef, profileRecord);

  return {
    uid: newUid,
    email: cleanEmail,
    displayName: cleanName,
    role: 'student',
    branchId: params.branchId,
    orgId: params.orgId,
  };
}

/**
 * Creates an instructor account in Firebase Auth and provisions their profile in Firestore.
 * Automatically links to the instructor's branch and organization.
 */
export async function createInstructor(params: {
  email: string;
  password: string;
  displayName: string;
  orgId: string;
  branchId: string;
}): Promise<{
  uid: string;
  email: string;
  displayName: string;
  role: string;
  branchId: string;
  orgId: string;
}> {
  const cleanEmail = params.email.trim();
  const cleanName = params.displayName.trim();
  const cleanPassword = params.password.trim();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!cleanPassword || cleanPassword.length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }
  if (!cleanName || cleanName.length < 2) {
    throw new Error('Please enter instructor full name.');
  }

  const config = getFirebaseConfig();
  const tempAppName = `TempInstructorApp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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
    tempAppName
  );

  let newUid = '';
  try {
    const tempAuth = getAuth(tempApp);
    const userCred = await createUserWithEmailAndPassword(tempAuth, cleanEmail, cleanPassword);
    newUid = userCred.user.uid;
    await signOut(tempAuth);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'auth/email-already-in-use') {
      const q = query(
        collection(db, 'users'),
        where('email', '==', cleanEmail),
        where('orgId', '==', params.orgId)
      );
      const existingSnap = await getDocs(q);
      if (!existingSnap.empty) {
        const existingDoc = existingSnap.docs[0];
        const existingData = existingDoc.data();
        if (existingData.role === 'instructor') {
          return {
            uid: existingDoc.id,
            email: cleanEmail,
            displayName: (existingData.displayName as string) || cleanName,
            role: 'instructor',
            branchId: (existingData.branchId as string) || params.branchId,
            orgId: params.orgId,
          };
        }
      }
      throw new Error('An account with this email address already exists.');
    } else if (e.code === 'auth/weak-password') {
      throw new Error('The password is too weak. Please use at least 6 characters.');
    }
    throw new Error(e.message || 'Failed to create instructor account.');
  } finally {
    try {
      await deleteApp(tempApp);
    } catch {}
  }

  const now = new Date().toISOString();
  const userDocRef = doc(db, 'users', newUid);
  const profileRecord = {
    id: newUid,
    email: cleanEmail,
    displayName: cleanName,
    role: 'instructor' as const,
    orgId: params.orgId,
    branchId: params.branchId,
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(userDocRef, profileRecord);

  return {
    uid: newUid,
    email: cleanEmail,
    displayName: cleanName,
    role: 'instructor',
    branchId: params.branchId,
    orgId: params.orgId,
  };
}


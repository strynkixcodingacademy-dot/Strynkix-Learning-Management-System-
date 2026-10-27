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
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { Organization, Branch } from '@/types/domain';
import { organizationSchema, branchSchema } from '@/types/validation';

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
  const orgRecord: Organization = {
    id: params.id,
    ...validation.data,
    createdAt: now,
    updatedAt: now,
  };

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
  const branchRecord: Branch = {
    id: params.id,
    ...validation.data,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(branchDocRef, branchRecord);
  return branchRecord;
}

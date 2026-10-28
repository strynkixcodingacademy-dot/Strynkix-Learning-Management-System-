/* eslint-disable */
/**
 * Strynkix LMS — Staging Super Admin Provisioning Script
 *
 * PURPOSE:
 * Securely provisions the root organization, default branch, and initial Super Admin
 * profile in Cloud Firestore for the STAGING environment ONLY (strynkix-live-books-staging).
 *
 * SAFETY INVARIANTS:
 * 1. Strictly refuses execution if the target project is not 'strynkix-live-books-staging'.
 * 2. Uses official Google Cloud/Firebase CLI authentication via firebase-tools runtime or GOOGLE_APPLICATION_CREDENTIALS.
 * 3. Verifies Auth user exists in staging Firebase Auth before writing profile.
 * 4. Checks for existing records and halts safely on conflicting data (no blind overwrites).
 * 5. Runs domain Zod validators and validateUserProfile() before writing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { organizationSchema, branchSchema, adminUserProvisionSchema } from '../src/types/validation';
import { validateUserProfile } from '../src/lib/auth/profile';

const EXPECTED_PROJECT_ID = 'strynkix-live-books-staging';
const FORBIDDEN_PROJECT_IDS = ['learning-management-syst-b9bf3'];

const ADMIN_UID = 'xXdUC9JkswW1dyj2IDsk2mC6G9p1';
const ADMIN_EMAIL = 'sagar@gmail.com';
const ADMIN_DISPLAY_NAME = 'Sagar Raut';

function assertStagingEnvironment(projectId: string): void {
  if (projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `[SECURITY FATAL] Target project mismatch! Expected '${EXPECTED_PROJECT_ID}', but detected '${projectId}'. Halting.`
    );
  }
  if (FORBIDDEN_PROJECT_IDS.includes(projectId)) {
    throw new Error(
      `[SECURITY FATAL] Refusing execution: Production project '${projectId}' was targeted. Halting.`
    );
  }
}

async function getAccessToken(): Promise<string> {
  // Option 1: Standard GOOGLE_APPLICATION_CREDENTIALS service account file
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (saPath && fs.existsSync(saPath)) {
    const keyData = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    if (keyData.project_id && keyData.project_id !== EXPECTED_PROJECT_ID) {
      throw new Error(
        `[SECURITY FATAL] Service account project_id '${keyData.project_id}' does not match '${EXPECTED_PROJECT_ID}'.`
      );
    }
  }

  // Option 2: Supported official Firebase CLI runtime authentication
  try {
    const fbAuth = require('/opt/homebrew/lib/node_modules/firebase-tools/lib/auth');
    const projectDir = path.resolve(__dirname, '..');
    const account = fbAuth.getProjectDefaultAccount(projectDir) || fbAuth.getGlobalDefaultAccount();
    if (!account || !account.tokens) {
      throw new Error('No active Firebase account detected in CLI. Please run firebase login.');
    }
    const tokenObj = await fbAuth.getAccessToken(account.tokens.refresh_token, account.tokens.scopes);
    if (!tokenObj || !tokenObj.access_token) {
      throw new Error('Failed to obtain access token from Firebase authentication provider.');
    }
    return tokenObj.access_token;
  } catch (err: any) {
    throw new Error(`Authentication failed: ${err.message}`);
  }
}

// Convert plain JavaScript objects to Firestore REST API Value format
function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: val.toString() } : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

// Convert Firestore REST format back to plain JavaScript objects
function fromFirestoreValue(val: any): any {
  if (!val) return null;
  if ('nullValue' in val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return parseFloat(val.doubleValue);
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

function fromFirestoreDoc(doc: any): any {
  if (!doc || !doc.fields) return null;
  const obj: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  return obj;
}

async function getDocument(token: string, docPath: string): Promise<any | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to get document ${docPath}: HTTP ${res.status} - ${errText}`);
  }
  const json = await res.json();
  return fromFirestoreDoc(json);
}

async function writeDocument(token: string, docPath: string, data: Record<string, any>): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to write document ${docPath}: HTTP ${res.status} - ${errText}`);
  }
}

async function verifyAuthUser(token: string): Promise<void> {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${EXPECTED_PROJECT_ID}/accounts:lookup`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ localId: [ADMIN_UID] }),
  });
  if (!res.ok) {
    throw new Error(`Auth user lookup failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as any;
  if (!data.users || data.users.length === 0) {
    throw new Error(`[ERROR] Auth user with UID '${ADMIN_UID}' does not exist in ${EXPECTED_PROJECT_ID}`);
  }
  const user = data.users[0];
  if (user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    throw new Error(`[CONFLICT] Auth email mismatch! Found '${user.email}', expected '${ADMIN_EMAIL}'`);
  }
  if (user.disabled) {
    throw new Error(`[ERROR] Auth user '${ADMIN_EMAIL}' is disabled in Firebase Auth.`);
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('================================================================');
  console.log(`  Strynkix LMS — Staging Super Admin Provisioning ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('================================================================');

  const projectId = process.env.FIREBASE_PROJECT_ID || EXPECTED_PROJECT_ID;
  assertStagingEnvironment(projectId);

  console.log(`\n[Target Project]: ${EXPECTED_PROJECT_ID}`);
  console.log('[Authenticating via official Firebase CLI runtime]...');
  const token = await getAccessToken();
  console.log('✓ Authentication successful.');

  console.log(`\n1. Verifying Firebase Auth account (${ADMIN_UID})...`);
  await verifyAuthUser(token);
  console.log(`✓ Confirmed Auth record for ${ADMIN_EMAIL} (${ADMIN_UID})`);

  const now = new Date().toISOString();

  // 2. Organization
  console.log('\n2. Checking Root Organization: organizations/strynkix...');
  const orgPayload = {
    id: 'strynkix',
    name: 'Strynkix Coding Academy',
    slug: 'strynkix',
    status: 'active' as const,
    settings: {
      defaultTimezone: 'Asia/Kolkata',
      features: {
        liveBooksEnabled: true,
        interactivePlaygrounds: true,
        peerReviews: false,
      },
    },
    createdAt: now,
    updatedAt: now,
  };
  organizationSchema.parse(orgPayload);

  const existingOrg = await getDocument(token, 'organizations/strynkix');
  if (existingOrg) {
    if (existingOrg.slug !== 'strynkix' || existingOrg.status !== 'active') {
      throw new Error(`[CONFLICT] organizations/strynkix exists with unexpected data: ${JSON.stringify(existingOrg)}`);
    }
    console.log('✓ organizations/strynkix already exists. Preserving existing record.');
  } else {
    if (!isDryRun) {
      await writeDocument(token, 'organizations/strynkix', orgPayload);
      console.log('✓ Successfully created organizations/strynkix');
    } else {
      console.log('[DRY RUN] Would create organizations/strynkix');
    }
  }

  // 3. Branch
  console.log('\n3. Checking Initial Branch: branches/branch_pune...');
  const branchPayload = {
    id: 'branch_pune',
    orgId: 'strynkix',
    name: 'Pune Campus',
    code: 'PUN-01',
    location: {
      city: 'Pune',
      state: 'Maharashtra',
      country: 'India',
      isRemote: false,
    },
    branchAdminUserIds: [],
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };
  branchSchema.parse(branchPayload);

  const existingBranch = await getDocument(token, 'branches/branch_pune');
  if (existingBranch) {
    if (existingBranch.orgId !== 'strynkix' || existingBranch.code !== 'PUN-01') {
      throw new Error(`[CONFLICT] branches/branch_pune exists with unexpected data: ${JSON.stringify(existingBranch)}`);
    }
    console.log('✓ branches/branch_pune already exists. Preserving existing record.');
  } else {
    if (!isDryRun) {
      await writeDocument(token, 'branches/branch_pune', branchPayload);
      console.log('✓ Successfully created branches/branch_pune');
    } else {
      console.log('[DRY RUN] Would create branches/branch_pune');
    }
  }

  // 4. User Profile
  console.log(`\n4. Checking Super Admin Profile: users/${ADMIN_UID}...`);
  const profilePayload = {
    id: ADMIN_UID,
    email: ADMIN_EMAIL,
    displayName: ADMIN_DISPLAY_NAME,
    role: 'super_admin' as const,
    orgId: 'strynkix',
    branchId: null,
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };
  adminUserProvisionSchema.parse({
    uid: ADMIN_UID,
    email: ADMIN_EMAIL,
    displayName: ADMIN_DISPLAY_NAME,
    role: 'super_admin',
    orgId: 'strynkix',
    status: 'active',
  });
  const validation = validateUserProfile(ADMIN_UID, profilePayload);
  if (!validation.isValid || !validation.profile) {
    throw new Error(`[VALIDATION ERROR] Profile invalid: ${validation.error}`);
  }

  const existingProfile = await getDocument(token, `users/${ADMIN_UID}`);
  if (existingProfile) {
    if (existingProfile.role === 'super_admin' && existingProfile.status === 'active' && existingProfile.orgId === 'strynkix') {
      console.log(`✓ users/${ADMIN_UID} is already active super_admin. Preserving record.`);
    } else {
      throw new Error(`[CONFLICT] users/${ADMIN_UID} exists with conflicting data: ${JSON.stringify(existingProfile)}`);
    }
  } else {
    if (!isDryRun) {
      await writeDocument(token, `users/${ADMIN_UID}`, profilePayload);
      console.log(`✓ Successfully provisioned Super Admin profile: users/${ADMIN_UID}`);
    } else {
      console.log(`[DRY RUN] Would create users/${ADMIN_UID}`);
    }
  }

  // 5. Verification
  if (!isDryRun) {
    console.log('\n5. Verifying written documents...');
    const vUser = await getDocument(token, `users/${ADMIN_UID}`);
    const vOrg = await getDocument(token, 'organizations/strynkix');
    const vBranch = await getDocument(token, 'branches/branch_pune');

    if (!vUser || !vOrg || !vBranch) {
      throw new Error('[FATAL] One or more documents could not be read back from Firestore.');
    }

    const vCheck = validateUserProfile(ADMIN_UID, vUser);
    if (!vCheck.isValid || vCheck.profile?.role !== 'super_admin' || vCheck.profile?.status !== 'active') {
      throw new Error(`[FATAL] Stored profile does not meet Super Admin contract: ${JSON.stringify(vUser)}`);
    }

    console.log('\n================================================================');
    console.log('  PROVISIONING SUCCESSFUL & VERIFIED');
    console.log('================================================================');
    console.log(`  Project:      ${EXPECTED_PROJECT_ID}`);
    console.log(`  UID:          ${ADMIN_UID}`);
    console.log(`  Email:        ${ADMIN_EMAIL}`);
    console.log(`  Display Name: ${vUser.displayName}`);
    console.log(`  Role:         ${vUser.role}`);
    console.log(`  Org ID:       ${vUser.orgId}`);
    console.log(`  Status:       ${vUser.status}`);
  } else {
    console.log('\n[DRY RUN COMPLETED] All pre-flight checks, schemas, and Auth lookups passed.');
  }
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});

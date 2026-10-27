/**
 * Strynkix LMS — Unit Tests for Organization and Branch Domain Schemas
 */

import { describe, it, expect } from 'vitest';
import { organizationSchema, branchSchema } from '@/types/validation';

describe('Organization Schema Validation', () => {
  it('validates a correct organization definition', () => {
    const validOrg = {
      name: 'Strynkix Coding Academy',
      slug: 'strynkix-coding-academy',
      website: 'https://strynkix.com',
      status: 'active' as const,
      settings: {
        allowedEmailDomains: ['strynkix.com', 'strynkix.in'],
        defaultTimezone: 'Asia/Kolkata',
        features: {
          liveBooksEnabled: true,
          interactivePlaygrounds: true,
          peerReviews: false,
        },
      },
    };

    const parsed = organizationSchema.safeParse(validOrg);
    expect(parsed.success).toBe(true);
  });

  it('rejects an organization with invalid slug (must be lowercase alphanumeric with dashes)', () => {
    const invalidSlugOrg = {
      name: 'Strynkix Academy',
      slug: 'Strynkix Invalid Slug!',
      status: 'active',
      settings: {
        defaultTimezone: 'UTC',
        features: {
          liveBooksEnabled: true,
          interactivePlaygrounds: true,
          peerReviews: false,
        },
      },
    };

    const parsed = organizationSchema.safeParse(invalidSlugOrg);
    expect(parsed.success).toBe(false);
  });

  it('rejects an organization with an empty or too short name', () => {
    const invalidNameOrg = {
      name: 'A', // min 2 characters
      slug: 'valid-slug',
      status: 'active',
      settings: {
        defaultTimezone: 'UTC',
        features: {
          liveBooksEnabled: true,
          interactivePlaygrounds: true,
          peerReviews: false,
        },
      },
    };

    const parsed = organizationSchema.safeParse(invalidNameOrg);
    expect(parsed.success).toBe(false);
  });
});

describe('Branch Schema Validation', () => {
  it('validates a physical branch campus with location and assigned admin UIDs', () => {
    const validBranch = {
      orgId: 'strynkix',
      name: 'Pune Innovation Campus',
      code: 'PUN-01',
      location: {
        city: 'Pune',
        state: 'Maharashtra',
        country: 'India',
        isRemote: false,
      },
      branchAdminUserIds: ['user_pune_manager_uid'],
      status: 'active' as const,
    };

    const parsed = branchSchema.safeParse(validBranch);
    expect(parsed.success).toBe(true);
  });

  it('validates a remote online branch campus', () => {
    const remoteBranch = {
      orgId: 'strynkix',
      name: 'Global Remote Hub',
      code: 'REMOTE-GLOBAL',
      location: {
        country: 'India',
        isRemote: true,
      },
      branchAdminUserIds: [],
      status: 'active' as const,
    };

    const parsed = branchSchema.safeParse(remoteBranch);
    expect(parsed.success).toBe(true);
  });

  it('rejects a branch with missing mandatory country', () => {
    const invalidBranch = {
      orgId: 'strynkix',
      name: 'Test Branch',
      code: 'TST-01',
      location: {
        city: 'Mumbai',
        // country is missing
        isRemote: false,
      },
      status: 'active',
    };

    const parsed = branchSchema.safeParse(invalidBranch);
    expect(parsed.success).toBe(false);
  });

  it('rejects a branch with invalid orgId format (special characters)', () => {
    const invalidOrgBranch = {
      orgId: 'invalid org name with spaces!',
      name: 'Test Branch',
      code: 'TST-02',
      location: {
        country: 'India',
        isRemote: false,
      },
      status: 'active',
    };

    const parsed = branchSchema.safeParse(invalidOrgBranch);
    expect(parsed.success).toBe(false);
  });
});

/**
 * Strynkix LMS — Unit Tests for Profile Validation and Safe Auth Error Formatting
 */

import { describe, it, expect } from 'vitest';
import { validateUserProfile, formatAuthError } from '@/lib/auth/profile';

describe('User Profile Validation & Boundary Enforcement', () => {
  it('successfully validates a complete student profile', () => {
    const rawData = {
      role: 'student',
      orgId: 'strynkix',
      branchId: 'branch_pune',
      email: 'student@strynkix.com',
      displayName: 'Aarav Patel',
      status: 'active',
      createdAt: '2026-10-28T00:00:00.000Z',
      updatedAt: '2026-10-28T00:00:00.000Z',
    };

    const result = validateUserProfile('uid_123', rawData);
    expect(result.isValid).toBe(true);
    expect(result.isSuspended).toBe(false);
    expect(result.profile).not.toBeNull();
    expect(result.profile?.role).toBe('student');
    expect(result.profile?.orgId).toBe('strynkix');
    expect(result.profile?.branchId).toBe('branch_pune');
  });

  it('successfully validates a super_admin profile without mandatory branchId', () => {
    const rawData = {
      role: 'super_admin',
      orgId: 'strynkix',
      email: 'admin@strynkix.com',
      displayName: 'Super Admin',
      status: 'active',
    };

    const result = validateUserProfile('uid_admin', rawData);
    expect(result.isValid).toBe(true);
    expect(result.isSuspended).toBe(false);
    expect(result.profile?.role).toBe('super_admin');
    expect(result.profile?.branchId).toBeUndefined();
  });

  it('rejects a profile if document is missing (undefined data)', () => {
    const result = validateUserProfile('uid_none', undefined);
    expect(result.isValid).toBe(false);
    expect(result.profile).toBeNull();
    expect(result.error).toContain('does not exist');
  });

  it('rejects a profile with missing orgId', () => {
    const rawData = {
      role: 'student',
      branchId: 'branch_pune',
      email: 'student@strynkix.com',
      displayName: 'No Org',
    };

    const result = validateUserProfile('uid_no_org', rawData);
    expect(result.isValid).toBe(false);
    expect(result.profile).toBeNull();
    expect(result.error).toContain('missing required tenant boundary');
  });

  it('rejects a profile with an invalid/unauthorized role', () => {
    const rawData = {
      role: 'system_hacker',
      orgId: 'strynkix',
      branchId: 'branch_pune',
      email: 'hacker@test.com',
      displayName: 'Hacker',
    };

    const result = validateUserProfile('uid_invalid_role', rawData);
    expect(result.isValid).toBe(false);
    expect(result.profile).toBeNull();
    expect(result.error).toContain('invalid role');
  });

  it('rejects a student profile if branchId is missing', () => {
    const rawData = {
      role: 'student',
      orgId: 'strynkix',
      email: 'student@strynkix.com',
      displayName: 'Missing Branch',
    };

    const result = validateUserProfile('uid_no_branch', rawData);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('requires an assigned branchId');
  });

  it('flags a suspended profile appropriately', () => {
    const rawData = {
      role: 'student',
      orgId: 'strynkix',
      branchId: 'branch_pune',
      email: 'suspended@strynkix.com',
      displayName: 'Suspended Student',
      status: 'suspended',
    };

    const result = validateUserProfile('uid_suspended', rawData);
    expect(result.isValid).toBe(true);
    expect(result.isSuspended).toBe(true);
    expect(result.error).toContain('suspended');
  });
});

describe('Safe Firebase Auth Error Formatting', () => {
  it('formats invalid credentials without revealing email existence', () => {
    expect(formatAuthError('auth/user-not-found')).toBe(
      'Invalid email or password. Please verify your credentials.'
    );
    expect(formatAuthError('auth/wrong-password')).toBe(
      'Invalid email or password. Please verify your credentials.'
    );
    expect(formatAuthError('auth/invalid-credential')).toBe(
      'Invalid email or password. Please verify your credentials.'
    );
  });

  it('formats rate limit lockout correctly', () => {
    expect(formatAuthError('auth/too-many-requests')).toContain('temporarily locked');
  });

  it('handles unexpected errors gracefully', () => {
    expect(formatAuthError('auth/some-weird-error')).toBe(
      'An error occurred during authentication. Please try again.'
    );
  });
});

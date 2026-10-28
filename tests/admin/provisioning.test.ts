/**
 * Account provisioning helpers: input validation and temporary passwords.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/firebase/client', () => ({ db: {}, auth: {} }));

import { generateTempPassword, MIN_PASSWORD_LENGTH, validateProvisionInput } from '@/lib/admin/service';

const valid = { email: 'new.student@example.test', password: 'Abcdefgh12', displayName: 'New Student', orgId: 'strynkix', branchId: 'branch_pune' };

describe('validateProvisionInput', () => {
  it('accepts a complete, well-formed request', () => {
    expect(validateProvisionInput(valid)).toBeNull();
  });

  it('rejects malformed emails, short names and short passwords', () => {
    expect(validateProvisionInput({ ...valid, email: 'not-an-email' })).toMatch(/email/i);
    expect(validateProvisionInput({ ...valid, email: 'a@b' })).toMatch(/email/i);
    expect(validateProvisionInput({ ...valid, displayName: 'A' })).toMatch(/name/i);
    expect(validateProvisionInput({ ...valid, password: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) })).toMatch(/at least 8/);
  });
});

describe('generateTempPassword', () => {
  it('meets the minimum length and is different every time', () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(a).not.toBe(b);
  });

  it('uses only unambiguous characters', () => {
    const p = generateTempPassword(200);
    expect(p).toHaveLength(200);
    expect(p).not.toMatch(/[0O1lI]/);
  });
});

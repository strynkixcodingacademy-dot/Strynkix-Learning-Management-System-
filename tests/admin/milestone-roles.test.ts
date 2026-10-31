/** Milestone G37/G38: who may create which accounts, and whose status a University Admin may change. */
import { describe, it, expect } from 'vitest';
import { canProvision } from '@/lib/server/account-provisioning';
import { statusActionFor } from '@/lib/account/service';
import { UserProfile } from '@/types/domain';

const p = (role: UserProfile['role'], extra: Partial<UserProfile> = {}) =>
  ({ id: role, role, orgId: 'org_a', status: 'active', email: `${role}@x`, displayName: role, createdAt: '', updatedAt: '', ...extra }) as UserProfile;

describe('canProvision', () => {
  it('Super Admin may create every provisionable role, with membership', () => {
    for (const role of ['university_admin', 'branch_admin', 'instructor', 'student', 'content_lead', 'content_designer'] as const) {
      expect(canProvision(p('super_admin'), { role, orgId: 'org_b', courseDesign: undefined })).toBe(true);
    }
    expect(canProvision(p('super_admin'), { role: 'content_designer', orgId: 'org_a', courseDesign: { responsibilities: ['reviewer'], assignedCourseIds: ['c1'] } })).toBe(true);
  });
  it('University Admin: branch roles in their own academy only, never membership', () => {
    const uni = p('university_admin');
    expect(canProvision(uni, { role: 'branch_admin', orgId: 'org_a' })).toBe(true);
    expect(canProvision(uni, { role: 'student', orgId: 'org_a' })).toBe(true);
    expect(canProvision(uni, { role: 'university_admin', orgId: 'org_a' })).toBe(false);
    expect(canProvision(uni, { role: 'content_designer', orgId: 'org_a' })).toBe(false);
    expect(canProvision(uni, { role: 'student', orgId: 'org_b' })).toBe(false);
    expect(canProvision(uni, { role: 'instructor', orgId: 'org_a', courseDesign: { responsibilities: ['reviewer'], assignedCourseIds: ['c1'] } })).toBe(false);
  });
  it('Branch Manager: instructors and students of their branch; others nothing; suspended nothing', () => {
    const ba = p('branch_admin', { branchId: 'b1' });
    expect(canProvision(ba, { role: 'student', orgId: 'org_a', branchId: 'b1' })).toBe(true);
    expect(canProvision(ba, { role: 'student', orgId: 'org_a', branchId: 'b2' })).toBe(false);
    expect(canProvision(ba, { role: 'branch_admin', orgId: 'org_a', branchId: 'b1' })).toBe(false);
    expect(canProvision(p('branch_admin'), { role: 'student', orgId: 'org_a', branchId: 'b1' })).toBe(false);
    for (const role of ['instructor', 'student', 'content_lead'] as const) expect(canProvision(p(role), { role: 'student', orgId: 'org_a', branchId: 'b1' })).toBe(false);
    expect(canProvision(p('super_admin', { status: 'suspended' }), { role: 'student', orgId: 'org_a', branchId: 'b1' })).toBe(false);
  });
});

describe('statusActionFor — University Admin', () => {
  const viewer = { uid: 'uni', role: 'university_admin' as const };
  it('offers actions for branch managers, instructors and students only', () => {
    expect(statusActionFor(p('branch_admin'), viewer)).toBe('suspend');
    expect(statusActionFor(p('student', { status: 'suspended' }), viewer)).toBe('reactivate');
    expect(statusActionFor(p('content_designer'), viewer)).toBeNull();
    expect(statusActionFor(p('university_admin'), viewer)).toBeNull();
  });
});

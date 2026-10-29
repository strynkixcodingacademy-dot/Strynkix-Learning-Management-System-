/**
 * Strynkix LMS — Course Design membership (Stage B): validation and authority
 * mirrors of firestore.rules. Rules are tested separately on the emulator.
 */

import { describe, it, expect } from 'vitest';
import {
  buildMembership,
  hasCourseDesignAuthority,
  validateMembershipAssignment,
  validateMembershipRevocation,
  MembershipInput,
} from '@/lib/admin/course-design';
import { validateUserProfile } from '@/lib/auth/profile';
import { courseDesignInputSchema, courseDesignProfileSchema } from '@/types/validation';
import { Course, UserProfile } from '@/types/domain';

const super_ = { uid: 'super', role: 'super_admin' as const, status: 'active' as const };
const person = (over: Partial<UserProfile> = {}): UserProfile => ({
  id: 'designer', orgId: 'org_a', role: 'content_designer', email: 'd@x.test', displayName: 'D', status: 'active',
  createdAt: '', updatedAt: '', ...over,
});
const course = (id: string, orgId = 'org_a'): Course => ({ id, orgId, title: id } as Course);
const input: MembershipInput = { responsibilities: ['content_developer'], assignedCourseIds: ['c1'] };

describe('Course Design input validation', () => {
  it('accepts explicit courses or exactly ["*"]', () => {
    expect(courseDesignInputSchema.safeParse(input).success).toBe(true);
    expect(courseDesignInputSchema.safeParse({ ...input, assignedCourseIds: ['*'] }).success).toBe(true);
  });

  it('rejects empty, mixed, duplicate or oversized scopes and unknown responsibilities', () => {
    expect(courseDesignInputSchema.safeParse({ ...input, assignedCourseIds: [] }).success).toBe(false);
    expect(courseDesignInputSchema.safeParse({ ...input, assignedCourseIds: ['*', 'c1'] }).success).toBe(false);
    expect(courseDesignInputSchema.safeParse({ ...input, assignedCourseIds: ['c1', 'c1'] }).success).toBe(false);
    expect(courseDesignInputSchema.safeParse({ ...input, assignedCourseIds: Array.from({ length: 51 }, (_, i) => `c${i}`) }).success).toBe(false);
    expect(courseDesignInputSchema.safeParse({ ...input, responsibilities: [] }).success).toBe(false);
    expect(courseDesignInputSchema.safeParse({ ...input, responsibilities: ['publisher' as never] }).success).toBe(false);
  });

  it('the stored profile is strict: extra keys are rejected', () => {
    const p = buildMembership(input, 'super', new Date('2026-10-29T00:00:00Z'));
    expect(courseDesignProfileSchema.safeParse(p).success).toBe(true);
    expect(courseDesignProfileSchema.safeParse({ ...p, canPublish: true }).success).toBe(false);
  });

  it('records the administrator, never the member, as assigner', () => {
    expect(buildMembership(input, 'super').assignedByUserId).toBe('super');
  });
});

describe('validateMembershipAssignment', () => {
  const ok = { actor: super_, target: person(), input, courses: [course('c1')] };

  it('allows an active Super Admin to assign in-org courses to an active eligible account', () => {
    expect(validateMembershipAssignment(ok)).toBeNull();
    expect(validateMembershipAssignment({ ...ok, target: person({ role: 'instructor' }) })).toBeNull();
    expect(validateMembershipAssignment({ ...ok, input: { ...input, assignedCourseIds: ['*'] }, courses: [] })).toBeNull();
  });

  it('denies non-Super-Admins, inactive admins and signed-out callers', () => {
    for (const role of ['university_admin', 'branch_admin', 'instructor', 'content_lead', 'content_designer', 'student'] as const) {
      expect(validateMembershipAssignment({ ...ok, actor: { uid: 'x', role, status: 'active' } })).toMatch(/Only a Super Admin/);
    }
    expect(validateMembershipAssignment({ ...ok, actor: { ...super_, status: 'suspended' } })).toMatch(/not active/);
    expect(validateMembershipAssignment({ ...ok, actor: null })).toMatch(/signed in/);
  });

  it('denies missing profiles, self-assignment, suspended or ineligible targets', () => {
    expect(validateMembershipAssignment({ ...ok, target: null })).toMatch(/no profile/);
    expect(validateMembershipAssignment({ ...ok, target: person({ id: 'super' }) })).toMatch(/yourself/);
    expect(validateMembershipAssignment({ ...ok, target: person({ status: 'suspended' }) })).toMatch(/active/);
    for (const role of ['student', 'branch_admin', 'university_admin', 'super_admin'] as const) {
      expect(validateMembershipAssignment({ ...ok, target: person({ role }) })).toMatch(/only for/);
    }
  });

  it('denies unknown and cross-organization courses', () => {
    expect(validateMembershipAssignment({ ...ok, courses: [] })).toMatch(/does not exist/);
    expect(validateMembershipAssignment({ ...ok, courses: [course('c1', 'org_b')] })).toMatch(/another organization/);
  });

  it('revocation is Super Admin only and never on oneself', () => {
    const member = person({ courseDesign: buildMembership(input, 'super') });
    expect(validateMembershipRevocation({ actor: super_, target: member })).toBeNull();
    expect(validateMembershipRevocation({ actor: { ...super_, role: 'university_admin' }, target: member })).toMatch(/Only a Super Admin/);
    expect(validateMembershipRevocation({ actor: super_, target: person() })).toMatch(/no Course Design/);
    expect(validateMembershipRevocation({ actor: super_, target: null })).toMatch(/no profile/);
  });
});

describe('hasCourseDesignAuthority (mirror of the rules)', () => {
  const member = (over: Partial<UserProfile> = {}, cd = input) => person({ courseDesign: buildMembership(cd, 'super'), ...over });

  it('requires responsibility, scope, org, active status and an eligible role', () => {
    expect(hasCourseDesignAuthority(member(), course('c1'), ['content_developer'])).toBe(true);
    expect(hasCourseDesignAuthority(member(), course('c2'), ['content_developer'])).toBe(false);
    expect(hasCourseDesignAuthority(member(), course('c1'), ['curriculum_architect'])).toBe(false);
    expect(hasCourseDesignAuthority(member(), course('c1', 'org_b'), ['content_developer'])).toBe(false);
    expect(hasCourseDesignAuthority(member({ status: 'suspended' }), course('c1'), ['content_developer'])).toBe(false);
    expect(hasCourseDesignAuthority(member({ role: 'student' }), course('c1'), ['content_developer'])).toBe(false);
    expect(hasCourseDesignAuthority(person(), course('c1'), ['content_developer'])).toBe(false);
    expect(hasCourseDesignAuthority(null, course('c1'), ['content_developer'])).toBe(false);
  });

  it('the content_lead label grants nothing without membership; "*" covers the member\'s org only', () => {
    expect(hasCourseDesignAuthority(person({ role: 'content_lead' }), course('c1'), ['lead'])).toBe(false);
    const orgWide = member({}, { responsibilities: ['lead'], assignedCourseIds: ['*'] });
    expect(hasCourseDesignAuthority(orgWide, course('anything'), ['lead'])).toBe(true);
    expect(hasCourseDesignAuthority(orgWide, course('anything', 'org_b'), ['lead'])).toBe(false);
  });
});

describe('profile loading keeps old records valid', () => {
  it('profiles without courseDesign load unchanged; malformed membership is dropped', () => {
    const base = { role: 'instructor', orgId: 'org_a', email: 'i@x.test', displayName: 'I', status: 'active' };
    expect(validateUserProfile('u1', base).profile?.courseDesign).toBeUndefined();
    expect(validateUserProfile('u1', { ...base, courseDesign: { department: 'course_design', responsibilities: ['god_mode'] } }).profile?.courseDesign).toBeUndefined();
    const good = buildMembership(input, 'super');
    expect(validateUserProfile('u1', { ...base, courseDesign: good }).profile?.courseDesign).toEqual(good);
  });

  it('content roles load without a branch', () => {
    const r = validateUserProfile('u2', { role: 'content_designer', orgId: 'org_a', email: 'd@x.test', displayName: 'D', status: 'active' });
    expect(r.isValid).toBe(true);
  });
});

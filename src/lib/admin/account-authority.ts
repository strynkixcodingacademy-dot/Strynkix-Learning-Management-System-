/**
 * Strynkix LMS — who may create and correct which accounts (milestone
 * G37/G40). Pure and client-safe: the server routes enforce these rules
 * (src/lib/server/account-provisioning.ts, account-profile-admin.ts) and the
 * dashboard uses them only to hide actions that would be refused.
 */

import { UserProfile, UserRole } from '@/types/domain';

export const PROVISIONABLE_ROLES = ['university_admin', 'branch_admin', 'instructor', 'student', 'content_lead', 'content_designer'] as const;
export type ProvisionableRole = (typeof PROVISIONABLE_ROLES)[number];
/** Roles that belong to the whole academy (no branch). */
export const ACADEMY_WIDE_ROLES: UserRole[] = ['university_admin', 'content_lead', 'content_designer'];

/** Which roles this actor may create, and where. Mirrors the pre-milestone rules. */
export function canProvision(
  actor: UserProfile | null,
  req: { role: ProvisionableRole; orgId: string; branchId?: string; courseDesign?: unknown }
): boolean {
  if (!actor || actor.status !== 'active') return false;
  if (req.courseDesign && actor.role !== 'super_admin') return false;
  if (actor.role === 'super_admin') return true;
  if (actor.orgId !== req.orgId) return false;
  if (actor.role === 'university_admin') return ['branch_admin', 'instructor', 'student'].includes(req.role);
  if (actor.role === 'branch_admin') {
    return Boolean(actor.branchId) && actor.branchId === req.branchId && ['instructor', 'student'].includes(req.role);
  }
  return false;
}

/** Roles this actor may move an account from and to. */
export function manageableRoles(actor: Pick<UserProfile, 'role'>): UserRole[] {
  if (actor.role === 'super_admin') return [...PROVISIONABLE_ROLES];
  if (actor.role === 'university_admin') return ['branch_admin', 'instructor', 'student'];
  if (actor.role === 'branch_admin') return ['instructor', 'student'];
  return [];
}

/** May this actor change the target's role, branch or email? Never oneself, never a Super Admin. */
export function canCorrectAccount(actor: UserProfile | null, target: UserProfile): boolean {
  if (!actor || actor.status !== 'active' || actor.id === target.id || target.role === 'super_admin') return false;
  if (actor.role !== 'super_admin' && actor.orgId !== target.orgId) return false;
  if (actor.role === 'branch_admin' && (!actor.branchId || actor.branchId !== target.branchId)) return false;
  return manageableRoles(actor).includes(target.role);
}

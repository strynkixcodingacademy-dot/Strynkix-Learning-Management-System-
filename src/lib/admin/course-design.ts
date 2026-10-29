/**
 * Strynkix LMS — Course Design membership (Stage B): pure validation and
 * authority checks. firestore.rules is the security boundary; these functions
 * mirror it so the UI can explain refusals and hide actions that would fail.
 */

import { COURSE_DESIGN_ELIGIBLE_ROLES, Course, CourseDesignProfile, CourseDesignResponsibility, UserProfile, UserRole } from '@/types/domain';
import { courseDesignInputSchema, courseDesignProfileSchema } from '@/types/validation';

export const COURSE_DESIGN_RESPONSIBILITIES: Array<{ id: CourseDesignResponsibility; label: string; description: string }> = [
  { id: 'lead', label: 'Lead', description: 'Plans the course and edits drafts in scope. Does not publish.' },
  { id: 'curriculum_architect', label: 'Curriculum architect', description: 'Creates and edits draft courses, modules and lessons in scope.' },
  { id: 'content_developer', label: 'Content developer', description: 'Writes lessons in draft courses in scope.' },
  { id: 'assessment_designer', label: 'Assessment designer', description: 'Writes quiz questions and answer keys in draft courses in scope.' },
  { id: 'reviewer', label: 'Reviewer', description: 'Approves submitted drafts or requests changes. Never their own work.' },
];

/** Responsibilities that may write draft content (mirrors firestore.rules). */
export const COURSE_WRITE: CourseDesignResponsibility[] = ['lead', 'curriculum_architect'];
export const LESSON_WRITE: CourseDesignResponsibility[] = ['lead', 'curriculum_architect', 'content_developer'];

export const ALL_COURSES = '*';

export interface MembershipInput {
  responsibilities: CourseDesignResponsibility[];
  assignedCourseIds: string[];
}

export interface Actor {
  uid: string;
  role: UserRole;
  status: UserProfile['status'];
}

export function isEligibleForCourseDesign(role: UserRole): boolean {
  return COURSE_DESIGN_ELIGIBLE_ROLES.includes(role);
}

function actorError(actor: Actor | null): string | null {
  if (!actor) return 'You must be signed in.';
  if (actor.role !== 'super_admin') return 'Only a Super Admin can manage Course Design membership.';
  if (actor.status !== 'active') return 'Your account is not active.';
  return null;
}

/**
 * Checks a grant or update. `courses` are the looked-up documents for the
 * explicit IDs in the input (missing IDs are simply absent from the list).
 */
export function validateMembershipAssignment(params: {
  actor: Actor | null;
  target: UserProfile | null;
  input: MembershipInput;
  courses: Course[];
}): string | null {
  const { actor, target, input, courses } = params;
  const denied = actorError(actor);
  if (denied) return denied;
  if (!target) return 'That account has no profile.';
  if (target.id === actor!.uid) return 'You cannot assign Course Design membership to yourself.';
  if (target.status !== 'active') return 'Only active accounts can join the Course Design department.';
  if (!isEligibleForCourseDesign(target.role)) return 'Course Design membership is only for Content Leads, Content Designers and Instructors.';
  const parsed = courseDesignInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid membership.';
  if (parsed.data.assignedCourseIds[0] === ALL_COURSES) return null;
  const byId = new Map(courses.map((c) => [c.id, c]));
  for (const id of parsed.data.assignedCourseIds) {
    const course = byId.get(id);
    if (!course) return `Course "${id}" does not exist.`;
    if (course.orgId !== target.orgId) return `Course "${course.title}" belongs to another organization.`;
  }
  return null;
}

export function validateMembershipRevocation(params: { actor: Actor | null; target: UserProfile | null }): string | null {
  const denied = actorError(params.actor);
  if (denied) return denied;
  if (!params.target) return 'That account has no profile.';
  if (params.target.id === params.actor!.uid) return 'You cannot change your own Course Design membership.';
  if (!params.target.courseDesign) return 'This account has no Course Design membership.';
  return null;
}

export function buildMembership(input: MembershipInput, assignedByUserId: string, now: Date = new Date()): CourseDesignProfile {
  return courseDesignProfileSchema.parse({
    department: 'course_design',
    responsibilities: input.responsibilities,
    assignedCourseIds: input.assignedCourseIds,
    assignedAt: now.toISOString(),
    assignedByUserId,
  });
}

/** Mirrors hasCourseDesignAuthority in firestore.rules. */
export function hasCourseDesignAuthority(
  profile: Pick<UserProfile, 'orgId' | 'role' | 'status' | 'courseDesign'> | null,
  course: Pick<Course, 'id' | 'orgId'>,
  responsibilities: CourseDesignResponsibility[]
): boolean {
  if (!profile || profile.status !== 'active' || !isEligibleForCourseDesign(profile.role)) return false;
  if (profile.orgId !== course.orgId) return false;
  const cd = courseDesignProfileSchema.safeParse(profile.courseDesign);
  if (!cd.success) return false;
  if (!cd.data.responsibilities.some((r) => responsibilities.includes(r))) return false;
  const scope = cd.data.assignedCourseIds;
  return scope[0] === ALL_COURSES || scope.includes(course.id);
}

/** True when the member's scope is the whole organization. */
export function hasOrgWideScope(profile: Pick<UserProfile, 'courseDesign'> | null): boolean {
  return profile?.courseDesign?.assignedCourseIds?.[0] === ALL_COURSES;
}

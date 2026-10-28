import { UserRole } from '@/types/domain';

/**
 * Determines the default post-authentication destination based on user role.
 * - Students land on the Strynkix Live Books dashboard (/dashboard): courses, My Day and progress.
 * - Administrative and instructional staff land on their dedicated management hub (/dashboard).
 */
export function getRoleDefaultRedirect(role?: UserRole): string {
  switch (role) {
    case 'student':
    case 'instructor':
    case 'branch_admin':
    case 'university_admin':
    case 'super_admin':
      return '/dashboard';
    default:
      return '/dashboard';
  }
}

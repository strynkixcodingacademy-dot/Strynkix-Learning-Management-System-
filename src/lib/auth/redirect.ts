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
    case 'content_lead':
    case 'content_designer':
      return '/dashboard';
    default:
      return '/dashboard';
  }
}

/**
 * Returns `param` only when it is a same-origin path (Stage C7). Rejects
 * protocol-relative and backslash forms such as `//evil.example` or
 * `/\evil.example`, which browsers would treat as another site.
 */
export function safeRedirectPath(param: string | null | undefined): string | null {
  if (!param || !param.startsWith('/') || param.startsWith('//') || param.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(param)) return null;
  try {
    const base = 'https://strynkix.invalid';
    const url = new URL(param, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}


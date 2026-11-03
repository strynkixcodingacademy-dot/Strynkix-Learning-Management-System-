import 'server-only';

/**
 * POST /api/admin/course-design — grant, update or revoke Course Design
 * membership (Super Admin only), audited in the same transaction (Stage C5).
 * Body: { action: 'assign', userId, membership: { responsibilities, assignedCourseIds } } | { action: 'revoke', userId, reason? }
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { manageCourseDesignMembership } from '@/lib/server/account-admin';

export async function POST(request: Request) {
  return handleContentRoute(request, 'admin/course-design', (services, token, body) => manageCourseDesignMembership(services, token, body));
}

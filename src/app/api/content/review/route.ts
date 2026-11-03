import 'server-only';

/**
 * POST /api/content/review — submit, reopen, approve, request changes,
 * publish, unpublish or archive a course or lesson (Stage C2).
 * Body: { targetType, targetId, action, comment?, reason? }
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { performContentAction } from '@/lib/server/content-review';

export async function POST(request: Request) {
  return handleContentRoute(request, 'content/review', (services, token, body) => performContentAction(services, token, body));
}

import 'server-only';

/**
 * POST /api/announcements — the announcements that reach the signed-in user (src/lib/server/announcements.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleAnnouncements } from '@/lib/server/announcements';

export async function POST(request: Request) {
  return handleContentRoute(request, 'announcements', (services, token, body) => handleAnnouncements(services, token, body));
}

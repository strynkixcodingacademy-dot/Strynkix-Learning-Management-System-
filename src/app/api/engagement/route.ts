import 'server-only';

/**
 * POST /api/engagement — student engagement, achievements, preferences, reminders and engagement views (src/lib/server/engagement.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleEngagement } from '@/lib/server/engagement';

export async function POST(request: Request) {
  return handleContentRoute(request, 'engagement', (services, token, body) => handleEngagement(services, token, body));
}

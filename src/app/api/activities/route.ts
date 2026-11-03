import 'server-only';

/**
 * POST /api/activities — academy activities, registrations and attendance (src/lib/server/activities.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleActivities } from '@/lib/server/activities';

export async function POST(request: Request) {
  return handleContentRoute(request, 'activities', (services, token, body) => handleActivities(services, token, body));
}

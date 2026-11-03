import 'server-only';

/**
 * POST /api/command — Super Admin Command Centre (src/lib/server/command-centre.ts).
 * Header: Authorization: Bearer <Firebase ID token>. Refused for every other role.
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleCommand } from '@/lib/server/command-centre';

export async function POST(request: Request) {
  return handleContentRoute(request, 'command', (services, token, body) => handleCommand(services, token, body));
}

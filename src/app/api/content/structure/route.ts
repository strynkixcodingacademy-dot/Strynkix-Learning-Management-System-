import 'server-only';

/**
 * POST /api/content/structure — edit draft course details and restructure a
 * course (module details/order/deletion, draft lesson order/move/deletion),
 * authorized, validated and audited on the server (milestone G28–G30).
 * Body: { action, ... } (see src/lib/server/content-structure.ts)
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { changeStructure } from '@/lib/server/content-structure';

export async function POST(request: Request) {
  return handleContentRoute(request, 'content/structure', (services, token, body) => changeStructure(services, token, body));
}

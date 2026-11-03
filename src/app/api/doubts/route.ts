import 'server-only';

/**
 * POST /api/doubts — doubt resolution and mentoring (src/lib/server/doubts.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleDoubts } from '@/lib/server/doubts';

export async function POST(request: Request) {
  return handleContentRoute(request, 'doubts', (services, token, body) => handleDoubts(services, token, body));
}

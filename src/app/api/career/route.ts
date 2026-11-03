import 'server-only';

/**
 * POST /api/career — student portfolio and resume builder (src/lib/server/career.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleCareer } from '@/lib/server/career';

export async function POST(request: Request) {
  return handleContentRoute(request, 'career', (services, token, body) => handleCareer(services, token, body), 256_000);
}

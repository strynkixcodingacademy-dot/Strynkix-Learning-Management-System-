import 'server-only';

/**
 * POST /api/feedback — structured student feedback and staff summaries (src/lib/server/feedback.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleFeedback } from '@/lib/server/feedback';

export async function POST(request: Request) {
  return handleContentRoute(request, 'feedback', (services, token, body) => handleFeedback(services, token, body));
}

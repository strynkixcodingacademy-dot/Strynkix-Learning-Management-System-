import 'server-only';

/**
 * POST /api/assessments — lesson activities and examinations: authoring,
 * student attempts, evaluation and result release (src/lib/server/assessments.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleAssessments } from '@/lib/server/assessments';

export async function POST(request: Request) {
  return handleContentRoute(request, 'assessments', (services, token, body) => handleAssessments(services, token, body), 512_000);
}

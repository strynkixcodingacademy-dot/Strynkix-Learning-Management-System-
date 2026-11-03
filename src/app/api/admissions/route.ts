import 'server-only';

/**
 * POST /api/admissions — admissions, staff onboarding and people records (src/lib/server/admissions.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleAdmissions } from '@/lib/server/admissions';

export async function POST(request: Request) {
  return handleContentRoute(request, 'admissions', (services, token, body) => handleAdmissions(services, token, body));
}

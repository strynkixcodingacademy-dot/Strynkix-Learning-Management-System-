import 'server-only';

/**
 * POST /api/certificates — certificate rules, eligibility, issue and revoke (src/lib/server/certificates.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleCertificates } from '@/lib/server/certificates';

export async function POST(request: Request) {
  return handleContentRoute(request, 'certificates', (services, token, body) => handleCertificates(services, token, body));
}

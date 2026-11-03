import 'server-only';

/**
 * POST /api/reports — financial and academic reports and export data (src/lib/server/reports.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleReports } from '@/lib/server/reports';

export async function POST(request: Request) {
  return handleContentRoute(request, 'reports', (services, token, body) => handleReports(services, token, body));
}

import 'server-only';

/**
 * POST /api/reporting — snapshot, job and reconciliation controls (Super Admin only; src/lib/server/reporting-admin.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleReporting } from '@/lib/server/reporting-admin';

export const maxDuration = 60;

export async function POST(request: Request) {
  return handleContentRoute(request, 'reporting', (services, token, body) => handleReporting(services, token, body));
}

import 'server-only';

/**
 * POST /api/attendance — attendance sheets, corrections (audited) and reports (src/lib/server/attendance.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleAttendance } from '@/lib/server/attendance';

export async function POST(request: Request) {
  return handleContentRoute(request, 'attendance', (services, token, body) => handleAttendance(services, token, body));
}

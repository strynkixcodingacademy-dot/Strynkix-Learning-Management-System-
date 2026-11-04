import 'server-only';

/**
 * POST /api/students — the Students register for branch managers and
 * administrators (src/lib/server/students.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleStudents } from '@/lib/server/students';

export async function POST(request: Request) {
  return handleContentRoute(request, 'students', (services, token, body) => handleStudents(services, token, body));
}

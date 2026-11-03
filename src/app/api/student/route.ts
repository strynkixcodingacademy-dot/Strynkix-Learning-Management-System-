import 'server-only';

/**
 * POST /api/student — the student’s own dashboard, courses and scores (src/lib/server/student-records.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleStudent } from '@/lib/server/student-records';

export async function POST(request: Request) {
  return handleContentRoute(request, 'student', (services, token, body) => handleStudent(services, token, body));
}

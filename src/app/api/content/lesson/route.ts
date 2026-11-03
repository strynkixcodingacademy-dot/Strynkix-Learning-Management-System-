import 'server-only';

/**
 * POST /api/content/lesson — save Block Studio content (draft lesson, or the
 * working revision of a published lesson) with its answer key, validated and
 * audited on the server (milestone G50).
 * Body: { lessonId, title, estimatedMinutes, blocks }
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { saveLessonFromStudio } from '@/lib/server/lesson-content';

export async function POST(request: Request) {
  return handleContentRoute(request, 'content/lesson', (services, token, body) => saveLessonFromStudio(services, token, body));
}

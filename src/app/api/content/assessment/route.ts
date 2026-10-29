import 'server-only';

/**
 * POST /api/content/assessment — replace a lesson's quiz questions and answer
 * key (Stage C2). Lets in-scope Assessment Designers manage assessments
 * without being able to edit the rest of the lesson.
 * Body: { lessonId, questions: QuizBlock[] (with correctOptionId and explanation) }
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { updateLessonAssessment } from '@/lib/server/assessment';

export async function POST(request: Request) {
  return handleContentRoute(request, 'content/assessment', (services, token, body) => updateLessonAssessment(services, token, body));
}

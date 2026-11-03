import 'server-only';

/**
 * POST /api/quiz/attempt — grade a keyed lesson quiz on the server (Stage C1).
 * Body: { courseId, lessonId, answers: { [questionBlockId]: optionId } }
 * Header: Authorization: Bearer <Firebase ID token>
 * The answer key never appears in any response or error message.
 */

import { AdminConfigError, getAdminServices } from '@/lib/server/firebase-admin';
import { QuizAttemptError, bearerToken, submitQuizAttempt } from '@/lib/server/quiz-attempts';

const MAX_BODY_BYTES = 16_384;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'invalid_request', message: 'The quiz submission is too large.' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid_request', message: 'The quiz submission is malformed.' });
  }

  try {
    const services = getAdminServices();
    const result = await submitQuizAttempt(services, bearerToken(request.headers.get('authorization')), body);
    return json(200, result);
  } catch (err) {
    if (err instanceof QuizAttemptError) {
      return json(
        err.status,
        { error: err.code, message: err.message, ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}) },
        err.retryAfterSeconds ? { 'Retry-After': String(err.retryAfterSeconds) } : {}
      );
    }
    // Configuration problems and unexpected failures: log server-side, return nothing specific.
    console.error('[quiz/attempt]', err instanceof AdminConfigError ? err.message : err);
    return json(err instanceof AdminConfigError ? 503 : 500, { error: 'unavailable', message: 'Quiz grading is unavailable right now. Try again later.' });
  }
}

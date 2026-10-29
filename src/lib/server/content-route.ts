/**
 * Strynkix LMS — shared plumbing for the trusted content routes (Stage C2):
 * body limits, ID-token verification and error mapping. Error responses carry
 * only a code and a human message.
 */

import type { Auth } from 'firebase-admin/auth';
import { AdminConfigError, getAdminServices } from '@/lib/server/firebase-admin';
import { bearerToken } from '@/lib/server/quiz-attempts';
import { ReviewError } from '@/lib/review/workflow';

const MAX_BODY_BYTES = 65_536;

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Verifies a Firebase ID token (revoked and disabled accounts are refused). */
export async function verifyCaller(auth: Auth, idToken: string | null): Promise<string> {
  if (!idToken) throw new ReviewError(401, 'unauthenticated', 'Sign in to continue.');
  try {
    return (await auth.verifyIdToken(idToken, true)).uid;
  } catch {
    throw new ReviewError(401, 'unauthenticated', 'Your session has expired. Sign in again.');
  }
}

export async function handleContentRoute(
  request: Request,
  label: string,
  run: (services: ReturnType<typeof getAdminServices>, idToken: string | null, body: unknown) => Promise<unknown>
): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'invalid_request', message: 'The request is too large.' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid_request', message: 'The request is malformed.' });
  }
  try {
    return json(200, await run(getAdminServices(), bearerToken(request.headers.get('authorization')), body));
  } catch (err) {
    if (err instanceof ReviewError) return json(err.status, { error: err.code, message: err.message });
    console.error(`[${label}]`, err instanceof AdminConfigError ? err.message : err);
    return json(err instanceof AdminConfigError ? 503 : 500, { error: 'unavailable', message: 'This action is unavailable right now. Try again later.' });
  }
}

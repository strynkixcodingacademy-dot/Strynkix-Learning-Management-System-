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

/**
 * Firestore gave up on a transaction because another one held the same
 * documents (gRPC ABORTED, after the SDK's own retries). Nothing was written,
 * so the caller can simply try again.
 */
export function isContention(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 10 || code === 'aborted' || code === 'ABORTED';
}

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
  run: (services: ReturnType<typeof getAdminServices>, idToken: string | null, body: unknown) => Promise<unknown>,
  maxBytes: number = MAX_BODY_BYTES
): Promise<Response> {
  const raw = await request.text();
  if (raw.length > maxBytes) return json(413, { error: 'invalid_request', message: 'The request is too large.' });
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
    if (isContention(err)) return json(409, { error: 'busy', message: 'Someone else was saving this at the same moment. Nothing was recorded; try again.' });
    console.error(`[${label}]`, err instanceof AdminConfigError ? err.message : err);
    return json(err instanceof AdminConfigError ? 503 : 500, { error: 'unavailable', message: 'This action is unavailable right now. Try again later.' });
  }
}

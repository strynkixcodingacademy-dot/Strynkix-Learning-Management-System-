/**
 * Strynkix LMS — calls to the trusted server routes (Stage C1/C2). Sends the
 * signed-in user's Firebase ID token; identity is never sent in the body.
 */

import { auth } from '@/lib/firebase/client';

/** A request the server refused, with its error code and a human message. */
export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryAfterSeconds?: number) {
    super(message);
  }
}

export async function postWithIdToken<T>(path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError('unauthenticated', 'Sign in to continue.');
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 'We couldn’t reach the server. Check your connection and try again.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(json?.error ?? 'unavailable', json?.message ?? 'This action is unavailable right now. Try again later.', json?.retryAfterSeconds);
  }
  return json as T;
}

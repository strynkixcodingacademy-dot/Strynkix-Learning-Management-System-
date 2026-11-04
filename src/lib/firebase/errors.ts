/**
 * Strynkix LMS — readable messages for Firestore errors. Our own errors (thrown
 * validation messages, ApiError from the server) pass through; Firebase's
 * wording ("Missing or insufficient permissions.") never reaches the screen.
 */

import { FirebaseError } from 'firebase/app';

const FIRESTORE_MESSAGES: Record<string, string> = {
  'permission-denied': "You don't have access to this, or it changed since you opened the page. Refresh and try again.",
  unavailable: "Can't reach the server right now. Check your connection and try again.",
  'deadline-exceeded': 'The server took too long to answer. Try again.',
  'failed-precondition': 'This changed since you opened it. Refresh the page and try again.',
  aborted: 'Someone else changed this at the same time. Refresh the page and try again.',
  'not-found': 'This no longer exists. Refresh the page.',
  'resource-exhausted': 'Too many requests right now. Wait a moment and try again.',
};

export function firestoreErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof FirebaseError) {
    return FIRESTORE_MESSAGES[err.code.replace(/^firestore\//, '')] ?? fallback;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

import { describe, it, expect } from 'vitest';
import { FirebaseError } from 'firebase/app';
import { firestoreErrorMessage } from '@/lib/firebase/errors';
import { ApiError } from '@/lib/api/authed';

describe('firestoreErrorMessage', () => {
  it('replaces Firebase wording with a readable message', () => {
    const denied = new FirebaseError('permission-denied', 'Missing or insufficient permissions.');
    expect(firestoreErrorMessage(denied, 'Could not save.')).toMatch(/don't have access/);
    expect(firestoreErrorMessage(new FirebaseError('firestore/unavailable', 'x'), 'Could not save.')).toMatch(/Can't reach the server/);
  });

  it('falls back for Firebase codes without a message of their own', () => {
    expect(firestoreErrorMessage(new FirebaseError('invalid-argument', 'Unsupported field value: undefined'), 'Could not save draft.')).toBe('Could not save draft.');
  });

  it('keeps our own messages, including server ApiErrors that carry a code', () => {
    expect(firestoreErrorMessage(new Error('Batch not found'), 'x')).toBe('Batch not found');
    expect(firestoreErrorMessage(new ApiError('invalid_request', 'Pick a course first.'), 'x')).toBe('Pick a course first.');
    expect(firestoreErrorMessage('boom', 'Could not save.')).toBe('Could not save.');
  });
});

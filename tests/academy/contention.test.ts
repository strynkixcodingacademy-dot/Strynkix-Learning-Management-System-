import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { isContention } = await import('@/lib/server/content-route');

describe('isContention', () => {
  it('recognises a transaction Firestore gave up on (gRPC ABORTED)', () => {
    expect(isContention({ code: 10, message: '10 ABORTED: Transaction lock timeout.' })).toBe(true);
    expect(isContention({ code: 'aborted' })).toBe(true);
  });

  it('leaves other failures alone', () => {
    expect(isContention({ code: 7 })).toBe(false); // PERMISSION_DENIED
    expect(isContention(new Error('boom'))).toBe(false);
    expect(isContention(null)).toBe(false);
  });
});

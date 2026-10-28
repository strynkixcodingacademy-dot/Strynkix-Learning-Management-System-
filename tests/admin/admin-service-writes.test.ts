/**
 * Phase 8 regression — optional admin form fields left blank must not reach
 * Firestore as `undefined` (setDoc rejects those, which blocked branch and
 * organization creation whenever City/State or Website/Logo were empty).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const writes: unknown[] = [];

vi.mock('@/lib/firebase/client', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((_db: unknown, ...segments: string[]) => segments.join('/')),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  setDoc: vi.fn(async (_ref: unknown, data: unknown) => {
    writes.push(data);
  }),
}));

import { createBranch, createOrganization } from '@/lib/admin/service';

function undefinedPaths(value: unknown, prefix = ''): string[] {
  if (value === undefined) return [prefix || '(root)'];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => undefinedPaths(v, prefix ? `${prefix}.${k}` : k));
}

beforeEach(() => {
  writes.length = 0;
});

describe('admin service writes', () => {
  it('createBranch with blank City and State writes no undefined fields', async () => {
    await createBranch({ id: 'branch_qa', orgId: 'strynkix', name: 'QA Campus', code: 'QA-01', country: 'India' });
    expect(writes).toHaveLength(1);
    expect(undefinedPaths(writes[0])).toEqual([]);
    expect(writes[0]).toMatchObject({ location: { country: 'India', isRemote: false } });
    expect((writes[0] as { location: object }).location).not.toHaveProperty('city');
  });

  it('createBranch keeps City and State when they are provided', async () => {
    await createBranch({ id: 'branch_qa', orgId: 'strynkix', name: 'QA Campus', code: 'QA-01', country: 'India', city: 'Mumbai', state: 'Maharashtra' });
    expect(writes[0]).toMatchObject({ location: { city: 'Mumbai', state: 'Maharashtra' } });
  });

  it('createOrganization with no website or logo writes no undefined fields', async () => {
    await createOrganization({ id: 'qa_academy', name: 'QA Academy', slug: 'qa-academy' });
    expect(writes).toHaveLength(1);
    expect(undefinedPaths(writes[0])).toEqual([]);
    expect(writes[0]).not.toHaveProperty('website');
  });
});

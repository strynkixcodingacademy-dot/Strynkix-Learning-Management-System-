import { describe, it, expect } from 'vitest';
import { getRoleDefaultRedirect, safeRedirectPath } from '@/lib/auth/redirect';

describe('Role Default Redirects', () => {
  // Stage 7: the Live Books dashboard (/dashboard) is the student home page.
  it('redirects student to the Live Books dashboard', () => {
    expect(getRoleDefaultRedirect('student')).toBe('/dashboard');
  });

  it('redirects instructor to /dashboard', () => {
    expect(getRoleDefaultRedirect('instructor')).toBe('/dashboard');
  });

  it('redirects branch_admin to /dashboard', () => {
    expect(getRoleDefaultRedirect('branch_admin')).toBe('/dashboard');
  });

  it('redirects university_admin to /dashboard', () => {
    expect(getRoleDefaultRedirect('university_admin')).toBe('/dashboard');
  });

  it('redirects super_admin to /dashboard', () => {
    expect(getRoleDefaultRedirect('super_admin')).toBe('/dashboard');
  });

  it('defaults undefined or unknown role to /dashboard', () => {
    expect(getRoleDefaultRedirect(undefined)).toBe('/dashboard');
  });
});

// Stage C7 security fix: the login page's ?redirect= was an open redirect.
describe('safeRedirectPath', () => {
  it('keeps same-origin paths with their query and hash', () => {
    expect(safeRedirectPath('/courses/c1/lessons/l1')).toBe('/courses/c1/lessons/l1');
    expect(safeRedirectPath('/dashboard?tab=people#top')).toBe('/dashboard?tab=people#top');
  });
  it('rejects anything that could leave the site', () => {
    for (const p of ['//evil.example', '//evil.example/path', '/\\evil.example', '/\\/evil.example', 'https://evil.example', 'javascript:alert(1)', 'evil', '', '/\tfoo', '/%0d%0aLocation:x']) {
      const r = safeRedirectPath(p);
      if (r !== null) expect(r.startsWith('/') && !r.startsWith('//')).toBe(true);
    }
    expect(safeRedirectPath('//evil.example')).toBeNull();
    expect(safeRedirectPath('/\\evil.example')).toBeNull();
    expect(safeRedirectPath('https://evil.example')).toBeNull();
    expect(safeRedirectPath('javascript:alert(1)')).toBeNull();
    expect(safeRedirectPath(null)).toBeNull();
  });
});


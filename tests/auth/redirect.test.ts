import { describe, it, expect } from 'vitest';
import { getRoleDefaultRedirect } from '@/lib/auth/redirect';

describe('Role Default Redirects', () => {
  it('redirects student to /courses catalog', () => {
    expect(getRoleDefaultRedirect('student')).toBe('/courses');
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

'use client';

/**
 * Strynkix Live Books — application shell.
 * One navigation frame for every signed-in page: a calm sidebar on desktop, a top
 * bar with an accessible drawer on mobile, and a "bare" variant for focused
 * reading. Navigation is role-aware; Firestore rules remain the security boundary.
 */

import React, { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { BrandMark } from '@/components/ui/Illustrations';
import { cx } from '@/components/ui/tones';
import { UserRole } from '@/types/domain';
import {
  BookOpen,
  Building2,
  GitBranch,
  Home,
  LogOut,
  Menu,
  PenTool,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
  group: 'Home' | 'Learn' | 'Teach' | 'Manage';
}

const ALL: UserRole[] = ['super_admin', 'university_admin', 'branch_admin', 'instructor', 'student'];
const STAFF: UserRole[] = ['super_admin', 'university_admin', 'branch_admin', 'instructor'];

const NAV_ITEMS: NavItem[] = [
  { name: 'Home', href: '/dashboard', icon: Home, roles: ALL, group: 'Home' },
  { name: 'My Courses', href: '/courses', icon: BookOpen, roles: ['student'], group: 'Learn' },
  { name: 'My Batches', href: '/dashboard/batches', icon: Users, roles: ['instructor'], group: 'Teach' },
  { name: 'Batches & Enrollment', href: '/dashboard/batches', icon: Users, roles: ['super_admin', 'university_admin', 'branch_admin'], group: 'Teach' },
  { name: 'Course Authoring', href: '/dashboard/courses', icon: PenTool, roles: STAFF, group: 'Teach' },
  { name: 'Live Books Preview', href: '/courses', icon: BookOpen, roles: STAFF, group: 'Teach' },
  { name: 'Branches', href: '/dashboard/branches', icon: GitBranch, roles: ['super_admin', 'university_admin'], group: 'Manage' },
  { name: 'Organizations', href: '/dashboard/organizations', icon: Building2, roles: ['super_admin'], group: 'Manage' },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  university_admin: 'University Admin',
  branch_admin: 'Branch Manager',
  instructor: 'Instructor',
  student: 'Student',
};

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  const groups = (['Home', 'Learn', 'Teach', 'Manage'] as const).filter((g) => items.some((i) => i.group === g));
  // Group headings only help when there is more than one group to tell apart.
  const labelled = groups.filter((g) => g !== 'Home').length > 1;
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group} className="space-y-1">
          {group !== 'Home' && labelled && (
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">{group}</div>
          )}
          {items.filter((i) => i.group === group).map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={`${item.href}-${item.name}`}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-150',
                  active ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-surface-muted hover:text-ink'
                )}
              >
                <Icon className={cx('w-[18px] h-[18px] shrink-0', active ? 'text-brand' : 'text-ink-3 group-hover:text-ink-2')} />
                {item.name}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function UserCard({ onSignOut }: { onSignOut: () => void }) {
  const { profile, tenant } = useAuth();
  const initial = (profile?.displayName || profile?.email || '?').charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-sm font-bold text-warning-ink" aria-hidden="true">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{profile?.displayName || 'Signed in'}</div>
        <div className="truncate text-xs text-ink-3">{tenant ? ROLE_LABELS[tenant.role] : ''}</div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger-ink"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}

interface AppShellProps {
  children: ReactNode;
  /** Optional plain page title for pages that do not render their own PageHeader. */
  pageTitle?: string;
  /** Focused layout without the sidebar (lesson reading). */
  bare?: boolean;
  /** Content for the bare layout's top bar (e.g. breadcrumbs). */
  topBar?: ReactNode;
}

export function AppShell({ children, pageTitle, bare = false, topBar }: AppShellProps) {
  const { tenant, signOut } = useAuth();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = NAV_ITEMS.filter((i) => tenant && i.roles.includes(tenant.role));

  // Close the drawer on Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out failed:', err);
    }
  };

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5 rounded-lg" aria-label="Strynkix Live Books home">
      <BrandMark size={32} />
      <span className="leading-tight">
        <span className="block text-[15px] font-extrabold tracking-tight text-ink">Live Books</span>
        <span className="hidden text-[11px] font-medium text-ink-3 sm:block">Strynkix Coding Academy</span>
      </span>
    </Link>
  );

  return (
    <RequireAuth>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lift">
        Skip to content
      </a>
      <div className="flex min-h-screen bg-canvas text-ink">
        {/* Desktop sidebar */}
        {!bare && (
          <aside className="hidden lg:flex w-64 shrink-0 flex-col gap-6 border-r border-line bg-surface px-4 py-5 sticky top-0 h-screen">
            {brand}
            <nav aria-label="Main" className="flex-1 overflow-y-auto">
              <NavList items={items} pathname={pathname} />
            </nav>
            <UserCard onSignOut={handleSignOut} />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar: mobile always; desktop only in bare mode */}
          <header className={cx('sticky top-0 z-40 border-b border-line bg-surface/95', bare ? '' : 'lg:hidden')}>
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
              {!bare && (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-muted"
                  aria-label="Open navigation"
                  aria-expanded={drawerOpen}
                  aria-controls="mobile-nav"
                >
                  <Menu className="w-5 h-5" />
                </button>
              )}
              {brand}
              <div className="ml-auto flex min-w-0 items-center gap-2">{topBar}</div>
            </div>
          </header>

          <main id="main" className={cx('flex-1', bare ? '' : 'mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10')}>
            {pageTitle && (
              <h1 className="mb-6 font-display text-2xl sm:text-[28px] font-extrabold tracking-tight text-ink">{pageTitle}</h1>
            )}
            {children}
          </main>
        </div>

        {/* Mobile drawer */}
        {!bare && drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button type="button" className="absolute inset-0 bg-ink/30 animate-fade" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
            <div id="mobile-nav" className="relative flex h-full w-72 max-w-[85vw] flex-col gap-6 bg-surface px-4 py-5 shadow-lift animate-rise">
              <div className="flex items-center justify-between">
                {brand}
                <button type="button" onClick={() => setDrawerOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted" aria-label="Close navigation">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav aria-label="Main" className="flex-1 overflow-y-auto">
                <NavList items={items} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <UserCard onSignOut={handleSignOut} />
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}

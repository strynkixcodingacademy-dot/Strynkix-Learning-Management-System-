'use client';

/**
 * Strynkix Live Books — application shell.
 * One navigation frame for every signed-in page: a silver sidebar and a light
 * top bar on desktop, a drawer on mobile, a "bare" variant for focused reading,
 * and the help assistant on every page. Navigation is role-aware; Firestore
 * rules remain the security boundary.
 */

import React, { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { BrandMark } from '@/components/ui/Illustrations';
import { Avatar } from '@/components/ui/DataViz';
import { cx } from '@/components/ui/tones';
import { HelpAssistant, openHelpAssistant } from '@/components/help/HelpAssistant';
import { UserRole } from '@/types/domain';
import {
  BarChart3,
  BookOpen,
  Building2,
  CircleHelp,
  GitBranch,
  Home,
  LifeBuoy,
  LogOut,
  Menu,
  PenTool,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';

type NavGroup = 'Overview' | 'Learn' | 'Teach' | 'Manage' | 'Support';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
  group: NavGroup;
}

const ALL: UserRole[] = ['super_admin', 'university_admin', 'branch_admin', 'instructor', 'student'];
const STAFF: UserRole[] = ['super_admin', 'university_admin', 'branch_admin', 'instructor'];

const NAV_ITEMS: NavItem[] = [
  { name: 'Home', href: '/dashboard', icon: Home, roles: ALL, group: 'Overview' },
  { name: 'My Progress', href: '/dashboard/analytics', icon: BarChart3, roles: ['student'], group: 'Overview' },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, roles: STAFF, group: 'Overview' },
  { name: 'My Courses', href: '/courses', icon: BookOpen, roles: ['student'], group: 'Learn' },
  { name: 'My Batches', href: '/dashboard/batches', icon: Users, roles: ['instructor'], group: 'Teach' },
  { name: 'Batches & Enrollment', href: '/dashboard/batches', icon: Users, roles: ['super_admin', 'university_admin', 'branch_admin'], group: 'Teach' },
  { name: 'Course Authoring', href: '/dashboard/courses', icon: PenTool, roles: STAFF, group: 'Teach' },
  { name: 'Live Books Preview', href: '/courses', icon: BookOpen, roles: STAFF, group: 'Teach' },
  { name: 'People', href: '/dashboard/people', icon: UsersRound, roles: ['super_admin', 'branch_admin'], group: 'Manage' },
  { name: 'Branches', href: '/dashboard/branches', icon: GitBranch, roles: ['super_admin', 'university_admin'], group: 'Manage' },
  { name: 'Organizations', href: '/dashboard/organizations', icon: Building2, roles: ['super_admin'], group: 'Manage' },
  { name: 'User Guide', href: '/dashboard/guide', icon: LifeBuoy, roles: ALL, group: 'Support' },
];

const GROUPS: NavGroup[] = ['Overview', 'Learn', 'Teach', 'Manage', 'Support'];

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
  const groups = GROUPS.filter((g) => items.some((i) => i.group === g));
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group} className="space-y-0.5">
          <div className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-4">{group}</div>
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
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition-[background-color,color,box-shadow] duration-150',
                  active
                    ? 'bg-surface text-ink shadow-card ring-1 ring-line'
                    : 'text-ink-2 hover:bg-surface/70 hover:text-ink'
                )}
              >
                {active && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-brand" />}
                <span className={cx(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors',
                  active ? 'bg-brand text-white' : 'bg-surface-muted text-ink-3 group-hover:text-ink-2'
                )}>
                  <Icon className="w-[15px] h-[15px]" />
                </span>
                <span>{item.name}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function UserCard({ onSignOut, onNavigate }: { onSignOut: () => void; onNavigate?: () => void }) {
  const { profile, tenant } = useAuth();
  const name = profile?.displayName || profile?.email || 'Signed in';
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-card">
      <Link href="/dashboard/profile" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 hover:bg-surface-muted" title="My Profile">
        <Avatar name={name} size={34} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold text-ink">{name}</span>
          <span className="block truncate text-[11px] font-semibold text-ink-3">{tenant ? ROLE_LABELS[tenant.role] : ''}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger-ink"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}

/** Desktop icon rail: compact, with a label that appears on hover and keyboard focus. */
function Rail({ items, pathname, onSignOut }: { items: NavItem[]; pathname: string; onSignOut: () => void }) {
  const { profile, tenant } = useAuth();
  const name = profile?.displayName || profile?.email || '?';
  const groups = GROUPS.filter((g) => g !== 'Support' && items.some((i) => i.group === g));
  const tip = 'pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lift transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100';
  const railLink = (active: boolean) => cx(
    'group relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors',
    active ? 'bg-brand-soft text-brand' : 'text-ink-3 hover:bg-surface-muted hover:text-ink'
  );
  return (
    <aside className="sticky top-0 z-40 hidden h-screen w-[76px] shrink-0 flex-col items-center border-r border-line bg-surface py-4 lg:flex">
      <Link href="/dashboard" className="group relative mb-3 rounded-xl" aria-label="Strynkix Live Books home">
        <BrandMark size={38} />
        <span className={tip}>Live Books home</span>
      </Link>
      <span aria-hidden="true" className="mb-3 h-px w-8 bg-line" />
      <nav aria-label="Main" className="flex flex-1 flex-col items-center gap-1">
        {groups.map((group, gi) => (
          <React.Fragment key={group}>
            {gi > 0 && <span aria-hidden="true" className="my-2 h-px w-6 bg-line" />}
            {items.filter((i) => i.group === group).map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link key={`${item.href}-${item.name}`} href={item.href} aria-label={item.name} aria-current={active ? 'page' : undefined} className={railLink(active)}>
                  {active && <span aria-hidden="true" className="absolute -left-[16px] top-2 bottom-2 w-[3px] rounded-r-full bg-brand" />}
                  <Icon className="h-[20px] w-[20px]" />
                  <span className={tip}>{item.name}</span>
                </Link>
              );
            })}
          </React.Fragment>
        ))}
      </nav>
      <div className="flex flex-col items-center gap-2 pt-3">
        <Link href="/dashboard/guide" aria-label="User Guide" aria-current={isActive(pathname, '/dashboard/guide') ? 'page' : undefined} className={railLink(isActive(pathname, '/dashboard/guide'))}>
          <LifeBuoy className="h-[20px] w-[20px]" />
          <span className={tip}>User Guide</span>
        </Link>
        <button type="button" onClick={onSignOut} aria-label="Sign out" className="group relative flex h-11 w-11 items-center justify-center rounded-xl text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger-ink">
          <LogOut className="h-[18px] w-[18px]" />
          <span className={tip}>Sign out</span>
        </button>
        <span aria-hidden="true" className="h-px w-8 bg-line" />
        <Link href="/dashboard/profile" aria-label={`My Profile (${name})`} className="group relative mt-1 flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-muted text-[13px] font-extrabold text-ink-2 hover:border-brand-line">
          {name.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('')}
          <span className={tip}>{name}{tenant ? ` · ${ROLE_LABELS[tenant.role]}` : ''}</span>
        </Link>
      </div>
    </aside>
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
  const { tenant, profile, signOut } = useAuth();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = NAV_ITEMS.filter((i) => tenant && i.roles.includes(tenant.role));
  const current = [...items].sort((a, b) => b.href.length - a.href.length).find((i) => isActive(pathname, i.href));

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
      <BrandMark size={34} />
      <span className="leading-tight">
        <span className="block text-[16px] font-extrabold tracking-tight text-ink">Live Books</span>
        <span className="hidden text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-3 sm:block">Strynkix Academy</span>
      </span>
    </Link>
  );

  const helpButton = (
    <button
      type="button"
      onClick={openHelpAssistant}
      className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-ink-2 shadow-card transition-colors hover:border-silver hover:text-ink"
    >
      <CircleHelp className="w-4 h-4 text-brand" />
      <span className="hidden sm:inline">Ask for help</span>
    </button>
  );

  return (
    <RequireAuth>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lift">
        Skip to content
      </a>
      <div className="flex min-h-screen bg-canvas text-ink">
        {/* Desktop icon rail */}
        {!bare && <Rail items={items} pathname={pathname} onSignOut={handleSignOut} />}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar: mobile always; desktop shows section + help */}
          <header className={cx('sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md', !bare && 'lg:hidden')}>
            <div className={cx('flex h-14 items-center gap-3 px-4 sm:px-6', bare ? 'mx-auto max-w-7xl' : 'lg:px-10')}>
              {!bare && (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-muted lg:hidden"
                  aria-label="Open navigation"
                  aria-expanded={drawerOpen}
                  aria-controls="mobile-nav"
                >
                  <Menu className="w-5 h-5" />
                </button>
              )}
              <div className={bare ? '' : 'lg:hidden'}>{brand}</div>
              {!bare && current && (
                <div className="hidden min-w-0 items-center gap-2 text-[13px] font-semibold text-ink-3 lg:flex">
                  <current.icon className="w-4 h-4 text-ink-4" />
                  <span className="truncate">{current.name}</span>
                </div>
              )}
              <div className="ml-auto flex min-w-0 items-center gap-2">
                {topBar}
                {helpButton}
                {!bare && (
                  <Link href="/dashboard/profile" className="hidden rounded-full ring-offset-2 hover:ring-2 hover:ring-brand-line sm:block lg:hidden" aria-label="My Profile">
                    <Avatar name={profile?.displayName || profile?.email || '?'} size={32} />
                  </Link>
                )}
              </div>
            </div>
          </header>

          <main id="main" className={cx('flex-1', bare ? 'pb-24' : 'mx-auto w-full max-w-[1320px] px-4 pt-7 pb-28 sm:px-6 lg:px-12 lg:pt-12')}>
            {pageTitle && (
              <h1 className="mb-6 text-[26px] font-extrabold tracking-tight text-ink sm:text-[30px]">{pageTitle}</h1>
            )}
            {children}
          </main>
        </div>

        {/* Mobile drawer */}
        {!bare && drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button type="button" className="absolute inset-0 bg-ink/20 backdrop-blur-[3px] animate-fade" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
            <div id="mobile-nav" className="relative flex h-full w-[290px] max-w-[85vw] flex-col gap-5 bg-gradient-to-b from-silver-soft via-canvas to-silver-soft px-4 py-5 shadow-float animate-rise">
              <div className="flex items-center justify-between">
                {brand}
                <button type="button" onClick={() => setDrawerOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface" aria-label="Close navigation">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav aria-label="Main" className="flex-1 overflow-y-auto">
                <NavList items={items} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <UserCard onSignOut={handleSignOut} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}
      </div>
      <HelpAssistant />
    </RequireAuth>
  );
}


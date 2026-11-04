'use client';

/**
 * Strynkix Live Books — application shell.
 * One navigation frame for every signed-in page: a rail of labelled categories
 * on desktop (each opens a hub of its pages), a top bar with global search and
 * where you are, a drawer on mobile, a "bare" variant for focused reading, and
 * the help assistant on every page. Navigation is role-aware; Firestore rules
 * remain the security boundary.
 */

import React, { ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { BrandMark } from '@/components/ui/Illustrations';
import { Avatar } from '@/components/ui/DataViz';
import { cx } from '@/components/ui/tones';
import { HelpAssistant, openHelpAssistant } from '@/components/help/HelpAssistant';
import { GlobalSearch, openGlobalSearch, SearchTrigger } from '@/components/search/GlobalSearch';
import { ThemeSwitch } from '@/components/ui/ThemeSwitch';
import {
  activeCategory,
  categoriesFor,
  CATEGORIES,
  currentFeature,
  featuresFor,
  HOME_HREF,
  isActivePath,
  type CategoryGroup,
} from '@/lib/navigation/catalog';
import { UserRole } from '@/types/domain';
import { ChevronRight, CircleHelp, Home, LifeBuoy, LogOut, Menu, Search, UserRound, X } from 'lucide-react';

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  university_admin: 'University Admin',
  branch_admin: 'Branch Manager',
  instructor: 'Instructor',
  student: 'Student',
  content_lead: 'Content Lead',
  content_designer: 'Content Designer',
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
}

/** Mobile drawer: Home, then each category with its pages, then account pages. */
function NavList({ groups, role, pathname, onNavigate }: { groups: CategoryGroup[]; role?: UserRole; pathname: string; onNavigate?: () => void }) {
  const account = featuresFor(role).filter((f) => !f.category);
  const link = (key: string, href: string, label: string, Icon: React.ElementType) => {
    const active = isActivePath(pathname, href);
    return (
      <Link
        key={key}
        href={href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition-[background-color,color,box-shadow] duration-150',
          active ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-ink-2 hover:bg-surface/70 hover:text-ink'
        )}
      >
        {active && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-brand" />}
        <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors', active ? 'bg-brand text-white' : 'bg-surface-muted text-ink-3 group-hover:text-ink-2')}>
          <Icon className="w-[15px] h-[15px]" />
        </span>
        <span>{label}</span>
      </Link>
    );
  };
  return (
    <div className="space-y-5">
      <div className="space-y-0.5">{link('home', HOME_HREF, 'Home', Home)}</div>
      {groups.map(({ category, features }) => (
        <div key={category.id} className="space-y-0.5">
          <div className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-4">{category.name}</div>
          {features.map((f) => link(`${category.id}-${f.href}`, f.href, f.name, f.icon))}
        </div>
      ))}
      <div className="space-y-0.5">
        <div className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-4">Account</div>
        {account.map((f) => link(`acct-${f.href}`, f.href, f.name, f.icon))}
        <ThemeSwitch className="mx-3 mt-2" />
      </div>
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

/** The avatar button and its menu: profile, guide, help and sign out. */
function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const { profile, tenant } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = profile?.displayName || profile?.email || '?';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] font-semibold text-ink-2 hover:bg-surface-muted hover:text-ink';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu (${name})`}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-muted text-[13px] font-extrabold text-ink-2 hover:border-brand-line"
      >
        {initials(name)}
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute bottom-0 left-full z-50 ml-3 w-64 rounded-2xl border border-line bg-surface p-2 shadow-float animate-rise">
          <div className="flex items-center gap-2.5 border-b border-line px-2 pb-3 pt-1">
            <Avatar name={name} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-bold text-ink">{name}</span>
              <span className="block truncate text-[11.5px] font-semibold text-ink-3">{tenant ? ROLE_LABELS[tenant.role] : ''}</span>
            </span>
          </div>
          <div className="border-b border-line px-1 py-2.5">
            <ThemeSwitch />
          </div>
          <div className="pt-2">
            <Link role="menuitem" href="/dashboard/profile" onClick={() => setOpen(false)} className={item}><UserRound className="h-4 w-4" /> My Profile</Link>
            <Link role="menuitem" href="/dashboard/guide" onClick={() => setOpen(false)} className={item}><LifeBuoy className="h-4 w-4" /> User Guide</Link>
            <button role="menuitem" type="button" onClick={() => { setOpen(false); openHelpAssistant(); }} className={item}><CircleHelp className="h-4 w-4" /> Ask for help</button>
            <button role="menuitem" type="button" onClick={onSignOut} className={cx(item, 'hover:bg-danger-soft hover:text-danger-ink')}><LogOut className="h-4 w-4" /> Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Desktop rail: Home and the role's categories, each with its name under the icon. */
function Rail({ groups, active, pathname, onSignOut }: { groups: CategoryGroup[]; active?: string; pathname: string; onSignOut: () => void }) {
  const railLink = (on: boolean) => cx(
    'relative flex w-[68px] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold leading-tight transition-colors',
    on ? 'bg-brand-soft text-brand-ink' : 'text-ink-3 hover:bg-surface-muted hover:text-ink'
  );
  const marker = <span aria-hidden="true" className="absolute -left-[8px] top-2 bottom-2 w-[3px] rounded-r-full bg-brand" />;
  const home = pathname === HOME_HREF;
  return (
    <aside className="sticky top-0 z-40 hidden h-screen w-[84px] shrink-0 flex-col items-center border-r border-line bg-surface py-4 lg:flex print:!hidden">
      <Link href={HOME_HREF} className="mb-3 rounded-xl" aria-label="Strynkix Live Books home">
        <BrandMark size={38} />
      </Link>
      <span aria-hidden="true" className="mb-3 h-px w-10 bg-line" />
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto [scrollbar-width:none]">
        <Link href={HOME_HREF} aria-current={home ? 'page' : undefined} className={railLink(home)}>
          {home && marker}
          <Home className="h-[20px] w-[20px]" />
          <span>Home</span>
        </Link>
        {groups.map(({ category, href }) => {
          const on = active === category.id;
          const Icon = category.icon;
          return (
            <Link key={category.id} href={href} aria-current={on ? 'page' : undefined} title={category.description} className={railLink(on)}>
              {on && marker}
              <Icon className="h-[20px] w-[20px]" />
              <span>{category.name}</span>
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col items-center gap-2 pt-3">
        <NotificationBell align="rail" />
        <span aria-hidden="true" className="h-px w-10 bg-line" />
        <AccountMenu onSignOut={onSignOut} />
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
  /** Desktop: the page fills exactly one screen and does not scroll (home board). */
  fit?: boolean;
}

export function AppShell({ children, pageTitle, bare = false, topBar, fit = false }: AppShellProps) {
  const { tenant, profile, signOut } = useAuth();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const role = tenant?.role;
  const groups = categoriesFor(role);
  const activeId = activeCategory(pathname, role);
  const category = CATEGORIES.find((c) => c.id === activeId);
  const group = groups.find((g) => g.category.id === activeId);
  const feature = currentFeature(pathname, role);

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

  // Where you are: Category › Page (the category links to its hub).
  const trail = !bare && (category || feature) && (
    <nav aria-label="You are here" className="hidden min-w-0 items-center gap-1.5 text-[13px] font-semibold text-ink-3 lg:flex">
      {category && group && (
        group.href === feature?.href
          ? <span className="truncate text-ink-2">{category.name}</span>
          : <Link href={group.href} className="truncate hover:text-ink">{category.name}</Link>
      )}
      {category && feature && feature.href !== group?.href && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-4" />}
      {feature && feature.href !== group?.href && <span className="truncate text-ink-2">{feature.name}</span>}
    </nav>
  );

  return (
    <RequireAuth>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lift">
        Skip to content
      </a>
      <div className="flex min-h-screen bg-canvas text-ink">
        {/* Desktop category rail */}
        {!bare && <Rail groups={groups} active={activeId} pathname={pathname} onSignOut={handleSignOut} />}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar: where you are, search, help */}
          <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md print:hidden">
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
              {trail}
              {!bare && (
                <div className="mx-auto hidden w-full max-w-[520px] md:block">
                  <SearchTrigger />
                </div>
              )}
              <div className="ml-auto flex min-w-0 items-center gap-2 md:ml-0">
                {topBar}
                {!bare && (
                  <button type="button" onClick={openGlobalSearch} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-muted md:hidden" aria-label="Open search">
                    <Search className="h-5 w-5" />
                  </button>
                )}
                {!bare && <div className="lg:hidden"><NotificationBell /></div>}
                {helpButton}
                {!bare && (
                  <Link href="/dashboard/profile" className="hidden rounded-full ring-offset-2 hover:ring-2 hover:ring-brand-line sm:block lg:hidden" aria-label="My Profile">
                    <Avatar name={profile?.displayName || profile?.email || '?'} size={32} />
                  </Link>
                )}
              </div>
            </div>
          </header>

          <main id="main" className={cx('flex-1 animate-fade', bare ? 'pb-24' : fit ? 'mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:h-[calc(100vh-57px)] lg:overflow-hidden lg:px-10 lg:py-7' : 'mx-auto w-full max-w-[1320px] px-4 pt-7 pb-28 sm:px-6 lg:px-12 lg:pt-10 print:max-w-none print:p-0')}>
            {pageTitle && (
              <h1 className="mb-6 text-[26px] font-extrabold tracking-tight text-ink sm:text-[30px]">{pageTitle}</h1>
            )}
            {children}
          </main>
        </div>

        {/* Mobile drawer */}
        {!bare && drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button type="button" className="absolute inset-0 bg-scrim backdrop-blur-[3px] animate-fade" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
            <div id="mobile-nav" className="relative flex h-full w-[290px] max-w-[85vw] flex-col gap-5 bg-gradient-to-b from-silver-soft via-canvas to-silver-soft px-4 py-5 shadow-float animate-rise">
              <div className="flex items-center justify-between">
                {brand}
                <button type="button" onClick={() => setDrawerOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface" aria-label="Close navigation">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav aria-label="Main" className="flex-1 overflow-y-auto">
                <NavList groups={groups} role={role} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <UserCard onSignOut={handleSignOut} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}
      </div>
      {!bare && <GlobalSearch />}
      <div className="print:hidden"><HelpAssistant showLauncher={!fit} /></div>
    </RequireAuth>
  );
}

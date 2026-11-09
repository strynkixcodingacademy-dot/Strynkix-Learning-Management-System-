'use client';

/**
 * Strynkix Live Books — application shell.
 * One navigation frame for every signed-in page: a labelled sidebar on desktop,
 * a drawer (plus a bottom bar for students) on phones, a slim top bar with help,
 * notifications and the profile, and the help assistant. Navigation is
 * role-aware; Firestore rules remain the security boundary.
 */

import React, { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { BrandMark } from '@/components/ui/Illustrations';
import { Avatar } from '@/components/ui/DataViz';
import { iconButtonClasses, IconButton } from '@/components/ui/Button';
import { cx } from '@/components/ui/tones';
import { HelpAssistant, openHelpAssistant } from '@/components/help/HelpAssistant';
import { UserRole } from '@/types/domain';
import {
  Award,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  FileText,
  Gauge,
  GitBranch,
  HelpCircle,
  Home,
  IndianRupee,
  LayoutDashboard,
  Library,
  LifeBuoy,
  LogOut,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  PenTool,
  Receipt,
  ScrollText,
  Sparkles,
  Trophy,
  UserPlus,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';

type NavGroup = 'Today' | 'Study' | 'Progress' | 'Career' | 'Campus' | 'Academy' | 'Teaching' | 'Content' | 'Finance' | 'Community' | 'Governance';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
  group: NavGroup;
}

const CONTENT: UserRole[] = ['content_lead', 'content_designer'];
const ALL: UserRole[] = ['super_admin', 'university_admin', 'branch_admin', 'instructor', 'student', ...CONTENT];
const STAFF: UserRole[] = ['super_admin', 'university_admin', 'branch_admin', 'instructor'];
const MANAGERS: UserRole[] = ['super_admin', 'university_admin', 'branch_admin'];
// Staff author drafts; Course Design members author in-scope drafts (rules enforce scope).
const AUTHORS: UserRole[] = [...STAFF, ...CONTENT];

// Navigation only shows the way; every route and API call authorizes on its own.
const NAV_ITEMS: NavItem[] = [
  { name: 'Home', href: '/dashboard', icon: Home, roles: ALL, group: 'Today' },
  { name: 'Command Centre', href: '/dashboard/command', icon: Gauge, roles: ['super_admin'], group: 'Today' },
  { name: 'My Teaching', href: '/dashboard/teaching', icon: ClipboardCheck, roles: ['instructor'], group: 'Today' },
  { name: 'Overview', href: '/dashboard/overview', icon: LayoutDashboard, roles: ['student'], group: 'Today' },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, roles: STAFF, group: 'Today' },

  { name: 'My Courses', href: '/dashboard/my-courses', icon: BookOpen, roles: ['student'], group: 'Study' },
  { name: 'Live Books', href: '/courses', icon: Library, roles: ['student'], group: 'Study' },
  { name: 'Assignments & Exams', href: '/dashboard/assessments', icon: ClipboardList, roles: ['student'], group: 'Study' },
  { name: 'Doubts', href: '/dashboard/doubts', icon: HelpCircle, roles: ['student'], group: 'Study' },

  { name: 'My Progress', href: '/dashboard/analytics', icon: BarChart3, roles: ['student'], group: 'Progress' },
  { name: 'My Scores', href: '/dashboard/scores', icon: Trophy, roles: ['student'], group: 'Progress' },
  { name: 'Attendance', href: '/dashboard/attendance', icon: CalendarCheck, roles: ['student'], group: 'Progress' },
  { name: 'Achievements', href: '/dashboard/achievements', icon: Sparkles, roles: ['student'], group: 'Progress' },

  { name: 'Certificates', href: '/dashboard/certificates', icon: Award, roles: ['student'], group: 'Career' },
  { name: 'Projects & Portfolio', href: '/dashboard/portfolio', icon: Briefcase, roles: ['student'], group: 'Career' },
  { name: 'Resume', href: '/dashboard/resume', icon: FileText, roles: ['student'], group: 'Career' },

  { name: 'Activities', href: '/dashboard/activities', icon: CalendarDays, roles: ['student'], group: 'Campus' },
  { name: 'Feedback', href: '/dashboard/feedback', icon: MessageSquareText, roles: ['student'], group: 'Campus' },
  { name: 'My Fees', href: '/dashboard/fees', icon: IndianRupee, roles: ['student'], group: 'Campus' },

  { name: 'Admissions', href: '/dashboard/admissions', icon: UserPlus, roles: MANAGERS, group: 'Academy' },
  { name: 'People', href: '/dashboard/people', icon: UsersRound, roles: MANAGERS, group: 'Academy' },
  { name: 'Batches & Enrollment', href: '/dashboard/batches', icon: Users, roles: MANAGERS, group: 'Academy' },
  { name: 'Branches', href: '/dashboard/branches', icon: GitBranch, roles: ['super_admin', 'university_admin'], group: 'Academy' },
  { name: 'Organizations', href: '/dashboard/organizations', icon: Building2, roles: ['super_admin'], group: 'Academy' },

  { name: 'My Batches', href: '/dashboard/batches', icon: Users, roles: ['instructor'], group: 'Teaching' },
  { name: 'Attendance', href: '/dashboard/attendance', icon: CalendarCheck, roles: STAFF, group: 'Teaching' },
  { name: 'Evaluate', href: '/dashboard/assessments', icon: ClipboardList, roles: STAFF, group: 'Teaching' },
  { name: 'Project reviews', href: '/dashboard/projects/review', icon: Briefcase, roles: STAFF, group: 'Teaching' },
  { name: 'Doubts', href: '/dashboard/doubts', icon: HelpCircle, roles: STAFF, group: 'Teaching' },
  { name: 'Certificates', href: '/dashboard/certificates', icon: Award, roles: STAFF, group: 'Teaching' },

  { name: 'Course Authoring', href: '/dashboard/courses', icon: PenTool, roles: AUTHORS, group: 'Content' },
  { name: 'Live Books', href: '/courses', icon: Library, roles: AUTHORS, group: 'Content' },

  { name: 'Finance', href: '/dashboard/finance', icon: IndianRupee, roles: MANAGERS, group: 'Finance' },
  { name: 'Expenses', href: '/dashboard/expenses', icon: Receipt, roles: MANAGERS, group: 'Finance' },
  { name: 'Reports', href: '/dashboard/reports', icon: FileBarChart, roles: MANAGERS, group: 'Finance' },

  { name: 'Engagement', href: '/dashboard/engagement', icon: Sparkles, roles: MANAGERS, group: 'Community' },
  { name: 'Activities', href: '/dashboard/activities', icon: CalendarDays, roles: STAFF, group: 'Community' },
  { name: 'Feedback', href: '/dashboard/feedback', icon: MessageSquareText, roles: STAFF, group: 'Community' },

  { name: 'Audit log', href: '/dashboard/audit', icon: ScrollText, roles: ['super_admin', 'university_admin'], group: 'Governance' },
];

/** Each role reads its groups in the order of its own working day. */
function groupOrder(role: UserRole): NavGroup[] {
  if (role === 'student') return ['Today', 'Study', 'Progress', 'Career', 'Campus'];
  if (role === 'instructor') return ['Today', 'Teaching', 'Content', 'Community'];
  if (role === 'content_lead' || role === 'content_designer') return ['Today', 'Content'];
  return ['Today', 'Academy', 'Teaching', 'Content', 'Finance', 'Community', 'Governance'];
}

/** The student's phone bar: the four places a student returns to all day. */
const STUDENT_TABS = [
  { name: 'Home', href: '/dashboard', icon: Home },
  { name: 'Courses', href: '/dashboard/my-courses', icon: BookOpen },
  { name: 'Work', href: '/dashboard/assessments', icon: ClipboardList },
  { name: 'Progress', href: '/dashboard/analytics', icon: BarChart3 },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  university_admin: 'University Admin',
  branch_admin: 'Branch Manager',
  instructor: 'Instructor',
  student: 'Student',
  content_lead: 'Content Lead',
  content_designer: 'Content Designer',
};

const COLLAPSED_KEY = 'lb-nav-collapsed';

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Wordmark({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 rounded-md" aria-label="Strynkix Live Books home">
      <BrandMark size={26} />
      <span className="font-display text-[1.1875rem] font-[560] leading-none tracking-[-0.01em] text-ink">Strynkix</span>
    </Link>
  );
}

function NavList({ items, order, pathname, onNavigate }: { items: NavItem[]; order: NavGroup[]; pathname: string; onNavigate?: () => void }) {
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY);
      if (raw) Promise.resolve(JSON.parse(raw) as string[]).then(setCollapsed);
    } catch { /* storage unavailable: every group stays open */ }
  }, []);

  const toggle = (group: string) => {
    const next = collapsed.includes(group) ? collapsed.filter((g) => g !== group) : [...collapsed, group];
    setCollapsed(next);
    try { window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
  };

  return (
    <div className="space-y-4">
      {order.filter((g) => items.some((i) => i.group === g)).map((group) => {
        const groupItems = items.filter((i) => i.group === group);
        const hasActive = groupItems.some((i) => isActive(pathname, i.href));
        // The page you are on is never hidden inside a closed group.
        const open = hasActive || !collapsed.includes(group);
        return (
          <div key={group}>
            {group === 'Today' ? null : (
              <button
                type="button"
                onClick={() => toggle(group)}
                aria-expanded={open}
                disabled={hasActive}
                className="group flex w-full items-center justify-between rounded-md px-2.5 py-1 text-xs font-medium text-ink-3 transition-colors hover:text-ink disabled:pointer-events-none"
              >
                {group}
                {!hasActive && <ChevronDown className={cx('h-3.5 w-3.5 opacity-0 transition-[opacity,transform] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100', !open && '-rotate-90 opacity-100')} aria-hidden="true" />}
              </button>
            )}
            {open && (
              <ul className="mt-0.5 space-y-px">
                {groupItems.map((item) => {
                  const active = isActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={`${item.href}-${item.name}`}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cx(
                          'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150',
                          active ? 'bg-ink/[0.06] font-medium text-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink'
                        )}
                      >
                        <Icon className={cx('h-4 w-4 shrink-0', active ? 'text-ink' : 'text-ink-4')} strokeWidth={1.75} aria-hidden="true" />
                        <span className="truncate">{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SidebarFoot({ pathname, onSignOut, onNavigate }: { pathname: string; onSignOut: () => void; onNavigate?: () => void }) {
  const { profile, tenant } = useAuth();
  const name = profile?.displayName || profile?.email || 'Signed in';
  const guideActive = isActive(pathname, '/dashboard/guide');
  return (
    <div className="space-y-1 border-t border-line pt-3">
      <Link href="/dashboard/guide" onClick={onNavigate} aria-current={guideActive ? 'page' : undefined}
        className={cx('flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors', guideActive ? 'bg-ink/[0.06] font-medium text-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink')}>
        <LifeBuoy className={cx('h-4 w-4 shrink-0', guideActive ? 'text-ink' : 'text-ink-4')} strokeWidth={1.75} aria-hidden="true" /> User Guide
      </Link>
      <div className="flex items-center gap-1">
        <Link href="/dashboard/profile" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 transition-colors hover:bg-ink/[0.045]" title="My Profile">
          <Avatar name={name} size={30} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium leading-tight text-ink">{name}</span>
            <span className="block truncate text-xs leading-tight text-ink-3">{tenant ? ROLE_LABELS[tenant.role] : ''}</span>
          </span>
        </Link>
        <IconButton label="Sign out" size="sm" onClick={onSignOut} className="hover:bg-danger-soft hover:text-danger-ink"><LogOut className="h-4 w-4" /></IconButton>
      </div>
    </div>
  );
}

interface AppShellProps {
  children: ReactNode;
  /** Plain page title for pages that do not render their own PageHeader. */
  pageTitle?: string;
}

export function AppShell({ children, pageTitle }: AppShellProps) {
  const { tenant, profile, signOut } = useAuth();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = NAV_ITEMS.filter((i) => tenant && i.roles.includes(tenant.role));
  const order = tenant ? groupOrder(tenant.role) : [];
  const current = [...items].sort((a, b) => b.href.length - a.href.length).find((i) => isActive(pathname, i.href));
  const isStudent = tenant?.role === 'student';

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

  return (
    <RequireAuth>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lift">
        Skip to content
      </a>
      <div className="flex min-h-screen bg-canvas text-ink">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 border-r border-line bg-sidebar px-3 pb-3 pt-4 lg:flex print:!hidden">
          <div className="px-1.5"><Wordmark /></div>
          <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
            <NavList items={items} order={order} pathname={pathname} />
          </nav>
          <SidebarFoot pathname={pathname} onSignOut={handleSignOut} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 print:hidden">
            <div className="flex h-14 items-center gap-2 px-3 sm:px-6 lg:px-10">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className={iconButtonClasses('md', 'lg:hidden')}
                aria-label="Open navigation"
                aria-expanded={drawerOpen}
                aria-controls="mobile-nav"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="lg:hidden"><Wordmark /></div>
              {current && <div className="hidden min-w-0 truncate text-sm text-ink-3 lg:block">{current.group === 'Today' ? current.name : <>{current.group} <span aria-hidden="true" className="text-silver">/</span> <span className="text-ink-2">{current.name}</span></>}</div>}
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={openHelpAssistant} aria-label="Ask for help"
                  className="inline-flex h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-muted hover:text-ink">
                  <CircleHelp className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  <span className="hidden sm:inline">Ask for help</span>
                </button>
                <NotificationBell />
                <Link href="/dashboard/profile" className="ml-1 rounded-full ring-offset-2 transition-shadow hover:ring-2 hover:ring-line-strong" aria-label="My Profile">
                  <Avatar name={profile?.displayName || profile?.email || '?'} size={32} />
                </Link>
              </div>
            </div>
          </header>

          <main id="main" className={cx('mx-auto w-full max-w-[1240px] flex-1 px-4 pt-7 sm:px-6 lg:px-10 lg:pt-9 print:max-w-none print:p-0', isStudent ? 'pb-28 lg:pb-20' : 'pb-20')}>
            {pageTitle && <h1 className="type-page mb-7 text-ink">{pageTitle}</h1>}
            {children}
          </main>
        </div>

        {/* Student phone bar */}
        {isStudent && (
          <nav aria-label="Quick links" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
            {STUDENT_TABS.map((t) => {
              const active = isActive(pathname, t.href);
              return (
                <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
                  className={cx('flex flex-col items-center gap-0.5 py-2 text-xs transition-colors', active ? 'font-medium text-brand-ink' : 'text-ink-3')}>
                  <t.icon className="h-5 w-5" strokeWidth={active ? 2 : 1.75} aria-hidden="true" />
                  {t.name}
                </Link>
              );
            })}
            <button type="button" onClick={() => setDrawerOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-xs text-ink-3">
              <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" /> More
            </button>
          </nav>
        )}

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button type="button" className="absolute inset-0 bg-ink/30 animate-fade" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
            <div id="mobile-nav" className="relative flex h-full w-[288px] max-w-[85vw] flex-col gap-4 bg-sidebar px-3 pb-3 pt-3 shadow-float animate-drawer">
              <div className="flex items-center justify-between pl-1.5">
                <Wordmark onNavigate={() => setDrawerOpen(false)} />
                <button type="button" onClick={() => setDrawerOpen(false)} className={iconButtonClasses('md')} aria-label="Close navigation">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto">
                <NavList items={items} order={order} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <SidebarFoot pathname={pathname} onSignOut={handleSignOut} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}
      </div>
      <div className="print:hidden"><HelpAssistant showLauncher={false} /></div>
    </RequireAuth>
  );
}

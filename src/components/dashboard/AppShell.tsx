'use client';

/**
 * Strynkix LMS — Authenticated Application Shell
 * Shared role-aware layout providing top bar navigation, tenant & branch badges,
 * role indicators, user profile summary, responsive navigation sidebar, and sign-out.
 */

import React, { useState, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { UserRole } from '@/types/domain';
import {
  LayoutDashboard,
  Building2,
  GitBranch,
  BookOpen,
  LogOut,
  Menu,
  X,
  Briefcase,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    name: 'Overview',
    href: '/dashboard',
    icon: LayoutDashboard,
    roles: ['super_admin', 'university_admin', 'branch_admin', 'instructor', 'student'],
  },
  {
    name: 'Organizations',
    href: '/dashboard/organizations',
    icon: Building2,
    roles: ['super_admin'],
  },
  {
    name: 'Branches',
    href: '/dashboard/branches',
    icon: GitBranch,
    roles: ['super_admin', 'university_admin'],
  },
  {
    name: 'Live Books & Courses',
    href: '/courses',
    icon: BookOpen,
    roles: ['super_admin', 'university_admin', 'branch_admin', 'instructor', 'student'],
  },
];

interface AppShellProps {
  children: ReactNode;
  pageTitle?: string;
}

export function AppShell({ children, pageTitle }: AppShellProps) {
  const { profile, tenant, signOut } = useAuth();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const userRole = tenant?.role;

  // Filter navigation items accessible to this user's role
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => userRole && item.roles.includes(userRole)
  );

  const getRoleBadge = (role?: UserRole) => {
    switch (role) {
      case 'super_admin':
        return { label: 'Super Admin', style: 'bg-purple-950 text-purple-300 border-purple-800' };
      case 'university_admin':
        return { label: 'University Admin', style: 'bg-indigo-950 text-indigo-300 border-indigo-800' };
      case 'branch_admin':
        return { label: 'Branch Manager', style: 'bg-cyan-950 text-cyan-300 border-cyan-800' };
      case 'instructor':
        return { label: 'Instructor', style: 'bg-emerald-950 text-emerald-300 border-emerald-800' };
      case 'student':
      default:
        return { label: 'Student', style: 'bg-blue-950 text-blue-300 border-blue-800' };
    }
  };

  const roleBadge = getRoleBadge(userRole);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out failed:', err);
    }
  };

  return (
    <RequireAuth>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        {/* Top Header Bar */}
        <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
            {/* Left: Brand & Mobile Menu Toggle */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 focus:outline-none"
                aria-label="Toggle navigation menu"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>

              <Link href="/dashboard" className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-lg text-white shadow-lg shadow-indigo-500/20">
                  S
                </div>
                <div className="hidden sm:block">
                  <span className="font-bold text-slate-100 tracking-tight text-sm">
                    Strynkix LMS
                  </span>
                </div>
              </Link>
            </div>

            {/* Center: Tenant & Branch Indicators */}
            <div className="hidden md:flex items-center gap-2.5 text-xs font-mono">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
                <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                <span>Org: <strong className="text-white">{tenant?.orgId}</strong></span>
              </div>
              {tenant?.branchId && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
                  <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                  <span>Branch: <strong className="text-white">{tenant.branchId}</strong></span>
                </div>
              )}
            </div>

            {/* Right: User Profile & Actions */}
            <div className="flex items-center gap-3">
              {/* Role Badge */}
              <span
                className={`text-[10px] font-mono uppercase px-2.5 py-0.5 rounded-full border ${roleBadge.style}`}
              >
                {roleBadge.label}
              </span>

              {/* User Name */}
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-semibold text-slate-200">
                  {profile?.displayName || 'User'}
                </span>
                <span className="text-[10px] text-slate-400 font-mono truncate max-w-[150px]">
                  {profile?.email}
                </span>
              </div>

              {/* Sign Out Button */}
              <button
                type="button"
                onClick={handleSignOut}
                className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Body Container with Sidebar + Main Workspace */}
        <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex gap-6">
          {/* Desktop Sidebar Navigation */}
          <aside className="hidden md:block w-64 shrink-0">
            <nav className="sticky top-24 space-y-1 rounded-2xl bg-slate-900/40 border border-slate-800/80 p-3 shadow-lg">
              <div className="px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
                Platform Navigation
              </div>
              {visibleNavItems.map((item) => {
                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
                const IconComponent = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    <IconComponent className="w-4 h-4 shrink-0" />
                    <span>{item.name}</span>
                  </Link>
                );
              })}

              <div className="pt-4 mt-4 border-t border-slate-800/60 px-3 py-2 text-[11px] text-slate-500 space-y-1">
                <div className="font-semibold text-slate-400">Security Boundary</div>
                <div className="text-[10px] leading-tight">
                  Enforced at Firestore Security Rules for tenant <span className="font-mono text-indigo-400">{tenant?.orgId}</span>.
                </div>
              </div>
            </nav>
          </aside>

          {/* Mobile Navigation Drawer */}
          {mobileMenuOpen && (
            <div className="md:hidden fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex">
              <div className="w-64 bg-slate-900 border-r border-slate-800 p-5 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <span className="font-bold text-sm text-white">Menu</span>
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className="p-1 rounded text-slate-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <nav className="space-y-1.5">
                  {visibleNavItems.map((item) => {
                    const isActive = pathname === item.href;
                    const IconComponent = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                          isActive
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        <IconComponent className="w-4 h-4 shrink-0" />
                        <span>{item.name}</span>
                      </Link>
                    );
                  })}
                </nav>
              </div>
              <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
            </div>
          )}

          {/* Main Content Workspace */}
          <main className="flex-1 min-w-0 space-y-6">
            {pageTitle && (
              <div className="pb-2 border-b border-slate-800/80">
                <h1 className="text-2xl font-extrabold tracking-tight text-white">{pageTitle}</h1>
              </div>
            )}
            {children}
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}

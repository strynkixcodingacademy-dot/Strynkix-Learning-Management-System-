'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Code2,
  CheckCircle2,
  Lock,
  UserCheck,
  LogOut,
  LogIn,
  AlertCircle,
  Loader2,
  ArrowRight,
  LayoutDashboard,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { RequireRole } from '@/components/auth/RouteGuards';

export default function Home() {
  const { user, profile, tenant, status, error, signIn, signOut } = useAuth();
  const [testEmail, setTestEmail] = useState('');
  const [testPassword, setTestPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const domainEntities = [
    { name: 'Organizations', scope: 'Root Tenant', desc: 'Tenant boundary for Strynkix and future partner academies' },
    { name: 'Branches', scope: 'Branch Boundary', desc: 'Physical and virtual campus hubs (e.g. Pune Hub, Remote)' },
    { name: 'Users', scope: 'UID === Auth UID', desc: 'Role-based profiles with strict server-assigned privileges' },
    { name: 'Courses', scope: 'Tenant Scoped', desc: 'Curriculum definitions, difficulty tracks, and prerequisites' },
    { name: 'Batches', scope: 'Branch Scoped', desc: 'Time-bound cohorts assigned to designated branch instructors' },
    { name: 'Modules', scope: 'Course Scoped', desc: 'Thematic chapters structuring interactive Live Books' },
    { name: 'Lessons', scope: 'Live Books', desc: 'Granular units: narrative concepts, code blocks, challenges' },
    { name: 'Assignments', scope: 'Module/Course', desc: 'Practical milestones with explicit grading rubrics' },
    { name: 'Enrollments', scope: 'Student Mapping', desc: 'Binds student UID to specific batch and course track' },
    { name: 'Progress', scope: 'Student Scoped', desc: 'Telemetry tracking lesson completion and time invested' },
    { name: 'Submissions', scope: 'Student/Reviewer', desc: 'Student deliverables, code repos, and instructor reviews' },
  ];

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setActionError(null);
    try {
      await signIn(testEmail, testPassword);
    } catch (err: unknown) {
      const e = err as Error;
      setActionError(e.message || 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err: unknown) {
      const e = err as Error;
      setActionError(e.message || 'Sign out failed');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-lg text-white shadow-lg shadow-indigo-500/20">
              S
            </div>
            <div>
              <span className="font-semibold text-slate-100 tracking-tight">Strynkix Coding Academy</span>
              <span className="ml-2 text-xs font-mono uppercase bg-indigo-950 text-indigo-400 border border-indigo-800/80 px-2 py-0.5 rounded">
                Stage 4: Role Dashboards & Admin
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
            <span className="hidden sm:flex items-center gap-1.5 text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Project: learning-management-syst-b9bf3
            </span>
            {status === 'authenticated' ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-sans text-xs font-semibold shadow-md shadow-indigo-600/20 transition"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </Link>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-sans text-xs font-semibold shadow-md shadow-indigo-600/20 transition"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 space-y-10">
        {/* Hero Section */}
        <section className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
            <BookOpen className="w-3.5 h-3.5" />
            Kalvium-Inspired Live Books Architecture
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white max-w-3xl leading-tight">
                Interactive Live Books Engine
              </h1>
              <p className="text-slate-400 text-base sm:text-lg max-w-2xl leading-relaxed mt-2">
                Digital textbook runtime with persistent curriculum navigation, rich block pedagogy,
                code practices, interactive quizzes, and student progress telemetry.
              </p>
            </div>
            <Link
              href="/courses"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition shadow-xl shadow-indigo-600/30 shrink-0 self-start sm:self-center"
            >
              <span>Explore Live Books</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>

        {/* Live Authentication & Session Inspector Card */}
        <section className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Live Authentication State Inspector</h2>
                <p className="text-xs text-slate-400">Monitored directly via onAuthStateChanged observer</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-400">Status:</span>
              <span
                className={`text-xs font-mono uppercase px-2.5 py-1 rounded-full border ${
                  status === 'authenticated'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : status === 'loading'
                    ? 'bg-sky-950 text-sky-300 border-sky-800'
                    : status === 'suspended'
                    ? 'bg-rose-950 text-rose-300 border-rose-800'
                    : status === 'no_profile'
                    ? 'bg-amber-950 text-amber-300 border-amber-800'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Session Metadata Display */}
            <div className="space-y-3 bg-slate-950/60 p-4 rounded-lg border border-slate-800/80 font-mono text-xs">
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-500">Firebase UID:</span>
                <span className="text-slate-300">{user?.uid || '(unauthenticated)'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-500">Email:</span>
                <span className="text-slate-300">{user?.email || '(none)'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-500">Assigned Role:</span>
                <span className="text-indigo-400 font-bold">{tenant?.role || '(none)'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-500">Tenant (orgId):</span>
                <span className="text-slate-300">{tenant?.orgId || '(none)'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Branch (branchId):</span>
                <span className="text-slate-300">{tenant?.branchId || '(none)'}</span>
              </div>
            </div>

            {/* Interactive Test Panel (Emulator Safe) */}
            <div className="space-y-4">
              {status === 'authenticated' ? (
                <div className="space-y-4">
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                    Welcome back, <strong className="text-white">{profile?.displayName}</strong>. You are securely authenticated with role{' '}
                    <strong className="text-indigo-300 font-mono uppercase">{tenant?.role}</strong>.
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      href="/dashboard"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition"
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      <span>Open Workspace Dashboard</span>
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSignIn} className="space-y-3">
                  <div className="text-xs text-slate-400">
                    Test sign-in against local Emulator / Auth service:
                  </div>
                  <div className="space-y-2">
                    <input
                      type="email"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      placeholder="Email address"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                    <input
                      type="password"
                      value={testPassword}
                      onChange={(e) => setTestPassword(e.target.value)}
                      placeholder="Password"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  {(actionError || error) && (
                    <div className="flex items-center gap-2 p-2 rounded bg-rose-950/40 border border-rose-900/50 text-[11px] text-rose-300">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>{actionError || error}</span>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition disabled:opacity-50"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                    Sign In
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Demonstration of UI Role Guard */}
          <div className="pt-4 border-t border-slate-800">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Role-Gated Section Demo (Super Admin & Branch Admin)
            </h4>
            <RequireRole
              allowedRoles={['super_admin', 'branch_admin']}
              fallback={
                <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-400">
                  🔒 Administrative controls hidden. (Signed in role does not possess administrative privileges).
                </div>
              }
            >
              <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-800/40 text-xs text-indigo-300 flex items-center justify-between">
                <span>⚡ Administrative controls unlocked for verified admin role.</span>
                <span className="font-mono text-[10px] bg-indigo-900 px-2 py-0.5 rounded text-indigo-200">
                  Authorized
                </span>
              </div>
            </RequireRole>
          </div>
        </section>

        {/* Core Domain Specification */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Code2 className="w-5 h-5 text-indigo-400" />
              Multi-Tenant Domain Entities
            </h2>
            <span className="text-xs font-mono text-slate-500">src/types/domain.ts</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {domainEntities.map((entity, i) => (
              <div
                key={i}
                className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80 hover:border-slate-700 transition-colors space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-200">{entity.name}</span>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {entity.scope}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{entity.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Security Principles */}
        <section className="p-6 rounded-xl bg-indigo-950/20 border border-indigo-900/30 space-y-4">
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-indigo-400" />
            Zero-Trust Client Invariants
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
            <div className="flex gap-2.5 items-start">
              <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                <strong>No Client Role Authority</strong>: Roles are verified strictly from Firestore security rules
                and verified token claims.
              </span>
            </div>
            <div className="flex gap-2.5 items-start">
              <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                <strong>No Public Admin Signup</strong>: Administrative roles cannot be self-selected during public
                onboarding.
              </span>
            </div>
            <div className="flex gap-2.5 items-start">
              <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                <strong>Race-Condition Mitigation</strong>: Async profile queries carry sequence tokens so outdated
                reads cannot overwrite newer sessions.
              </span>
            </div>
            <div className="flex gap-2.5 items-start">
              <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                <strong>Suspended Account Enforcement</strong>: Suspended accounts are immediately locked out at the
                context and security rules layer.
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 text-slate-500 text-xs py-6 text-center">
        Strynkix Coding Academy LMS • Production-Minded Foundation
      </footer>
    </div>
  );
}

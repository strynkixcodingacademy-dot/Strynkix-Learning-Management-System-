'use client';

/**
 * Strynkix LMS — Role-Aware Dashboard Overview Hub
 * Dynamically presents relevant telemetry, controls, and quick actions based on
 * the authenticated user's role: super_admin, university_admin, branch_admin,
 * instructor, or student.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { getOrganizations, getBranches } from '@/lib/admin/service';
import {
  Building2,
  GitBranch,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  Users,
  GraduationCap,
  Clock,
  Sparkles,
  Loader2,
} from 'lucide-react';

export default function DashboardPage() {
  const { profile, tenant } = useAuth();
  const [orgCount, setOrgCount] = useState<number | null>(null);
  const [branchCount, setBranchCount] = useState<number | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  const role = tenant?.role;

  useEffect(() => {
    async function loadStats() {
      if (!tenant) return;
      setLoadingMetrics(true);
      try {
        if (tenant.role === 'super_admin') {
          const [orgs, branches] = await Promise.all([
            getOrganizations(),
            getBranches(),
          ]);
          setOrgCount(orgs.length);
          setBranchCount(branches.length);
        } else if (tenant.role === 'university_admin') {
          const branches = await getBranches(tenant.orgId);
          setBranchCount(branches.length);
        }
      } catch (err) {
        console.error('Failed to load dashboard metrics:', err);
      } finally {
        setLoadingMetrics(false);
      }
    }

    loadStats();
  }, [tenant]);

  return (
    <AppShell pageTitle="Dashboard Overview">
      <div className="space-y-8">
        {/* Welcome Banner */}
        <div className="p-6 rounded-2xl bg-gradient-to-r from-indigo-950/60 via-slate-900 to-slate-900 border border-indigo-900/40 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-indigo-400 font-mono text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Workspace Active</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white">
              Welcome back, {profile?.displayName || 'Scholar'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-xl">
              You are signed in under organization <strong className="text-slate-200">{tenant?.orgId}</strong>
              {tenant?.branchId ? ` (Branch: ${tenant.branchId})` : ''} with verified role{' '}
              <strong className="text-indigo-300 uppercase font-mono text-xs">{role}</strong>.
            </p>
          </div>

          <Link
            href="/courses"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition shrink-0 self-start sm:self-center"
          >
            <BookOpen className="w-4 h-4" />
            <span>Live Books Catalog</span>
          </Link>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* SUPER ADMIN CONSOLE */}
        {/* ----------------------------------------------------------------- */}
        {role === 'super_admin' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-purple-400" />
                <span>Super Administrator Control Plane</span>
              </h3>
              <span className="text-xs text-slate-500 font-mono">System-Wide Access</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* Card 1: Organizations */}
              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition space-y-4">
                <div className="flex items-center justify-between">
                  <div className="h-10 w-10 rounded-lg bg-purple-950/60 border border-purple-800/80 flex items-center justify-center text-purple-400">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <span className="text-2xl font-black text-white font-mono">
                    {loadingMetrics ? <Loader2 className="w-5 h-5 animate-spin text-purple-400" /> : orgCount ?? '—'}
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-200">Organizations</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Multi-tenant academies and university partners.
                  </p>
                </div>
                <Link
                  href="/dashboard/organizations"
                  className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 font-semibold transition"
                >
                  <span>Manage Organizations</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {/* Card 2: Branches */}
              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition space-y-4">
                <div className="flex items-center justify-between">
                  <div className="h-10 w-10 rounded-lg bg-indigo-950/60 border border-indigo-800/80 flex items-center justify-center text-indigo-400">
                    <GitBranch className="w-5 h-5" />
                  </div>
                  <span className="text-2xl font-black text-white font-mono">
                    {loadingMetrics ? <Loader2 className="w-5 h-5 animate-spin text-indigo-400" /> : branchCount ?? '—'}
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-200">Branches & Campuses</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Physical and remote learning hubs across academies.
                  </p>
                </div>
                <Link
                  href="/dashboard/branches"
                  className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition"
                >
                  <span>Manage Branches</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {/* Card 3: Security & Governance */}
              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="h-10 w-10 rounded-lg bg-emerald-950/60 border border-emerald-800/80 flex items-center justify-center text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-mono uppercase px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                    Active
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-200">Zero-Trust Security</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Firestore Security Rules enforce multi-tenant barriers.
                  </p>
                </div>
                <span className="text-[11px] text-slate-500 font-mono block">
                  Rules version 2 • Project b9bf3
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* UNIVERSITY ADMIN CONSOLE */}
        {/* ----------------------------------------------------------------- */}
        {role === 'university_admin' && (
          <div className="space-y-6">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-400" />
              <span>University Administration Plane ({tenant?.orgId})</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <GitBranch className="w-6 h-6 text-indigo-400" />
                  <span className="text-2xl font-bold font-mono text-white">
                    {loadingMetrics ? '...' : branchCount ?? '—'}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-200">University Campuses</h4>
                <p className="text-xs text-slate-400">
                  Manage branches and campus locations within your institution.
                </p>
                <Link
                  href="/dashboard/branches"
                  className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                >
                  <span>View University Branches</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                <BookOpen className="w-6 h-6 text-indigo-400" />
                <h4 className="text-sm font-bold text-slate-200">Course Offerings</h4>
                <p className="text-xs text-slate-400">
                  Inspect Live Books and curricula deployed for your students.
                </p>
                <Link
                  href="/courses"
                  className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                >
                  <span>Explore Courses</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* BRANCH ADMIN CONSOLE */}
        {/* ----------------------------------------------------------------- */}
        {role === 'branch_admin' && (
          <div className="space-y-6">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-cyan-400" />
              <span>Branch Management Hub: Campus {tenant?.branchId}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                <Users className="w-5 h-5 text-cyan-400" />
                <h4 className="text-sm font-bold text-slate-200">Cohort Management</h4>
                <p className="text-xs text-slate-400">
                  Manage batch allocations, instructor assignments, and campus cohorts.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                <BookOpen className="w-5 h-5 text-cyan-400" />
                <h4 className="text-sm font-bold text-slate-200">Curriculum Tracking</h4>
                <p className="text-xs text-slate-400">
                  Review student cohort progress through interactive Live Books.
                </p>
                <Link href="/courses" className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold block pt-2">
                  View Curriculum &rarr;
                </Link>
              </div>

              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h4 className="text-sm font-bold text-slate-200">Branch Perimeter</h4>
                <p className="text-xs text-slate-400">
                  Bound strictly to {tenant?.branchId} via Firestore Security Rules.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* INSTRUCTOR WORKSTATION */}
        {/* ----------------------------------------------------------------- */}
        {role === 'instructor' && (
          <div className="space-y-6">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-emerald-400" />
              <span>Instructor Workstation</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <BookOpen className="w-5 h-5 text-emerald-400" />
                <h4 className="text-sm font-bold text-slate-200">Interactive Live Books</h4>
                <p className="text-xs text-slate-400">
                  Teach and guide students through structured code walkthroughs and exercises.
                </p>
                <Link href="/courses" className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold block">
                  Browse Lessons &rarr;
                </Link>
              </div>

              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <Clock className="w-5 h-5 text-emerald-400" />
                <h4 className="text-sm font-bold text-slate-200">Grading & Submissions</h4>
                <p className="text-xs text-slate-400">
                  Review student assignments and issue authorized scores and pedagogical feedback.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* STUDENT LEARNING HUB */}
        {/* ----------------------------------------------------------------- */}
        {role === 'student' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-400" />
                <span>My Learning Hub</span>
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <BookOpen className="w-6 h-6 text-indigo-400" />
                <h4 className="text-sm font-bold text-slate-200">Software Engineering Foundations</h4>
                <p className="text-xs text-slate-400">
                  Interactive Live Books covering TypeScript architecture, zero-trust schemas, and cloud data.
                </p>
                <Link
                  href="/courses"
                  className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                >
                  <span>Continue Learning</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
                <h4 className="text-sm font-bold text-slate-200">My Telemetry & Progress</h4>
                <p className="text-xs text-slate-400">
                  Your progress is saved securely and privately to your student record.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

'use client';

/**
 * Strynkix LMS — Unified Common Login Page
 * Handles credential authentication, status verification (suspended/missing profile),
 * and automatic role-based redirection to the appropriate workspace.
 */

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getRoleDefaultRedirect } from '@/lib/auth/redirect';
import {
  Lock,
  Mail,
  AlertCircle,
  Loader2,
  ArrowRight,
  ShieldAlert,
  AlertTriangle,
  LogOut,
} from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect');

  const { status, tenant, error: authError, signIn, signOut } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-redirect if already authenticated
  useEffect(() => {
    if (status === 'authenticated' && tenant?.role) {
      const destination =
        redirectParam && redirectParam.startsWith('/')
          ? redirectParam
          : getRoleDefaultRedirect(tenant.role);
      router.replace(destination);
    }
  }, [status, tenant, redirectParam, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await signIn(email, password);
      // Auth observer will update status, triggering the useEffect above
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMessage(e.message || 'Authentication failed. Please check your credentials.');
      setIsSubmitting(false);
    }
  };

  // State: Suspended Account
  if (status === 'suspended') {
    return (
      <div className="max-w-md w-full p-8 rounded-2xl bg-slate-900/90 border border-rose-900/50 shadow-2xl space-y-5 text-center">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto" />
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-white">Account Inactive or Suspended</h2>
          <p className="text-xs text-rose-300 leading-relaxed">
            Your academy account has been suspended by administration. Please contact your campus manager or academy leadership.
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    );
  }

  // State: Missing Profile
  if (status === 'no_profile') {
    return (
      <div className="max-w-md w-full p-8 rounded-2xl bg-slate-900/90 border border-amber-800/40 shadow-2xl space-y-5 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-white">Profile Pending Provisioning</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Your Firebase login is authenticated, but no Strynkix LMS profile record has been provisioned for your account. Please notify your administrator to assign your tenant organization and role.
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-2xl space-y-6">
      <div className="space-y-2 text-center">
        <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-xl text-white shadow-lg shadow-indigo-600/30 mx-auto">
          S
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-white">
          Sign In to Strynkix LMS
        </h1>
        <p className="text-xs text-slate-400">
          Enter your authorized academy credentials to access your courses and workspace.
        </p>
      </div>

      {(errorMessage || authError) && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
          <span>{errorMessage || authError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">Email Address</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@strynkix.com"
              required
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">Password</label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || status === 'loading'}
          className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2"
        >
          {isSubmitting || status === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <span>Sign In</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
        <Link href="/" className="hover:text-slate-300 transition">
          &larr; Back to Home
        </Link>
        <span className="font-mono">Strynkix Academy</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4">
      <Suspense
        fallback={
          <div className="flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            <span className="text-xs text-slate-400 font-mono">Loading authentication portal...</span>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}

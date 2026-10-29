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
import { getRoleDefaultRedirect, safeRedirectPath } from '@/lib/auth/redirect';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { BrandMark } from '@/components/ui/Illustrations';
import { buttonClasses } from '@/components/ui/Button';
import {
  Lock,
  Mail,
  AlertCircle,
  Loader2,
  ArrowRight,
  ShieldAlert,
  AlertTriangle,
  LogOut,
  CheckCircle2,
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
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [resetSent, setResetSent] = useState<string | null>(null);

  // Auto-redirect if already authenticated
  useEffect(() => {
    if (status === 'authenticated' && tenant?.role) {
      // Only same-origin paths: `//evil.example` would leave the academy (Stage C7).
      const destination = safeRedirectPath(redirectParam) ?? getRoleDefaultRedirect(tenant.role);
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

  // Password reset. The confirmation is identical whether or not the account
  // exists, so the form cannot be used to discover registered emails.
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setResetSent(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(email.trim());
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/user-not-found') setResetSent(email.trim());
      else if (code === 'auth/invalid-email') setErrorMessage('Please enter a valid email address.');
      else if (code === 'auth/too-many-requests') setErrorMessage('Too many reset requests. Please wait a few minutes and try again.');
      else setErrorMessage('We couldn’t send a reset email right now. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // State: Suspended Account
  if (status === 'suspended') {
    return (
      <div className="w-full max-w-[420px] space-y-5 rounded-card border border-danger-line bg-surface p-8 text-center shadow-lift">
        <ShieldAlert className="w-12 h-12 text-danger-ink mx-auto" />
        <div className="space-y-1">
          <h2 className="font-display text-[26px] font-extrabold text-ink">Your account is paused</h2>
          <p className="text-sm text-ink-2 leading-relaxed">
            An administrator has paused your access. Your work and progress are safe. Contact your branch manager to have it reactivated.
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className={buttonClasses('secondary')}
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
      <div className="w-full max-w-[420px] space-y-5 rounded-card border border-warning-line bg-surface p-8 text-center shadow-lift">
        <AlertTriangle className="w-12 h-12 text-warning-ink mx-auto" />
        <div className="space-y-1">
          <h2 className="font-display text-[26px] font-extrabold text-ink">Your account isn’t set up yet</h2>
          <p className="text-sm text-ink-2 leading-relaxed">
            You signed in, but your academy hasn’t finished setting up your account (your branch and role). Ask your branch manager to complete it, then sign in again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className={buttonClasses('secondary')}
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div className="w-full max-w-[420px] space-y-6">
        <div className="space-y-2">
          <h1 className="font-display text-[34px] font-extrabold leading-tight tracking-tight text-ink">Reset your password</h1>
          <p className="text-sm text-ink-3">Enter your academy email and we&apos;ll send you a link to choose a new password.</p>
        </div>
        {resetSent ? (
          <div role="status" className="p-3.5 rounded-xl bg-success-soft border border-success-line text-sm text-ink-2 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-success-ink mt-0.5" aria-hidden="true" />
            <span>If an account exists for <strong>{resetSent}</strong>, a reset link is on its way. Check your inbox and spam folder.</span>
          </div>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            {errorMessage && (
              <div role="alert" className="p-3.5 rounded-xl bg-danger-soft border border-danger-line text-sm text-danger-ink flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="reset-email" className="text-sm font-semibold text-ink-2">Email address</label>
              <input id="reset-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full h-12 px-3.5 rounded-xl bg-surface border border-line-strong text-[15px] text-ink placeholder-ink-4 shadow-card focus:outline-none focus:ring-3 focus:ring-brand/15 focus:border-brand" />
            </div>
            <button type="submit" disabled={isSubmitting}
              className={buttonClasses('primary', 'lg', 'w-full')}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
              Send reset link
            </button>
          </form>
        )}
        <button type="button" onClick={() => { setMode('signin'); setErrorMessage(null); setResetSent(null); }}
          className="w-full text-sm font-semibold text-brand-ink hover:underline">
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[420px] space-y-7">
      <div className="space-y-2">
        <h1 className="font-display text-[34px] font-extrabold leading-tight tracking-tight text-ink">
          Welcome back
        </h1>
        <p className="text-[15px] text-ink-3">
          Sign in with the email and password your academy gave you.
        </p>
      </div>

      {(errorMessage || authError) && (
        <div role="alert" className="p-3.5 rounded-xl bg-danger-soft border border-danger-line text-xs text-danger-ink flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink mt-0.5" />
          <span>{errorMessage || authError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="login-email" className="text-sm font-semibold text-ink-2">Email address</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-ink-3 absolute left-3.5 top-4 pointer-events-none" />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@strynkix.com"
              required
              className="w-full h-12 pl-10 pr-3 rounded-xl bg-surface border border-line-strong text-[15px] text-ink placeholder-ink-4 shadow-card focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="text-sm font-semibold text-ink-2">Password</label>
            <button type="button" onClick={() => { setMode('reset'); setErrorMessage(null); }}
              className="text-sm font-semibold text-brand-ink hover:underline">
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-ink-3 absolute left-3.5 top-4 pointer-events-none" />
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              className="w-full h-12 pl-10 pr-3 rounded-xl bg-surface border border-line-strong text-[15px] text-ink placeholder-ink-4 shadow-card focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || status === 'loading'}
          className={buttonClasses('primary', 'lg', 'w-full')}
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-5 text-[13px] text-ink-3">
        <Link href="/" className="font-semibold hover:text-ink-2 transition">
          &larr; Back to Home
        </Link>
        <span>New here? Ask your branch manager for an account.</span>
      </div>
    </div>
  );
}

const POINTS = [
  { title: 'A plan for every day', body: 'Lessons and one assignment, set by your instructor.' },
  { title: 'Interactive Live Books', body: 'Code examples, quizzes and practice in every lesson.' },
  { title: 'Feedback that helps', body: 'Marks, comments and a chance to correct your work.' },
];

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden border-r border-line bg-gradient-to-br from-surface via-silver-soft to-canvas lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:p-12">
      <div aria-hidden="true" className="paper-dots absolute inset-0 opacity-70" />
      <div aria-hidden="true" className="absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
      <div aria-hidden="true" className="absolute -left-16 bottom-10 h-56 w-56 rounded-full bg-highlight/40 blur-3xl" />
      <Link href="/" className="relative flex items-center gap-3">
        <BrandMark size={40} />
        <span className="leading-tight">
          <span className="block font-display text-[20px] font-extrabold text-ink">Live Books</span>
          <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-ink-3">Strynkix Coding Academy</span>
        </span>
      </Link>
      <div className="relative max-w-md space-y-8">
        <h2 className="font-display text-[44px] font-extrabold leading-[1.08] tracking-tight text-ink">
          Learn by doing, <span className="marker">one day at a time.</span>
        </h2>
        <ul className="space-y-4">
          {POINTS.map((p, i) => (
            <li key={p.title} className="flex gap-4 rounded-2xl border border-line bg-surface/80 p-4 shadow-card backdrop-blur-sm">
              <span className="font-display text-[22px] font-extrabold leading-none text-brand">{String(i + 1).padStart(2, '0')}</span>
              <span>
                <span className="block text-sm font-extrabold text-ink">{p.title}</span>
                <span className="block text-sm text-ink-3">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-xs font-semibold text-ink-4">© Strynkix Coding Academy</p>
    </aside>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <BrandPanel />
      <div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-10">
        <div className="mb-10 lg:hidden"><BrandMark size={44} /></div>
      <Suspense
        fallback={
          <div className="flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 text-brand-ink animate-spin" />
            <span className="text-xs text-ink-3">Loading authentication portal...</span>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
      </div>
    </div>
  );
}

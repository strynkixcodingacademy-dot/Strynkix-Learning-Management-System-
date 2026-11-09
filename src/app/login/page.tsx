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
      <div className="w-full max-w-[400px] space-y-5 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
        <div className="space-y-1">
          <h1 className="type-page text-ink">Your account is paused</h1>
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
          <span>Sign out</span>
        </button>
      </div>
    );
  }

  // State: Missing Profile
  if (status === 'no_profile') {
    return (
      <div className="w-full max-w-[400px] space-y-5 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
        <div className="space-y-1">
          <h1 className="type-page text-ink">Your account isn’t set up yet</h1>
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
          <span>Sign out</span>
        </button>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div className="w-full max-w-[400px] space-y-6">
        <div className="space-y-2">
          <h1 className="type-page font-display text-ink">Reset your password</h1>
          <p className="text-sm text-ink-3">Enter your academy email and we&apos;ll send you a link to choose a new password.</p>
        </div>
        {resetSent ? (
          <div role="status" className="p-3.5 rounded-lg bg-success-soft border border-success-line text-sm text-ink-2 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-success-ink mt-0.5" aria-hidden="true" />
            <span>If an account exists for <strong>{resetSent}</strong>, a reset link is on its way. Check your inbox and spam folder.</span>
          </div>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            {errorMessage && (
              <div role="alert" className="p-3.5 rounded-lg bg-danger-soft border border-danger-line text-sm text-danger-ink flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="reset-email" className="text-sm font-medium text-ink-2">Email address</label>
              <input id="reset-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full h-11 px-3.5 rounded-lg bg-surface border border-line-strong text-body text-ink transition-[border-color,box-shadow] duration-150 hover:border-silver focus:outline-none focus:ring-3 focus:ring-brand/15 focus:border-brand" />
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
    <div className="w-full max-w-[400px] space-y-7">
      <div className="space-y-2">
        <h1 className="type-page font-display text-ink">
          Sign in
        </h1>
        <p className="text-body text-ink-3">
          Use the email and password your academy gave you.
        </p>
      </div>

      {(errorMessage || authError) && (
        <div role="alert" className="p-3.5 rounded-lg bg-danger-soft border border-danger-line text-sm text-danger-ink flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink mt-0.5" />
          <span>{errorMessage || authError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="login-email" className="text-sm font-medium text-ink-2">Email address</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-ink-3 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@strynkix.com"
              required
              className="w-full h-11 pl-10 pr-3 rounded-lg bg-surface border border-line-strong text-body text-ink transition-[border-color,box-shadow] duration-150 hover:border-silver focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="text-sm font-medium text-ink-2">Password</label>
            <button type="button" onClick={() => { setMode('reset'); setErrorMessage(null); }}
              className="text-sm font-semibold text-brand-ink hover:underline">
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-ink-3 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
                            required
              className="w-full h-11 pl-10 pr-3 rounded-lg bg-surface border border-line-strong text-body text-ink transition-[border-color,box-shadow] duration-150 hover:border-silver focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
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

      <p className="border-t border-line pt-5 text-sm text-ink-3">New here? Ask your branch manager for an account.</p>
    </div>
  );
}

/** The cover the student opens to sign in. */
function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-cloth-cobalt text-foil lg:flex lg:w-[44%] lg:flex-col lg:justify-between lg:px-16 lg:py-14">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-4 bg-black/20" />
      <span aria-hidden="true" className="absolute inset-y-0 left-4 w-px bg-white/10" />
      <Link href="/" className="relative flex items-center gap-2.5 self-start rounded-md focus-visible:outline-foil">
        <BrandMark size={28} foil />
        <span className="font-display text-lg font-[560] leading-none">Strynkix</span>
      </Link>
      <div className="relative">
        <p className="font-display text-[clamp(3rem,4.6vw,4.25rem)] font-[540] leading-none tracking-[-0.03em]">Live Books</p>
        <span aria-hidden="true" className="mt-6 block h-px w-16 bg-foil/40" />
        <p className="mt-6 max-w-[30ch] font-display text-lg italic leading-snug text-foil/80">The lessons, plans and marks of Strynkix Coding Academy.</p>
      </div>
      <p className="relative text-xs text-foil/60">For students, instructors and staff of the academy</p>
    </aside>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <BrandPanel />
      <main id="main" className="flex flex-1 flex-col items-center justify-center p-6 sm:p-10">
        <Link href="/" className="mb-10 flex items-center gap-2.5 rounded-md lg:hidden" aria-label="Strynkix Live Books home">
          <BrandMark size={30} />
          <span className="font-display text-xl font-[560] leading-none text-ink">Strynkix</span>
        </Link>
        <Suspense
          fallback={
            <div className="flex flex-col items-center justify-center space-y-3" role="status">
              <Loader2 className="w-6 h-6 text-ink-3 animate-spin" aria-hidden="true" />
              <span className="text-sm text-ink-3">Loading sign in…</span>
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}

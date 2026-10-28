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
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
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
      <div className="max-w-md w-full p-8 rounded-2xl bg-surface border border-danger-line shadow-lift space-y-5 text-center">
        <ShieldAlert className="w-12 h-12 text-danger-ink mx-auto" />
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-ink">Account Inactive or Suspended</h2>
          <p className="text-xs text-danger-ink leading-relaxed">
            Your academy account has been suspended by administration. Please contact your campus manager or academy leadership.
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-muted hover:bg-surface-sunken text-ink-2 text-xs font-semibold transition"
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
      <div className="max-w-md w-full p-8 rounded-2xl bg-surface border border-warning-line shadow-lift space-y-5 text-center">
        <AlertTriangle className="w-12 h-12 text-warning-ink mx-auto" />
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-ink">Profile Pending Provisioning</h2>
          <p className="text-xs text-ink-3 leading-relaxed">
            Your Firebase login is authenticated, but no Strynkix LMS profile record has been provisioned for your account. Please notify your administrator to assign your tenant organization and role.
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-muted hover:bg-surface-sunken text-ink-2 text-xs font-semibold transition"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div className="max-w-md w-full p-8 rounded-2xl bg-surface border border-line shadow-lift space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Reset your password</h1>
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
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
            </div>
            <button type="submit" disabled={isSubmitting}
              className="w-full py-2.5 px-4 rounded-xl bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-sm font-semibold shadow-card transition flex items-center justify-center gap-2">
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
    <div className="max-w-md w-full p-8 rounded-2xl bg-surface border border-line shadow-lift space-y-6">
      <div className="space-y-2 text-center">
        <div className="h-12 w-12 rounded-xl bg-brand flex items-center justify-center font-bold text-xl text-white shadow-card mx-auto">
          S
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          Sign In to Strynkix LMS
        </h1>
        <p className="text-xs text-ink-3">
          Enter your authorized academy credentials to access your courses and workspace.
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
          <label htmlFor="login-email" className="text-xs font-semibold text-ink-2">Email address</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-ink-3 absolute left-3 top-3 pointer-events-none" />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@strynkix.com"
              required
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="text-xs font-semibold text-ink-2">Password</label>
            <button type="button" onClick={() => { setMode('reset'); setErrorMessage(null); }}
              className="text-xs font-semibold text-brand-ink hover:underline">
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-ink-3 absolute left-3 top-3 pointer-events-none" />
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || status === 'loading'}
          className="w-full py-2.5 px-4 rounded-xl bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold shadow-card transition flex items-center justify-center gap-2"
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

      <div className="pt-4 border-t border-line flex items-center justify-between text-[11px] text-ink-3">
        <Link href="/" className="hover:text-ink-2 transition">
          &larr; Back to Home
        </Link>
        <span className="font-mono">Strynkix Academy</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col justify-center items-center p-4">
      <Suspense
        fallback={
          <div className="flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 text-brand-ink animate-spin" />
            <span className="text-xs text-ink-3 font-mono">Loading authentication portal...</span>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}

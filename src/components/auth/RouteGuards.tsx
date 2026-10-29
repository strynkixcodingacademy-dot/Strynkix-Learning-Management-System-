'use client';

/**
 * Strynkix LMS — Client Route & Role Guards
 *
 * IMPORTANT SECURITY ARCHITECTURE NOTICE:
 * These UI guards are presentation-layer conveniences to prevent visual flicker
 * and streamline user navigation. They are NOT a security boundary.
 *
 * Real security, data privacy, and tenant isolation are strictly enforced by:
 * 1. Cloud Firestore Security Rules (firestore.rules)
 * 2. Trusted server-side authorization handlers (Admin SDK)
 */

import React, { ReactNode } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { UserRole } from '@/types/domain';
import { BrandMark, Illustration, IllustrationName } from '@/components/ui/Illustrations';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/States';

function StateScreen({
  illustration,
  title,
  children,
  action,
}: {
  illustration: IllustrationName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-card animate-rise">
        <div className="mb-2 flex justify-center"><Illustration name={illustration} size={112} /></div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">{title}</h1>
        <div className="mt-2 text-sm leading-relaxed text-ink-3">{children}</div>
        {action && <div className="mt-6 flex justify-center gap-2">{action}</div>}
      </div>
      <div className="mt-6 flex items-center gap-2 text-xs text-ink-3">
        <BrandMark size={18} /> Strynkix Live Books
      </div>
    </div>
  );
}

interface RequireAuthProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Restricts rendering to authenticated users with a verified, active LMS profile.
 */
export function RequireAuth({ children, fallback }: RequireAuthProps) {
  const { status, error, signOut } = useAuth();

  if (status === 'loading') {
    return (
      fallback || (
        <div className="min-h-screen bg-canvas px-4 py-10 sm:px-10" role="status" aria-live="polite">
          <span className="sr-only">Checking your account…</span>
          <div className="mx-auto max-w-5xl space-y-4">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-28" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          </div>
        </div>
      )
    );
  }

  if (status === 'unauthenticated') {
    return (
      <StateScreen illustration="lock" title="Please sign in" action={<Link href="/login" className={buttonClasses('primary')}>Sign in</Link>}>
        Sign in with your Strynkix Coding Academy account to open your Live Books.
      </StateScreen>
    );
  }

  if (status === 'no_profile') {
    return (
      <StateScreen illustration="compass" title="Your account isn't set up yet"
        action={<Button variant="secondary" onClick={() => signOut()}>Sign out</Button>}>
        You&apos;re signed in, but your academy hasn&apos;t added you to Live Books yet. Ask your branch manager or instructor to set up your profile.
      </StateScreen>
    );
  }

  if (status === 'suspended') {
    return (
      <StateScreen illustration="lock" title="Your account isn't active"
        action={<Button variant="secondary" onClick={() => signOut()}>Sign out</Button>}>
        {error || 'Your academy account is not active right now. Please contact your academy administrator.'}
      </StateScreen>
    );
  }

  if (status === 'error') {
    return (
      <StateScreen illustration="compass" title="We couldn't load your account"
        action={<Button variant="secondary" onClick={() => window.location.reload()}>Try again</Button>}>
        {error || 'Something went wrong while loading your profile. Check your connection and try again.'}
      </StateScreen>
    );
  }

  return <>{children}</>;
}

interface RequireRoleProps {
  allowedRoles: UserRole[];
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Restricts rendering to users with one of the allowed roles.
 * Client-side visual guard only; Firestore Security Rules enforce data access.
 */
export function RequireRole({ allowedRoles, children, fallback }: RequireRoleProps) {
  const { tenant, status } = useAuth();

  if (status === 'loading') {
    return null;
  }

  // Not signed in, paused or unprovisioned: show that state, not "wrong role".
  if (status !== 'authenticated') {
    return <RequireAuth>{children}</RequireAuth>;
  }

  const userRole = tenant?.role;
  const isAuthorized = userRole && allowedRoles.includes(userRole);

  if (!isAuthorized) {
    return (
      fallback || (
        <StateScreen illustration="lock" title="This area isn't available to you"
          action={<Link href="/dashboard" className={buttonClasses('primary')}>Go to Home</Link>}>
          This page is for academy staff with a different role. If you think you should have access, contact your administrator.
        </StateScreen>
      )
    );
  }

  return <>{children}</>;
}

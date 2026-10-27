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
import { ShieldAlert, AlertTriangle, Loader2, ArrowRight } from 'lucide-react';

interface RequireAuthProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Restricts rendering to authenticated users with a verified, active LMS profile.
 */
export function RequireAuth({ children, fallback }: RequireAuthProps) {
  const { status, error } = useAuth();

  if (status === 'loading') {
    return (
      fallback || (
        <div className="flex flex-col items-center justify-center p-12 space-y-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm font-medium">Verifying LMS credentials...</p>
        </div>
      )
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="p-8 max-w-md mx-auto my-12 bg-slate-900 border border-slate-800 rounded-xl text-center space-y-5 shadow-2xl">
        <ShieldAlert className="w-10 h-10 text-amber-400 mx-auto" />
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-white">Authentication Required</h3>
          <p className="text-xs text-slate-400">
            Please sign in to your Strynkix Coding Academy account to access this learning portal.
          </p>
        </div>
        <div>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition"
          >
            <span>Sign In to Continue</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'no_profile') {
    return (
      <div className="p-8 max-w-md mx-auto my-12 bg-slate-900 border border-amber-800/40 rounded-xl text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
        <h3 className="text-lg font-bold text-white">Profile Pending Provisioning</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Your Firebase account is authenticated, but no Strynkix LMS profile has been assigned to your
          identity yet. Please contact your academy administrator or instructor.
        </p>
      </div>
    );
  }

  if (status === 'suspended') {
    return (
      <div className="p-8 max-w-md mx-auto my-12 bg-rose-950/30 border border-rose-900/60 rounded-xl text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-rose-500 mx-auto" />
        <h3 className="text-lg font-bold text-rose-200">Account Suspended</h3>
        <p className="text-xs text-rose-300 leading-relaxed">
          {error || 'Your academy account is currently inactive or suspended. Please contact administration.'}
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="p-8 max-w-md mx-auto my-12 bg-rose-950/20 border border-rose-900/40 rounded-xl text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
        <h4 className="text-sm font-semibold text-rose-200">Authentication Error</h4>
        <p className="text-xs text-rose-300">{error || 'Unable to authenticate session.'}</p>
      </div>
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
    return (
      <div className="flex items-center justify-center p-6 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-500 mr-2" />
        <span className="text-xs">Checking authorization...</span>
      </div>
    );
  }

  const userRole = tenant?.role;
  const isAuthorized = userRole && allowedRoles.includes(userRole);

  if (!isAuthorized) {
    return (
      fallback || (
        <div className="p-6 bg-slate-900/80 border border-slate-800 rounded-lg text-center space-y-2">
          <ShieldAlert className="w-6 h-6 text-amber-400 mx-auto" />
          <h4 className="text-sm font-semibold text-white">Restricted Section</h4>
          <p className="text-xs text-slate-400">
            This module requires one of the following roles:{' '}
            <span className="font-mono text-indigo-400">{allowedRoles.join(', ')}</span>.
          </p>
        </div>
      )
    );
  }

  return <>{children}</>;
}

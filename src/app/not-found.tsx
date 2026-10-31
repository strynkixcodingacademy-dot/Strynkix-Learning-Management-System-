'use client';

/**
 * Strynkix Live Books — branded 404 for unknown addresses (milestone G12).
 * Offers the way back that fits the visitor: their home when signed in, the
 * sign-in page otherwise.
 */

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { StateScreen } from '@/components/auth/RouteGuards';
import { buttonClasses } from '@/components/ui/Button';

export default function NotFound() {
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  return (
    <StateScreen illustration="compass" title="We couldn’t find that page"
      action={signedIn
        ? <><Link href="/dashboard" className={buttonClasses('primary')}>Go to Home</Link><Link href="/courses" className={buttonClasses('secondary')}>Live Books</Link></>
        : <Link href="/login" className={buttonClasses('primary')}>Sign in</Link>}>
      The address may be mistyped, or the page may have moved. Nothing you saved is affected.
    </StateScreen>
  );
}

'use client';

/**
 * Strynkix Live Books — error boundary for every page (milestone G11).
 * Shows a calm recovery screen instead of a blank page. Never shows the error
 * message or stack (it may contain internal details); a reference id is shown
 * for server errors so support can match the server log.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { StateScreen } from '@/components/auth/RouteGuards';
import { buttonClasses } from '@/components/ui/Button';

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error('[page error]', error);
  }, [error]);
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';

  return (
    <StateScreen illustration="compass" title="Something went wrong on this page"
      action={<>
        <button type="button" onClick={() => retry()} className={buttonClasses('primary')}>Try again</button>
        <Link href="/dashboard" className={buttonClasses('secondary')}>Go to Home</Link>
      </>}>
      Your work that was already saved is safe. Try again, or go back to your home page.
      {digest && <span className="mt-2 block text-xs text-ink-4">Reference: {digest}</span>}
    </StateScreen>
  );
}

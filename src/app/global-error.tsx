'use client';

/**
 * Strynkix Live Books — last-resort error screen when the root layout itself
 * fails (milestone G11). It replaces the whole document, so it brings its own
 * <html>, <body> and styles, and shows no internal error details.
 */

import { useEffect } from 'react';
import './globals.css';

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error('[global error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <title>Something went wrong · Strynkix Live Books</title>
        <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-card">
            <h1 className="type-page text-ink">Strynkix Live Books couldn’t load</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-3">Your saved work is safe. Please try again in a moment.</p>
            <div className="mt-6 flex justify-center gap-2">
              <button type="button" onClick={() => retry()} className="h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-white">Try again</button>
              {/* A plain link: the app's router may be what failed. */}
              <a href="/dashboard" className="inline-flex h-10 items-center rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink">Go to Home</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}

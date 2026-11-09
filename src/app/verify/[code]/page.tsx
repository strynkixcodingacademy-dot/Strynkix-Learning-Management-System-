'use client';

/** Strynkix LMS — public certificate verification (no sign-in). Shows only what the certificate itself shows. */

import React, { Suspense, use, useEffect, useState } from 'react';
import { formatDate } from '@/lib/academy/format';
import { BrandMark } from '@/components/ui/Illustrations';
import { CheckCircle2, XCircle } from 'lucide-react';

interface Result { valid: boolean; status?: string; certificateNumber?: string; studentName?: string; courseTitle?: string; academyName?: string; completedOn?: string; message?: string }

function VerifyPageContent({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [r, setR] = useState<Result | null>(null);
  useEffect(() => {
    fetch(`/api/certificates/verify?code=${encodeURIComponent(code)}`).then((res) => res.json()).then(setR).catch(() => setR({ valid: false, message: 'Verification is unavailable right now.' }));
  }, [code]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md space-y-5 rounded-card border border-line bg-surface p-6 text-center shadow-card">
        <div className="flex justify-center"><BrandMark size={40} /></div>
        <h1 className="type-page text-ink">Certificate verification</h1>
        {!r ? <p className="text-sm text-ink-3" role="status">Checking…</p> : r.valid ? (
          <div className="space-y-2">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden="true" />
            <p className="font-semibold text-success-ink">This certificate is valid.</p>
            <dl className="space-y-1 text-sm text-ink-2">
              <div><dt className="inline text-ink-3">Awarded to: </dt><dd className="inline font-semibold">{r.studentName}</dd></div>
              <div><dt className="inline text-ink-3">Course: </dt><dd className="inline font-semibold">{r.courseTitle}</dd></div>
              <div><dt className="inline text-ink-3">Issued by: </dt><dd className="inline">{r.academyName}</dd></div>
              <div><dt className="inline text-ink-3">Completed: </dt><dd className="inline">{formatDate(r.completedOn)}</dd></div>
              <div><dt className="inline text-ink-3">Number: </dt><dd className="inline">{r.certificateNumber}</dd></div>
            </dl>
          </div>
        ) : (
          <div className="space-y-2">
            <XCircle className="mx-auto h-10 w-10 text-danger" aria-hidden="true" />
            <p className="font-semibold text-danger-ink">{r.status === 'revoked' ? 'This certificate has been revoked.' : r.message ?? 'No certificate matches this link.'}</p>
          </div>
        )}
      </div>
    </main>
  );
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function VerifyPage(props: Parameters<typeof VerifyPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <VerifyPageContent {...props} />
    </Suspense>
  );
}

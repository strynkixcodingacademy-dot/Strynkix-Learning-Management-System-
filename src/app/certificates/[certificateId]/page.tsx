'use client';

/**
 * Strynkix LMS — printable certificate. "Print / Save as PDF" uses the
 * browser's print dialog; the page prints on one landscape A4 sheet.
 */

import React, { Suspense, use } from 'react';
import Link from 'next/link';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { certificatesApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatDate } from '@/lib/academy/format';
import type { Certificate } from '@/types/academy';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/States';

function CertificateView({ id }: { id: string }) {
  const { data, error } = useApiData(id, () => certificatesApi<{ certificate: Certificate }>({ action: 'get', certificateId: id }));
  if (error) return <div className="mx-auto max-w-md p-8"><ErrorState title="Certificate unavailable">{error}</ErrorState></div>;
  if (!data) return <LoadingState label="Loading certificate…" />;
  const c = data.certificate;
  const verifyUrl = typeof window !== 'undefined' ? `${window.location.origin}/verify/${c.verificationCode}` : `/verify/${c.verificationCode}`;
  return (
    <div className="min-h-screen bg-surface-muted p-4 print:bg-white print:p-0">
      <style>{'@page { size: A4 landscape; margin: 0; }'}</style>
      <div className="mx-auto mb-4 flex max-w-[1000px] flex-wrap gap-2 print:hidden">
        <Link href="/dashboard/certificates" className={buttonClasses('ghost')}>← Back</Link>
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>
      <article className="relative mx-auto flex aspect-[297/210] max-w-[1000px] flex-col items-center justify-between border-[10px] border-double border-brand bg-white p-[5%] text-center text-[#1d1d1f] shadow-lift print:max-w-none print:shadow-none">
        {c.status === 'revoked' && <div className="absolute inset-0 flex items-center justify-center text-6xl font-extrabold uppercase tracking-widest text-red-600/30">Revoked</div>}
        <div>
          <div className="text-sm font-bold uppercase tracking-[0.3em] text-[#6e6e73]">{c.academyName}</div>
          <h1 className="mt-4 font-serif text-[clamp(28px,4.5vw,52px)] font-bold">Certificate of Completion</h1>
        </div>
        <div className="space-y-3">
          <p className="text-lg text-[#6e6e73]">This certifies that</p>
          <p className="font-serif text-[clamp(26px,4vw,44px)] font-bold">{c.studentName}</p>
          <p className="text-lg text-[#6e6e73]">has successfully completed the course</p>
          <p className="text-[clamp(20px,2.6vw,30px)] font-bold">{c.courseTitle}</p>
          <p className="text-[#6e6e73]">on {formatDate(c.completedOn)}</p>
        </div>
        <div className="flex w-full items-end justify-between gap-6 text-left text-xs text-[#6e6e73]">
          <div>
            <div>Certificate No. <strong className="text-[#1d1d1f]">{c.certificateNumber}</strong></div>
            <div className="mt-1 break-all">Verify at {verifyUrl}</div>
          </div>
          <div className="text-center">
            <div className="mb-1 font-serif text-xl italic text-[#1d1d1f]">{c.signatoryName}</div>
            <div className="border-t border-[#1d1d1f] pt-1">{c.signatoryTitle}, {c.academyName}</div>
          </div>
        </div>
      </article>
    </div>
  );
}

function CertificatePageContent({ params }: { params: Promise<{ certificateId: string }> }) {
  const { certificateId } = use(params);
  return <RequireAuth><CertificateView id={certificateId} /></RequireAuth>;
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function CertificatePage(props: Parameters<typeof CertificatePageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <CertificatePageContent {...props} />
    </Suspense>
  );
}

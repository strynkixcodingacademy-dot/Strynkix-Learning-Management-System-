'use client';

/** Strynkix LMS — printable admission form for a confirmed or draft admission. */

import React, { Suspense, use } from 'react';
import { RequireRole } from '@/components/auth/RouteGuards';
import { admissionsApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatDate, formatMoney } from '@/lib/academy/format';
import type { Admission } from '@/types/academy';
import { DocHeader, PrintFrame } from '@/components/print/PrintFrame';
import { ErrorState, LoadingState } from '@/components/ui/States';

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return <div className="grid grid-cols-[180px_1fr] gap-2 border-b border-line py-1.5"><dt className="text-ink-3">{label}</dt><dd className="font-medium">{value || '—'}</dd></div>;
}

function Form({ id }: { id: string }) {
  const { data, error } = useApiData(id, () => admissionsApi<{ admission: Admission }>({ action: 'get', admissionId: id }));
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading…" />;
  const a = data.admission;
  const p = a.personal;
  return (
    <PrintFrame back={`/dashboard/admissions/${a.id}`} title="Admission form">
      <DocHeader academy="Strynkix Coding Academy" branch={`Branch: ${a.branchId}`} title="Admission form" meta={<>{a.admissionNumber ?? 'Draft'} · {formatDate(a.confirmedAt ?? a.updatedAt)}</>} />
      <h2 className="mb-1 mt-2 font-semibold">Personal information</h2>
      <dl>
        <Row label="Name" value={[p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ')} />
        <Row label="Date of birth" value={formatDate(p.dateOfBirth)} /><Row label="Gender" value={p.gender} />
        <Row label="Email" value={p.email} /><Row label="Mobile" value={p.mobile} />
        <Row label="Emergency contact" value={[p.emergencyName, p.emergencyRelation, p.emergencyPhone].filter(Boolean).join(' · ')} />
        <Row label="Address" value={[p.address, p.city, p.state, p.pinCode].filter(Boolean).join(', ')} />
      </dl>
      <h2 className="mb-1 mt-5 font-semibold">Academic background</h2>
      <dl>
        <Row label="Highest qualification" value={a.academic?.highestQualification} /><Row label="Current education / occupation" value={a.academic?.currentOccupation} />
        <Row label="Institution" value={a.academic?.institution} /><Row label="Technical experience" value={a.academic?.technicalExperience} />
      </dl>
      <h2 className="mb-1 mt-5 font-semibold">Course and fees</h2>
      <dl>
        <Row label="Course / batch" value={`${a.courseId ?? '—'} / ${a.batchId ?? '—'}`} />
        <Row label="Discount" value={a.fee && a.fee.discountType !== 'none' ? `${a.fee.discountType === 'percent' ? `${a.fee.discountValue / 100}%` : formatMoney(a.fee.discountValue)} — ${a.fee.discountReason ?? ''}` : 'None'} />
        <Row label="Payment plan" value={a.fee ? (a.fee.plan === 'one_time' ? 'One-time' : a.fee.installments.map((i) => `${formatMoney(i.amount)} on ${formatDate(i.dueDate)}`).join('; ')) : '—'} />
        <Row label="Paid at admission" value={a.fee?.initialPayment ? formatMoney(a.fee.initialPayment.amount) : '—'} />
      </dl>
      <div className="mt-16 grid grid-cols-2 gap-16 text-center text-xs text-ink-3">
        <div className="border-t border-ink pt-1">Student signature</div>
        <div className="border-t border-ink pt-1">Authorized signatory</div>
      </div>
    </PrintFrame>
  );
}

function AdmissionPrintPageContent({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><Form id={admissionId} /></RequireRole>;
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function AdmissionPrintPage(props: Parameters<typeof AdmissionPrintPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <AdmissionPrintPageContent {...props} />
    </Suspense>
  );
}

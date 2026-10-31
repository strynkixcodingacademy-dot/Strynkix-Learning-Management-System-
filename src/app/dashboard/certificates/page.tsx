'use client';

/**
 * Strynkix LMS — Certificates.
 * Students: issued certificates (open, print or save as PDF) and what is still
 * needed for each course. Staff: a batch’s eligibility, issuing (branch
 * managers), and the course’s certificate rules (academy administrators).
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { certificatesApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { getBatchesForTenant } from '@/lib/batches/service';
import { formatDate } from '@/lib/academy/format';
import type { Certificate, CertificatePolicy } from '@/types/academy';
import type { Batch } from '@/types/domain';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Award, CheckCircle2, Circle } from 'lucide-react';

interface Eligibility { eligible: boolean; completionPercent: number; attendancePercent: number | null; averagePercent: number | null; finalExamPassed: boolean; unmet: string[] }

function MyCertificates() {
  const { data, error, reload } = useApiData('mine', () => certificatesApi<{ certificates: Certificate[]; inProgress: { courseId: string; courseTitle: string; eligibility: Eligibility }[] }>({ action: 'my_certificates' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading your certificates…" />;
  return (
    <div className="space-y-6">
      <PageHeader title="My Certificates" description="Certificates are issued by your branch once you meet the course’s requirements. Each has a verification link employers can check." />
      {data.certificates.length === 0 ? <EmptyState title="No certificates yet">Your certificates will appear here.</EmptyState> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.certificates.map((c) => (
            <Card key={c.id} className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <Award className="h-8 w-8 text-warning-ink" aria-hidden="true" />
                <StatusPill size="sm" tone={c.status === 'issued' ? 'success' : 'danger'}>{c.status === 'issued' ? 'Valid' : 'Revoked'}</StatusPill>
              </div>
              <div className="text-lg font-extrabold text-ink">{c.courseTitle}</div>
              <div className="text-sm text-ink-3">{c.certificateNumber} · completed {formatDate(c.completedOn)}</div>
              {c.status === 'issued' && <Link href={`/certificates/${c.id}`} className={buttonClasses('primary', 'sm')}>Open, print or save as PDF</Link>}
            </Card>
          ))}
        </div>
      )}
      {data.inProgress.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-extrabold text-ink">Working towards</h2>
          {data.inProgress.map((p) => (
            <Card key={p.courseId} className="space-y-2 p-5">
              <div className="font-bold text-ink">{p.courseTitle}</div>
              {p.eligibility.eligible ? <p className="flex items-center gap-2 text-sm text-success-ink"><CheckCircle2 className="h-4 w-4" /> You meet the requirements. Your branch can now issue your certificate.</p> : (
                <ul className="space-y-1 text-sm text-ink-2">{p.eligibility.unmet.map((u) => <li key={u} className="flex items-start gap-2"><Circle className="mt-1 h-3 w-3 shrink-0 text-ink-4" />{u}</li>)}</ul>
              )}
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}

type PolicyInput = Pick<CertificatePolicy, 'minCompletionPercent' | 'minAttendancePercent' | 'requireFinalExamPass' | 'minAveragePercent' | 'signatoryName' | 'signatoryTitle'>;

function PolicyForm({ courseId, initial, onSaved }: { courseId: string; initial: PolicyInput; onSaved: () => void }) {
  const [p, setP] = useState<PolicyInput>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-bold text-ink">Certificate rules for this course</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Lessons completed (%)" htmlFor="pc"><input id="pc" type="number" min={0} max={100} value={p.minCompletionPercent} onChange={(e) => setP({ ...p, minCompletionPercent: Number(e.target.value) })} className={fieldClasses} /></Field>
        <Field label="Attendance (%)" htmlFor="pa" hint="0 = not required"><input id="pa" type="number" min={0} max={100} value={p.minAttendancePercent} onChange={(e) => setP({ ...p, minAttendancePercent: Number(e.target.value) })} className={fieldClasses} /></Field>
        <Field label="Average score (%)" htmlFor="pv" hint="0 = not required"><input id="pv" type="number" min={0} max={100} value={p.minAveragePercent} onChange={(e) => setP({ ...p, minAveragePercent: Number(e.target.value) })} className={fieldClasses} /></Field>
        <Field label="Signatory name" htmlFor="ps"><input id="ps" value={p.signatoryName} onChange={(e) => setP({ ...p, signatoryName: e.target.value })} className={fieldClasses} /></Field>
        <Field label="Signatory title" htmlFor="pt"><input id="pt" value={p.signatoryTitle} onChange={(e) => setP({ ...p, signatoryTitle: e.target.value })} className={fieldClasses} /></Field>
        <label className="flex items-center gap-2 self-end pb-3 text-sm text-ink-2"><input type="checkbox" checked={p.requireFinalExamPass} onChange={(e) => setP({ ...p, requireFinalExamPass: e.target.checked })} /> Final exam must be passed</label>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Button loading={busy} onClick={async () => {
        setBusy(true);
        try { await certificatesApi({ action: 'save_policy', courseId, policy: p }); setMsg({ kind: 'success', text: 'Certificate rules saved.' }); onSaved(); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
      }}>Save rules</Button>
    </Card>
  );
}

function BatchCertificates({ batch }: { batch: Batch }) {
  const { data, error, reload } = useApiData(batch.id, () => certificatesApi<{ policy: PolicyInput; canIssue: boolean; students: { studentId: string; name: string; eligibility: Eligibility; certificate: Certificate | null }[] }>({ action: 'batch_eligibility', batchId: batch.id }));
  const policy = useApiData(batch.courseId, () => certificatesApi<{ policy: PolicyInput; canEdit: boolean }>({ action: 'get_policy', courseId: batch.courseId }));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Checking eligibility…" />;
  return (
    <div className="space-y-4">
      {policy.data?.canEdit && <PolicyForm key={JSON.stringify(policy.data.policy)} courseId={batch.courseId} initial={policy.data.policy} onSaved={() => { policy.reload(); reload(); }} />}
      {!data.policy.signatoryName && <Notice kind="warning">Certificate rules and a signatory haven’t been set for this course yet. An academy administrator sets them.</Notice>}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {data.students.length === 0 ? <EmptyState title="No students">No active students in this batch.</EmptyState> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Student</th><th className="p-3 text-right">Lessons</th><th className="p-3 text-right">Attendance</th><th className="p-3 text-right">Average</th><th className="p-3">Final exam</th><th className="p-3">Certificate</th></tr></thead>
            <tbody>{data.students.map((s) => (
              <tr key={s.studentId} className="border-b border-line align-top last:border-0">
                <td className="p-3 font-semibold text-ink">{s.name}{!s.eligibility.eligible && <div className="mt-1 text-xs font-normal text-ink-3">{s.eligibility.unmet.join(' ')}</div>}</td>
                <td className="p-3 text-right">{s.eligibility.completionPercent}%</td>
                <td className="p-3 text-right">{s.eligibility.attendancePercent ?? '—'}{s.eligibility.attendancePercent !== null ? '%' : ''}</td>
                <td className="p-3 text-right">{s.eligibility.averagePercent ?? '—'}{s.eligibility.averagePercent !== null ? '%' : ''}</td>
                <td className="p-3">{s.eligibility.finalExamPassed ? 'Passed' : '—'}</td>
                <td className="p-3">
                  {s.certificate ? <Link href={`/certificates/${s.certificate.id}`} className="text-brand-ink underline">{s.certificate.certificateNumber}</Link>
                    : data.canIssue && s.eligibility.eligible ? (
                      <Button size="sm" loading={busy === s.studentId} onClick={async () => {
                        setBusy(s.studentId);
                        setMsg(null);
                        try { const r = await certificatesApi<{ certificateNumber: string }>({ action: 'issue', courseId: batch.courseId, studentId: s.studentId }); setMsg({ kind: 'success', text: `Issued ${r.certificateNumber} to ${s.name}.` }); reload(); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(null); }
                      }}>Issue certificate</Button>
                    ) : <span className="text-xs text-ink-3">{s.eligibility.eligible ? 'Eligible' : 'Not eligible yet'}</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function StaffCertificates() {
  const { tenant, user } = useAuth();
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [batchId, setBatchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!tenant || !user) return;
    getBatchesForTenant(tenant, user.uid).then((b) => { setBatches(b); setBatchId((c) => c || b[0]?.id || ''); }).catch((e) => setError((e as Error).message));
  }, [tenant, user]);
  const batch = useMemo(() => batches?.find((b) => b.id === batchId) ?? null, [batches, batchId]);
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!batches) return <LoadingState label="Loading batches…" />;
  return (
    <div className="space-y-6">
      <PageHeader title="Certificates" description="Check which students meet the course requirements and issue their certificates. A certificate can be issued once per student per course." />
      {batches.length === 0 ? <EmptyState title="No batches">Certificates are issued per batch.</EmptyState> : (
        <>
          <Field label="Batch" htmlFor="cert-batch">
            <select id="cert-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={`${fieldClasses} max-w-md`}>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </Field>
          {batch && <BatchCertificates key={batch.id} batch={batch} />}
        </>
      )}
    </div>
  );
}

export default function CertificatesPage() {
  const { tenant } = useAuth();
  return (
    <RequireAuth>
      <AppShell pageTitle="Certificates">
        {!tenant ? <LoadingState label="Loading…" /> : tenant.role === 'student' ? <MyCertificates />
          : ['super_admin', 'university_admin', 'branch_admin', 'instructor'].includes(tenant.role) ? <StaffCertificates />
            : <EmptyState title="Not available">Certificates are managed by branch managers and administrators.</EmptyState>}
      </AppShell>
    </RequireAuth>
  );
}

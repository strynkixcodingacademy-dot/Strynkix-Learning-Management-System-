'use client';

/**
 * Strynkix LMS — a person's profile for managers: personal and academic
 * details, courses and results, attendance, fee status (finance access only),
 * batches taught, and editing of the permitted fields. Login email, role and
 * branch are changed from People → Edit (audited account changes).
 */

import React, { Suspense, use, useState } from 'react';
import Link from 'next/link';
import { AppShell, ROLE_LABELS } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { admissionsApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatDate, formatMoney, toPaise } from '@/lib/academy/format';
import type { PersonProfile } from '@/types/academy';
import type { UserRole } from '@/types/domain';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, Field, PageHeader, Section, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { BookOpen, IndianRupee, User, Users } from 'lucide-react';

interface Detail {
  user: { id: string; displayName: string; email: string; role: UserRole; status: string; branchId: string | null; phoneNumber: string | null; studentId: string | null; createdAt: string };
  profile: Partial<PersonProfile> | null;
  canSeeFinance: boolean;
  academic: { courseId: string; courseTitle: string; batchName: string; status: string; enrolledAt: string; evaluated: number; averagePercent: number | null; attendance: { scheduled: number; percent: number } }[];
  fees: { id: string; courseTitle: string; due: number; collected: number; balance: number; paymentStatus: string; nextDue: { dueDate: string; amount: number } | null }[] | null;
  batchesTaught: { id: string; name: string; status: string }[];
}

function EditForm({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const p = d.profile?.personal ?? { firstName: '', lastName: '', email: d.user.email, mobile: d.user.phoneNumber ?? '' };
  const [personal, setPersonal] = useState({ mobile: p.mobile ?? '', emergencyName: p.emergencyName ?? '', emergencyRelation: p.emergencyRelation ?? '', emergencyPhone: p.emergencyPhone ?? '', address: p.address ?? '', city: p.city ?? '', state: p.state ?? '', pinCode: p.pinCode ?? '' });
  const [comp, setComp] = useState(d.profile?.compensation ? String(d.profile.compensation.amount / 100) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const isStaff = d.user.role !== 'student';
  return (
    <Card className="space-y-4 p-5">
      <h3 className="text-sm font-bold text-ink">Edit contact details</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(personal) as (keyof typeof personal)[]).map((k) => (
          <Field key={k} label={k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())} htmlFor={`e-${k}`}>
            <input id={`e-${k}`} value={personal[k]} onChange={(e) => setPersonal((x) => ({ ...x, [k]: e.target.value }))} className={fieldClasses} />
          </Field>
        ))}
        {isStaff && d.canSeeFinance && <Field label="Monthly compensation (₹)" htmlFor="e-comp" hint="Visible only to finance-authorized users."><input id="e-comp" inputMode="decimal" value={comp} onChange={(e) => setComp(e.target.value)} className={fieldClasses} /></Field>}
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Button loading={busy} onClick={async () => {
        setBusy(true);
        setMsg(null);
        try {
          const cleanPersonal = Object.fromEntries(Object.entries(personal).filter(([, v]) => v.trim()));
          const amount = comp.trim() ? toPaise(comp) : null;
          if (comp.trim() && amount === null) throw new Error('Enter the compensation in rupees.');
          await admissionsApi({ action: 'update_person', userId: d.user.id, personal: cleanPersonal, ...(isStaff && d.canSeeFinance ? { compensation: amount === null ? null : { type: 'monthly', amount } } : {}) });
          setMsg({ kind: 'success', text: 'Saved.' });
          onSaved();
        } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
      }}>Save changes</Button>
    </Card>
  );
}

function Person({ userId }: { userId: string }) {
  const { data, error, reload } = useApiData(userId, () => admissionsApi<Detail>({ action: 'person', userId }));
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading profile…" />;
  const { user, profile } = data;
  const p = profile?.personal;
  return (
    <div className="space-y-8">
      <PageHeader breadcrumbs={[{ label: 'People', href: '/dashboard/people' }, { label: user.displayName }]} eyebrow={ROLE_LABELS[user.role]} title={user.displayName}
        description={`${user.email}${user.studentId ? ` · Student ID ${user.studentId}` : ''}`}
        actions={<><StatusPill tone={user.status === 'active' ? 'success' : 'warning'}>{user.status}</StatusPill><Button variant="secondary" onClick={() => setEditing((v) => !v)}>{editing ? 'Close editor' : 'Edit details'}</Button></>} />
      {editing && <EditForm d={data} onSaved={() => { setEditing(false); reload(); }} />}
      <Section title="Personal details" icon={User}>
        {!p ? <EmptyState title="No personal record">This account was created before admissions were recorded here. Use “Edit details” to add contact information.</EmptyState> : (
          <Card className="grid gap-3 p-5 text-sm sm:grid-cols-3">
            <div><div className="text-xs text-ink-3">Mobile</div><div className="font-semibold">{p.mobile || '—'}</div></div>
            <div><div className="text-xs text-ink-3">Date of birth</div><div className="font-semibold">{formatDate(p.dateOfBirth)}</div></div>
            <div><div className="text-xs text-ink-3">Emergency contact</div><div className="font-semibold">{[p.emergencyName, p.emergencyRelation, p.emergencyPhone].filter(Boolean).join(' · ') || '—'}</div></div>
            <div className="sm:col-span-3"><div className="text-xs text-ink-3">Address</div><div className="font-semibold">{[p.address, p.city, p.state, p.pinCode].filter(Boolean).join(', ') || '—'}</div></div>
            {profile?.academic?.highestQualification && <div><div className="text-xs text-ink-3">Qualification</div><div className="font-semibold">{profile.academic.highestQualification}</div></div>}
            {profile?.professional?.qualification && <div><div className="text-xs text-ink-3">Qualification</div><div className="font-semibold">{profile.professional.qualification}</div></div>}
            {profile?.professional?.skills?.length ? <div><div className="text-xs text-ink-3">Skills</div><div className="font-semibold">{profile.professional.skills.join(', ')}</div></div> : null}
            {profile?.professional?.joiningDate && <div><div className="text-xs text-ink-3">Joined</div><div className="font-semibold">{formatDate(profile.professional.joiningDate)}</div></div>}
            {profile?.compensation && <div><div className="text-xs text-ink-3">Compensation ({profile.compensation.type.replace('_', ' ')})</div><div className="font-semibold">{formatMoney(profile.compensation.amount)}</div></div>}
          </Card>
        )}
      </Section>
      {user.role === 'student' && (
        <Section title="Courses, results and attendance" icon={BookOpen}>
          {data.academic.length === 0 ? <EmptyState title="Not enrolled">No course enrollments yet.</EmptyState> : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Course / batch</th><th className="p-3">Status</th><th className="p-3 text-right">Results</th><th className="p-3 text-right">Average</th><th className="p-3 text-right">Attendance</th></tr></thead>
                <tbody>{data.academic.map((a) => <tr key={a.courseId} className="border-b border-line last:border-0"><td className="p-3 font-semibold text-ink">{a.courseTitle}<div className="text-xs font-normal text-ink-3">{a.batchName} · since {formatDate(a.enrolledAt)}</div></td><td className="p-3">{a.status}</td><td className="p-3 text-right">{a.evaluated}</td><td className="p-3 text-right">{a.averagePercent ?? '—'}{a.averagePercent !== null ? '%' : ''}</td><td className="p-3 text-right">{a.attendance.scheduled ? `${a.attendance.percent}%` : '—'}</td></tr>)}</tbody>
              </table>
            </Card>
          )}
        </Section>
      )}
      {data.fees && (
        <Section title="Fees" icon={IndianRupee}>
          {data.fees.length === 0 ? <EmptyState title="No fee account">No fee account is linked to this student.</EmptyState> : data.fees.map((f) => (
            <Card key={f.id} className="flex flex-wrap items-center gap-4 p-4 text-sm">
              <div className="min-w-0 flex-1 font-semibold text-ink">{f.courseTitle}</div>
              <div>Due {formatMoney(f.due)}</div><div>Paid {formatMoney(f.collected)}</div><div className="font-bold">Balance {formatMoney(f.balance)}</div>
              <StatusPill size="sm" tone={f.paymentStatus === 'paid' ? 'success' : f.paymentStatus === 'overdue' ? 'danger' : 'warning'}>{f.paymentStatus}</StatusPill>
              <Link href={`/dashboard/finance/accounts/${f.id}`} className={buttonClasses('secondary', 'sm')}>Open ledger</Link>
            </Card>
          ))}
        </Section>
      )}
      {data.batchesTaught.length > 0 && (
        <Section title="Batches taught" icon={Users}>
          <ul className="flex flex-wrap gap-2">{data.batchesTaught.map((b) => <li key={b.id}><Link href={`/dashboard/batches/${b.id}`} className="inline-block rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink hover:border-silver">{b.name} · {b.status.replace('_', ' ')}</Link></li>)}</ul>
        </Section>
      )}
    </div>
  );
}

function PersonPageContent({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin']}><AppShell pageTitle="Profile"><Person userId={userId} /></AppShell></RequireRole>;
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function PersonPage(props: Parameters<typeof PersonPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <PersonPageContent {...props} />
    </Suspense>
  );
}

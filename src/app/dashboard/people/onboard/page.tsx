'use client';

/**
 * Strynkix LMS — onboard an instructor (branch staff, optional batch
 * assignment) or a course designer (academy-wide, Super Admin, with course
 * responsibilities). The login is created by the trusted provisioning flow;
 * personal and professional details are stored privately.
 */

import React, { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { admissionsApi } from '@/lib/academy/api';
import { getBranches } from '@/lib/admin/service';
import { getBatchesForTenant } from '@/lib/batches/service';
import { getCoursesPage } from '@/lib/courses/service';
import { toPaise } from '@/lib/academy/format';
import type { Batch, Branch, Course, CourseDesignResponsibility } from '@/types/domain';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { Notice } from '@/components/ui/States';

const RESP: { id: CourseDesignResponsibility; label: string }[] = [
  { id: 'content_developer', label: 'Content developer (writes lessons)' }, { id: 'assessment_designer', label: 'Assessment designer (quizzes and exams)' },
  { id: 'curriculum_architect', label: 'Curriculum architect (course structure)' }, { id: 'reviewer', label: 'Reviewer (approves content)' }, { id: 'lead', label: 'Lead' },
];

function Onboard({ role }: { role: 'instructor' | 'content_designer' }) {
  const { tenant, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [branchId, setBranchId] = useState(tenant?.role === 'branch_admin' ? tenant.branchId ?? '' : '');
  const [f, setF] = useState({ firstName: '', middleName: '', lastName: '', dateOfBirth: '', email: '', mobile: '', emergencyName: '', emergencyPhone: '', address: '', city: '', qualification: '', specialization: '', skills: '', experienceYears: '', joiningDate: '', responsibilities: '' });
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [resp, setResp] = useState<CourseDesignResponsibility[]>(['content_developer']);
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [salary, setSalary] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string; userId?: string } | null>(null);

  useEffect(() => {
    if (!tenant || !user) return;
    if (tenant.role !== 'branch_admin') getBranches(tenant.orgId).then((b) => setBranches(b.filter((x) => x.status === 'active'))).catch(() => undefined);
    getBatchesForTenant(tenant, user.uid).then((b) => setBatches(b.filter((x) => ['upcoming', 'in_progress'].includes(x.status)))).catch(() => undefined);
    if (role === 'content_designer') getCoursesPage({ orgId: tenant.orgId, pageSize: 100 }).then((p) => setCourses(p.courses)).catch(() => undefined);
  }, [tenant, user, role]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const I = (k: keyof typeof f, label: string, type = 'text', required = false) => <Field label={label} htmlFor={`o-${k}`} required={required}><input id={`o-${k}`} type={type} value={f[k]} onChange={set(k)} className={fieldClasses} /></Field>;
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const amount = salary.trim() ? toPaise(salary) : null;
      if (salary.trim() && amount === null) throw new Error('Enter the compensation in rupees.');
      const r = await admissionsApi<{ userId: string }>({
        action: 'onboard_staff', role, ...(role === 'instructor' ? { branchId } : {}), password,
        personal: JSON.parse(JSON.stringify({ firstName: f.firstName.trim(), middleName: opt(f.middleName), lastName: f.lastName.trim(), dateOfBirth: opt(f.dateOfBirth), email: f.email.trim(), mobile: f.mobile.trim(), emergencyName: opt(f.emergencyName), emergencyPhone: opt(f.emergencyPhone), address: opt(f.address), city: opt(f.city) })),
        professional: JSON.parse(JSON.stringify({ qualification: opt(f.qualification), specialization: opt(f.specialization), skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean), experienceYears: f.experienceYears ? Number(f.experienceYears) : undefined, joiningDate: opt(f.joiningDate), employmentStatus: 'active', responsibilities: opt(f.responsibilities) })),
        ...(amount !== null ? { compensation: { type: 'monthly', amount } } : {}),
        ...(role === 'instructor' && batchIds.length ? { batchIds } : {}),
        ...(role === 'content_designer' ? { courseDesign: { responsibilities: resp, assignedCourseIds: courseIds } } : {}),
      });
      setMsg({ kind: 'success', text: `${f.firstName} can now sign in with ${f.email} and the password you set.`, userId: r.userId });
    } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: 'People', href: '/dashboard/people' }, { label: role === 'instructor' ? 'Onboard instructor' : 'Onboard course designer' }]} title={role === 'instructor' ? 'Onboard an instructor' : 'Onboard a course designer'} description="Personal details are kept private to managers. The person can change their password after signing in." />
      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-bold text-ink">Personal and contact information</h2>
        <div className="grid gap-4 sm:grid-cols-3">{I('firstName', 'First name', 'text', true)}{I('middleName', 'Middle name')}{I('lastName', 'Surname', 'text', true)}</div>
        <div className="grid gap-4 sm:grid-cols-3">{I('dateOfBirth', 'Date of birth', 'date')}{I('email', 'Email (sign-in)', 'email', true)}{I('mobile', 'Mobile', 'tel', true)}</div>
        <div className="grid gap-4 sm:grid-cols-3">{I('emergencyName', 'Emergency contact')}{I('emergencyPhone', 'Emergency phone', 'tel')}{I('city', 'City')}</div>
        {I('address', 'Address')}
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-bold text-ink">Professional details</h2>
        <div className="grid gap-4 sm:grid-cols-3">{I('qualification', 'Qualification')}{I('specialization', 'Specialization')}{I('experienceYears', 'Experience (years)', 'number')}</div>
        <div className="grid gap-4 sm:grid-cols-2">{I('skills', 'Skills (comma separated)')}{I('joiningDate', 'Joining date', 'date')}</div>
        {role === 'instructor' ? (
          <>
            {tenant?.role !== 'branch_admin' && (
              <Field label="Branch" htmlFor="o-branch" required><select id="o-branch" value={branchId} onChange={(e) => { setBranchId(e.target.value); setBatchIds([]); }} className={fieldClasses}><option value="">Choose a branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            )}
            <fieldset className="space-y-2"><legend className="text-sm font-semibold text-ink-2">Assign to batches (optional)</legend>
              <div className="flex flex-wrap gap-3">{batches.filter((b) => b.branchId === branchId).map((b) => <label key={b.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={batchIds.includes(b.id)} onChange={(e) => setBatchIds((x) => (e.target.checked ? [...x, b.id] : x.filter((y) => y !== b.id)))} /> {b.name}</label>)}</div>
            </fieldset>
          </>
        ) : (
          <>
            <fieldset className="space-y-2"><legend className="text-sm font-semibold text-ink-2">Content responsibilities</legend>
              {RESP.map((r) => <label key={r.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={resp.includes(r.id)} onChange={(e) => setResp((x) => (e.target.checked ? [...x, r.id] : x.filter((y) => y !== r.id)))} /> {r.label}</label>)}
            </fieldset>
            <fieldset className="space-y-2"><legend className="text-sm font-semibold text-ink-2">Assigned courses (they get access to these only)</legend>
              <div className="flex flex-wrap gap-3">{courses.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={courseIds.includes(c.id)} onChange={(e) => setCourseIds((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} /> {c.title}</label>)}</div>
            </fieldset>
          </>
        )}
        <Field label="Notes on responsibilities" htmlFor="o-responsibilities"><textarea id="o-responsibilities" rows={2} value={f.responsibilities} onChange={set('responsibilities')} className={fieldClasses} /></Field>
      </Card>
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Monthly compensation (₹, optional)" htmlFor="o-salary" hint="Only finance-authorized users can record or see this."><input id="o-salary" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} className={fieldClasses} /></Field>
        <Field label="Initial password" htmlFor="o-pw" required hint="At least 8 characters."><input id="o-pw" value={password} onChange={(e) => setPassword(e.target.value)} className={`${fieldClasses} font-mono`} /></Field>
      </Card>
      {msg && <Notice kind={msg.kind}>{msg.text} {msg.userId && <Link className="underline" href={`/dashboard/people/${msg.userId}`}>Open profile</Link>}</Notice>}
      <div className="flex gap-2">
        <Button onClick={submit} loading={busy} disabled={!f.firstName || !f.lastName || !f.email || !f.mobile || password.length < 8 || (role === 'instructor' && !branchId) || (role === 'content_designer' && (!resp.length || !courseIds.length))}>Create account</Button>
        <Link href="/dashboard/people" className={buttonClasses('ghost')}>Cancel</Link>
      </div>
    </div>
  );
}

function OnboardPageContent({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const sp = use(searchParams);
  const role = sp.role === 'content_designer' ? 'content_designer' : 'instructor';
  return (
    <RequireRole allowedRoles={role === 'content_designer' ? ['super_admin'] : ['super_admin', 'university_admin', 'branch_admin']}>
      <AppShell><Onboard role={role} /></AppShell>
    </RequireRole>
  );
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function OnboardPage(props: Parameters<typeof OnboardPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <OnboardPageContent {...props} />
    </Suspense>
  );
}

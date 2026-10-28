'use client';

/**
 * Strynkix Live Books — branch overview (Super Admin).
 * One branch at a glance: its managers, instructors and students, its batches,
 * and how it is performing, using the same analytics definitions as /analytics.
 */

import React, { Suspense, use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { BatchStatusBadge } from '@/components/batches/StatusBadges';
import { buttonClasses } from '@/components/ui/Button';
import { Avatar, KpiTile, Meter } from '@/components/ui/DataViz';
import { Card, PageHeader, Section } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { buildAnalytics, ratioHint } from '@/lib/analytics/metrics';
import { BatchData } from '@/lib/analytics/metrics';
import { loadAnalyticsData } from '@/lib/analytics/service';
import { Batch, Branch, UserProfile } from '@/types/domain';
import { AlertTriangle, BarChart3, BookCheck, ClipboardCheck, GraduationCap, Layers, MapPin, Plus, ShieldCheck, Trophy, Users } from 'lucide-react';

type BranchPageProps = { params: Promise<{ branchId: string }> };

// params is a Promise in this Next.js version; unwrapping it inside Suspense
// keeps the route compatible with cacheComponents prerendering.
export default function BranchDetailPage({ params }: BranchPageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <BranchDetailContent params={params} />
    </Suspense>
  );
}

function BranchDetailContent({ params }: BranchPageProps) {
  const { branchId } = use(params);
  const { user, tenant } = useAuth();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [data, setData] = useState<BatchData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!tenant || !user) return;
      try {
        const snap = await getDoc(doc(db, 'branches', branchId));
        if (!snap.exists()) {
          if (alive) setError('This branch doesn’t exist or isn’t in your scope.');
          return;
        }
        const b = { id: snap.id, ...snap.data() } as Branch;
        const [usersSnap, analytics] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('orgId', '==', b.orgId), where('branchId', '==', b.id))),
          loadAnalyticsData(tenant, user.uid, { branchId: b.id, includeClosed: true }),
        ]);
        if (!alive) return;
        setBranch(b);
        setPeople(usersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as UserProfile)));
        setBatches(analytics.all.filter((x) => x.branchId === b.id));
        setData(analytics.data.filter((d) => !['archived', 'cancelled'].includes(d.batch.status)));
        setNow(new Date());
        setError(null);
      } catch (err) {
        console.error('Failed to load branch', err);
        if (alive) setError('We couldn’t load this branch. Check your connection and try again.');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [branchId, tenant, user, reloadKey]);

  const report = useMemo(() => buildAnalytics(data, now), [data, now]);
  const managers = people.filter((p) => p.role === 'branch_admin');
  const instructors = people.filter((p) => p.role === 'instructor');
  const students = people.filter((p) => p.role === 'student');
  const pct = (n: number | null) => (n === null ? '—' : `${n}`);
  const place = branch?.location?.isRemote
    ? 'Remote virtual campus'
    : [branch?.location?.city, branch?.location?.state, branch?.location?.country].filter(Boolean).join(', ') || 'Location not set';

  return (
    <AppShell>
      <RequireRole allowedRoles={['super_admin', 'university_admin']}>
        {loading ? (
          <LoadingState label="Loading branch…" rows={4} />
        ) : error || !branch ? (
          <ErrorState title="Branch unavailable" onRetry={() => { setLoading(true); setReloadKey((k) => k + 1); }}>
            {error} <Link href="/dashboard/branches" className="font-bold text-brand-ink underline">Back to branches</Link>
          </ErrorState>
        ) : (
          <div className="space-y-8">
            <PageHeader
              breadcrumbs={[{ label: 'Branches', href: '/dashboard/branches' }, { label: branch.name }]}
              eyebrow={branch.code ? `Branch · ${branch.code}` : 'Branch'}
              title={branch.name}
              description={<span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{place}</span>}
              actions={<>
                <Link href="/dashboard/batches" className={buttonClasses('primary')}><Plus className="h-4 w-4" /> New batch</Link>
                <Link href="/dashboard/analytics" className={buttonClasses('secondary')}><BarChart3 className="h-4 w-4" /> Full analytics</Link>
              </>}
            />

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiTile label="Active students" value={report.totals.activeStudents} icon={GraduationCap} hint={`${students.length} student account${students.length === 1 ? '' : 's'} at this branch.`} />
              <KpiTile label="Learning completion" value={pct(report.metrics.learningCompletion.percentage)} suffix={report.metrics.learningCompletion.percentage === null ? undefined : '%'} icon={BookCheck} tone="success" hint={ratioHint(report.metrics.learningCompletion, 'planned lessons finished.', 'No lessons planned up to today.')} />
              <KpiTile label="Submission rate" value={pct(report.metrics.submissionRate.percentage)} suffix={report.metrics.submissionRate.percentage === null ? undefined : '%'} icon={ClipboardCheck} tone="teal" hint={ratioHint(report.metrics.submissionRate, 'due assignments submitted.', 'No deadline has passed yet.')} />
              <KpiTile label="Average mark" value={pct(report.metrics.assessment.percentage)} suffix={report.metrics.assessment.percentage === null ? undefined : '%'} icon={Trophy} tone="lavender" hint={`${report.metrics.assessment.gradedCount} graded submissions.`} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Section id="batches" title={`Batches (${batches.length})`} icon={Layers}>
                {batches.length === 0 ? (
                  <EmptyState compact illustration="calendar" title="No batches at this branch yet" action={<Link href="/dashboard/batches" className={buttonClasses('primary', 'sm')}>Create a batch</Link>}>
                    Create a batch to enroll students and start daily plans.
                  </EmptyState>
                ) : (
                  <Card className="divide-y divide-line">
                    {batches.map((b) => {
                      const row = report.batches.find((r) => r.batch.id === b.id);
                      return (
                        <Link key={b.id} href={`/dashboard/batches/${b.id}`} className="flex flex-col gap-3 px-4 py-3.5 hover:bg-canvas sm:flex-row sm:items-center sm:px-5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-bold text-ink">{b.name}</span>
                              <BatchStatusBadge status={b.status} />
                            </div>
                            <div className="text-xs text-ink-3">{b.code} · {row ? `${row.activeStudents} active student${row.activeStudents === 1 ? '' : 's'}` : 'closed'}</div>
                          </div>
                          {row && <div className="sm:w-48"><Meter value={row.metrics.learningCompletion.percentage} tone="success" label="Lesson completion" /></div>}
                        </Link>
                      );
                    })}
                  </Card>
                )}
              </Section>

              <div className="space-y-6">
                <Section id="team" title="Team" icon={ShieldCheck}>
                  <Card className="p-4">
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-4">Branch managers</div>
                    {managers.length === 0 ? (
                      <p className="mt-2 text-sm text-ink-3">No manager yet. Use “Add Branch Manager” on the Branches page.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">{managers.map((m) => (
                        <li key={m.id} className="flex items-center gap-2.5"><Avatar name={m.displayName} size={30} /><span className="min-w-0"><span className="block truncate text-sm font-bold text-ink">{m.displayName}</span><span className="block truncate text-xs text-ink-3">{m.email}</span></span></li>
                      ))}</ul>
                    )}
                    <div className="mt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-4">Instructors ({instructors.length})</div>
                    {instructors.length === 0 ? (
                      <p className="mt-2 text-sm text-ink-3">Instructors are added from a batch with “Add Lead Instructor”.</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-1.5">{instructors.map((i) => (
                        <span key={i.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-muted py-0.5 pl-0.5 pr-2.5 text-xs font-semibold text-ink-2"><Avatar name={i.displayName} size={22} />{i.displayName}</span>
                      ))}</div>
                    )}
                    <Link href="/dashboard/people" className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-brand-ink hover:underline"><Users className="h-4 w-4" /> Manage people</Link>
                  </Card>
                </Section>

                <Section id="attention" title={`Needs attention (${report.totals.atRisk})`} icon={AlertTriangle}>
                  <Card className="p-4">
                    {report.totals.atRisk === 0 ? (
                      <p className="text-sm text-ink-3">Every active student at this branch is on track.</p>
                    ) : (
                      <ul className="space-y-2.5">{report.students.filter((s) => s.flags.length).slice(0, 6).map((s) => (
                        <li key={`${s.batchId}-${s.studentId}`} className="flex items-start gap-2.5">
                          <Avatar name={s.name} size={28} />
                          <span className="min-w-0"><span className="block truncate text-sm font-bold text-ink">{s.name}</span><span className="block text-xs font-semibold text-coral-ink">{s.flags[0]}</span></span>
                        </li>
                      ))}</ul>
                    )}
                  </Card>
                </Section>
              </div>
            </div>
          </div>
        )}
      </RequireRole>
    </AppShell>
  );
}

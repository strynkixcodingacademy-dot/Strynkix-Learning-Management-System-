'use client';

/**
 * Strynkix LMS — Super Admin Command Centre: organization-wide summary,
 * admissions, academics, finance, trends and recent activity, for all
 * academies or a chosen academy / branch and period. Every figure is computed
 * on the server from the live records; every metric links to its list.
 */

import React from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { commandApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatDate, formatMoney } from '@/lib/academy/format';
import { CommandNav } from '@/components/command/CommandNav';
import { ActivityList, Metric, useCommandFilters, type Overview } from '@/components/command/Shared';
import { BarList, PairedColumns } from '@/components/command/Charts';
import { ColumnChart } from '@/components/ui/DataViz';
import { Card, PageHeader, Section } from '@/components/ui/Page';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import { Activity, BookOpen, GraduationCap, IndianRupee, LineChart, UserPlus } from 'lucide-react';

function Dashboard() {
  const f = useCommandFilters();
  const { data, error, reload } = useApiData(JSON.stringify(f.params), () => commandApi<Overview>({ action: 'overview', ...f.params }));
  const q = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(f.orgId ? { orgId: f.orgId } : {}), ...(f.branchId ? { branchId: f.branchId } : {}), ...extra })}`;
  const peopleLink = (role: string) => `/dashboard/command/people${q({ role })}`;
  return (
    <div className="space-y-8">
      <PageHeader title="Command Centre" description="Every academy, branch, learner and rupee in one place. Figures are live and computed from the records." />
      <CommandNav />
      {f.controls()}
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Gathering organization-wide figures…" rows={5} /> : (
        <>
          <Section title="Organization" icon={BookOpen}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 xl:grid-cols-7">
              {!f.orgId && <Metric label="Academies" value={f.orgs.length} hint={`${f.orgs.filter((o) => o.status === 'active').length} active · ${f.orgs.filter((o) => o.status !== 'active').length} suspended`} href="/dashboard/command/academies" />}
              <Metric label="Branches" value={data.stats.branches} hint={`${data.stats.activeBranches} active`} href={`/dashboard/command/branches${q({})}`} />
              <Metric label="Students" value={data.stats.students} hint={`${data.stats.activeStudents} active accounts`} href={peopleLink('student')} />
              <Metric label="Instructors" value={data.stats.instructors} href={peopleLink('instructor')} />
              <Metric label="Course designers" value={data.stats.courseDesigners} href={peopleLink('content_designer')} />
              <Metric label="Branch managers" value={data.stats.branchManagers} href={peopleLink('branch_admin')} />
              <Metric label="University admins" value={data.stats.universityAdmins} href={peopleLink('university_admin')} />
              <Metric label="Courses" value={data.stats.courses ?? '—'} hint={data.stats.publishedCourses !== null ? `${data.stats.publishedCourses} published` : undefined} href={f.orgId ? `/dashboard/command/academies/${f.orgId}?tab=courses` : '/dashboard/command/academies'} />
              <Metric label="Batches" value={data.stats.batches} hint={`${data.stats.runningBatches} running`} href={`/dashboard/command/academics${q({})}`} />
              <Metric label="Enrollments" value={data.stats.enrollments} hint={`${data.stats.activeEnrollments} active`} href={`/dashboard/command/academics${q({})}`} />
            </div>
          </Section>

          <Section title="Admissions" icon={UserPlus}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-7">
              <Metric label="Total admissions" value={data.admissions.total} />
              <Metric label="This year" value={data.admissions.thisYear} />
              <Metric label="This month" value={data.admissions.thisMonth} />
              <Metric label="Today" value={data.admissions.today} />
              <Metric label="Active enrollments" value={data.stats.activeEnrollments} />
              <Metric label="Completed" value={data.stats.completedEnrollments} />
              <Metric label="Withdrawn or paused" value={data.stats.withdrawnEnrollments} />
            </div>
            <Card className="grid gap-6 p-5 lg:grid-cols-3">
              <div className="lg:col-span-3"><h3 className="mb-2 text-sm font-semibold text-ink">Admissions by month ({formatDate(data.period.from)} – {formatDate(data.period.to)})</h3>
                {data.charts.admissionsByMonth.length ? <ColumnChart data={data.charts.admissionsByMonth.map((m) => ({ label: `${m.month}: ${m.count}`, short: m.month.slice(5), value: m.count }))} label="Admissions by month" /> : <p className="text-sm text-ink-3">No admissions in this period.</p>}
              </div>
              {!f.orgId && <BarList title="By academy" rows={data.admissions.byAcademy.map((r) => ({ id: r.id, label: r.name, value: r.count, href: `/dashboard/command/academies/${r.id}` }))} />}
              <BarList title="By branch" tone="bg-teal" rows={data.charts.admissionsByBranch.map((r) => ({ id: r.id, label: r.name, value: r.count, href: `/dashboard/command/branches/${r.id}` }))} />
              <BarList title="By course" tone="bg-info" rows={data.admissions.byCourse.map((r) => ({ id: r.id, label: r.name, value: r.count }))} />
            </Card>
          </Section>

          <Section title="Academics" icon={GraduationCap} action={<Link href={`/dashboard/command/academics${q({})}`} className="text-sm font-semibold text-brand-ink">Academic intelligence</Link>}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-8">
              <Metric label="Published courses" value={data.academics.courses.published} hint={`${data.academics.courses.draft} drafts`} />
              <Metric label="Enrolled students" value={data.academics.enrolledStudents} />
              <Metric label="Avg completion" value={data.academics.averageCompletion === null ? '—' : `${data.academics.averageCompletion}%`} />
              <Metric label="Avg attendance" value={data.academics.averageAttendance === null ? '—' : `${data.academics.averageAttendance}%`} hint="In the period" />
              <Metric label="Avg assessment" value={data.academics.averageAssessment === null ? '—' : `${data.academics.averageAssessment}%`} hint="Evaluated in the period" />
              <Metric label="Pending evaluations" value={data.academics.pendingEvaluations} href={`/dashboard/command/academics${q({})}`} />
              <Metric label="Upcoming exams" value={data.academics.upcomingExams.length} />
              <Metric label="Inactive 14+ days" value={data.academics.inactiveStudents} hint="Active learners with no lesson activity" href={`/dashboard/command/academics${q({})}`} />
            </div>
            <Card className="grid gap-6 p-5 lg:grid-cols-3">
              {!f.orgId && <BarList title="Active students by academy" rows={data.charts.studentsByAcademy.map((r) => ({ id: r.id, label: r.name, value: r.count, href: `/dashboard/command/academies/${r.id}` }))} />}
              <BarList title="Course popularity (active learners)" tone="bg-teal" rows={data.charts.coursePopularity.map((r) => ({ id: r.id, label: r.name, value: r.count }))} />
              <BarList title="Course completion" tone="bg-success" format={(n) => `${n}%`} rows={data.charts.completionByCourse.map((r) => ({ id: r.courseId, label: r.title, value: r.completion }))} />
              <div className="lg:col-span-3"><h3 className="mb-2 text-sm font-semibold text-ink">Attendance by month (%)</h3>
                {data.charts.attendanceByMonth.length ? <ColumnChart data={data.charts.attendanceByMonth.map((m) => ({ label: `${m.month}: ${m.percent}%`, short: m.month.slice(5), value: m.percent }))} label="Attendance by month" tone="teal" unit="%" /> : <p className="text-sm text-ink-3">No attendance recorded in this period.</p>}
              </div>
              {data.academics.upcomingExams.length > 0 && (
                <div className="lg:col-span-3"><h3 className="mb-2 text-sm font-semibold text-ink">Upcoming examinations</h3>
                  <ul className="space-y-1 text-sm">{data.academics.upcomingExams.map((e) => <li key={e.id} className="flex justify-between gap-3"><span>{e.title} <span className="text-ink-3">({e.examType ?? 'exam'})</span></span><span className="text-ink-3">{e.opensAt ? `opens ${formatWhen(e.opensAt)}` : e.closesAt ? `closes ${formatWhen(e.closesAt)}` : ''}</span></li>)}</ul>
                </div>
              )}
            </Card>
          </Section>

          <Section title="Finance" icon={IndianRupee} action={<Link href={`/dashboard/command/finance${q({})}`} className="text-sm font-semibold text-brand-ink">Finance intelligence</Link>}>
            <p className="text-sm text-ink-3"><strong>Expected</strong> = agreed fees owed; <strong>collected</strong> = payments actually received, less refunds and reversals; <strong>net position</strong> = collected minus recorded expenses in the period (cash basis, not audited profit).</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-5">
              <Metric label="Fees expected" value={formatMoney(data.finance.expected)} hint="All open fee accounts" />
              <Metric label="Collected to date" value={formatMoney(data.finance.collectedToDate)} />
              <Metric label="Outstanding" value={formatMoney(data.finance.outstanding)} />
              <Metric label="Overdue installments" value={formatMoney(data.finance.overdue)} hint={`${data.finance.overdueAccounts} students`} href={`/dashboard/command/finance${q({})}`} />
              <Metric label="Collected in period" value={formatMoney(data.finance.collectedInPeriod)} />
              <Metric label="Collected this month" value={formatMoney(data.finance.collectedThisMonth)} />
              <Metric label="Discounts (period)" value={formatMoney(data.finance.discounts)} hint={data.finance.pendingDiscounts ? `${data.finance.pendingDiscounts} awaiting approval` : undefined} />
              <Metric label="Refunds (period)" value={formatMoney(data.finance.refunds)} />
              <Metric label="Expenses (period)" value={formatMoney(data.finance.expenses)} />
              <Metric label="Net operating position" value={formatMoney(data.finance.net)} hint="Collected − expenses" />
            </div>
            <Card className="grid gap-6 p-5 lg:grid-cols-2">
              <PairedColumns title="Collections vs expenses" aLabel="Collected" bLabel="Expenses" format={formatMoney} rows={data.charts.collectionsByMonth.map((m) => ({ label: m.month, a: m.collected, b: m.expenses }))} />
              <div><h3 className="mb-2 text-sm font-semibold text-ink">Outstanding fees at month end (₹)</h3>
                {data.charts.outstandingByMonth.length ? <ColumnChart data={data.charts.outstandingByMonth.map((m) => ({ label: `${m.month}: ${formatMoney(m.outstanding)}`, short: m.month.slice(5), value: Math.round(m.outstanding / 100) }))} label="Outstanding by month" tone="info" unit="₹" /> : <p className="text-sm text-ink-3">No fee accounts yet.</p>}
              </div>
              <div><h3 className="mb-2 text-sm font-semibold text-ink">Fee collections by month (₹)</h3>
                {data.charts.collectionsByMonth.length ? <ColumnChart data={data.charts.collectionsByMonth.map((m) => ({ label: `${m.month}: ${formatMoney(m.collected)}`, short: m.month.slice(5), value: Math.round(m.collected / 100) }))} label="Collections by month" tone="success" unit="₹" /> : <p className="text-sm text-ink-3">No collections in this period.</p>}
              </div>
              <BarList title="Expenses by category" tone="bg-coral" format={formatMoney} rows={data.charts.expenseCategories.map((c) => ({ label: c.name, value: c.amount }))} />
            </Card>
          </Section>

          <Section title="Recent activity" icon={Activity} action={<Link href="/dashboard/audit" className="text-sm font-semibold text-brand-ink">Full audit log</Link>}>
            <ActivityList rows={data.recent} />
          </Section>
          <p className="flex items-center gap-1 text-xs text-ink-3"><LineChart className="h-3.5 w-3.5" /> Totals use the same ledger as Finance and Reports.</p>
        </>
      )}
    </div>
  );
}

export default function CommandCentrePage() {
  return <RequireRole allowedRoles={['super_admin']}><AppShell><Dashboard /></AppShell></RequireRole>;
}

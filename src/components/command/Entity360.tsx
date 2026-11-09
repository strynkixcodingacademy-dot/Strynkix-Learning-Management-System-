'use client';

/**
 * Strynkix LMS — Academy 360° and Branch 360° (Super Admin). One component,
 * two kinds; each tab loads its own data from /api/command, paginated where
 * lists can grow. Actions reuse the existing audited academy, branch and
 * account routes.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { ROLE_LABELS } from '@/components/dashboard/AppShell';
import { commandApi, reportsApi } from '@/lib/academy/api';
import { correctAccount, getBranches, getOrganization } from '@/lib/admin/service';
import { useApiData } from '@/lib/hooks/useApiData';
import { usePaged } from '@/lib/hooks/usePaged';
import { downloadCsv } from '@/lib/export/csv';
import { formatDate, formatMoney, moneyPlain, todayLocal } from '@/lib/academy/format';
import type { Branch, Organization, UserRole } from '@/types/domain';
import { BranchEditDialog, OrganizationEditDialog } from '@/components/admin/AcademyDialogs';
import { CommandNav } from './CommandNav';
import { BarList, PairedColumns } from './Charts';
import { ActivityList, Metric, type ActivityRow, type Stats } from './Shared';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ColumnChart } from '@/components/ui/DataViz';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs } from '@/components/ui/Tabs';
import { useConfirm } from '@/components/ui/ConfirmDialog';

type Kind = 'academy' | 'branch';
type AcademyTab = 'overview' | 'branches' | 'people' | 'courses' | 'academics' | 'finance' | 'audit';
type BranchTab = 'overview' | 'students' | 'staff' | 'courses' | 'academics' | 'finance' | 'reports' | 'audit';
interface Head { academy: { id: string; name: string; status: string; website: string | null; timezone: string | null; createdAt: string | null } | null; branch: { id: string; name: string; code: string; status: string; city: string | null; managers: { id: string; name: string }[] } | null }

const th = 'p-2.5 text-left text-xs font-semibold text-ink-3';
const td = 'p-2.5';
const pctOr = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

function Table({ head, children, min = 640 }: { head: string[]; children: React.ReactNode; min?: number }) {
  return <Card className="overflow-x-auto"><table className="w-full text-sm" style={{ minWidth: min }}><thead><tr className="border-b border-line">{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead><tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0">{children}</tbody></table></Card>;
}

function StatsGrid({ s, kind }: { s: Stats; kind: Kind }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
      {kind === 'academy' && <Metric label="Branches" value={s.branches} hint={`${s.activeBranches} active`} />}
      <Metric label="Students" value={s.students} hint={`${s.activeStudents} active`} />
      <Metric label="Instructors" value={s.instructors} />
      <Metric label="Branch managers" value={s.branchManagers} />
      {kind === 'academy' && <Metric label="Course designers" value={s.courseDesigners} />}
      {s.courses !== null && <Metric label="Courses" value={s.courses} hint={`${s.publishedCourses} published`} />}
      <Metric label="Batches" value={s.batches} hint={`${s.runningBatches} running`} />
      <Metric label="Admissions" value={s.admissions} />
      <Metric label="Fees expected" value={formatMoney(s.expected)} />
      <Metric label="Collected" value={formatMoney(s.collected)} />
      <Metric label="Outstanding" value={formatMoney(s.outstanding)} />
      <Metric label="Expenses recorded" value={formatMoney(s.expenses)} />
    </div>
  );
}

function OverviewTab({ kind, id }: { kind: Kind; id: string }) {
  const { data, error, reload } = useApiData(`${kind}|${id}|overview`, () => commandApi<{ stats: Stats; admissions: { byMonth: { month: string; count: number }[]; byCourse: { id: string; name: string; count: number }[] }; academics: { averageCompletion: number | null; averageAttendance: number | null; averageAssessment: number | null; pendingEvaluations: number; inactiveStudents: number; completionByCourse: { courseId: string; title: string; completion: number }[] }; finance: { totals: { collected: number; expenses: number; net: number; overdue: number; refunds: number; discounts: number }; byMonth: { month: string; collected: number; expenses: number }[] }; period: { from: string; to: string } }>({ action: kind, ...(kind === 'academy' ? { orgId: id } : { branchId: id }), tab: 'overview' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading overview…" rows={4} />;
  return (
    <div className="space-y-6">
      <StatsGrid s={data.stats} kind={kind} />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-5">
        <Metric label="Avg completion" value={pctOr(data.academics.averageCompletion)} />
        <Metric label="Avg attendance" value={pctOr(data.academics.averageAttendance)} hint="This year" />
        <Metric label="Avg assessment" value={pctOr(data.academics.averageAssessment)} hint="This year" />
        <Metric label="Pending evaluations" value={data.academics.pendingEvaluations} />
        <Metric label="Inactive 14+ days" value={data.academics.inactiveStudents} />
      </div>
      <Card className="grid gap-6 p-5 lg:grid-cols-2">
        <div><h3 className="mb-2 text-sm font-semibold text-ink">Admissions by month (this year)</h3>{data.admissions.byMonth.length ? <ColumnChart data={data.admissions.byMonth.map((m) => ({ label: `${m.month}: ${m.count}`, short: m.month.slice(5), value: m.count }))} label="Admissions by month" /> : <p className="text-sm text-ink-3">No admissions this year.</p>}</div>
        <PairedColumns title="Collections vs expenses (this year)" aLabel="Collected" bLabel="Expenses" format={formatMoney} rows={data.finance.byMonth.map((m) => ({ label: m.month, a: m.collected, b: m.expenses }))} />
        <BarList title="Course completion" tone="bg-success" format={(n) => `${n}%`} rows={data.academics.completionByCourse.map((c) => ({ id: c.courseId, label: c.title, value: c.completion }))} />
        <BarList title="Admissions by course (this year)" tone="bg-teal" rows={data.admissions.byCourse.map((c) => ({ id: c.id, label: c.name, value: c.count }))} />
      </Card>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-6">
        <Metric label="Collected (year)" value={formatMoney(data.finance.totals.collected)} />
        <Metric label="Expenses (year)" value={formatMoney(data.finance.totals.expenses)} />
        <Metric label="Net position (year)" value={formatMoney(data.finance.totals.net)} hint="Collected − expenses" />
        <Metric label="Overdue now" value={formatMoney(data.finance.totals.overdue)} />
        <Metric label="Refunds (year)" value={formatMoney(data.finance.totals.refunds)} />
        <Metric label="Discounts (year)" value={formatMoney(data.finance.totals.discounts)} />
      </div>
    </div>
  );
}

interface BranchRow { id: string; name: string; code: string; status: string; managers: string[]; stats: Stats }
function BranchesTab({ orgId }: { orgId: string }) {
  const { data, error, reload } = useApiData(`${orgId}|branches`, () => commandApi<{ branches: BranchRow[] }>({ action: 'academy', orgId, tab: 'branches' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading branches…" />;
  if (!data.branches.length) return <EmptyState title="No branches">This academy has no branches yet.</EmptyState>;
  return (
    <Table head={['Branch', 'Status', 'Manager', 'Students', 'Courses', 'Admissions', 'Collected', 'Outstanding']} min={820}>
      {data.branches.map((b) => (
        <tr key={b.id}>
          <td className={td}><Link href={`/dashboard/command/branches/${b.id}`} className="font-semibold text-brand-ink hover:underline">{b.name}</Link><div className="text-xs text-ink-3">{b.code}</div></td>
          <td className={td}><StatusPill size="sm" tone={b.status === 'active' ? 'success' : 'neutral'}>{b.status}</StatusPill></td>
          <td className={td}>{b.managers.join(', ') || <span className="text-ink-3">Not assigned</span>}</td>
          <td className={td}>{b.stats.students}</td><td className={td}>{b.stats.batches} batches</td><td className={td}>{b.stats.admissions}</td>
          <td className={td}>{formatMoney(b.stats.collected)}</td><td className={td}>{formatMoney(b.stats.outstanding)}</td>
        </tr>
      ))}
    </Table>
  );
}

interface PersonRow { id: string; displayName: string; email: string; role: UserRole; status: string; branch: string | null; studentId: string | null; enrollments?: { course: string; batch: string; status: string; attendance: number }[]; fees?: { id: string; balance: number; overdue: number }[] }
function PeopleTab({ kind, id, tab }: { kind: Kind; id: string; tab: 'people' | 'students' | 'staff' }) {
  const [role, setRole] = useState<UserRole | ''>(tab === 'people' ? 'university_admin' : '');
  const key = `${kind}|${id}|${tab}|${role}`;
  const p = usePaged<PersonRow>(key, async (cursor) => {
    const r = await commandApi<{ people: PersonRow[]; cursor: string | null }>({ action: kind, ...(kind === 'academy' ? { orgId: id } : { branchId: id }), tab, ...(role ? { role } : {}), ...(cursor ? { cursor } : {}) });
    return { rows: r.people, cursor: r.cursor };
  });
  return (
    <div className="space-y-3">
      {tab === 'people' && (
        <Field label="Role" htmlFor="p-role"><select id="p-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={`${fieldClasses} max-w-xs`}>
          {(['university_admin', 'branch_admin', 'instructor', 'content_designer', 'content_lead', 'student'] as UserRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select></Field>
      )}
      {p.error ? <ErrorState onRetry={p.reload}>{p.error}</ErrorState> : p.loading && !p.rows.length ? <LoadingState label="Loading people…" /> : !p.rows.length ? <EmptyState title="Nobody here">No accounts match.</EmptyState> : (
        <Table head={tab === 'students' ? ['Student', 'Course and batch', 'Enrollment', 'Attendance', 'Fees'] : ['Name', 'Role', 'Branch', 'Status']} min={tab === 'students' ? 760 : 560}>
          {p.rows.map((u) => (
            <tr key={u.id} className="align-top">
              <td className={td}><Link href={`/dashboard/people/${u.id}`} className="font-semibold text-brand-ink hover:underline">{u.displayName}</Link><div className="text-xs text-ink-3">{u.email}{u.studentId ? ` · ${u.studentId}` : ''}</div></td>
              {tab === 'students' ? (
                <>
                  <td className={td}>{u.enrollments?.length ? u.enrollments.map((e, i) => <div key={i}>{e.course} <span className="text-ink-3">· {e.batch}</span></div>) : <span className="text-ink-3">Not enrolled</span>}</td>
                  <td className={td}>{u.enrollments?.map((e, i) => <div key={i}>{e.status}</div>)}</td>
                  <td className={td}>{u.enrollments?.map((e, i) => <div key={i}>{e.attendance ? `${e.attendance}%` : '—'}</div>)}</td>
                  <td className={td}>{u.fees?.length ? u.fees.map((f) => <Link key={f.id} href={`/dashboard/finance/accounts/${f.id}`} className="block text-brand-ink hover:underline">{f.balance ? `${formatMoney(f.balance)} due` : 'Paid'}{f.overdue ? ` · ${formatMoney(f.overdue)} overdue` : ''}</Link>) : <span className="text-ink-3">—</span>}</td>
                </>
              ) : (
                <><td className={td}>{ROLE_LABELS[u.role]}</td><td className={td}>{u.branch ?? '—'}</td><td className={td}><StatusPill size="sm" tone={u.status === 'active' ? 'success' : 'warning'}>{u.status}</StatusPill></td></>
              )}
            </tr>
          ))}
        </Table>
      )}
      {p.cursor && <Button variant="secondary" loading={p.loading} onClick={() => p.more()}>Load more</Button>}
    </div>
  );
}

interface CourseRow { id: string; title: string; status: string | null; price: number | null; pricingVersion: number | null; open: boolean; enrolled: number; active: number; completed: number; lessons: number; completion: number | null; batches: { id: string; name: string; status: string; instructors: string[]; startDate: string; endDate: string | null; students: number | null }[] }
function CoursesTab({ kind, id }: { kind: Kind; id: string }) {
  const { data, error, reload } = useApiData(`${kind}|${id}|courses`, () => commandApi<{ courses: CourseRow[] }>({ action: kind, ...(kind === 'academy' ? { orgId: id } : { branchId: id }), tab: 'courses' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading courses…" />;
  if (!data.courses.length) return <EmptyState title="No courses">No courses {kind === 'branch' ? 'run at this branch' : 'in this academy'} yet.</EmptyState>;
  return (
    <Table head={['Course', 'Price', 'Enrolled', 'Active', 'Completed', 'Completion', 'Batches (instructors · dates)']} min={900}>
      {data.courses.map((c) => (
        <tr key={c.id} className="align-top">
          <td className={td}><div className="font-semibold text-ink">{c.title}</div><div className="text-xs text-ink-3">{c.status ?? ''}{c.lessons ? ` · ${c.lessons} lessons` : ''}</div></td>
          <td className={td}>{c.price === null ? <span className="text-ink-3">Not priced</span> : <>{formatMoney(c.price)}<div className="text-xs text-ink-3">v{c.pricingVersion}{c.open ? '' : ' · closed'}</div></>}</td>
          <td className={td}>{c.enrolled}</td><td className={td}>{c.active}</td><td className={td}>{c.completed}</td><td className={td}>{pctOr(c.completion)}</td>
          <td className={td}>{c.batches.length ? c.batches.map((b) => <div key={b.id} className="text-xs"><Link href={`/dashboard/batches/${b.id}`} className="font-semibold text-brand-ink">{b.name}</Link> · {b.status.replace('_', ' ')} · {b.instructors.join(', ') || 'no instructor'} · {formatDate(b.startDate)}–{formatDate(b.endDate)}</div>) : <span className="text-ink-3">—</span>}</td>
        </tr>
      ))}
    </Table>
  );
}

export interface Intel {
  coursePerformance: { courseId: string; title: string; enrolled: number; active: number; completed: number; completion: number | null; attendance: number | null; quiz: number | null; assignment: number | null; exam: number | null; pendingEvaluations: number }[];
  attention: { studentId: string; name: string; course: string; reasons: string[]; attendance: number | null; completion: number }[]; attentionTotal: number;
  instructors: { id: string; name: string; batches: { id: string; name: string }[]; students: number; attendanceSessions30d: number; pendingEvaluations: number; evaluated90d: number; averageTurnaroundHours: number | null; completion: number | null }[];
  assessments: { id: string; title: string; course: string; kind: string; examType: string | null; timing: string; participants: number; eligible: number; evaluated: number; pending: number; average: number | null; resultsReleased: boolean; closesAt: string | null }[];
  batches: { id: string; name: string; status: string; students: number; attendance: number | null }[];
  courses: { id: string; title: string }[];
}

export function IntelView({ data }: { data: Intel }) {
  return (
    <div className="space-y-6">
      <h3 className="font-semibold text-ink">Course performance</h3>
      {data.coursePerformance.length ? (
        <Table head={['Course', 'Enrolled', 'Active', 'Completed', 'Completion', 'Attendance', 'Quiz', 'Assignment', 'Exam', 'Pending evaluations']} min={980}>
          {data.coursePerformance.map((c) => <tr key={c.courseId}><td className={`${td} font-semibold text-ink`}>{c.title}</td><td className={td}>{c.enrolled}</td><td className={td}>{c.active}</td><td className={td}>{c.completed}</td><td className={td}>{pctOr(c.completion)}</td><td className={td}>{pctOr(c.attendance)}</td><td className={td}>{pctOr(c.quiz)}</td><td className={td}>{pctOr(c.assignment)}</td><td className={td}>{pctOr(c.exam)}</td><td className={td}>{c.pendingEvaluations}</td></tr>)}
        </Table>
      ) : <EmptyState title="No enrollments">No learners in this selection.</EmptyState>}
      <h3 className="font-semibold text-ink">Students who may need attention ({data.attentionTotal})</h3>
      <p className="text-sm text-ink-3">Indicators to look into, not judgments: no recent lesson activity, low attendance, assessments not passed yet, overdue activities, low completion.{data.attentionTotal > data.attention.length ? ` Showing the first ${data.attention.length} of ${data.attentionTotal}; narrow by branch or course to see the rest.` : ''}</p>
      {data.attention.length ? (
        <Table head={['Student', 'Course', 'Needs attention because', 'Attendance', 'Completion']} min={760}>
          {data.attention.map((a, i) => <tr key={`${a.studentId}-${i}`} className="align-top"><td className={td}><Link href={`/dashboard/people/${a.studentId}`} className="font-semibold text-brand-ink hover:underline">{a.name}</Link></td><td className={td}>{a.course}</td><td className={td}>{a.reasons.join(' · ')}</td><td className={td}>{pctOr(a.attendance)}</td><td className={td}>{a.completion}%</td></tr>)}
        </Table>
      ) : <EmptyState title="Nobody flagged">No learner in this selection shows these indicators.</EmptyState>}
      <h3 className="font-semibold text-ink">Instructor activity</h3>
      {data.instructors.length ? (
        <Table head={['Instructor', 'Batches', 'Students', 'Attendance sessions (30 days)', 'Pending evaluations', 'Evaluated (90 days)', 'Avg turnaround', 'Batch completion']} min={960}>
          {data.instructors.map((i) => <tr key={i.id}><td className={td}><Link href={`/dashboard/people/${i.id}`} className="font-semibold text-brand-ink hover:underline">{i.name}</Link></td><td className={td}>{i.batches.map((b) => b.name).join(', ') || '—'}</td><td className={td}>{i.students}</td><td className={td}>{i.attendanceSessions30d}</td><td className={td}>{i.pendingEvaluations}</td><td className={td}>{i.evaluated90d}</td><td className={td}>{i.averageTurnaroundHours === null ? '—' : `${i.averageTurnaroundHours} h`}</td><td className={td}>{pctOr(i.completion)}</td></tr>)}
        </Table>
      ) : <EmptyState title="No instructors">No instructors in this selection.</EmptyState>}
      <p className="text-xs text-ink-3">Operational facts only. There is no student feedback system yet, so no ratings are shown.</p>
      <h3 className="font-semibold text-ink">Assessment monitoring</h3>
      {data.assessments.length ? (
        <Table head={['Assessment', 'Course', 'Timing', 'Participation', 'Evaluated', 'Pending', 'Average', 'Results']} min={900}>
          {data.assessments.map((a) => <tr key={a.id}><td className={td}><Link href={`/dashboard/assessments/${a.id}`} className="font-semibold text-brand-ink hover:underline">{a.title}</Link><div className="text-xs text-ink-3">{a.kind === 'exam' ? `${a.examType ?? ''} exam` : a.kind.replace('_', ' ')}</div></td><td className={td}>{a.course}</td><td className={td}>{a.timing}{a.closesAt ? <div className="text-xs text-ink-3">closes {formatDate(a.closesAt)}</div> : null}</td><td className={td}>{a.participants} / {a.eligible}</td><td className={td}>{a.evaluated}</td><td className={td}>{a.pending}</td><td className={td}>{pctOr(a.average)}</td><td className={td}>{a.resultsReleased ? 'Published' : <span className="text-warning-ink">Not released</span>}</td></tr>)}
        </Table>
      ) : <EmptyState title="No assessments">No published activities or exams.</EmptyState>}
    </div>
  );
}

function AcademicsTab({ kind, id }: { kind: Kind; id: string }) {
  const { data, error, reload } = useApiData(`${kind}|${id}|academics`, () => commandApi<Intel>({ action: kind, ...(kind === 'academy' ? { orgId: id } : { branchId: id }), tab: 'academics' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Analysing academics…" rows={4} />;
  return (
    <div className="space-y-6">
      {data.batches.length > 0 && <><h3 className="font-semibold text-ink">Batches</h3><Table head={['Batch', 'Status', 'Active students', 'Attendance (90 days)']}>{data.batches.map((b) => <tr key={b.id}><td className={td}><Link href={`/dashboard/batches/${b.id}`} className="font-semibold text-brand-ink hover:underline">{b.name}</Link></td><td className={td}>{b.status.replace('_', ' ')}</td><td className={td}>{b.students}</td><td className={td}>{pctOr(b.attendance)}</td></tr>)}</Table></>}
      <IntelView data={data} />
    </div>
  );
}

interface FinanceTabData { period: { from: string; to: string }; totals: { expected: number; collectedToDate: number; outstanding: number; overdue: number; collected: number; refunds: number; discounts: number; expenses: number; net: number }; byBranch: { id: string; name: string; collected: number; outstanding: number; expenses: number; net: number; students: number }[]; byCourse: { id: string; name: string; expected: number; collected: number; outstanding: number; students: number }[]; byCategory: { name: string; amount: number }[]; upcoming: { feeAccountId: string; studentName: string; dueDate: string; amount: number }[] }
interface TxRow { id: string; date: string; type: string; amount: number; studentName: string; receiptNumber: string | null; method: string | null; reason: string | null; feeAccountId: string; recordedBy: string }
function FinanceTab({ kind, id, orgId }: { kind: Kind; id: string; orgId: string }) {
  const [summary, setSummary] = useState<FinanceTabData | null>(null);
  const p = usePaged<TxRow>(`${kind}|${id}|finance`, async (cursor) => {
    const r = await commandApi<FinanceTabData & { transactions: TxRow[]; cursor: string | null }>({ action: kind, ...(kind === 'academy' ? { orgId: id } : { branchId: id }), tab: 'finance', ...(cursor ? { cursor } : {}) });
    if (!cursor) setSummary(r);
    return { rows: r.transactions, cursor: r.cursor };
  });
  if (p.error) return <ErrorState onRetry={p.reload}>{p.error}</ErrorState>;
  if (!summary) return <LoadingState label="Loading finance…" rows={4} />;
  const t = summary.totals;
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-3">This year ({formatDate(summary.period.from)} – {formatDate(summary.period.to)}). Expected and outstanding are as of today; collected is cash received less refunds.</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-5">
        <Metric label="Fees expected" value={formatMoney(t.expected)} /><Metric label="Collected to date" value={formatMoney(t.collectedToDate)} /><Metric label="Outstanding" value={formatMoney(t.outstanding)} /><Metric label="Overdue" value={formatMoney(t.overdue)} />
        <Metric label="Collected (year)" value={formatMoney(t.collected)} /><Metric label="Discounts (year)" value={formatMoney(t.discounts)} /><Metric label="Refunds (year)" value={formatMoney(t.refunds)} /><Metric label="Expenses (year)" value={formatMoney(t.expenses)} /><Metric label="Net position (year)" value={formatMoney(t.net)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/dashboard/finance`} className={buttonClasses('secondary', 'sm')}>Student fee accounts in Finance</Link>
        <Link href={`/dashboard/command/finance?orgId=${orgId}${kind === 'branch' ? `&branchId=${id}` : ''}`} className={buttonClasses('secondary', 'sm')}>Finance intelligence for this {kind}</Link>
      </div>
      {kind === 'academy' && summary.byBranch.length > 0 && <Table head={['Branch', 'Students', 'Collected', 'Outstanding', 'Expenses', 'Net']}>{summary.byBranch.map((b) => <tr key={b.id}><td className={`${td} font-semibold`}>{b.name}</td><td className={td}>{b.students}</td><td className={td}>{formatMoney(b.collected)}</td><td className={td}>{formatMoney(b.outstanding)}</td><td className={td}>{formatMoney(b.expenses)}</td><td className={td}>{formatMoney(b.net)}</td></tr>)}</Table>}
      {summary.byCourse.length > 0 && <Table head={['Course', 'Students', 'Expected', 'Collected', 'Outstanding']}>{summary.byCourse.map((c) => <tr key={c.id}><td className={`${td} font-semibold`}>{c.name}</td><td className={td}>{c.students}</td><td className={td}>{formatMoney(c.expected)}</td><td className={td}>{formatMoney(c.collected)}</td><td className={td}>{formatMoney(c.outstanding)}</td></tr>)}</Table>}
      <BarList title="Expenses by category (year)" tone="bg-coral" format={formatMoney} rows={summary.byCategory.map((c) => ({ label: c.name, value: c.amount }))} />
      <h3 className="font-semibold text-ink">Transactions (newest first)</h3>
      {!p.rows.length ? <EmptyState title="No transactions">No ledger entries yet.</EmptyState> : (
        <Table head={['Date', 'Entry', 'Student', 'Amount', 'Details']} min={720}>
          {p.rows.map((x) => <tr key={x.id}><td className={td}>{formatDate(x.date)}</td><td className={td}>{x.type}{x.receiptNumber ? <div className="text-xs text-ink-3">{x.receiptNumber}</div> : null}</td><td className={td}><Link href={`/dashboard/finance/accounts/${x.feeAccountId}`} className="text-brand-ink hover:underline">{x.studentName}</Link></td><td className={`${td} tabular-nums`}>{formatMoney(x.amount)}</td><td className={`${td} text-xs text-ink-2`}>{[x.method, x.reason, `by ${x.recordedBy}`].filter(Boolean).join(' · ')}</td></tr>)}
        </Table>
      )}
      {p.cursor && <Button variant="secondary" loading={p.loading} onClick={() => p.more()}>Load more</Button>}
    </div>
  );
}

function AuditTab({ kind, id }: { kind: Kind; id: string }) {
  const p = usePaged<ActivityRow>(`${kind}|${id}|audit`, async (cursor) => {
    const r = await commandApi<{ activity: ActivityRow[]; cursor: string | null }>({ action: kind, ...(kind === 'academy' ? { orgId: id } : { branchId: id }), tab: 'audit', ...(cursor ? { cursor } : {}) });
    return { rows: r.activity, cursor: r.cursor };
  });
  if (p.error) return <ErrorState onRetry={p.reload}>{p.error}</ErrorState>;
  if (p.loading && !p.rows.length) return <LoadingState label="Loading history…" />;
  return <div className="space-y-3"><ActivityList rows={p.rows} />{p.cursor && <Button variant="secondary" loading={p.loading} onClick={() => p.more()}>Load more</Button>}</div>;
}

const REPORTS: { dataset: string; label: string }[] = [
  { dataset: 'admissions', label: 'Admissions' }, { dataset: 'students', label: 'Students and enrollments' }, { dataset: 'fee_accounts', label: 'Fee collection and outstanding' },
  { dataset: 'installments', label: 'Installment status' }, { dataset: 'transactions', label: 'Payment history' }, { dataset: 'expenses', label: 'Expenses' },
];
function ReportsTab({ orgId, branchId }: { orgId: string; branchId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-3">Download this branch’s records as CSV (amounts in rupees), or open the full report pages for attendance, performance and the monthly financial summary.</p>
      <div className="flex flex-wrap gap-2">
        <Link href={`/dashboard/reports?orgId=${orgId}&branchId=${branchId}`} className={buttonClasses('primary', 'sm')}>Financial and academic reports</Link>
        <Link href="/dashboard/attendance" className={buttonClasses('secondary', 'sm')}>Attendance reports (per batch)</Link>
      </div>
      {msg && <Notice kind="info">{msg}</Notice>}
      <div className="grid gap-2 sm:grid-cols-2">
        {REPORTS.map((r) => (
          <Card key={r.dataset} className="flex items-center justify-between gap-3 p-3">
            <span className="text-sm font-semibold text-ink">{r.label}</span>
            <Button size="sm" variant="secondary" loading={busy === r.dataset} onClick={async () => {
              setBusy(r.dataset);
              try {
                const res = await reportsApi<{ rows: Record<string, string | number>[] }>({ action: 'export', dataset: r.dataset, orgId, branchId });
                if (!res.rows.length) { setMsg(`No ${r.label.toLowerCase()} records yet.`); return; }
                const money = new Set(['gross', 'discount', 'adjustments', 'due', 'collected', 'balance', 'amount', 'paid', 'remaining']);
                downloadCsv(`${r.dataset}-${branchId}-${todayLocal()}.csv`, res.rows, Object.keys(res.rows[0]).map((k) => ({ header: money.has(k) ? `${k} (INR)` : k, value: (row: Record<string, string | number>) => (money.has(k) && typeof row[k] === 'number' ? moneyPlain(row[k] as number) : row[k]) })), [['Academy', orgId], ['Branch', branchId], ['Generated', todayLocal()]]);
              } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
            }}>CSV</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Branch manager assignment reuses the audited account route (move a Branch Manager to this branch). */
function ManagerAssign({ orgId, branchId, onDone }: { orgId: string; branchId: string; onDone: (msg: string) => void }) {
  const { data } = useApiData(`${orgId}|managers`, () => commandApi<{ people: PersonRow[] }>({ action: 'people', orgId, role: 'branch_admin' }));
  const [userId, setUserId] = useState('');
  const { confirm, dialog } = useConfirm();
  const options = data?.people ?? [];
  return (
    <div className="flex flex-wrap items-end gap-2">
      {dialog}
      <Field label="Assign a Branch Manager" htmlFor="mgr"><select id="mgr" value={userId} onChange={(e) => setUserId(e.target.value)} className={`${fieldClasses} min-w-[220px]`}><option value="">Choose…</option>{options.map((p) => <option key={p.id} value={p.id}>{p.displayName}{p.branch ? ` (now ${p.branch})` : ''}</option>)}</select></Field>
      <Button size="sm" variant="secondary" disabled={!userId} onClick={async () => {
        const person = options.find((p) => p.id === userId);
        if (!(await confirm({ title: `Make ${person?.displayName} manager of this branch?`, body: 'They move to this branch (and stop managing their current one). The change is audited.', confirmLabel: 'Assign' }))) return;
        try { await correctAccount({ action: 'move_branch', userId, branchId }); onDone(`${person?.displayName} now manages this branch.`); } catch (e) { onDone((e as Error).message); }
      }}>Assign</Button>
      <Link href={`/dashboard/branches`} className="pb-2 text-xs text-brand-ink underline">Create a new Branch Manager</Link>
    </div>
  );
}

export function Entity360({ kind, id, initialTab }: { kind: Kind; id: string; initialTab?: string }) {
  const tabs: { id: string; label: string }[] = kind === 'academy'
    ? [{ id: 'overview', label: 'Overview' }, { id: 'branches', label: 'Branches' }, { id: 'people', label: 'People' }, { id: 'courses', label: 'Courses' }, { id: 'academics', label: 'Academics' }, { id: 'finance', label: 'Finance' }, { id: 'audit', label: 'Audit history' }]
    : [{ id: 'overview', label: 'Overview' }, { id: 'students', label: 'Students' }, { id: 'staff', label: 'Staff' }, { id: 'courses', label: 'Courses and batches' }, { id: 'academics', label: 'Attendance and academics' }, { id: 'finance', label: 'Finance' }, { id: 'reports', label: 'Reports' }, { id: 'audit', label: 'Audit history' }];
  const [tab, setTab] = useState<string>(tabs.some((t) => t.id === initialTab) ? initialTab! : 'overview');
  const { data: head, error, reload } = useApiData(`${kind}|${id}|head`, () => commandApi<Head>({ action: kind, ...(kind === 'academy' ? { orgId: id } : { branchId: id }), tab: 'audit' }));
  const [editOrg, setEditOrg] = useState<Organization | null>(null);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!head) return <LoadingState label="Loading…" />;
  const a = head.academy, b = head.branch;
  const name = kind === 'academy' ? a?.name ?? id : b?.name ?? id;
  const status = kind === 'academy' ? a?.status : b?.status;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Centre', href: '/dashboard/command' }, ...(kind === 'academy' ? [{ label: 'Academies', href: '/dashboard/command/academies' }] : [{ label: a?.name ?? 'Academy', href: `/dashboard/command/academies/${a?.id}` }, { label: 'Branches', href: `/dashboard/command/branches?orgId=${a?.id}` }]), { label: name }]}
        eyebrow={kind === 'academy' ? 'Academy 360°' : `Branch 360° · ${a?.name ?? ''}`} title={name}
        description={kind === 'academy' ? [a?.id, a?.website, a?.timezone, a?.createdAt ? `since ${formatDate(a.createdAt)}` : null].filter(Boolean).join(' · ') : [b?.code, b?.city, `Manager: ${b?.managers.map((m) => m.name).join(', ') || 'not assigned'}`].filter(Boolean).join(' · ')}
        actions={<>
          <StatusPill tone={status === 'active' ? 'success' : 'warning'}>{status}</StatusPill>
          <Button variant="secondary" onClick={async () => {
            setMsg(null);
            if (kind === 'academy') { const o = await getOrganization(id); if (o) setEditOrg(o); }
            else { const all = await getBranches(a?.id); const x = all.find((y) => y.id === id); if (x) setEditBranch(x); }
          }}>Edit or change status</Button>
        </>}
      />
      <CommandNav />
      {msg && <Notice kind="info">{msg}</Notice>}
      {kind === 'branch' && a && <ManagerAssign orgId={a.id} branchId={id} onDone={(m) => { setMsg(m); reload(); }} />}
      <Tabs idPrefix={`e360-${kind}`} label={`${kind} sections`} value={tab} onChange={setTab} items={tabs} />
      {tab === 'overview' && <OverviewTab kind={kind} id={id} />}
      {tab === 'branches' && <BranchesTab orgId={id} />}
      {(tab === 'people' || tab === 'students' || tab === 'staff') && <PeopleTab key={tab} kind={kind} id={id} tab={tab} />}
      {tab === 'courses' && <CoursesTab kind={kind} id={id} />}
      {tab === 'academics' && <AcademicsTab kind={kind} id={id} />}
      {tab === 'finance' && <FinanceTab kind={kind} id={id} orgId={a?.id ?? id} />}
      {tab === 'reports' && a && <ReportsTab orgId={a.id} branchId={id} />}
      {tab === 'audit' && <AuditTab kind={kind} id={id} />}
      {editOrg && <OrganizationEditDialog org={editOrg} onClose={() => setEditOrg(null)} onSaved={(m) => { setEditOrg(null); setMsg(m); reload(); }} />}
      {editBranch && <BranchEditDialog branch={editBranch} onClose={() => setEditBranch(null)} onSaved={(m) => { setEditBranch(null); setMsg(m); reload(); }} />}
    </div>
  );
}

export type { AcademyTab, BranchTab };

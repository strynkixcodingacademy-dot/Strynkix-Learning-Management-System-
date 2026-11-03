'use client';

/**
 * Strynkix LMS — My Scores: quiz, assignment and examination results, overall
 * course performance and trend. Only released results show marks; anything
 * still being evaluated is labelled provisional. Read-only.
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { studentApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { ATTEMPT_STATUS_LABELS, EXAM_TYPE_LABELS, KIND_LABELS } from '@/lib/assessments/grading';
import type { AssessmentKind, AttemptStatus, ExamType } from '@/types/academy';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import { ColumnChart, KpiTile } from '@/components/ui/DataViz';
import { Card, PageHeader } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs } from '@/components/ui/Tabs';

interface ScoreRow {
  id: string; assessmentId: string; courseId: string; title: string; kind: AssessmentKind; examType: ExamType | null; attemptNumber: number;
  status: AttemptStatus; late: boolean; submittedAt: string | null; totalMarks: number; passingPercent: number | null; released: boolean;
  resultPublishedAt: string | null; score?: number; percent?: number; passed?: boolean; feedback?: string | null; provisional: number | null;
}
interface ScoresData {
  courses: Record<string, string>;
  assessments: ScoreRow[];
  assignments: { id: string; title: string; courseId: string | null; status: string; attemptCount: number; score: number | null; totalPoints: number | null; feedback: string | null; submittedAt: string | null; gradedAt: string | null }[];
  lessonQuizzes: { lessonId: string; lessonTitle: string; courseId: string; attempts: number; bestPercent: number; passed: boolean; lastAttemptAt: string }[];
}

type Tab = 'quizzes' | 'assignments' | 'demo' | 'practice' | 'final' | 'overall';

function ResultTable({ rows, courses }: { rows: ScoreRow[]; courses: Record<string, string> }) {
  if (!rows.length) return <EmptyState title="No results here yet">Submitted work appears here; marks show once results are released.</EmptyState>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
          <th className="p-3">Activity</th><th className="p-3">Attempt</th><th className="p-3">Submitted</th><th className="p-3">Status</th><th className="p-3 text-right">Marks</th><th className="p-3 text-right">%</th><th className="p-3">Result</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line align-top last:border-0">
              <td className="p-3"><Link href={`/courses/${r.courseId}/activities/${r.assessmentId}`} className="font-semibold text-ink hover:text-brand-ink">{r.title}</Link><div className="text-xs text-ink-3">{courses[r.courseId] ?? ''}</div>{r.released && r.feedback && <div className="mt-1 text-xs text-ink-2">Feedback: {r.feedback}</div>}</td>
              <td className="p-3">{r.attemptNumber}</td>
              <td className="p-3">{formatWhen(r.submittedAt ?? undefined)}{r.late ? <span className="ml-1 text-xs text-danger-ink">late</span> : null}</td>
              <td className="p-3">{ATTEMPT_STATUS_LABELS[r.status]}</td>
              <td className="p-3 text-right tabular-nums">{r.released ? `${r.score} / ${r.totalMarks}` : r.provisional !== null ? <span title="Provisional">{r.provisional}* / {r.totalMarks}</span> : `— / ${r.totalMarks}`}</td>
              <td className="p-3 text-right tabular-nums">{r.released ? r.percent : '—'}</td>
              <td className="p-3">
                {r.released ? <><StatusPill size="sm" tone={r.passed ? 'success' : 'danger'}>{r.passed ? 'Passed' : 'Not passed'}</StatusPill><div className="mt-1 text-[11px] text-ink-3">Final · published {formatWhen(r.resultPublishedAt ?? undefined)}</div></>
                  : <StatusPill size="sm" tone="warning">{r.provisional !== null ? 'Provisional' : 'Awaiting result'}</StatusPill>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.some((r) => !r.released && r.provisional !== null) && <p className="p-3 text-xs text-ink-3">* Provisional: automatic MCQ marks only; written answers are still being evaluated.</p>}
    </Card>
  );
}

function Scores() {
  const { data, error, reload } = useApiData('scores', () => studentApi<ScoresData>({ action: 'scores' }));
  const [tab, setTab] = useState<Tab>('overall');
  const groups = useMemo(() => {
    const a = data?.assessments ?? [];
    return {
      quizzes: a.filter((r) => r.kind === 'quiz'),
      assignments: a.filter((r) => ['short_answer', 'long_answer', 'practical'].includes(r.kind)),
      demo: a.filter((r) => r.examType === 'demo'), practice: a.filter((r) => r.examType === 'practice'), final: a.filter((r) => r.examType === 'final'),
    };
  }, [data]);
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading your scores…" />;
  const released = data.assessments.filter((r) => r.released);
  const avg = released.length ? Math.round(released.reduce((s, r) => s + (r.percent ?? 0), 0) / released.length) : null;
  const trend = [...released].sort((x, y) => (x.submittedAt ?? '').localeCompare(y.submittedAt ?? '')).slice(-12)
    .map((r, i) => ({ label: `${r.title} (${r.percent}%)`, short: String(i + 1), value: r.percent ?? 0 }));
  const byCourse = Object.entries(data.courses).map(([id, title]) => {
    const rows = released.filter((r) => r.courseId === id);
    return { id, title, count: rows.length, avg: rows.length ? Math.round(rows.reduce((s, r) => s + (r.percent ?? 0), 0) / rows.length) : null, passed: rows.filter((r) => r.passed).length };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="My Scores" description="Your results across quizzes, assignments and examinations. Marks appear once your instructors release them." />
      <Tabs<Tab> idPrefix="sc" label="Result type" value={tab} onChange={setTab} items={[
        { id: 'overall', label: 'Overall' }, { id: 'quizzes', label: 'Quizzes', count: groups.quizzes.length }, { id: 'assignments', label: 'Assignments', count: groups.assignments.length + data.assignments.length },
        { id: 'demo', label: 'Demo exams', count: groups.demo.length }, { id: 'practice', label: 'Practice exams', count: groups.practice.length }, { id: 'final', label: 'Final exams', count: groups.final.length },
      ]} />
      {tab === 'overall' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Average score" value={avg ?? '—'} suffix={avg === null ? undefined : '%'} hint="Across released results" />
            <KpiTile label="Results released" value={released.length} tone="teal" />
            <KpiTile label="Passed" value={released.filter((r) => r.passed).length} tone="success" />
            <KpiTile label="Awaiting results" value={data.assessments.length - released.length} tone="warning" />
          </div>
          {trend.length >= 2 && <Card className="p-5"><h2 className="mb-3 text-sm font-bold text-ink">Your last {trend.length} results (%)</h2><ColumnChart data={trend} label="Scores over time" /></Card>}
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Course</th><th className="p-3 text-right">Results</th><th className="p-3 text-right">Average</th><th className="p-3 text-right">Passed</th></tr></thead>
              <tbody>{byCourse.map((c) => <tr key={c.id} className="border-b border-line last:border-0"><td className="p-3 font-semibold text-ink">{c.title}</td><td className="p-3 text-right">{c.count}</td><td className="p-3 text-right">{c.avg === null ? '—' : `${c.avg}%`}</td><td className="p-3 text-right">{c.passed}</td></tr>)}</tbody>
            </table>
          </Card>
          {data.lessonQuizzes.length > 0 && (
            <Card className="overflow-x-auto">
              <h2 className="p-3 text-sm font-bold text-ink">Lesson knowledge checks</h2>
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Lesson</th><th className="p-3 text-right">Attempts</th><th className="p-3 text-right">Best</th><th className="p-3">Status</th></tr></thead>
                <tbody>{data.lessonQuizzes.map((q) => <tr key={q.lessonId} className="border-b border-line last:border-0"><td className="p-3">{q.lessonTitle}</td><td className="p-3 text-right">{q.attempts}</td><td className="p-3 text-right">{q.bestPercent}%</td><td className="p-3">{q.passed ? 'Passed' : 'Not passed yet'}</td></tr>)}</tbody>
              </table>
            </Card>
          )}
        </div>
      )}
      {tab === 'quizzes' && <ResultTable rows={groups.quizzes} courses={data.courses} />}
      {tab === 'assignments' && (
        <div className="space-y-4">
          <ResultTable rows={groups.assignments} courses={data.courses} />
          {data.assignments.length > 0 && (
            <Card className="overflow-x-auto">
              <h2 className="p-3 text-sm font-bold text-ink">Daily assignments</h2>
              <table className="w-full min-w-[620px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="p-3">Assignment</th><th className="p-3">Status</th><th className="p-3 text-right">Score</th><th className="p-3">Feedback</th></tr></thead>
                <tbody>{data.assignments.map((s) => <tr key={s.id} className="border-b border-line last:border-0"><td className="p-3">{s.title}</td><td className="p-3">{s.status.replace('_', ' ')}</td><td className="p-3 text-right">{s.score === null ? '—' : `${s.score}${s.totalPoints ? ` / ${s.totalPoints}` : ''}`}</td><td className="p-3 text-ink-2">{s.feedback ?? ''}</td></tr>)}</tbody>
              </table>
            </Card>
          )}
        </div>
      )}
      {(tab === 'demo' || tab === 'practice' || tab === 'final') && (
        <><p className="text-sm text-ink-3">{EXAM_TYPE_LABELS[tab]} results.</p><ResultTable rows={groups[tab]} courses={data.courses} /></>
      )}
      <p className="text-xs text-ink-3">Scores are set by the server and your instructors; they can’t be edited here. {KIND_LABELS.exam}s with manual result release show marks after release.</p>
    </div>
  );
}

export default function ScoresPage() {
  return <RequireRole allowedRoles={['student']}><AppShell><Scores /></AppShell></RequireRole>;
}

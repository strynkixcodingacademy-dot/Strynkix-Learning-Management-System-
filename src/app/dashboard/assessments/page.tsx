'use client';

/**
 * Strynkix LMS — Assessments.
 * Students: every lesson activity and examination in their courses, with status
 * and released results. Staff: the submissions waiting for evaluation in their
 * scope (their batches, their branch, or the whole academy).
 */

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { getEvaluationQueue, listStudentAssessments, type StudentAssessmentSummary } from '@/lib/assessments/service';
import { EXAM_TYPE_LABELS, KIND_LABELS } from '@/lib/assessments/grading';
import type { AssessmentAttempt } from '@/types/academy';
import { buttonClasses } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { AttemptStatusPill, formatWhen } from '@/components/assessments/AttemptStatusPill';

type StudentTab = 'activities' | 'exams';

function StudentAssessments({ initial }: { initial: StudentTab }) {
  const [items, setItems] = useState<StudentAssessmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<StudentTab>(initial);
  useEffect(() => {
    let live = true;
    listStudentAssessments().then((r) => live && setItems(r.assessments)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, []);
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!items) return <LoadingState label="Loading your activities…" />;
  const shown = items.filter((a) => (tab === 'exams' ? a.kind === 'exam' : a.kind !== 'exam'))
    .sort((x, y) => (x.closesAt ?? '9').localeCompare(y.closesAt ?? '9'));
  const pending = (a: StudentAssessmentSummary) => a.canStart && (a.status === 'not_started' || a.status === 'returned');
  return (
    <div className="space-y-6">
      <PageHeader title={tab === 'exams' ? 'Quizzes & Exams' : 'Assignments'} description="Everything your instructors have set for your courses. Open one to start, continue or see your results." />
      <Tabs<StudentTab> idPrefix="sa" label="Show" value={tab} onChange={setTab}
        items={[{ id: 'activities', label: 'Lesson activities', count: items.filter((a) => a.kind !== 'exam' && pending(a)).length }, { id: 'exams', label: 'Examinations', count: items.filter((a) => a.kind === 'exam' && pending(a)).length }]} />
      {shown.length === 0 ? <EmptyState title="Nothing here yet">Your instructors haven’t published any {tab === 'exams' ? 'examinations' : 'activities'} for your courses.</EmptyState> : (
        <ul className="space-y-2">
          {shown.map((a) => (
            <li key={a.id}>
              <Link href={`/courses/${a.courseId}/activities/${a.id}`} className="block">
                <Card interactive className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-ink">{a.title}</div>
                    <div className="text-xs text-ink-3">
                      {a.kind === 'exam' && a.examType ? EXAM_TYPE_LABELS[a.examType] : KIND_LABELS[a.kind]} · {a.totalMarks} marks
                      {a.closesAt ? ` · ${a.kind === 'exam' ? 'closes' : 'due'} ${formatWhen(a.closesAt)}` : ''}{a.timeLimitMinutes ? ` · ${a.timeLimitMinutes} min` : ''}
                    </div>
                  </div>
                  <AttemptStatusPill status={a.status} late={a.late} size="sm" />
                  {a.score !== undefined && <span className="text-sm font-bold text-ink">{a.score}/{a.totalMarks}</span>}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EvaluationQueue() {
  const [items, setItems] = useState<AssessmentAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getEvaluationQueue().then((r) => live && setItems(r.attempts)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, []);
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!items) return <LoadingState label="Loading submissions…" />;
  return (
    <div className="space-y-6">
      <PageHeader title="Evaluate submissions" description="Written answers, practical work and mixed exams waiting for marks, oldest first. Open a course’s Activities & exams to create new ones." />
      {items.length === 0 ? <EmptyState title="All caught up">No submissions are waiting for evaluation.</EmptyState> : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-ink">{t.studentName}</div>
                  <div className="text-xs text-ink-3">{t.title} · attempt {t.attemptNumber} · submitted {formatWhen(t.submittedAt)}</div>
                </div>
                <AttemptStatusPill status={t.status} late={t.late} resubmission={t.resubmission} size="sm" />
                <Link href={`/dashboard/assessments/${t.assessmentId}?attempt=${t.id}`} className={buttonClasses('primary', 'sm')}>Evaluate</Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssessmentsPageContent({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tenant } = useAuth();
  const sp = React.use(searchParams);
  return (
    <RequireAuth>
      <AppShell>
        {!tenant ? <LoadingState label="Loading…" /> : tenant.role === 'student'
          ? <StudentAssessments initial={sp.tab === 'exams' ? 'exams' : 'activities'} />
          : ['super_admin', 'university_admin', 'branch_admin', 'instructor'].includes(tenant.role) ? <EvaluationQueue />
            : <EmptyState title="Not available">Assessments are evaluated by instructors and branch managers.</EmptyState>}
      </AppShell>
    </RequireAuth>
  );
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function AssessmentsPage(props: Parameters<typeof AssessmentsPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <AssessmentsPageContent {...props} />
    </Suspense>
  );
}

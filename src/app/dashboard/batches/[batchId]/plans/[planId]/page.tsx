'use client';

/**
 * Strynkix Live Books — Daily Plan editor & review (instructor / admin)
 * Plan the day (objectives, existing published lessons, learning deadline), attach
 * the daily assignment, publish, then review completion and grade submissions.
 */

import React, { Suspense, use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { getBatchById, getBatchEnrollments, getBatchProgress } from '@/lib/batches/service';
import { grantsContentAccess, isBatchOpenForEnrollment } from '@/lib/batches/scope';
import { getLessonsForCourse, getModulesForCourse } from '@/lib/courses/service';
import { getSortedCurriculumLessons, FlattenedCurriculumLesson } from '@/lib/livebook/curriculum';
import {
  canTeachBatch,
  getAssignment,
  getPlan,
  gradeSubmission,
  listenToAssignmentSubmissions,
  requestCorrection,
  saveDailyAssignment,
  savePlan,
  setPlanStatus,
} from '@/lib/learning/service';
import {
  canReviewerGrade,
  canReviewerRequestCorrection,
  getDeadlineState,
  isLateSubmission,
} from '@/lib/learning/submission-state';
import { DeadlineBadge, formatDateTime, formatPlanDate } from '@/components/learning/LearningBits';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/Page';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { Assignment, AssignmentSubmissionType, Batch, DailyPlan, Enrollment, Progress, Submission } from '@/types/domain';
import { AlertCircle, Archive, CalendarCheck, CheckCircle2, FileEdit, Filter, Loader2, Save, Send, Users } from 'lucide-react';

interface PlanPageProps {
  params: Promise<{ batchId: string; planId: string }>;
}

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-60';

function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return value ? new Date(value).toISOString() : '';
}

function Banner({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const style = tone === 'error' ? 'bg-danger-soft border-danger-line text-danger-ink' : 'bg-success-soft border-success-line text-success-ink';
  return (
    <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${style}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'error' ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
      <span>{children}</span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Submission review row
// -----------------------------------------------------------------------------
function SubmissionReview({ submission, assignment, uid }: { submission: Submission; assignment: Assignment; uid: string }) {
  const [score, setScore] = useState(typeof submission.score === 'number' ? String(submission.score) : '');
  const [feedback, setFeedback] = useState(submission.feedback ?? '');
  const [busy, setBusy] = useState<'grade' | 'correct' | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const run = async (kind: 'grade' | 'correct') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'grade') {
        if (score.trim() === '') throw new Error('Enter marks before grading.');
        await gradeSubmission(submission, assignment, { score: Number(score), feedback }, uid);
        setMessage({ tone: 'success', text: 'Graded. The student sees this immediately.' });
      } else {
        await requestCorrection(submission, { feedback }, uid);
        setMessage({ tone: 'success', text: 'Correction requested.' });
      }
    } catch (err) {
      setMessage({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 p-4 rounded-xl bg-surface border border-line space-y-3">
      {submission.textAnswer && (
        <div>
          <div className="text-[11px] font-mono uppercase text-ink-3 mb-1">Written answer</div>
          <p className="text-xs text-ink whitespace-pre-line">{submission.textAnswer}</p>
        </div>
      )}
      {submission.codeContent && (
        <div>
          <div className="text-[11px] font-mono uppercase text-ink-3 mb-1">Code</div>
          <pre className="text-[11px] text-ink bg-surface border border-line rounded-lg p-3 overflow-x-auto"><code>{submission.codeContent}</code></pre>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-3">
        <div className="space-y-1">
          <label htmlFor={`score-${submission.id}`} className="text-[11px] font-semibold text-ink-2">Marks (0–{assignment.totalPoints})</label>
          <input id={`score-${submission.id}`} type="number" min={0} max={assignment.totalPoints} step="0.5" value={score}
            onChange={(e) => setScore(e.target.value)} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`feedback-${submission.id}`} className="text-[11px] font-semibold text-ink-2">Feedback</label>
          <textarea id={`feedback-${submission.id}`} rows={2} value={feedback} maxLength={5000}
            onChange={(e) => setFeedback(e.target.value)} className={inputClass} />
        </div>
      </div>
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => run('grade')} disabled={busy !== null || !canReviewerGrade(submission.status)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold">
          {busy === 'grade' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {submission.status === 'graded' ? 'Update grade' : 'Grade'}
        </button>
        <button type="button" onClick={() => run('correct')} disabled={busy !== null || !canReviewerRequestCorrection(submission.status)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken disabled:opacity-50 text-warning-ink text-xs font-semibold">
          {busy === 'correct' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Request correction
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------
function PlanView({ batchId, planId }: { batchId: string; planId: string }) {
  const { user, tenant } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [lessons, setLessons] = useState<FlattenedCurriculumLesson[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [progress, setProgress] = useState<Progress[] | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [triageFilter, setTriageFilter] = useState<'all' | 'needs_review' | 'awaiting_submission' | 'graded'>('all');

  // Plan form
  const [title, setTitle] = useState('');
  const [objectives, setObjectives] = useState('');
  const [lessonIds, setLessonIds] = useState<string[]>([]);
  const [learningDue, setLearningDue] = useState('');
  const [planMsg, setPlanMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  // Assignment form
  const [aTitle, setATitle] = useState('');
  const [aDescription, setADescription] = useState('');
  const [aType, setAType] = useState<AssignmentSubmissionType>('text_and_code');
  const [aPoints, setAPoints] = useState('10');
  const [aDeadline, setADeadline] = useState('');
  const [assignMsg, setAssignMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!tenant || !user) return;
      setIsLoading(true);
      setError(null);
      try {
        const [loadedBatch, loadedPlan] = await Promise.all([getBatchById(batchId), getPlan(planId)]);
        if (!loadedBatch || !loadedPlan || loadedPlan.batchId !== loadedBatch.id) throw new Error('not found');
        const [modules, courseLessons, loadedAssignment, loadedEnrollments] = await Promise.all([
          getModulesForCourse(loadedBatch.courseId, loadedBatch.orgId),
          getLessonsForCourse(loadedBatch.courseId, loadedBatch.orgId),
          loadedPlan.assignmentId ? getAssignment(loadedPlan.assignmentId) : Promise.resolve(null),
          getBatchEnrollments(loadedBatch),
        ]);
        let loadedProgress: Progress[] | null = null;
        try {
          loadedProgress = await getBatchProgress(loadedBatch);
        } catch (progressErr) {
          console.error('Failed to load progress', progressErr);
        }
        if (!isMounted) return;
        setBatch(loadedBatch);
        setPlan(loadedPlan);
        setAssignment(loadedAssignment);
        setLessons(getSortedCurriculumLessons(modules, courseLessons.filter((l) => l.status === 'published')));
        setEnrollments(loadedEnrollments.filter((e) => grantsContentAccess(e.status)));
        setProgress(loadedProgress);
        setTitle(loadedPlan.title);
        setObjectives(loadedPlan.objectives.join('\n'));
        setLessonIds(loadedPlan.lessonIds);
        setLearningDue(toLocalInput(loadedPlan.learningDueAt));
        if (loadedAssignment) {
          setATitle(loadedAssignment.title);
          setADescription(loadedAssignment.description);
          setAType(loadedAssignment.submissionType ?? 'text');
          setAPoints(String(loadedAssignment.totalPoints));
          setADeadline(toLocalInput(loadedAssignment.deadline));
        } else {
          setATitle(`${loadedPlan.title} — assignment`);
          setADeadline(toLocalInput(loadedPlan.learningDueAt));
        }
      } catch (err) {
        console.error('Failed to load plan', err);
        if (isMounted) setError('This plan was not found or you are not assigned to its batch.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [batchId, planId, tenant, user]);

  // Live submissions for review.
  useEffect(() => {
    if (!assignment) return;
    return listenToAssignmentSubmissions(
      assignment,
      (subs) => {
        setSubmissions(subs);
        setReviewError(null);
      },
      (err) => {
        console.error('Submission listener failed', err);
        setReviewError('Submissions could not be loaded.');
      }
    );
  }, [assignment]);

  const roster = useMemo(() => {
    const byStudent = new Map(submissions.map((s) => [s.studentId, s]));
    return enrollments.map((e) => {
      const completed = progress
        ? plan?.lessonIds.filter((id) => progress.some((p) => p.studentId === e.studentId && p.lessonId === id && p.status === 'completed')).length ?? 0
        : null;
      return { enrollment: e, submission: byStudent.get(e.studentId) ?? null, completed };
    });
  }, [enrollments, submissions, progress, plan]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3" role="status">
        <Loader2 className="w-7 h-7 text-brand-ink animate-spin" />
        <span className="text-xs text-ink-3 font-mono">Loading plan...</span>
      </div>
    );
  }

  if (error || !batch || !plan || !user) {
    return (
      <div className="max-w-md mx-auto p-6 rounded-2xl bg-surface border border-line text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-danger-ink mx-auto" />
        <p className="text-sm text-ink-2">{error}</p>
        <Link href={`/dashboard/batches/${batchId}/plans`} className="text-xs text-brand-ink font-semibold">Back to plans</Link>
      </div>
    );
  }

  const canEdit = canTeachBatch(tenant, user.uid, batch) && isBatchOpenForEnrollment(batch.status) && plan.status !== 'archived';
  const now = new Date();

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPlan(true);
    setPlanMsg(null);
    try {
      const saved = await savePlan(batch, {
        date: plan.date,
        title,
        objectives: objectives.split('\n'),
        lessonIds,
        learningDueAt: fromLocalInput(learningDue),
      }, tenant, user.uid, plan);
      setPlan(saved);
      setPlanMsg({ tone: 'success', text: 'Plan saved.' });
    } catch (err) {
      setPlanMsg({ tone: 'error', text: (err as Error).message });
    } finally {
      setSavingPlan(false);
    }
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAssignment(true);
    setAssignMsg(null);
    try {
      const saved = await saveDailyAssignment(plan, {
        title: aTitle,
        description: aDescription,
        submissionType: aType,
        totalPoints: Number(aPoints),
        deadline: fromLocalInput(aDeadline),
      }, user.uid, assignment);
      setAssignment(saved);
      setPlan({ ...plan, assignmentId: saved.id });
      setAssignMsg({ tone: 'success', text: 'Assignment saved.' });
    } catch (err) {
      setAssignMsg({ tone: 'error', text: (err as Error).message });
    } finally {
      setSavingAssignment(false);
    }
  };

  const changeStatus = async (status: DailyPlan['status']) => {
    if (status === 'archived') {
      const ok = await confirm({
        title: 'Archive this daily plan?',
        body: 'Students will no longer see this daily plan or its scheduled targets.',
        confirmLabel: 'Archive Plan',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setStatusBusy(true);
    setStatusMsg(null);
    try {
      await setPlanStatus(plan, status, assignment);
      setPlan({ ...plan, status, publishedAt: plan.publishedAt ?? (status === 'published' ? new Date().toISOString() : undefined) });
      if (assignment) setAssignment({ ...assignment, status });
      setStatusMsg({ tone: 'success', text: status === 'published' ? 'Published. Enrolled students can now see this plan.' : 'Plan archived.' });
    } catch (err) {
      setStatusMsg({ tone: 'error', text: (err as Error).message || 'Status change failed.' });
    } finally {
      setStatusBusy(false);
    }
  };

  const toggleLesson = (id: string) =>
    setLessonIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 10 ? ids : [...ids, id]));

  // Once published, reviewing work is the main job, so the review hub leads.
  const editSection = (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Plan form */}
        <form onSubmit={handleSavePlan} className="p-5 rounded-2xl bg-surface border border-line space-y-4">
          <h3 className="text-sm font-bold text-ink">Learning plan</h3>
          <div className="space-y-1">
            <label htmlFor="planTitle" className="text-xs font-semibold text-ink-2">Title</label>
            <input id="planTitle" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={160} disabled={!canEdit} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label htmlFor="objectives" className="text-xs font-semibold text-ink-2">Objectives / targets (one per line, up to 10)</label>
            <textarea id="objectives" rows={3} value={objectives} onChange={(e) => setObjectives(e.target.value)} disabled={!canEdit} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label htmlFor="learningDue" className="text-xs font-semibold text-ink-2">Lessons due by</label>
            <input id="learningDue" type="datetime-local" value={learningDue} onChange={(e) => setLearningDue(e.target.value)} required disabled={!canEdit} className={inputClass} />
          </div>
          <fieldset className="min-w-0 space-y-1">
            <legend className="text-xs font-semibold text-ink-2">Lessons ({lessonIds.length}/10 selected)</legend>
            {lessons.length === 0 ? (
              <p className="text-xs text-ink-3">This course has no published lessons yet.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                {lessons.map((l) => (
                  <label key={l.id} className="flex min-w-0 items-center gap-3 px-3 py-2 text-xs text-ink-2 cursor-pointer hover:bg-surface-muted">
                    <input type="checkbox" checked={lessonIds.includes(l.id)} onChange={() => toggleLesson(l.id)}
                      disabled={!canEdit || (!lessonIds.includes(l.id) && lessonIds.length >= 10)}
                      className="rounded border-line text-brand-ink focus:ring-brand" />
                    <span className="min-w-0 flex-1 truncate" title={`${l.moduleTitle} · ${l.title}`}><span className="text-ink-3">{l.moduleTitle} ·</span> {l.title}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {planMsg && <Banner tone={planMsg.tone}>{planMsg.text}</Banner>}
          {canEdit && (
            <button type="submit" disabled={savingPlan} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold">
              {savingPlan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save plan
            </button>
          )}
        </form>

        {/* Assignment form */}
        <form onSubmit={handleSaveAssignment} className="p-5 rounded-2xl bg-surface border border-line space-y-4">
          <h3 className="text-sm font-bold text-ink">Daily assignment {!assignment && <span className="text-ink-3 font-normal">(optional)</span>}</h3>
          <div className="space-y-1">
            <label htmlFor="aTitle" className="text-xs font-semibold text-ink-2">Title</label>
            <input id="aTitle" value={aTitle} onChange={(e) => setATitle(e.target.value)} required minLength={2} maxLength={160} disabled={!canEdit} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label htmlFor="aDescription" className="text-xs font-semibold text-ink-2">Instructions</label>
            <textarea id="aDescription" rows={5} value={aDescription} onChange={(e) => setADescription(e.target.value)} required minLength={5} maxLength={20000} disabled={!canEdit} className={inputClass} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="aType" className="text-xs font-semibold text-ink-2">Submission</label>
              <select id="aType" value={aType} onChange={(e) => setAType(e.target.value as AssignmentSubmissionType)} disabled={!canEdit} className={inputClass}>
                <option value="text">Written answer</option>
                <option value="code">Code</option>
                <option value="text_and_code">Answer + code</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="aPoints" className="text-xs font-semibold text-ink-2">Marks</label>
              <input id="aPoints" type="number" min={1} max={1000} value={aPoints} onChange={(e) => setAPoints(e.target.value)} required
                disabled={!canEdit || assignment?.status === 'published'} className={inputClass} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor="aDeadline" className="text-xs font-semibold text-ink-2">Deadline</label>
              <input id="aDeadline" type="datetime-local" value={aDeadline} onChange={(e) => setADeadline(e.target.value)} required disabled={!canEdit} className={inputClass} />
            </div>
          </div>
          {assignment?.status === 'published' && <p className="text-[11px] text-ink-3">Marks are locked after publishing so grades stay comparable. Deadline and instructions can still change.</p>}
          {assignMsg && <Banner tone={assignMsg.tone}>{assignMsg.text}</Banner>}
          {canEdit && (
            <button type="submit" disabled={savingAssignment} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold">
              {savingAssignment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {assignment ? 'Save assignment' : 'Add assignment'}
            </button>
          )}
        </form>
      </div>
    </>
  );

  const reviewSection = (
    <>
      {/* Review */}
      {/* Review & Triage Section */}
      <section className="rounded-2xl bg-surface border border-line overflow-hidden space-y-4">
        <div className="p-4 sm:p-5 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Users className="w-4 h-4 text-brand-ink" /> Completion & Review Hub
            </h3>
            <p className="text-xs text-ink-3 mt-0.5">Triage student lesson completions and assignment submissions</p>
          </div>
          <span className="text-sm text-ink-3">{roster.length} active student{roster.length === 1 ? '' : 's'}</span>
        </div>

        {/* Triage Summary Stat Cards */}
        {roster.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 sm:px-5">
            <div className="p-3.5 rounded-xl border border-line bg-canvas/70">
              <div className="text-xl font-extrabold text-ink">{roster.length}</div>
              <div className="text-xs text-ink-3">Enrolled students</div>
            </div>
            <div className="p-3.5 rounded-xl border border-line bg-canvas/70">
              <div className="text-xl font-extrabold text-success-ink">
                {plan.lessonIds.length > 0 ? roster.filter((r) => r.completed === plan.lessonIds.length).length : '—'}
                {plan.lessonIds.length > 0 && <span className="text-xs font-normal text-ink-3"> / {roster.length}</span>}
              </div>
              <div className="text-xs text-ink-3">Lessons completed</div>
            </div>
            <div className="p-3.5 rounded-xl border border-line bg-canvas/70">
              <div className="text-xl font-extrabold text-teal-ink">
                {assignment ? roster.filter((r) => r.submission !== null).length : '—'}
                {assignment && <span className="text-xs font-normal text-ink-3"> / {roster.length}</span>}
              </div>
              <div className="text-xs text-ink-3">Submitted work</div>
            </div>
            <div className={`p-3.5 rounded-xl border ${roster.filter((r) => r.submission?.status === 'submitted' || r.submission?.status === 'resubmit_requested').length > 0 ? 'border-coral-line bg-coral-soft/50' : 'border-line bg-canvas/70'}`}>
              <div className={`text-xl font-extrabold ${roster.filter((r) => r.submission?.status === 'submitted' || r.submission?.status === 'resubmit_requested').length > 0 ? 'text-coral-ink' : 'text-ink'}`}>
                {assignment ? roster.filter((r) => r.submission?.status === 'submitted' || r.submission?.status === 'resubmit_requested').length : '—'}
              </div>
              <div className="text-xs text-ink-3">Needs review</div>
            </div>
          </div>
        )}

        {/* Triage Filter Bar */}
        {roster.length > 0 && assignment && (
          <div className="flex items-center gap-1.5 px-4 sm:px-5 border-b border-line pb-3 overflow-x-auto">
            <span className="text-xs font-semibold text-ink-3 flex items-center gap-1 mr-2 shrink-0">
              <Filter className="w-3.5 h-3.5" /> Filter:
            </span>
            <button
              type="button"
              onClick={() => setTriageFilter('all')}
              className={`whitespace-nowrap px-3 py-1 rounded-lg text-xs font-semibold transition ${triageFilter === 'all' ? 'bg-brand text-white shadow-card' : 'bg-surface-muted text-ink-2 hover:bg-surface-sunken'}`}
            >
              All ({roster.length})
            </button>
            <button
              type="button"
              onClick={() => setTriageFilter('needs_review')}
              className={`whitespace-nowrap px-3 py-1 rounded-lg text-xs font-semibold transition ${triageFilter === 'needs_review' ? 'bg-brand text-white shadow-card' : 'bg-surface-muted text-ink-2 hover:bg-surface-sunken'}`}
            >
              Needs Review ({roster.filter((r) => r.submission?.status === 'submitted' || r.submission?.status === 'resubmit_requested').length})
            </button>
            <button
              type="button"
              onClick={() => setTriageFilter('awaiting_submission')}
              className={`whitespace-nowrap px-3 py-1 rounded-lg text-xs font-semibold transition ${triageFilter === 'awaiting_submission' ? 'bg-brand text-white shadow-card' : 'bg-surface-muted text-ink-2 hover:bg-surface-sunken'}`}
            >
              Missing / Pending ({roster.filter((r) => !r.submission).length})
            </button>
            <button
              type="button"
              onClick={() => setTriageFilter('graded')}
              className={`whitespace-nowrap px-3 py-1 rounded-lg text-xs font-semibold transition ${triageFilter === 'graded' ? 'bg-brand text-white shadow-card' : 'bg-surface-muted text-ink-2 hover:bg-surface-sunken'}`}
            >
              Graded ({roster.filter((r) => r.submission?.status === 'graded').length})
            </button>
          </div>
        )}

        {progress === null && <div className="m-4"><Banner tone="error">Lesson progress could not be loaded; completion is shown as unavailable.</Banner></div>}
        {reviewError && <div className="m-4"><Banner tone="error">{reviewError}</Banner></div>}
        {plan.status === 'draft' && <p className="px-5 py-2 text-xs text-ink-3">Students cannot see this plan until it is published.</p>}
        {roster.length === 0 ? (
          <p className="p-6 text-xs text-ink-3 text-center">No active students in this batch.</p>
        ) : (
          <ul className="divide-y divide-line">
            {roster
              .filter((r) => {
                if (triageFilter === 'needs_review') return r.submission?.status === 'submitted' || r.submission?.status === 'resubmit_requested';
                if (triageFilter === 'awaiting_submission') return !r.submission;
                if (triageFilter === 'graded') return r.submission?.status === 'graded';
                return true;
              })
              .map(({ enrollment, submission, completed }) => {
                const state = assignment ? getDeadlineState(assignment.deadline, submission, now) : null;
                const late = submission && assignment ? isLateSubmission(submission.submittedAt, assignment.deadline) : false;
                return (
                  <li key={enrollment.id} className="p-4 sm:px-5">
                    <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
                      <div className="min-w-0 lg:w-56">
                        <div className="text-sm font-semibold text-ink truncate">{enrollment.studentDisplayName || enrollment.studentId}</div>
                        <div className="text-[11px] font-mono text-ink-3 truncate">{enrollment.studentEmail}</div>
                      </div>
                      <div className="text-xs text-ink-2 lg:w-40">
                        {plan.lessonIds.length === 0 ? <span className="text-ink-3">No lessons planned</span> :
                          completed === null ? <span className="text-warning-ink">Progress unavailable</span> :
                            <>Lessons: <strong>{completed}/{plan.lessonIds.length}</strong> completed</>}
                      </div>
                      <div className="flex-1 flex flex-wrap items-center gap-2 text-xs">
                        {state ? <DeadlineBadge state={state} /> : <span className="text-ink-3">No assignment</span>}
                        {late && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-coral-soft text-coral-ink border border-coral-line">Late</span>}
                        {submission && <span className="text-[11px] text-ink-3">attempt {submission.attemptCount ?? 1} • {formatDateTime(submission.submittedAt)}</span>}
                        {submission?.status === 'graded' && assignment && <span className="text-[11px] text-brand-ink font-semibold">{submission.score}/{assignment.totalPoints} marks</span>}
                      </div>
                      {submission && assignment && (
                        <button type="button" onClick={() => setExpanded(expanded === submission.id ? null : submission.id)}
                          aria-expanded={expanded === submission.id}
                          className="px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-xs font-semibold text-ink lg:w-28">
                          {expanded === submission.id ? 'Close' : 'Review'}
                        </button>
                      )}
                    </div>
                    {submission && assignment && expanded === submission.id && (
                      // Keyed by attempt (not status) so the reviewer's confirmation survives the live status update.
                      <SubmissionReview key={`${submission.id}:${submission.attemptCount}`} submission={submission} assignment={assignment} uid={user.uid} />
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Batches', href: '/dashboard/batches' },
          { label: batch.name, href: `/dashboard/batches/${batch.id}` },
          { label: 'Daily plans', href: `/dashboard/batches/${batch.id}/plans` },
          { label: formatPlanDate(plan.date) },
        ]}
        eyebrow={formatPlanDate(plan.date, 'long')}
        title={plan.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {plan.status === 'published'
              ? <StatusPill tone="success" icon={CalendarCheck} size="sm">Published — students can see it</StatusPill>
              : plan.status === 'draft'
                ? <StatusPill tone="warning" icon={FileEdit} size="sm">Draft — not visible to students</StatusPill>
                : <StatusPill tone="neutral" icon={Archive} size="sm">Archived</StatusPill>}
            <span>{plan.lessonIds.length} lesson{plan.lessonIds.length === 1 ? '' : 's'}{assignment ? ' · 1 assignment' : ' · no assignment'}</span>
          </span>
        }
        actions={canEdit ? (
          <>
            {plan.status === 'draft' && (
              <Button variant="success" onClick={() => changeStatus('published')} loading={statusBusy}
                disabled={plan.lessonIds.length === 0 && !assignment} icon={<Send className="w-4 h-4" aria-hidden="true" />}>
                Publish to students
              </Button>
            )}
            <Button variant="secondary" onClick={() => changeStatus('archived')} disabled={statusBusy}>Archive</Button>
          </>
        ) : undefined}
      />
      {statusMsg && <Banner tone={statusMsg.tone}>{statusMsg.text}</Banner>}
      {canEdit && plan.status === 'draft' && plan.lessonIds.length === 0 && !assignment && (
        <p className="text-[11px] text-ink-3">Add lessons or an assignment and save before publishing.</p>
      )}

      {plan.status === 'published' ? (
        <>
          {reviewSection}
          {editSection}
        </>
      ) : (
        <>
          {editSection}
          {reviewSection}
        </>
      )}

      {dialog}
    </div>
  );
}

function PlanContent({ params }: PlanPageProps) {
  const { batchId, planId } = use(params);
  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor']}>
      <AppShell>
        <PlanView batchId={batchId} planId={planId} />
      </AppShell>
    </RequireRole>
  );
}

export default function PlanPage({ params }: PlanPageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <PlanContent params={params} />
    </Suspense>
  );
}

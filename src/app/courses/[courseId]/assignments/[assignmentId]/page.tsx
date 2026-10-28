'use client';

/**
 * Strynkix Live Books — Daily Assignment (student view)
 * Instructions, deadline, text/code submission, live status, feedback and marks.
 * Code is stored as text and never executed.
 */

import React, { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { Breadcrumbs, Card } from '@/components/ui/Page';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState, Notice, Skeleton } from '@/components/ui/States';
import { getStudentCourseEnrollment } from '@/lib/batches/service';
import { grantsContentAccess } from '@/lib/batches/scope';
import { getAssignment, listenToOwnSubmission, submitAssignment } from '@/lib/learning/service';
import { canStudentSubmit, getDeadlineState, isLateSubmission } from '@/lib/learning/submission-state';
import { DeadlineBadge, formatDateTime } from '@/components/learning/LearningBits';
import { Assignment, Submission } from '@/types/domain';
import { CheckCircle2, ClipboardList, Loader2, MessageSquare, Send } from 'lucide-react';

interface AssignmentPageProps {
  params: Promise<{ courseId: string; assignmentId: string }>;
}

function AssignmentSkeleton() {
  return (
    <div className="max-w-4xl mx-auto space-y-6" role="status" aria-live="polite">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-48" />
      <Skeleton className="h-64" />
    </div>
  );
}

function AssignmentView({ courseId, assignmentId }: { courseId: string; assignmentId: string }) {
  const { user, tenant } = useAuth();
  const [courseTitle, setCourseTitle] = useState('Course');
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submissionLoaded, setSubmissionLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const [textAnswer, setTextAnswer] = useState('');
  const [codeContent, setCodeContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const isStudent = tenant?.role === 'student';

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!tenant?.orgId || !user?.uid) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        if (tenant.role === 'student') {
          const enrollment = await getStudentCourseEnrollment(tenant.orgId, user.uid, courseId);
          if (!enrollment || !grantsContentAccess(enrollment.status)) {
            if (isMounted) setError('You are not enrolled in this course.');
            return;
          }
        }

        const [loadedAssignment, courseSnap] = await Promise.all([
          getAssignment(assignmentId),
          getDoc(doc(db, 'courses', courseId)).catch(() => null),
        ]);

        if (!isMounted) return;

        if (courseSnap && courseSnap.exists()) {
          setCourseTitle(courseSnap.data().title || 'Course');
        }

        if (!loadedAssignment || loadedAssignment.courseId !== courseId) {
          setError('Assignment not found.');
          return;
        }
        setAssignment(loadedAssignment);
      } catch (err) {
        console.error('Failed to load assignment', err);
        if (isMounted) setError('This assignment is not available to you, or it is not published yet.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [assignmentId, courseId, tenant?.orgId, tenant?.role, user?.uid]);

  // Live submission status: grades and correction requests appear without a refresh.
  useEffect(() => {
    if (!assignment || !isStudent || !user?.uid || !tenant?.orgId) return;
    return listenToOwnSubmission(
      tenant.orgId,
      user.uid,
      assignment.id,
      (s) => {
        setSubmission(s);
        setSubmissionLoaded(true);
        setLiveError(null);
      },
      (err) => {
        console.error('Submission listener failed', err);
        setLiveError('Live updates are unavailable. Reload the page to see the latest status.');
        setSubmissionLoaded(true);
      }
    );
  }, [assignment, isStudent, user?.uid, tenant?.orgId]);

  // Pre-fill the form with the latest submitted content when editing or correcting.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  if (submission && prefilledFor !== `${submission.id}:${submission.attemptCount}`) {
    setPrefilledFor(`${submission.id}:${submission.attemptCount}`);
    setTextAnswer(submission.textAnswer ?? '');
    setCodeContent(submission.codeContent ?? '');
  }

  if (isLoading) {
    return (
      <AppShell>
        <AssignmentSkeleton />
      </AppShell>
    );
  }

  if (error || !assignment) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto py-12">
          <EmptyState
            illustration="lock"
            title="Assignment unavailable"
            action={
              <Link href={`/courses/${courseId}?tab=assignments`} className={buttonClasses('primary')}>
                Back to course assignments
              </Link>
            }
          >
            {error || 'Unable to open assignment.'}
          </EmptyState>
        </div>
      </AppShell>
    );
  }

  const type = assignment.submissionType ?? 'text';
  const state = getDeadlineState(assignment.deadline, submission, now);
  const editable = isStudent && submissionLoaded && canStudentSubmit(submission);
  const late = submission ? isLateSubmission(submission.submittedAt, assignment.deadline) : false;
  const pastDeadline = assignment.deadline ? new Date(assignment.deadline).getTime() < now.getTime() : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.uid) return;
    setFormError(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      await submitAssignment({
        assignment,
        studentId: user.uid,
        textAnswer: type === 'code' ? undefined : textAnswer,
        codeContent: type === 'text' ? undefined : codeContent,
      });
      setNow(new Date());
      setSuccessMsg(submission ? 'Your updated submission was received.' : 'Your submission was received.');
    } catch (err) {
      setFormError((err as Error).message || 'Submission failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6">
        <Breadcrumbs
          items={[
            { label: isStudent ? 'Home' : 'Batches', href: isStudent ? '/dashboard' : '/dashboard/batches' },
            { label: courseTitle, href: `/courses/${courseId}` },
            { label: 'Assignments', href: `/courses/${courseId}?tab=assignments` },
            { label: assignment.title },
          ]}
        />

        {/* Assignment instructions card */}
        <Card as="section" className="p-6 sm:p-7 space-y-5 animate-rise">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-brand-ink flex items-center gap-1.5 mb-1">
                <ClipboardList className="w-4 h-4 text-brand" /> Daily Assignment
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">{assignment.title}</h1>
            </div>
            {isStudent && submissionLoaded && <DeadlineBadge state={state} />}
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-xl bg-canvas p-4 text-xs border border-line">
            <div>
              <dt className="text-ink-3">Deadline</dt>
              <dd className="mt-0.5 font-semibold text-ink">{formatDateTime(assignment.deadline)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Total marks</dt>
              <dd className="mt-0.5 font-semibold text-ink">{assignment.totalPoints} marks</dd>
            </div>
            <div>
              <dt className="text-ink-3">Format</dt>
              <dd className="mt-0.5 font-semibold text-ink">
                {type === 'text' ? 'Written answer' : type === 'code' ? 'Code only' : 'Written answer + code'}
              </dd>
            </div>
          </dl>

          <div className="pt-2 text-[15px] text-ink-2 whitespace-pre-line leading-relaxed border-t border-line">
            {assignment.description}
          </div>
        </Card>

        {!isStudent && (
          <Notice kind="info">
            Preview mode. To review submissions, open the batch&apos;s daily plan in{' '}
            <Link href={`/dashboard/batches/${assignment.batchId}/plans/${assignment.planId}`} className="font-semibold text-brand-ink hover:underline">
              Batches
            </Link>.
          </Notice>
        )}

        {isStudent && (
          <>
            {liveError && <Notice kind="warning">{liveError}</Notice>}

            {/* Submission status feedback card */}
            {submission && (
              <Card as="section" className="p-6 space-y-4 animate-rise" aria-live="polite">
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <h2 className="text-base font-bold text-ink flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-success" /> Your Submission
                  </h2>
                  <span className="text-xs text-ink-3">
                    Attempt {submission.attemptCount ?? 1}
                  </span>
                </div>

                <div className="text-xs text-ink-3 space-y-1">
                  <div>
                    Submitted {submission.submittedAt ? formatDateTime(submission.submittedAt) : '(confirming…)'}
                    {late && (
                      <span className="ml-2 px-2 py-0.5 rounded-full bg-coral-soft text-coral-ink border border-coral-line text-[10px] font-bold uppercase tracking-[0.06em] font-semibold">
                        Late
                      </span>
                    )}
                  </div>
                  {submission.status === 'graded' && typeof submission.score === 'number' && (
                    <div className="text-base text-ink pt-1">
                      Score: <strong className="text-brand-ink font-extrabold text-lg">{submission.score}</strong> / {assignment.totalPoints} marks
                    </div>
                  )}
                  {submission.status === 'submitted' && (
                    <div className="text-ink-2 italic pt-1">Awaiting evaluation by your instructor.</div>
                  )}
                </div>

                {submission.feedback && (
                  <div
                    className={`p-4 rounded-xl text-xs border ${
                      submission.status === 'resubmit_requested'
                        ? 'bg-warning-soft border-warning-line text-warning-ink'
                        : 'bg-brand-soft border-brand-line text-brand-ink'
                    }`}
                  >
                    <div className="font-bold flex items-center gap-1.5 mb-1.5 text-sm">
                      <MessageSquare className="w-4 h-4" />
                      {submission.status === 'resubmit_requested' ? 'Correction requested' : 'Instructor feedback'}
                    </div>
                    <p className="whitespace-pre-line leading-relaxed text-xs">{submission.feedback}</p>
                  </div>
                )}
              </Card>
            )}

            {successMsg && <Notice kind="success">{successMsg}</Notice>}

            {/* Submission form */}
            {editable ? (
              <Card as="section" className="p-6 animate-rise">
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <h2 className="text-lg font-bold text-ink">
                      {submission?.status === 'resubmit_requested'
                        ? 'Resubmit with Corrections'
                        : submission
                        ? 'Update Your Submission'
                        : 'Submit your work'}
                    </h2>
                    <p className="text-xs text-ink-3 mt-0.5">
                      {submission ? 'You can revise your answers until grading is finalized.' : 'Complete the required work below and submit for review.'}
                    </p>
                  </div>

                  {pastDeadline && (
                    <Notice kind="warning">
                      The deadline has passed. You may still submit your work; it will be recorded with a late timestamp.
                    </Notice>
                  )}

                  {formError && <Notice kind="error">{formError}</Notice>}

                  {type !== 'code' && (
                    <div className="space-y-1.5">
                      <label htmlFor="textAnswer" className="text-xs font-semibold text-ink-2">
                        Written answer {type === 'text_and_code' && <span className="text-ink-3">(Explanation / narrative)</span>}
                      </label>
                      <textarea
                        id="textAnswer"
                        value={textAnswer}
                        onChange={(e) => setTextAnswer(e.target.value)}
                        rows={6}
                        maxLength={20000}
                        placeholder="Explain your approach, key decisions, and answers here..."
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line text-sm text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand leading-relaxed"
                      />
                    </div>
                  )}

                  {type !== 'text' && (
                    <div className="space-y-1.5">
                      <label htmlFor="codeContent" className="text-xs font-semibold text-ink-2">
                        Code
                      </label>
                      <textarea
                        id="codeContent"
                        value={codeContent}
                        onChange={(e) => setCodeContent(e.target.value)}
                        rows={12}
                        maxLength={100000}
                        spellCheck={false}
                        wrap="off"
                        placeholder="// Paste your clean, formatted solution code here..."
                        className="w-full px-3.5 py-3 rounded-xl bg-code text-code-ink border border-code-line text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand leading-relaxed"
                      />
                      <p className="text-[11px] text-ink-3">Code is saved securely as text for instructor inspection and feedback.</p>
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-between">
                    <span className="text-xs text-ink-3">
                      {submission ? `Previous attempt: ${submission.attemptCount ?? 1}` : 'First submission'}
                    </span>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className={buttonClasses('primary', 'md')}
                    >
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      <span>{isSubmitting ? 'Submitting…' : submission ? 'Resubmit' : 'Submit assignment'}</span>
                    </button>
                  </div>
                </form>
              </Card>
            ) : submission?.status === 'graded' ? (
              <div className="rounded-xl border border-line bg-surface p-5 text-center text-xs text-ink-3">
                This assignment has been evaluated and marked. Submissions are now finalized.
              </div>
            ) : !submissionLoaded ? (
              <div className="flex items-center gap-2 text-xs text-ink-3 p-4">
                <Loader2 className="w-4 h-4 animate-spin text-brand" /> Loading your submission records…
              </div>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}

function AssignmentContent({ params }: AssignmentPageProps) {
  const { courseId, assignmentId } = use(params);
  return <AssignmentView courseId={courseId} assignmentId={assignmentId} />;
}

export default function AssignmentPage({ params }: AssignmentPageProps) {
  return (
    <Suspense fallback={<AssignmentSkeleton />}>
      <AssignmentContent params={params} />
    </Suspense>
  );
}

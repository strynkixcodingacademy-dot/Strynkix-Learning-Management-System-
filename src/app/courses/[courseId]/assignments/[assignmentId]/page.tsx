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
import { Breadcrumbs, Card, fieldClasses } from '@/components/ui/Page';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState, Notice, Skeleton } from '@/components/ui/States';
import { getStudentCourseEnrollment } from '@/lib/batches/service';
import { grantsContentAccess } from '@/lib/batches/scope';
import { getAssignment, listenToOwnSubmission, submitAssignment } from '@/lib/learning/service';
import { canStudentSubmit, getDeadlineState, isLateSubmission } from '@/lib/learning/submission-state';
import { DeadlineBadge, formatDateTime } from '@/components/learning/LearningBits';
import { Assignment, Submission } from '@/types/domain';
import { Loader2, MessageSquare, Send } from 'lucide-react';

interface AssignmentPageProps {
  params: Promise<{ courseId: string; assignmentId: string }>;
}

function AssignmentSkeleton() {
  return (
    <div className="max-w-3xl space-y-6" role="status" aria-live="polite">
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
          <h1 className="sr-only">Assignment</h1>
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
      <div className="max-w-3xl space-y-7">
        <Breadcrumbs
          items={[
            { label: isStudent ? 'Home' : 'Batches', href: isStudent ? '/dashboard' : '/dashboard/batches' },
            { label: courseTitle, href: `/courses/${courseId}` },
            { label: 'Assignments', href: `/courses/${courseId}?tab=assignments` },
            { label: assignment.title },
          ]}
        />

        {/* Assignment instructions card */}
        <section className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <h1 className="type-page text-ink">{assignment.title}</h1>
            {isStudent && submissionLoaded && <div className="shrink-0 sm:pt-2"><DeadlineBadge state={state} /></div>}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-line py-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-3">Deadline</dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">{formatDateTime(assignment.deadline)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Total marks</dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">{assignment.totalPoints} marks</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Format</dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                {type === 'text' ? 'Written answer' : type === 'code' ? 'Code only' : 'Written answer + code'}
              </dd>
            </div>
          </dl>

          <div className="max-w-[66ch] whitespace-pre-line font-reading text-[1.0625rem] leading-relaxed text-ink">
            {assignment.description}
          </div>
        </section>

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
              <Card as="section" className="p-5 sm:p-6 space-y-4" aria-live="polite">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="type-section text-ink">Your submission</h2>
                  <span className="text-xs text-ink-3">
                    Attempt {submission.attemptCount ?? 1}
                  </span>
                </div>

                <div className="text-sm text-ink-3 space-y-2">
                  <div>
                    Submitted {submission.submittedAt ? formatDateTime(submission.submittedAt) : '(confirming…)'}
                    {late && (
                      <span className="ml-2 rounded-full bg-coral-soft px-2 py-px text-xs font-medium text-coral-ink">
                        Late
                      </span>
                    )}
                  </div>
                  {submission.status === 'graded' && typeof submission.score === 'number' && (
                    <div className="flex items-baseline gap-1.5 pt-1 text-ink-3">
                      <span className="type-figure text-[1.625rem] text-ink">{submission.score}</span> of {assignment.totalPoints} marks
                    </div>
                  )}
                  {submission.status === 'submitted' && (
                    <div className="text-ink-2">Awaiting evaluation by your instructor.</div>
                  )}
                </div>

                {submission.feedback && (
                  <div
                    className={`rounded-lg px-4 py-3 ${
                      submission.status === 'resubmit_requested' ? 'bg-warning-soft' : 'bg-success-soft'
                    }`}
                  >
                    <div className={`mb-1 flex items-center gap-1.5 text-sm font-semibold ${submission.status === 'resubmit_requested' ? 'text-warning-ink' : 'text-success-ink'}`}>
                      <MessageSquare className="w-4 h-4" />
                      {submission.status === 'resubmit_requested' ? 'Correction requested' : 'Instructor feedback'}
                    </div>
                    <p className="whitespace-pre-line font-reading text-base leading-relaxed text-ink">{submission.feedback}</p>
                  </div>
                )}
              </Card>
            )}

            {successMsg && <Notice kind="success">{successMsg}</Notice>}

            {/* Submission form */}
            {editable ? (
              <Card as="section" className="p-5 sm:p-6">
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <h2 className="type-section text-ink">
                      {submission?.status === 'resubmit_requested'
                        ? 'Resubmit with corrections'
                        : submission
                        ? 'Update your submission'
                        : 'Submit your work'}
                    </h2>
                    <p className="text-sm text-ink-3 mt-1">
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
                      <label htmlFor="textAnswer" className="text-sm font-medium text-ink-2">
                        Written answer {type === 'text_and_code' && <span className="text-ink-3">(Explanation / narrative)</span>}
                      </label>
                      <textarea
                        id="textAnswer"
                        value={textAnswer}
                        onChange={(e) => setTextAnswer(e.target.value)}
                        rows={6}
                        maxLength={20000}
                        placeholder="Explain your approach, key decisions, and answers here..."
                        className={`${fieldClasses} leading-relaxed`}
                      />
                    </div>
                  )}

                  {type !== 'text' && (
                    <div className="space-y-1.5">
                      <label htmlFor="codeContent" className="text-sm font-medium text-ink-2">
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
                        className={`${fieldClasses} !bg-code font-mono !text-[0.8125rem] leading-[1.7] text-code-ink`}
                      />
                      <p className="text-xs text-ink-3">Code is saved securely as text for instructor inspection and feedback.</p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
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
              <div className="rounded-lg bg-surface-muted/60 p-4 text-sm text-ink-3">
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

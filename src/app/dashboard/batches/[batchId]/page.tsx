'use client';

/**
 * Strynkix LMS — Batch Roster, Enrollment & Progress
 * Administrators enroll students and change enrollment status. Administrators
 * and assigned instructors see each student's progress from existing progress
 * records. Assignment review/grading is a separate milestone; this page is its
 * intended home (see docs/ARCHITECTURE.md, Stage 6).
 */

import { Breadcrumbs } from '@/components/ui/Page';
import React, { use, useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { BatchStatusBadge, EnrollmentStatusBadge } from '@/components/batches/StatusBadges';
import { getCourseById, getLessonsForCourse } from '@/lib/courses/service';
import {
  changeEnrollmentStatus,
  enrollStudent,
  getBatchById,
  getBatchEnrollments,
  getBatchProgress,
  getBranchStudents,
  reconcileSeatCount,
  updateBatch,
} from '@/lib/batches/service';
import { canManageBatchScope, grantsContentAccess, isBatchOpenForEnrollment } from '@/lib/batches/scope';
import { buildRosterProgress, RosterRow } from '@/lib/batches/roster';
import { QuizResultsTable } from '@/components/livebook/QuizResults';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Avatar } from '@/components/ui/DataViz';
import { buttonClasses } from '@/components/ui/Button';
import { Batch, Course, Enrollment, EnrollmentStatus, Progress, UserProfile } from '@/types/domain';
import { createInstructor, createStudent, getBranchManagers } from '@/lib/admin/service';
import { CreateAccountDialog, CredentialsDialog, type AccountKind, type IssuedCredentials, type NewAccountInput } from '@/components/batches/AccountDialogs';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  GraduationCap,
  Loader2,
  UserPlus,
  Users,
} from 'lucide-react';
import { firestoreErrorMessage } from '@/lib/firebase/errors';

interface BatchDetailPageProps {
  params: Promise<{ batchId: string }>;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function ProgressCell({ row }: { row: RosterRow }) {
  if (row.state === 'unavailable') {
    return <span className="text-[11px] text-warning-ink">Progress unavailable</span>;
  }
  if (row.totalLessons === 0) {
    return <span className="text-[11px] text-ink-3">No published lessons</span>;
  }
  if (row.state === 'no_activity') {
    return <span className="text-[11px] text-ink-3 italic">No activity yet</span>;
  }
  return (
    <div className="space-y-1 min-w-[140px]">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-success-ink font-bold">{row.percentage}%</span>
        <span className="text-ink-3">
          {row.completedCount}/{row.totalLessons} lessons
        </span>
      </div>
      <div className="h-1.5 w-full bg-surface-muted rounded-full overflow-hidden">
        <div className="h-full bg-success rounded-full" style={{ width: `${row.percentage}%` }} />
      </div>
      {row.inProgressCount > 0 && (
        <div className="text-[10px] text-ink-3">{row.inProgressCount} in progress</div>
      )}
    </div>
  );
}

function BatchDetailView({ batchId }: { batchId: string }) {
  const { user, tenant } = useAuth();
  const { confirm, dialog } = useConfirm();

  const [batch, setBatch] = useState<Batch | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress[] | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [publishedLessonIds, setPublishedLessonIds] = useState<string[]>([]);
  const [lessonTitles, setLessonTitles] = useState<Record<string, string>>({});

  const [students, setStudents] = useState<UserProfile[]>([]);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [busyEnrollmentId, setBusyEnrollmentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Assigned Instructors State
  const [assignedInstructors, setAssignedInstructors] = useState<{ id: string; displayName: string; email: string }[]>([]);

  // Account creation: which dialog is open, then the login to share once it's done
  const [creating, setCreating] = useState<AccountKind | null>(null);
  const [issued, setIssued] = useState<{ kind: AccountKind; creds: IssuedCredentials } | null>(null);

  const canManage = Boolean(batch && canManageBatchScope(tenant, batch));

  const loadRoster = useCallback(async (target: Batch) => {
    setRosterError(null);
    setProgressError(null);

    const [enrollmentResult, lessonsResult, progressResult] = await Promise.allSettled([
      getBatchEnrollments(target),
      getLessonsForCourse(target.courseId, target.orgId),
      getBatchProgress(target),
    ]);

    if (enrollmentResult.status === 'fulfilled') {
      setEnrollments(enrollmentResult.value);
    } else {
      console.error('Failed to load enrollments', enrollmentResult.reason);
      setEnrollments([]);
      setRosterError('Unable to load the batch roster.');
    }

    if (lessonsResult.status === 'fulfilled' && progressResult.status === 'fulfilled') {
      setPublishedLessonIds(lessonsResult.value.filter((l) => l.status === 'published').map((l) => l.id));
      setLessonTitles(Object.fromEntries(lessonsResult.value.map((l) => [l.id, l.title])));
      setProgress(progressResult.value);
    } else {
      console.error(
        'Failed to load progress data',
        lessonsResult.status === 'rejected' ? lessonsResult.reason : (progressResult as PromiseRejectedResult).reason
      );
      setPublishedLessonIds([]);
      setProgress(null);
      setProgressError('Learning progress could not be loaded. Enrollment data below is still accurate.');
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadAll() {
      if (!tenant || !user) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setPageError(null);
      try {
        const loaded = await getBatchById(batchId);
        if (!isMounted) return;
        if (!loaded) {
          setPageError('Batch not found.');
          return;
        }
        setBatch(loaded);
        // Managers keep a capped batch's seat counter accurate (legacy batches predate it).
        if (typeof loaded.maxStudents === 'number' && canManageBatchScope(tenant, loaded)) {
          reconcileSeatCount(loaded)
            .then((count) => { if (isMounted) setBatch((b) => (b ? { ...b, activeEnrollmentCount: count } : b)); })
            .catch((err) => console.warn('Could not reconcile seat count', err));
        }
        const [loadedCourse] = await Promise.all([getCourseById(loaded.courseId).catch(() => null), loadRoster(loaded)]);
        if (isMounted) setCourse(loadedCourse);

        if (loaded.instructorUserIds && loaded.instructorUserIds.length > 0) {
          getBranchManagers(loaded.instructorUserIds)
            .then((profiles) => {
              if (isMounted) setAssignedInstructors(profiles);
            })
            .catch((err) => console.warn('Could not load instructor profiles', err));
        }
      } catch (err) {
        console.error('Failed to load batch', err);
        if (isMounted) setPageError('Batch not found or you do not have access to it.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadAll();
    return () => {
      isMounted = false;
    };
  }, [batchId, tenant, user, loadRoster]);

  // Enrollment candidates are only needed by administrators.
  const loadStudents = useCallback(async (targetBatch: Batch) => {
    try {
      const loaded = await getBranchStudents(targetBatch);
      setStudents(loaded);
      setStudentsError(null);
    } catch (err) {
      console.error('Failed to load students', err);
      setStudentsError('Unable to load students for this branch.');
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (batch && canManage) {
      getBranchStudents(batch)
        .then((loaded) => {
          if (isMounted) {
            setStudents(loaded);
            setStudentsError(null);
          }
        })
        .catch((err) => {
          console.error('Failed to load students', err);
          if (isMounted) setStudentsError('Unable to load students for this branch.');
        });
    }
    return () => {
      isMounted = false;
    };
  }, [batch, canManage]);

  const issue = (kind: AccountKind, account: { displayName: string; email: string }, password: string, target: Batch) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    setIssued({ kind, creds: { name: account.displayName, email: account.email, password, batchName: target.name, loginUrl: `${origin}/login` } });
    setCreating(null);
  };

  const createInstructorAccount = async ({ name, email, password }: NewAccountInput) => {
    if (!batch || !user) return;
    const newInst = await createInstructor({ email, password, displayName: name, orgId: batch.orgId, branchId: batch.branchId });

    // Update batch document with new instructor UID
    const currentIds = batch.instructorUserIds || [];
    const updatedInstructorIds = Array.from(new Set([...currentIds, newInst.uid]));
    await updateBatch(batch, { instructorUserIds: updatedInstructorIds }, tenant);

    // Update local state
    setBatch((prev) => (prev ? { ...prev, instructorUserIds: updatedInstructorIds } : null));
    setAssignedInstructors((prev) => [
      ...prev.filter((i) => i.id !== newInst.uid),
      { id: newInst.uid, displayName: newInst.displayName, email: newInst.email },
    ]);
    issue('instructor', newInst, password, batch);
    setSuccessMsg(`Instructor "${newInst.displayName}" created and assigned to ${batch.name}!`);
  };

  const createStudentAccount = async ({ name, email, password }: NewAccountInput) => {
    if (!batch || !user) return;
    const newStudent = await createStudent({ email, password, displayName: name, orgId: batch.orgId, branchId: batch.branchId });

    // Automatically enroll into this batch
    await enrollStudent(batch, newStudent.uid, tenant, user.uid);
    issue('student', newStudent, password, batch);
    setSuccessMsg(`Student "${newStudent.displayName}" created and enrolled successfully!`);

    // Refresh roster & candidates
    await Promise.all([loadRoster(batch), loadStudents(batch)]);
  };

  const rosterRows = useMemo(
    () => buildRosterProgress(enrollments, progress, publishedLessonIds),
    [enrollments, progress, publishedLessonIds]
  );

  const enrolledInThisBatch = new Set(
    enrollments.filter((e) => grantsContentAccess(e.status)).map((e) => e.studentId)
  );
  const candidates = students.filter((s) => !enrolledInThisBatch.has(s.id));
  const activeCount = enrollments.filter((e) => e.status === 'active').length;
  const tracked = rosterRows.filter((r) => r.state === 'tracked' && r.percentage !== null);
  const averageCompletion =
    tracked.length > 0 ? Math.round(tracked.reduce((sum, r) => sum + (r.percentage || 0), 0) / tracked.length) : null;

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batch || !user || !selectedStudentId) return;
    setIsEnrolling(true);
    setActionError(null);
    setSuccessMsg(null);
    try {
      const enrollment = await enrollStudent(batch, selectedStudentId, tenant, user.uid);
      setSuccessMsg(`${enrollment.studentDisplayName || enrollment.studentId} enrolled.`);
      setSelectedStudentId('');
      await loadRoster(batch);
    } catch (err) {
      setActionError(firestoreErrorMessage(err, 'Enrollment failed.'));
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleStatusChange = async (enrollment: Enrollment, status: EnrollmentStatus, verb: string) => {
    if (!batch) return;
    const name = enrollment.studentDisplayName || enrollment.studentId;
    if (status === 'dropped' || status === 'suspended') {
      const ok = await confirm({
        title: `${verb} ${name}?`,
        body: 'They will lose access to course materials, daily plans, and assignments for this cohort.',
        confirmLabel: `${verb} Student`,
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusyEnrollmentId(enrollment.id);
    setActionError(null);
    setSuccessMsg(null);
    try {
      await changeEnrollmentStatus(enrollment, batch, status, tenant);
      setSuccessMsg(`${name}: enrollment updated.`);
      await loadRoster(batch);
    } catch (err) {
      setActionError(firestoreErrorMessage(err, 'Failed to update enrollment.'));
    } finally {
      setBusyEnrollmentId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <Loader2 className="w-7 h-7 text-brand-ink animate-spin" />
        <span className="text-xs text-ink-3">Loading batch...</span>
      </div>
    );
  }

  if (pageError || !batch) {
    return (
      <div className="max-w-md mx-auto p-6 rounded-2xl bg-surface border border-line text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-danger-ink mx-auto" />
        <h2 className="text-lg font-bold text-ink">Batch Unavailable</h2>
        <p className="text-xs text-ink-3">{pageError || 'Batch could not be loaded.'}</p>
        <Link
          href="/dashboard/batches"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Batches
        </Link>
      </div>
    );
  }

  const enrollmentOpen = isBatchOpenForEnrollment(batch.status);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Batches', href: '/dashboard/batches' }, { label: batch.name }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard/batches" className="inline-flex items-center gap-2 text-xs text-ink-3 hover:text-ink">
          <ArrowLeft className="w-4 h-4" />
          <span>All batches</span>
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/dashboard/batches/${batch.id}/plans`} className={buttonClasses('secondary', 'sm')}>
            <CalendarDays className="w-4 h-4" />
            <span>Daily Plans</span>
          </Link>
          <Link href={`/dashboard/batches/${batch.id}/timetable`} className={buttonClasses('primary', 'sm')}>
            <CalendarDays className="w-4 h-4" />
            <span>Weekly Timetable</span>
          </Link>
        </div>
      </div>

      {/* Batch summary */}
      <section className="p-5 sm:p-6 rounded-2xl bg-surface border border-line space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[28px] sm:text-[34px] font-extrabold leading-tight tracking-tight text-ink">{batch.name}</h1>
            <div className="text-xs text-brand-ink mt-1">
              {batch.code} • {course?.title || batch.courseId}
            </div>
          </div>
          <BatchStatusBadge status={batch.status} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-surface border border-line">
            <div className="text-ink-3">Schedule</div>
            <div className="text-ink mt-1">
              {formatDate(batch.startDate)} → {formatDate(batch.endDate)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-surface border border-line">
            <div className="text-ink-3">Active students</div>
            <div className="text-ink mt-1">
              {activeCount}
              {batch.maxStudents ? ` / ${batch.maxStudents}` : ''}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-surface border border-line">
            <div className="text-ink-3">Published lessons</div>
            <div className="text-ink mt-1">{progress === null ? '—' : publishedLessonIds.length}</div>
          </div>
          <div className="p-3 rounded-xl bg-surface border border-line">
            <div className="text-ink-3">Avg. completion (active learners)</div>
            <div className="text-ink mt-1">
              {averageCompletion === null ? '—' : `${averageCompletion}%`}
            </div>
          </div>
        </div>
        {course && course.status !== 'published' && (
          <p className="text-[11px] text-warning-ink">
            This course is {course.status}. Enrolled students cannot open it until it is published.
          </p>
        )}
      </section>

      {/* Lead Instructors Section */}
      <section className="p-5 rounded-2xl bg-surface border border-line space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-brand-ink" />
            <h3 className="text-sm font-bold text-ink">Lead Instructors</h3>
            <span className="text-xs text-ink-3">({assignedInstructors.length})</span>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setCreating('instructor')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-xs font-semibold text-brand-ink border border-line transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Add Instructor</span>
            </button>
          )}
        </div>

        {assignedInstructors.length === 0 ? (
          <p className="text-xs text-ink-3">No instructors have been assigned to this cohort yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {assignedInstructors.map((inst) => (
              <div key={inst.id} className="p-3 rounded-xl bg-surface-muted border border-line flex items-center justify-between gap-2 text-xs">
                <Avatar name={inst.displayName} size={34} />
                <div className="min-w-0 flex-1 pr-2">
                  <div className="font-semibold text-ink truncate">{inst.displayName}</div>
                  <div className="text-[11px] text-ink-3 truncate">{inst.email}</div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-brand/10 text-brand-ink border border-brand/20 shrink-0">
                  Instructor
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {successMsg && (
        <div className="p-4 rounded-xl bg-success-soft border border-success-line flex items-center gap-2.5 text-success-ink text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-success-ink" />
          <span>{successMsg}</span>
        </div>
      )}
      {actionError && (
        <div className="p-4 rounded-xl bg-danger-soft border border-danger-line flex items-center gap-2.5 text-danger-ink text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Enrollment form (administrators only) */}
      {canManage && (
        <section className="p-5 rounded-2xl bg-surface border border-line space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-brand-ink" />
              <span>Enroll a Student</span>
            </h3>
            {enrollmentOpen && (
              <button
                type="button"
                onClick={() => setCreating('student')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-xs font-semibold text-brand-ink border border-line transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>+ Create & Enroll New Student</span>
              </button>
            )}
          </div>
          {!enrollmentOpen ? (
            <p className="text-xs text-ink-3">
              This batch is {batch.status.replace('_', ' ')} and is not accepting enrollments.
            </p>
          ) : studentsError ? (
            <p className="text-xs text-danger-ink">{studentsError}</p>
          ) : (
            <form onSubmit={handleEnroll} className="flex flex-col sm:flex-row gap-3">
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                required
                className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                aria-label="Student to enroll"
              >
                <option value="">
                  {candidates.length === 0 ? 'No eligible students in this branch' : 'Select a student...'}
                </option>
                {candidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName} — {s.email}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isEnrolling || !selectedStudentId}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold"
              >
                {isEnrolling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isEnrolling ? 'Enrolling...' : 'Enroll'}</span>
              </button>
            </form>
          )}
          <p className="text-[11px] text-ink-3">
            Only active students of this batch&apos;s branch are listed. A student can hold one active enrollment per
            course; withdraw it before moving them to another batch.
          </p>
        </section>
      )}

      {/* Quiz results (milestone G23): server-written summaries for this batch's students */}
      {batch && progress && (
        <section aria-labelledby="quiz-results-heading" className="rounded-2xl border border-line bg-surface shadow-card overflow-hidden">
          <div className="border-b border-line p-4 sm:p-5">
            <h3 id="quiz-results-heading" className="text-base font-bold text-ink">Quiz results</h3>
            <p className="text-xs text-ink-3">Every graded quiz attempt by students of this batch. Expand a row for the attempt history.</p>
          </div>
          <QuizResultsTable
            showFilters
            contextLabel="Student"
            emptyText="When students in this batch take a lesson quiz, their scores appear here."
            rows={progress
              .filter((p) => p.batchId === batch.id && p.quiz && p.quiz.attemptCount > 0)
              .map((p) => {
                const e = enrollments.find((x) => x.studentId === p.studentId);
                return { key: p.id, progress: p, lessonTitle: lessonTitles[p.lessonId] ?? 'Lesson', context: e?.studentDisplayName || e?.studentEmail || p.studentId };
              })}
            scopeFor={() => ({ orgId: batch.orgId, batchId: batch.id })}
          />
        </section>
      )}

      {/* Roster */}
      <section className="rounded-2xl bg-surface border border-line overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-line flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <Users className="w-4 h-4 text-brand-ink" />
            <span>Roster & Progress</span>
          </h3>
          <span className="text-xs text-ink-3">{enrollments.length} enrollment(s)</span>
        </div>

        {progressError && (
          <div className="m-4 p-3 rounded-lg bg-warning-soft border border-warning-line flex items-center justify-between gap-2 text-warning-ink text-xs">
            <span>{progressError}</span>
            <button onClick={() => loadRoster(batch)} className="font-semibold shrink-0 hover:text-ink">
              Retry
            </button>
          </div>
        )}

        {rosterError ? (
          <div className="p-6 text-center space-y-2">
            <p className="text-xs text-danger-ink">{rosterError}</p>
            <button onClick={() => loadRoster(batch)} className="text-xs font-semibold text-brand-ink hover:text-brand-ink">
              Retry
            </button>
          </div>
        ) : rosterRows.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Users className="w-8 h-8 text-ink-4 mx-auto" />
            <p className="text-xs text-ink-3">No students are enrolled in this batch yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {rosterRows.map((row) => {
              const e = row.enrollment;
              const busy = busyEnrollmentId === e.id;
              return (
                <li key={e.id} className="p-4 sm:px-5 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
                  <div className="flex min-w-0 items-center gap-3 lg:w-64">
                    <Avatar name={e.studentDisplayName || e.studentEmail || '?'} size={36} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink truncate">
                        {e.studentDisplayName || e.studentId}
                      </div>
                      <div className="text-[11px] text-ink-3 truncate">{e.studentEmail || e.studentId}</div>
                    </div>
                  </div>
                  <div className="lg:w-28">
                    <EnrollmentStatusBadge status={e.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <ProgressCell row={row} />
                  </div>
                  <div className="text-[11px] text-ink-3 lg:w-28">
                    {row.lastAccessedAt ? `Active ${formatDate(row.lastAccessedAt)}` : ''}
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-2 lg:justify-end lg:w-56">
                      {busy && <Loader2 className="w-4 h-4 animate-spin text-brand-ink" />}
                      {!busy && e.status === 'active' && (
                        <>
                          <button
                            onClick={() => handleStatusChange(e, 'completed', 'Complete')}
                            className="px-2.5 py-1 rounded-lg bg-surface-muted hover:bg-surface-sunken text-[11px] font-semibold text-ink"
                          >
                            Mark completed
                          </button>
                          <button
                            onClick={() => handleStatusChange(e, 'suspended', 'Deactivate')}
                            className="px-2.5 py-1 rounded-lg bg-surface-muted hover:bg-surface-sunken text-[11px] font-semibold text-warning-ink"
                          >
                            Deactivate
                          </button>
                          <button
                            onClick={() => handleStatusChange(e, 'dropped', 'Withdraw')}
                            className="px-2.5 py-1 rounded-lg bg-surface-muted hover:bg-surface-sunken text-[11px] font-semibold text-danger-ink"
                          >
                            Withdraw
                          </button>
                        </>
                      )}
                      {!busy && (e.status === 'dropped' || e.status === 'suspended') && enrollmentOpen && (
                        <button
                          onClick={() => handleStatusChange(e, 'active', 'Reactivate')}
                          className="px-2.5 py-1 rounded-lg bg-surface-muted hover:bg-surface-sunken text-[11px] font-semibold text-success-ink"
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {creating && (
        <CreateAccountDialog
          kind={creating}
          batch={batch}
          onCreate={creating === 'instructor' ? createInstructorAccount : createStudentAccount}
          onClose={() => setCreating(null)}
        />
      )}
      {issued && <CredentialsDialog kind={issued.kind} creds={issued.creds} onClose={() => setIssued(null)} />}

      {dialog}
    </div>
  );
}

function BatchDetailContent({ params }: BatchDetailPageProps) {
  const { batchId } = use(params);
  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor']}>
      <AppShell>
        <BatchDetailView batchId={batchId} />
      </AppShell>
    </RequireRole>
  );
}

export default function BatchDetailPage({ params }: BatchDetailPageProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-canvas flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 text-brand-ink animate-spin" />
          <span className="text-xs text-ink-3">Loading batch...</span>
        </div>
      }
    >
      <BatchDetailContent params={params} />
    </Suspense>
  );
}

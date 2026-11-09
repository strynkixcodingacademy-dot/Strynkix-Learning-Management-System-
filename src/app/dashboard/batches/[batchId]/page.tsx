'use client';

/**
 * Strynkix LMS — Batch Roster, Enrollment & Progress
 * Administrators enroll students and change enrollment status. Administrators
 * and assigned instructors see each student's progress from existing progress
 * records. Assignment review/grading is a separate milestone; this page is its
 * intended home (see docs/ARCHITECTURE.md, Stage 6).
 */

import React, { use, useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { ModalFrame } from '@/components/ui/Modal';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Button, buttonClasses } from '@/components/ui/Button';
import { KpiTile } from '@/components/ui/DataViz';
import { ProgressBar } from '@/components/ui/Progress';
import { EmptyState, Notice } from '@/components/ui/States';
import { PageHeader, fieldClasses } from '@/components/ui/Page';
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
import { Batch, Course, Enrollment, EnrollmentStatus, Progress, UserProfile } from '@/types/domain';
import { createInstructor, createStudent, generateTempPassword, getBranchManagers } from '@/lib/admin/service';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  GraduationCap,
  Loader2,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';

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
    return <span className="text-xs text-warning-ink">Progress unavailable</span>;
  }
  if (row.totalLessons === 0) {
    return <span className="text-xs text-ink-3">No published lessons</span>;
  }
  if (row.state === 'no_activity') {
    return <span className="text-xs text-ink-3 italic">No activity yet</span>;
  }
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium tabular-nums text-ink">{row.percentage}%</span>
        <span className="text-ink-3">{row.completedCount} of {row.totalLessons}{row.inProgressCount > 0 ? `, ${row.inProgressCount} in progress` : ''}</span>
      </div>
      <ProgressBar value={row.percentage} tone={row.percentage === 100 ? 'success' : 'brand'} size="sm" label={`${row.enrollment.studentDisplayName || 'Student'} progress`} className="mt-1" />
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

  // Instructor Provisioning State
  const [showCreateInstructorModal, setShowCreateInstructorModal] = useState(false);
  const [instructorName, setInstructorName] = useState('');
  const [instructorEmail, setInstructorEmail] = useState('');
  const [instructorPassword, setInstructorPassword] = useState('');
  const [showInstructorPassword, setShowInstructorPassword] = useState(false);
  const [isSubmittingInstructor, setIsSubmittingInstructor] = useState(false);
  const [instructorFormError, setInstructorFormError] = useState<string | null>(null);

  // Instructor Credentials Modal State
  const [createdInstructorCreds, setCreatedInstructorCreds] = useState<{
    name: string;
    email: string;
    password?: string;
    batchName: string;
    loginUrl: string;
  } | null>(null);
  const [copiedInstructorCreds, setCopiedInstructorCreds] = useState(false);

  // Student Provisioning Modal State
  const [showCreateStudentModal, setShowCreateStudentModal] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [showStudentPassword, setShowStudentPassword] = useState(false);
  const [isSubmittingStudent, setIsSubmittingStudent] = useState(false);
  const [studentFormError, setStudentFormError] = useState<string | null>(null);

  // Student Credentials Modal State
  const [createdStudentCreds, setCreatedStudentCreds] = useState<{
    name: string;
    email: string;
    password?: string;
    batchName: string;
    loginUrl: string;
  } | null>(null);
  const [copiedStudentCreds, setCopiedStudentCreds] = useState(false);

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

  const handleGenerateInstructorPassword = () => {
    setInstructorPassword(generateTempPassword());
  };

  const handleCreateAndAssignInstructor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batch || !user) return;
    setIsSubmittingInstructor(true);
    setInstructorFormError(null);
    try {
      const newInst = await createInstructor({
        email: instructorEmail,
        password: instructorPassword,
        displayName: instructorName,
        orgId: batch.orgId,
        branchId: batch.branchId,
      });

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

      // Open Credentials Modal
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setCreatedInstructorCreds({
        name: newInst.displayName,
        email: newInst.email,
        password: instructorPassword,
        batchName: batch.name,
        loginUrl: `${origin}/login`,
      });

      setShowCreateInstructorModal(false);
      setInstructorName('');
      setInstructorEmail('');
      setInstructorPassword('');
      setSuccessMsg(`Instructor "${newInst.displayName}" created and assigned to ${batch.name}!`);
    } catch (err: unknown) {
      setInstructorFormError((err as Error).message || 'Failed to create instructor.');
    } finally {
      setIsSubmittingInstructor(false);
    }
  };

  const handleCopyInstructorCreds = () => {
    if (!createdInstructorCreds) return;
    const shareText = `🎓 Welcome to Strynkix Coding Academy!

You have been assigned as Instructor for: ${createdInstructorCreds.batchName}
Role: Instructor
Login URL: ${createdInstructorCreds.loginUrl}
Email: ${createdInstructorCreds.email}
Password: ${createdInstructorCreds.password}

Please log in to manage daily plans, post assignments, and review student code!`;
    navigator.clipboard.writeText(shareText);
    setCopiedInstructorCreds(true);
    setTimeout(() => setCopiedInstructorCreds(false), 3000);
  };

  const handleGenerateStudentPassword = () => {
    setStudentPassword(generateTempPassword());
  };

  const handleCreateAndEnrollStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batch || !user) return;
    setIsSubmittingStudent(true);
    setStudentFormError(null);
    try {
      const newStudent = await createStudent({
        email: studentEmail,
        password: studentPassword,
        displayName: studentName,
        orgId: batch.orgId,
        branchId: batch.branchId,
      });

      // Automatically enroll into this batch
      await enrollStudent(batch, newStudent.uid, tenant, user.uid);

      // Open Credentials Modal
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setCreatedStudentCreds({
        name: newStudent.displayName,
        email: newStudent.email,
        password: studentPassword,
        batchName: batch.name,
        loginUrl: `${origin}/login`,
      });

      setShowCreateStudentModal(false);
      setStudentName('');
      setStudentEmail('');
      setStudentPassword('');
      setSuccessMsg(`Student "${newStudent.displayName}" created and enrolled successfully!`);

      // Refresh roster & candidates
      await Promise.all([loadRoster(batch), loadStudents(batch)]);
    } catch (err: unknown) {
      setStudentFormError((err as Error).message || 'Failed to create student.');
    } finally {
      setIsSubmittingStudent(false);
    }
  };

  const handleCopyStudentCreds = () => {
    if (!createdStudentCreds) return;
    const shareText = `🎓 Welcome to Strynkix Coding Academy!

You have been enrolled in: ${createdStudentCreds.batchName}
Role: Student
Login URL: ${createdStudentCreds.loginUrl}
Email: ${createdStudentCreds.email}
Password: ${createdStudentCreds.password}

Please log in to start learning!`;
    navigator.clipboard.writeText(shareText);
    setCopiedStudentCreds(true);
    setTimeout(() => setCopiedStudentCreds(false), 3000);
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
      setActionError((err as Error).message || 'Enrollment failed.');
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
      setActionError((err as Error).message || 'Failed to update enrollment.');
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
        <h2 className="type-section text-ink">Batch Unavailable</h2>
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
    <div className="space-y-9">
      <PageHeader
        breadcrumbs={[{ label: 'Batches', href: '/dashboard/batches' }, { label: batch.name }]}
        title={batch.name}
        eyebrow={<span className="inline-flex flex-wrap items-center gap-2"><span>{batch.code}, {course?.title || batch.courseId}</span><BatchStatusBadge status={batch.status} /></span>}
        actions={<Link href={`/dashboard/batches/${batch.id}/plans`} className={buttonClasses('primary')}><CalendarDays className="h-4 w-4" aria-hidden="true" /> Daily Plans & Assignments</Link>}
      />

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <KpiTile label="Active students" value={activeCount} suffix={batch.maxStudents ? `of ${batch.maxStudents}` : undefined} />
        <KpiTile label="Average completion" value={averageCompletion === null ? '—' : averageCompletion} suffix={averageCompletion === null ? undefined : '%'} hint="Active learners only" />
        <KpiTile label="Published lessons" value={progress === null ? '—' : publishedLessonIds.length} />
        <div className="min-w-0 border-t border-line-strong pt-3">
          <div className="text-sm text-ink-3">Schedule</div>
          <div className="mt-2 text-body font-medium leading-snug text-ink">{formatDate(batch.startDate)} to {formatDate(batch.endDate)}</div>
        </div>
      </div>

      {course && course.status !== 'published' && (
        <Notice kind="warning">This course is {course.status}. Enrolled students cannot open it until it is published.</Notice>
      )}
      {successMsg && <Notice kind="success">{successMsg}</Notice>}
      {actionError && <Notice kind="error">{actionError}</Notice>}

      {/* Roster: the working surface of this page */}
      <section aria-labelledby="roster-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="roster-heading" className="type-section text-ink">Roster and progress</h2>
          <span className="text-sm text-ink-3">{enrollments.length} enrollment{enrollments.length === 1 ? '' : 's'}</span>
        </div>

        {progressError && (
          <Notice kind="warning" action={<button onClick={() => loadRoster(batch)} className="shrink-0 text-sm font-semibold text-warning-ink hover:underline">Retry</button>}>{progressError}</Notice>
        )}

        {rosterError ? (
          <Notice kind="error" action={<button onClick={() => loadRoster(batch)} className="shrink-0 text-sm font-semibold text-danger-ink hover:underline">Retry</button>}>{rosterError}</Notice>
        ) : rosterRows.length === 0 ? (
          <EmptyState compact illustration="inbox" title="No students yet">No students are enrolled in this batch yet.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div aria-hidden="true" className="hidden gap-4 border-b border-line px-4 py-2.5 text-xs font-semibold text-ink-3 lg:grid lg:grid-cols-[minmax(0,1.4fr)_5.5rem_minmax(8.5rem,1fr)_5.5rem_17.5rem]">
              <span>Student</span><span>Status</span><span>Progress</span><span>Last active</span><span className="sr-only">Actions</span>
            </div>
            <ul className="divide-y divide-line">
              {rosterRows.map((row) => {
                const e = row.enrollment;
                const busy = busyEnrollmentId === e.id;
                const rowAction = 'rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150';
                return (
                  <li key={e.id} className="grid items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-muted/40 lg:grid-cols-[minmax(0,1.4fr)_5.5rem_minmax(8.5rem,1fr)_5.5rem_17.5rem]">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={e.studentDisplayName || e.studentEmail || '?'} size={32} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{e.studentDisplayName || e.studentId}</div>
                        <div className="truncate text-xs text-ink-3">{e.studentEmail || e.studentId}</div>
                      </div>
                    </div>
                    <div><EnrollmentStatusBadge status={e.status} /></div>
                    <ProgressCell row={row} />
                    <div className="text-xs text-ink-3">{row.lastAccessedAt ? <><span className="lg:hidden">Last active </span>{formatDate(row.lastAccessedAt)}</> : null}</div>
                    {canManage ? (
                      <div className="-ml-2 flex flex-wrap items-center gap-0.5 lg:ml-0 lg:flex-nowrap lg:justify-end">
                        {busy && <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-label="Updating" />}
                        {!busy && e.status === 'active' && (
                          <>
                            <button onClick={() => handleStatusChange(e, 'completed', 'Complete')} className={`${rowAction} text-ink-2 hover:bg-surface-sunken hover:text-ink`}>Mark completed</button>
                            <button onClick={() => handleStatusChange(e, 'suspended', 'Deactivate')} className={`${rowAction} text-ink-2 hover:bg-warning-soft hover:text-warning-ink`}>Deactivate</button>
                            <button onClick={() => handleStatusChange(e, 'dropped', 'Withdraw')} className={`${rowAction} text-ink-2 hover:bg-danger-soft hover:text-danger-ink`}>Withdraw</button>
                          </>
                        )}
                        {!busy && (e.status === 'dropped' || e.status === 'suspended') && enrollmentOpen && (
                          <button onClick={() => handleStatusChange(e, 'active', 'Reactivate')} className={`${rowAction} text-success-ink hover:bg-success-soft`}>Reactivate</button>
                        )}
                      </div>
                    ) : <span className="hidden lg:block" />}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <div className="grid gap-x-12 gap-y-9 lg:grid-cols-2">
        {/* Lead Instructors */}
        <section aria-labelledby="instructors-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="instructors-heading" className="type-section text-ink">Lead instructors</h2>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setInstructorName('');
                  setInstructorEmail('');
                  setInstructorPassword('');
                  setInstructorFormError(null);
                  handleGenerateInstructorPassword();
                  setShowCreateInstructorModal(true);
                }}
                className={buttonClasses('secondary', 'sm')}
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add Instructor
              </button>
            )}
          </div>
          {assignedInstructors.length === 0 ? (
            <p className="border-t border-line pt-3 text-sm text-ink-3">No instructors have been assigned to this cohort yet.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {assignedInstructors.map((inst) => (
                <li key={inst.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={inst.displayName} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{inst.displayName}</div>
                    <div className="truncate text-xs text-ink-3">{inst.email}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Enrollment form (administrators only) */}
        {canManage && (
          <section aria-labelledby="enroll-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="enroll-heading" className="type-section text-ink">Enroll a student</h2>
              {enrollmentOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setStudentName('');
                    setStudentEmail('');
                    setStudentPassword('');
                    setStudentFormError(null);
                    handleGenerateStudentPassword();
                    setShowCreateStudentModal(true);
                  }}
                  className={buttonClasses('secondary', 'sm')}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Create & Enroll New Student
                </button>
              )}
            </div>
            {!enrollmentOpen ? (
              <p className="border-t border-line pt-3 text-sm text-ink-3">
                This batch is {batch.status.replace('_', ' ')} and is not accepting enrollments.
              </p>
            ) : studentsError ? (
              <Notice kind="error">{studentsError}</Notice>
            ) : (
              <form onSubmit={handleEnroll} className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  required
                  className={`${fieldClasses} h-10 min-w-0 flex-1`}
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
                <Button type="submit" loading={isEnrolling} disabled={!selectedStudentId}>{isEnrolling ? 'Enrolling...' : 'Enroll'}</Button>
              </form>
            )}
            <p className="text-xs text-ink-3">
              Only active students of this batch&apos;s branch are listed. A student can hold one active enrollment per
              course; withdraw it before moving them to another batch.
            </p>
          </section>
        )}
      </div>

      {/* Quiz results (milestone G23): server-written summaries for this batch's students */}
      {batch && progress && (
        <section aria-labelledby="quiz-results-heading" className="space-y-3">
          <div>
            <h2 id="quiz-results-heading" className="type-section text-ink">Quiz results</h2>
            <p className="mt-1 text-sm text-ink-3">Every graded quiz attempt by students of this batch. Expand a row for the attempt history.</p>
          </div>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
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
          </div>
        </section>
      )}

      {/* Modal: Create & Assign Instructor */}
      {showCreateInstructorModal && (
        <ModalFrame onClose={() => setShowCreateInstructorModal(false)}>
          <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-6 space-y-5 shadow-float">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand-ink">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Add Lead Instructor</h3>
                  <p className="text-xs text-ink-3">Set up an instructor account and assign them to this batch</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateInstructorModal(false)}
                className="p-1 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-muted transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-surface-muted border border-line text-xs space-y-1">
              <div className="font-semibold text-ink">Assigning to Batch:</div>
              <div className="text-brand-ink">{batch.name} ({batch.code})</div>
            </div>

            {instructorFormError && (
              <div className="p-3 rounded-xl bg-danger-soft border border-danger-line flex items-center gap-2 text-danger-ink text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{instructorFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateAndAssignInstructor} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Prof. Priya Nair"
                  value={instructorName}
                  onChange={(e) => setInstructorName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-canvas border border-line text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. priya@strynkix.com"
                  value={instructorEmail}
                  onChange={(e) => setInstructorEmail(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-canvas border border-line text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink">Initial Password</label>
                  <button
                    type="button"
                    onClick={handleGenerateInstructorPassword}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
                  >
                    <Sparkles className="w-3 h-3" />
                    Generate Strong
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showInstructorPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    placeholder="Enter password"
                    value={instructorPassword}
                    onChange={(e) => setInstructorPassword(e.target.value)}
                    className="w-full pl-3.5 pr-10 py-2 rounded-xl bg-canvas border border-line text-xs font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <button
                    type="button"
                    onClick={() => setShowInstructorPassword(!showInstructorPassword)}
                    className="absolute right-3 top-2.5 text-ink-3 hover:text-ink"
                  >
                    {showInstructorPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowCreateInstructorModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-ink hover:bg-surface-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingInstructor || !instructorName || !instructorEmail || !instructorPassword}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-brand/20 transition-all"
                >
                  {isSubmittingInstructor && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmittingInstructor ? 'Creating & Assigning...' : 'Create & Assign Instructor'}</span>
                </button>
              </div>
            </form>
          </div>
        </ModalFrame>
      )}

      {/* Modal: Share Instructor Credentials */}
      {createdInstructorCreds && (
        <ModalFrame>
          <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-6 space-y-5 shadow-float">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-success/15 border border-success/30 flex items-center justify-center text-success-ink">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Instructor Assigned Successfully!</h3>
                  <p className="text-xs text-ink-3">Share these login credentials with the instructor</p>
                </div>
              </div>
              <button
                onClick={() => setCreatedInstructorCreds(null)}
                className="p-1 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-muted transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 p-4 rounded-xl bg-surface-muted border border-line text-xs font-mono">
              <div className="flex justify-between items-center pb-2 border-b border-line">
                <span className="text-ink-3">Cohort / Batch:</span>
                <span className="font-semibold text-ink">{createdInstructorCreds.batchName}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-line">
                <span className="text-ink-3">Full Name:</span>
                <span className="font-semibold text-ink">{createdInstructorCreds.name}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-line">
                <span className="text-ink-3">Role:</span>
                <span className="font-semibold text-brand-ink">Lead Instructor</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-line">
                <span className="text-ink-3">Email:</span>
                <span className="font-semibold text-brand-ink">{createdInstructorCreds.email}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-line">
                <span className="text-ink-3">Password:</span>
                <span className="font-semibold text-ink">{createdInstructorCreds.password}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-ink-3">Login URL:</span>
                <span className="text-ink underline">{createdInstructorCreds.loginUrl}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2 border-t border-line">
              <button
                type="button"
                onClick={handleCopyInstructorCreds}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-surface border border-line hover:bg-surface-sunken text-xs font-semibold text-ink transition-colors"
              >
                {copiedInstructorCreds ? (
                  <>
                    <Check className="w-4 h-4 text-success-ink" />
                    <span className="text-success-ink">Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Credentials to Share</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setCreatedInstructorCreds(null)}
                className="w-full sm:w-auto px-5 py-2 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </ModalFrame>
      )}

      {/* Modal: Create & Enroll Student */}
      {showCreateStudentModal && (
        <ModalFrame onClose={() => setShowCreateStudentModal(false)}>
          <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-6 space-y-5 shadow-float">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand-ink">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Create & Enroll Student</h3>
                  <p className="text-xs text-ink-3">Set up a student account and enroll them into this cohort</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateStudentModal(false)}
                className="p-1 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-muted transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-surface-muted border border-line text-xs space-y-1">
              <div className="font-semibold text-ink">Enrolling into Batch:</div>
              <div className="text-brand-ink">{batch.name} ({batch.code})</div>
            </div>

            {studentFormError && (
              <div className="p-3 rounded-xl bg-danger-soft border border-danger-line flex items-center gap-2 text-danger-ink text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{studentFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateAndEnrollStudent} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-canvas border border-line text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. rahul@strynkix.com"
                  value={studentEmail}
                  onChange={(e) => setStudentEmail(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-canvas border border-line text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink">Initial Password</label>
                  <button
                    type="button"
                    onClick={handleGenerateStudentPassword}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
                  >
                    <Sparkles className="w-3 h-3" />
                    Generate Strong
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showStudentPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    placeholder="Enter password"
                    value={studentPassword}
                    onChange={(e) => setStudentPassword(e.target.value)}
                    className="w-full pl-3.5 pr-10 py-2 rounded-xl bg-canvas border border-line text-xs font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <button
                    type="button"
                    onClick={() => setShowStudentPassword(!showStudentPassword)}
                    className="absolute right-3 top-2.5 text-ink-3 hover:text-ink"
                  >
                    {showStudentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowCreateStudentModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-ink hover:bg-surface-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingStudent || !studentName || !studentEmail || !studentPassword}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-brand/20 transition-all"
                >
                  {isSubmittingStudent && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmittingStudent ? 'Creating & Enrolling...' : 'Create & Enroll Student'}</span>
                </button>
              </div>
            </form>
          </div>
        </ModalFrame>
      )}

      {/* Modal: Share Student Credentials */}
      {createdStudentCreds && (
        <ModalFrame>
          <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-6 space-y-5 shadow-float">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-success/15 border border-success/30 flex items-center justify-center text-success-ink">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Student Enrolled Successfully!</h3>
                  <p className="text-xs text-ink-3">Share these login credentials with the student</p>
                </div>
              </div>
              <button
                onClick={() => setCreatedStudentCreds(null)}
                className="p-1 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-muted transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 p-4 rounded-xl bg-surface-muted border border-line text-xs font-mono">
              <div className="flex justify-between items-center pb-2 border-b border-line">
                <span className="text-ink-3">Cohort / Batch:</span>
                <span className="font-semibold text-ink">{createdStudentCreds.batchName}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-line">
                <span className="text-ink-3">Full Name:</span>
                <span className="font-semibold text-ink">{createdStudentCreds.name}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-line">
                <span className="text-ink-3">Email:</span>
                <span className="font-semibold text-brand-ink">{createdStudentCreds.email}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-line">
                <span className="text-ink-3">Password:</span>
                <span className="font-semibold text-ink">{createdStudentCreds.password}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-ink-3">Login URL:</span>
                <span className="text-ink underline">{createdStudentCreds.loginUrl}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2 border-t border-line">
              <button
                type="button"
                onClick={handleCopyStudentCreds}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-surface border border-line hover:bg-surface-sunken text-xs font-semibold text-ink transition-colors"
              >
                {copiedStudentCreds ? (
                  <>
                    <Check className="w-4 h-4 text-success-ink" />
                    <span className="text-success-ink">Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Credentials to Share</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setCreatedStudentCreds(null)}
                className="w-full sm:w-auto px-5 py-2 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </ModalFrame>
      )}

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

'use client';

/**
 * Strynkix Live Books — shared loader for the lesson hub and the reader:
 * course curriculum, the current lesson, the student's progress and enrollment.
 * Students reach content only through an active enrollment; staff preview.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Course, Lesson, Module, Progress } from '@/types/domain';
import { getCourseWithCurriculum, getLesson, getStudentCourseProgress, recordLessonProgress } from '@/lib/livebook/service';
import { getStudentCourseEnrollment } from '@/lib/batches/service';
import { grantsContentAccess } from '@/lib/batches/scope';

const STAFF = ['super_admin', 'university_admin', 'branch_admin', 'instructor', 'content_lead', 'content_designer'];

export interface LiveBookState {
  course: Course | null;
  modules: Module[];
  lessons: Lesson[];
  lesson: Lesson | null;
  progress: Progress[];
  /** Enrollment batch; null for staff previews (progress isn't recorded). */
  batchId: string | null;
  loading: boolean;
  error: string | null;
}

export function useLiveBook(courseId: string, lessonId: string, opts: { recordVisit?: boolean } = {}) {
  const { user, tenant } = useAuth();
  const [state, setState] = useState<LiveBookState>({
    course: null, modules: [], lessons: [], lesson: null, progress: [], batchId: null, loading: true, error: null,
  });
  const recordVisit = opts.recordVisit ?? false;

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!tenant?.orgId || !user?.uid) return;
      try {
        const preview = STAFF.includes(tenant.role);
        let batchId: string | null = null;
        if (tenant.role === 'student') {
          const enrollment = await getStudentCourseEnrollment(tenant.orgId, user.uid, courseId);
          if (!enrollment || !grantsContentAccess(enrollment.status)) {
            if (alive) setState((s) => ({ ...s, loading: false, error: 'You are not enrolled in this course. Contact your academy administrator for access.' }));
            return;
          }
          batchId = enrollment.batchId;
        }
        const [curriculum, lesson, progress] = await Promise.all([
          getCourseWithCurriculum(courseId, tenant.orgId, preview),
          getLesson(lessonId, tenant.orgId, preview),
          getStudentCourseProgress(courseId, user.uid, tenant.orgId),
        ]);
        if (!alive) return;
        if (!curriculum || !lesson) {
          setState((s) => ({ ...s, loading: false, error: 'Lesson or course not found.' }));
          return;
        }
        setState({ course: curriculum.course, modules: curriculum.modules, lessons: curriculum.lessons, lesson, progress, batchId, loading: false, error: null });

        // Opening the reader records an "in progress" visit; a failed write never blocks reading.
        const done = progress.some((p) => p.lessonId === lesson.id && p.status === 'completed');
        if (recordVisit && batchId && !done) {
          recordLessonProgress({
            studentId: user.uid, orgId: tenant.orgId, courseId, moduleId: lesson.moduleId, lessonId: lesson.id,
            batchId, status: 'in_progress', timeSpentSeconds: 30,
          }).catch((err) => console.warn('Failed to record lesson visit', err));
        }
      } catch (err) {
        console.error('Failed to load Live Book', err);
        if (alive) setState((s) => ({ ...s, loading: false, error: 'Failed to load lesson content. Please check your connection.' }));
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [courseId, lessonId, recordVisit, tenant?.orgId, tenant?.role, user?.uid]);

  /** Marks the current lesson complete (enrolled students only) and refreshes progress. */
  const uid = user?.uid;
  const orgId = tenant?.orgId;
  const { lesson: current, batchId: currentBatch } = state;
  const markCompleted = useCallback(async () => {
    if (!uid || !orgId || !current || !currentBatch) return;
    await recordLessonProgress({
      studentId: uid, orgId, courseId, moduleId: current.moduleId, lessonId: current.id,
      batchId: currentBatch, status: 'completed', timeSpentSeconds: 60,
    });
    const progress = await getStudentCourseProgress(courseId, uid, orgId);
    setState((s) => ({ ...s, progress }));
  }, [uid, orgId, current, currentBatch, courseId]);

  /** Reloads progress after the server graded a quiz attempt. */
  const refreshProgress = useCallback(async () => {
    if (!uid || !orgId) return;
    const progress = await getStudentCourseProgress(courseId, uid, orgId);
    setState((s) => ({ ...s, progress }));
  }, [uid, orgId, courseId]);

  return { ...state, markCompleted, refreshProgress };
}

'use client';

/**
 * Activities attached to a lesson (MCQ quiz, short or long answer, practical),
 * shown at the end of the lesson with the student's status for each.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { listStudentAssessments, type StudentAssessmentSummary } from '@/lib/assessments/service';
import { KIND_LABELS } from '@/lib/assessments/grading';
import { AttemptStatusPill, formatWhen } from './AttemptStatusPill';
import { ClipboardList, ChevronRight } from 'lucide-react';

export function LessonActivities({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const [items, setItems] = useState<StudentAssessmentSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    listStudentAssessments({ courseId, lessonId })
      .then((r) => live && setItems(r.assessments))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [courseId, lessonId]);

  if (failed) return <p className="my-8 text-center text-sm text-ink-3">Lesson activities couldn’t be loaded. Refresh to try again.</p>;
  if (!items || items.length === 0) return null;
  return (
    <section aria-labelledby="lesson-activities" className="my-12 space-y-3">
      <h2 id="lesson-activities" className="flex items-center gap-2 text-xl font-extrabold text-ink">
        <ClipboardList className="h-5 w-5 text-brand" aria-hidden="true" /> Lesson activities
      </h2>
      <p className="text-sm text-ink-3">Complete these after the lesson. Your instructor sees your submissions.</p>
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id}>
            <Link href={`/courses/${courseId}/activities/${a.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-card hover:border-silver">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-ink">{a.title}</div>
                <div className="text-xs text-ink-3">{KIND_LABELS[a.kind]} · {a.totalMarks} marks{a.closesAt ? ` · due ${formatWhen(a.closesAt)}` : ''}</div>
              </div>
              <AttemptStatusPill status={a.status} late={a.late} size="sm" />
              {a.score !== undefined && <span className="text-sm font-bold text-ink">{a.score}/{a.totalMarks}</span>}
              <ChevronRight className="h-4 w-4 text-ink-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

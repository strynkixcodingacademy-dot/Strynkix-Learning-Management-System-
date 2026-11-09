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
import { ChevronRight } from 'lucide-react';

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
      <h2 id="lesson-activities" className="type-section text-ink">Lesson activities</h2>
      <p className="text-sm text-ink-3">Complete these after the lesson. Your instructor sees your submissions.</p>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface font-sans">
        {items.map((a) => (
          <li key={a.id}>
            <Link href={`/courses/${courseId}/activities/${a.id}`} className="group flex flex-wrap items-center gap-3 p-4 transition-colors hover:bg-surface-muted/50">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink group-hover:text-brand-ink">{a.title}</div>
                <div className="text-xs text-ink-3">{KIND_LABELS[a.kind]}, {a.totalMarks} marks{a.closesAt ? `, due ${formatWhen(a.closesAt)}` : ''}</div>
              </div>
              <AttemptStatusPill status={a.status} late={a.late} size="sm" />
              {a.score !== undefined && <span className="text-sm font-medium tabular-nums text-ink">{a.score}/{a.totalMarks}</span>}
              <ChevronRight className="h-4 w-4 text-silver" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

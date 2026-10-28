'use client';

/**
 * Strynkix Live Books — lesson reader. A focused, full-screen reading view:
 * reading-progress bar with section markers, the lesson content (text, code,
 * videos, references…), then "It's Quiz Time" — passing the quiz completes the
 * lesson. Lessons without quiz questions keep the explicit "Mark complete".
 */

import React, { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { headingAnchor, LessonBlockRenderer } from '@/components/livebook/LessonBlockRenderer';
import { LessonNavigation } from '@/components/livebook/LessonNavigation';
import { QuizTime } from '@/components/livebook/QuizTime';
import { useLiveBook } from '@/components/livebook/useLiveBook';
import { getAdjacentLessons } from '@/lib/livebook/curriculum';
import { lessonNumber, lessonQuiz, readingBlocks } from '@/lib/livebook/structure';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { ArrowLeft, ArrowRight, Brain, Check, X } from 'lucide-react';

interface LessonPageProps {
  params: Promise<{ courseId: string; lessonId: string }>;
}

/** Reading progress (0–100) and the scroll position of each section heading. */
function useReadingProgress(anchorIds: string[]) {
  const [pct, setPct] = useState(0);
  const [marks, setMarks] = useState<number[]>([]);
  const key = anchorIds.join('|');
  useEffect(() => {
    const measure = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setPct(max > 0 ? Math.min(100, Math.round((window.scrollY / max) * 100)) : 0);
      setMarks(
        key ? key.split('|').flatMap((id) => {
          const el = document.getElementById(id);
          return el && max > 0 ? [Math.min(100, Math.max(0, ((el.getBoundingClientRect().top + window.scrollY - 120) / max) * 100))] : [];
        }) : []
      );
    };
    const frame = requestAnimationFrame(measure);
    // Images, videos and code panels change the page height after first paint.
    const observer = new ResizeObserver(() => measure());
    observer.observe(document.body);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [key]);
  return { pct, marks };
}

function ReaderView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { user } = useAuth();
  const book = useLiveBook(courseId, lessonId, { recordVisit: true });
  const { course, modules, lessons, lesson, progress, batchId, loading, error, markCompleted } = book;
  const blocks = lesson ? readingBlocks(lesson) : [];
  const anchors = blocks.flatMap((b) => (b.type === 'heading' && b.level <= 2 ? [headingAnchor(b.id, b.text)] : []));
  const { pct, marks } = useReadingProgress(anchors);
  const hub = `/courses/${courseId}/units/${lessonId}`;

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-16" role="status" aria-live="polite">
        <span className="sr-only">Opening lesson…</span>
        <Skeleton className="mx-auto h-10 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (error || !course || !lesson) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyState illustration="lock" title="Lesson unavailable" action={<Link href={`/courses/${courseId}`} className={buttonClasses('primary')}>Back to course syllabus</Link>}>
          {error || 'Unable to open lesson.'}
        </EmptyState>
      </div>
    );
  }

  const number = lessonNumber(modules, lessons, lesson.id);
  const questions = lessonQuiz(lesson);
  const isCompleted = progress.some((p) => p.lessonId === lesson.id && p.status === 'completed');
  const { prevLesson, nextLesson } = getAdjacentLessons(modules, lessons, lesson.id);

  return (
    <div className="min-h-screen bg-surface-muted/60">
      {/* Reading progress + close */}
      <header className="sticky top-0 z-40 bg-surface-muted/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center gap-4 px-4 pt-5 pb-2 sm:px-8">
          <div className="relative h-2 flex-1 rounded-full bg-surface-sunken" role="progressbar" aria-label="Reading progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-warning transition-[width] duration-150" style={{ width: `${pct}%` }} />
            {marks.map((m, i) => (
              <span key={i} aria-hidden="true" className={cx('absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-muted', m <= pct ? 'bg-warning' : 'bg-silver')} style={{ left: `${m}%` }} />
            ))}
          </div>
          {questions.length > 0 && (
            <a href="#quiz" className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-coral shadow-card hover:border-silver" aria-label="Jump to the quiz" title="Jump to the quiz">
              <Brain className="h-4 w-4" />
            </a>
          )}
          <Link href={hub} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3 hover:bg-surface hover:text-ink" aria-label="Close lesson">
            <X className="h-5 w-5" />
          </Link>
        </div>
        <div className={cx('mx-auto flex max-w-[1180px] items-center gap-2 px-4 pb-2 text-[12.5px] text-ink-3 transition-opacity sm:px-8', pct > 3 ? 'opacity-100' : 'opacity-0')} aria-hidden={pct <= 3}>
          <span className={cx('flex h-4 w-4 items-center justify-center rounded-full border', isCompleted ? 'border-success bg-success text-white' : 'border-line-strong bg-surface')}>{isCompleted && <Check className="h-2.5 w-2.5" strokeWidth={3} />}</span>
          <span className="truncate">{number} {lesson.title}</span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[1060px] px-4 pb-24 sm:px-8">
        <div className="relative flex items-center justify-center gap-4 py-10">
          {number && <span className="absolute left-0 hidden h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-sm font-semibold text-ink-2 shadow-card sm:flex">{number}</span>}
          <h1 className="px-0 text-center text-[28px] font-extrabold leading-tight tracking-tight text-ink sm:px-14 sm:text-[34px]">{lesson.title}</h1>
        </div>

        {!batchId && (
          <p className="mb-8 rounded-xl border border-brand-line bg-brand-soft px-4 py-3 text-center text-sm text-ink-2">
            <strong>Preview mode.</strong> You&apos;re viewing this lesson as staff; progress is recorded only for enrolled students.
          </p>
        )}

        <article className="lesson-flow text-[17px] leading-[1.75] text-ink">
          {blocks.length ? blocks.map((b) => <LessonBlockRenderer key={b.id} block={b} />) : (
            <p className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink-3">This lesson is being prepared by your instructors.</p>
          )}
        </article>

        <hr className="my-14 border-line" />

        {questions.length > 0 ? (
          <>
            <QuizTime
              questions={questions}
              storageKey={`lb-best:${user?.uid ?? 'anon'}:${lesson.id}`}
              isCompleted={isCompleted}
              canTrackProgress={Boolean(batchId)}
              onPassed={markCompleted}
            />
            <hr className="my-12 border-line" />
            <nav aria-label="Lesson navigation" className="flex flex-wrap items-center justify-between gap-4 text-[15px] font-medium text-ink-3">
              {prevLesson ? (
                <Link href={`/courses/${courseId}/units/${prevLesson.id}`} className="inline-flex items-center gap-2 hover:text-ink"><ArrowLeft className="h-4 w-4" /> {prevLesson.title}</Link>
              ) : <span />}
              {nextLesson ? (
                <Link href={`/courses/${courseId}/units/${nextLesson.id}`} className="inline-flex items-center gap-2 hover:text-ink">{nextLesson.title} <ArrowRight className="h-4 w-4" /></Link>
              ) : (
                <Link href={`/courses/${courseId}`} className="inline-flex items-center gap-2 hover:text-ink">Back to course <ArrowRight className="h-4 w-4" /></Link>
              )}
            </nav>
          </>
        ) : (
          <LessonNavigation
            courseId={course.id}
            prevLesson={prevLesson}
            nextLesson={nextLesson}
            isCompleted={isCompleted}
            onMarkCompleted={markCompleted}
            canTrackProgress={Boolean(batchId)}
          />
        )}
      </main>
    </div>
  );
}

function LessonPageContent({ params }: LessonPageProps) {
  const { courseId, lessonId } = use(params);
  return (
    <RequireAuth>
      <ReaderView courseId={courseId} lessonId={lessonId} />
    </RequireAuth>
  );
}

export default function LessonPage({ params }: LessonPageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading lesson…</span></div>}>
      <LessonPageContent params={params} />
    </Suspense>
  );
}

'use client';

/**
 * Strynkix Live Books — lesson reader. A focused page, set like a good textbook:
 * a reading measure in Literata, an outline in the margin, a thin reading-progress
 * rule with section marks, then "It's Quiz Time" — passing the quiz completes the
 * lesson. Lessons without quiz questions keep the explicit "Mark complete". No
 * motion while reading.
 */

import React, { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { useAuth } from '@/context/AuthContext';
import { headingAnchor, LessonBlockRenderer } from '@/components/livebook/LessonBlockRenderer';
import { LessonNavigation } from '@/components/livebook/LessonNavigation';
import { QuizTime } from '@/components/livebook/QuizTime';
import { LessonActivities } from '@/components/assessments/LessonActivities';
import { useLiveBook } from '@/components/livebook/useLiveBook';
import { getAdjacentLessons } from '@/lib/livebook/curriculum';
import { submitQuizAttempt } from '@/lib/livebook/service';
import { lessonNumber, lessonQuiz, readingBlocks } from '@/lib/livebook/structure';
import { buttonClasses, iconButtonClasses } from '@/components/ui/Button';
import { EmptyState, Notice, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { cx } from '@/components/ui/tones';
import { ArrowLeft, ArrowRight, CheckCheck, ClipboardCheck, X } from 'lucide-react';

interface LessonPageProps {
  params: Promise<{ courseId: string; lessonId: string }>;
}

/** Reading progress (0–100) and the scroll position of each section heading. */
function useReadingProgress(anchorIds: string[]) {
  const [pct, setPct] = useState(0);
  const [marks, setMarks] = useState<number[]>([]);
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const key = anchorIds.join('|');
  useEffect(() => {
    const measure = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setPct(max > 0 ? Math.min(100, Math.round((window.scrollY / max) * 100)) : 0);
      const ids = key ? key.split('|') : [];
      setMarks(ids.flatMap((id) => {
        const el = document.getElementById(id);
        return el && max > 0 ? [Math.min(100, Math.max(0, ((el.getBoundingClientRect().top + window.scrollY - 120) / max) * 100))] : [];
      }));
      setActiveAnchor([...ids].reverse().find((id) => {
        const el = document.getElementById(id);
        return el && el.getBoundingClientRect().top < 140;
      }) ?? null);
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
  return { pct, marks, activeAnchor };
}

function ReaderView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { user } = useAuth();
  const book = useLiveBook(courseId, lessonId, { recordVisit: true });
  const { course, modules, lessons, lesson, progress, batchId, loading, error, markCompleted, refreshProgress } = book;
  const blocks = lesson ? readingBlocks(lesson) : [];
  const headings = blocks.flatMap((b) => (b.type === 'heading' && b.level <= 2 ? [{ id: headingAnchor(b.id, b.text), text: b.text }] : []));
  const { pct, marks, activeAnchor } = useReadingProgress(headings.map((h) => h.id));
  const hub = `/courses/${courseId}/units/${lessonId}`;

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-20" role="status" aria-live="polite">
        <span className="sr-only">Opening lesson…</span>
        <Skeleton className="h-11 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (error || !course || !lesson) {
    return (
      <main id="main" className="mx-auto max-w-md px-4 py-16">
        <h1 className="sr-only">Live Books</h1>
        <EmptyState illustration="lock" title="Lesson unavailable" action={<Link href={`/courses/${courseId}`} className={buttonClasses('primary')}>Back to course syllabus</Link>}>
          {error || 'Unable to open lesson.'}
        </EmptyState>
      </main>
    );
  }

  const number = lessonNumber(modules, lessons, lesson.id);
  const questions = lessonQuiz(lesson);
  const lessonProgress = progress.find((p) => p.lessonId === lesson.id);
  const isCompleted = lessonProgress?.status === 'completed';
  const { prevLesson, nextLesson } = getAdjacentLessons(modules, lessons, lesson.id);

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lift">Skip to content</a>

      {/* Running head: where you are, how far through, and the way out. */}
      <header className="sticky top-0 z-40 border-b border-line bg-canvas print:hidden">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-3 px-4 sm:px-6">
          <Link href={`/courses/${courseId}`} className="min-w-0 flex-1 truncate text-sm text-ink-3 hover:text-ink">
            <span className="hidden sm:inline">{course.title}<span aria-hidden="true" className="px-2 text-silver">/</span></span>
            <span className="text-ink-2">{number ? `${number} ` : ''}{lesson.title}</span>
          </Link>
          {isCompleted && <StatusPill tone="success" icon={CheckCheck} size="sm" className="hidden sm:inline-flex">Completed</StatusPill>}
          {questions.length > 0 && (
            <a href="#quiz" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-muted hover:text-ink" aria-label="Jump to the quiz">
              <ClipboardCheck className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" /> <span className="hidden sm:inline">Quiz</span>
            </a>
          )}
          <Link href={hub} className={iconButtonClasses('md')} aria-label="Close lesson" title="Close lesson">
            <X className="h-5 w-5" />
          </Link>
        </div>
        <div className="relative h-0.5 bg-line" role="progressbar" aria-label="Reading progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
          {marks.map((m, i) => (
            <span key={i} aria-hidden="true" className={cx('absolute -top-px h-1 w-px', m <= pct ? 'bg-brand-strong' : 'bg-silver')} style={{ left: `${m}%` }} />
          ))}
        </div>
      </header>

      <div className="mx-auto grid max-w-[1180px] gap-x-12 px-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,44rem)_minmax(0,1fr)]">
        {/* Outline in the margin on wide screens only; the running head does the job elsewhere. */}
        <nav aria-label="On this page" className="hidden xl:block">
          {headings.length > 1 && (
            <div className="sticky top-24 pt-14">
              <p className="mb-2 text-xs font-medium text-ink-3">On this page</p>
              <ul className="space-y-1.5">
                {headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} aria-current={activeAnchor === h.id ? 'location' : undefined}
                      className={cx('block text-sm leading-snug transition-colors duration-150', activeAnchor === h.id ? 'font-medium text-ink' : 'text-ink-3 hover:text-ink')}>{h.text}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>

        <main id="main" className="mx-auto w-full min-w-0 max-w-[44rem] pb-24">
          <header className="pb-8 pt-10 sm:pt-14">
            <p className="text-sm text-ink-3">{number && `Lesson ${number}`}{lesson.estimatedMinutes ? `${number ? ', ' : ''}${lesson.estimatedMinutes} min read` : ''}</p>
            <h1 className="mt-2 text-[clamp(2rem,1.6rem+1.8vw,2.875rem)] leading-[1.1] text-ink">{lesson.title}</h1>
          </header>

          {!batchId && (
            <div className="mb-8"><Notice kind="info"><span className="font-semibold">Preview mode.</span> You&apos;re viewing this lesson as staff; progress is recorded only for enrolled students.</Notice></div>
          )}

          <article className="lesson-flow text-ink">
            {blocks.length ? blocks.map((b) => <LessonBlockRenderer key={b.id} block={b} />) : (
              <p className="rounded-lg bg-surface-muted/60 p-8 text-center font-sans text-sm text-ink-3">This lesson is being prepared by your instructors.</p>
            )}
          </article>

          {batchId && <LessonActivities courseId={courseId} lessonId={lesson.id} />}

          {questions.length > 0 ? (
            <div className="mt-14 space-y-10">
              <QuizTime
                questions={questions}
                isCompleted={isCompleted}
                canTrackProgress={Boolean(batchId)}
                bestPercent={lessonProgress?.quiz?.bestPercent ?? null}
                draftKey={user ? `lb-quiz-draft:${user.uid}:${lesson.id}:${lesson.publishedVersion ?? 0}` : undefined}
                onSubmit={async (answers) => {
                  const result = await submitQuizAttempt(courseId, lesson.id, answers, lesson.publishedVersion ?? null);
                  // The server already saved the attempt; a failed refresh only delays the tick.
                  refreshProgress().catch((err) => console.warn('Failed to refresh progress', err));
                  return result;
                }}
              />
              <nav aria-label="Lesson navigation" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {prevLesson ? (
                  <Link href={`/courses/${courseId}/units/${prevLesson.id}`} className="group rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong">
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous</span>
                    <span className="mt-0.5 block text-sm font-medium text-ink group-hover:text-brand-ink">{prevLesson.title}</span>
                  </Link>
                ) : <span className="hidden sm:block" />}
                {nextLesson ? (
                  <Link href={`/courses/${courseId}/units/${nextLesson.id}`} className="group rounded-lg border border-line bg-surface p-4 text-right transition-colors hover:border-line-strong">
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">Next <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
                    <span className="mt-0.5 block text-sm font-medium text-ink group-hover:text-brand-ink">{nextLesson.title}</span>
                  </Link>
                ) : (
                  <Link href={`/courses/${courseId}`} className="group rounded-lg border border-line bg-surface p-4 text-right transition-colors hover:border-line-strong">
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">Finished <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
                    <span className="mt-0.5 block text-sm font-medium text-ink group-hover:text-brand-ink">Back to course</span>
                  </Link>
                )}
              </nav>
            </div>
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

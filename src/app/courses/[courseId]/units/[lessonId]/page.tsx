'use client';

/**
 * Strynkix Live Books — lesson page ("unit"). Learning Path on the left; on the
 * right the lesson's three ways in: read the Lesson, Revision Notes, and Quiz.
 */

import React, { Suspense, use, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { LiveBooksFrame } from '@/components/livebook/LiveBooksFrame';
import { LearningPathNav } from '@/components/livebook/LearningPathNav';
import { useLiveBook } from '@/components/livebook/useLiveBook';
import { AppArt, AppArtName } from '@/components/home/AppArt';
import { CourseIcon } from '@/components/ui/CourseIcon';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { cx } from '@/components/ui/tones';
import { lessonNumber, lessonQuiz, lessonStatus, revisionNotes } from '@/lib/livebook/structure';
import { CheckCheck, ChevronLeft, Clock, ExternalLink, Lightbulb, PlayCircle, Wrench, BookOpenCheck } from 'lucide-react';

interface UnitPageProps {
  params: Promise<{ courseId: string; lessonId: string }>;
}

function EntryCard({ title, art, tone, href, onClick, note, expanded }: { title: string; art: AppArtName; tone: 'warm' | 'violet' | 'sky'; href?: string; onClick?: () => void; note?: string; expanded?: boolean }) {
  const look = {
    warm: 'bg-warning-soft/70 text-coral-ink',
    violet: 'bg-lavender-soft text-lavender-ink',
    sky: 'bg-brand-soft text-brand-ink',
  }[tone];
  const body = (
    <>
      <span className="relative z-10 pt-8 text-center text-[22px] font-bold">{title}</span>
      {note && <span className="relative z-10 mt-1 text-center text-[12px] font-semibold text-ink-3">{note}</span>}
      <span aria-hidden="true" className="absolute -bottom-[45%] left-1/2 h-[90%] w-[120%] -translate-x-1/2 rounded-[50%] bg-surface/90" />
      <span className="relative z-10 mt-auto flex justify-center pb-4 transition-transform duration-200 group-hover:-translate-y-1"><AppArt name={art} size={92} /></span>
    </>
  );
  const cls = cx('group relative flex h-[220px] flex-col overflow-hidden rounded-xl border border-line shadow-card transition-shadow hover:shadow-lift', look);
  return href ? <Link href={href} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls} aria-expanded={expanded}>{body}</button>;
}

function UnitView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { course, modules, lessons, lesson, progress, loading, error } = useLiveBook(courseId, lessonId);
  const [showNotes, setShowNotes] = useState(false);

  if (loading) return <LiveBooksFrame><div className="space-y-4 p-8"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-56" /></div></LiveBooksFrame>;
  if (error || !course || !lesson) {
    return (
      <LiveBooksFrame>
        <div className="p-8">
          <EmptyState illustration="lock" title="Lesson unavailable" action={<Link href="/courses" className={buttonClasses('primary')}>Back to Live Books</Link>}>
            {error || 'Unable to open lesson.'}
          </EmptyState>
        </div>
      </LiveBooksFrame>
    );
  }

  const number = lessonNumber(modules, lessons, lesson.id) ?? '';
  const questions = lessonQuiz(lesson);
  const status = lessonStatus(progress, lesson.id);
  const notes = revisionNotes(lesson);
  const reader = `/courses/${courseId}/lessons/${lesson.id}`;

  return (
    <LiveBooksFrame className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="hidden border-r border-line bg-surface lg:block lg:min-h-0">
        <LearningPathNav courseId={courseId} modules={modules} lessons={lessons} progress={progress} activeLessonId={lesson.id} />
      </aside>

      <section className="min-w-0 overflow-y-auto px-5 py-8 sm:px-12 sm:py-12">
        <div className="flex items-start gap-4 border-b border-line pb-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-sm font-semibold text-ink-2 shadow-card">{number}</span>
          <div className="min-w-0 flex-1">
            <Link href={`/courses/${courseId}`} className="inline-flex items-center gap-1 text-[14px] text-ink-3 hover:text-ink">
              <ChevronLeft className="h-4 w-4" /> {course.title}
            </Link>
            <h2 className="mt-1 text-[24px] font-extrabold leading-tight tracking-tight text-ink sm:text-[28px]">{lesson.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {lesson.estimatedMinutes} min</span>
              {status === 'completed' && <StatusPill tone="success" icon={CheckCheck} size="sm">Completed</StatusPill>}
              {status === 'in_progress' && <StatusPill tone="brand" size="sm">In progress</StatusPill>}
            </div>
          </div>
          <span className="hidden sm:block"><CourseIcon course={course} size="md" /></span>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <EntryCard title="Lesson" art="preview" tone="warm" href={reader} note={status === 'completed' ? 'Read again' : undefined} />
          <EntryCard title="Revision Notes" art="pen" tone="violet" onClick={() => setShowNotes((v) => !v)} expanded={showNotes} />
          <EntryCard title="Quiz" art="clipboard" tone="sky" href={questions.length ? `${reader}#quiz` : reader}
            note={questions.length ? `${questions.length} question${questions.length === 1 ? '' : 's'}` : 'No quiz for this lesson'} />
        </div>

        {showNotes && (
          <section aria-label="Revision notes" className="mt-8 space-y-6 rounded-card border border-lavender-line bg-surface p-6 shadow-card animate-rise">
            <h3 className="text-[18px] font-extrabold text-ink">Revision Notes</h3>
            {notes.outline.length === 0 && notes.keyPoints.length === 0 && notes.videos.length === 0 && notes.links.length === 0 ? (
              <p className="text-sm text-ink-3">This lesson has no sections or key points to summarise yet. Open the lesson to read it in full.</p>
            ) : (
              <>
                {notes.outline.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-[12px] font-bold uppercase tracking-[0.1em] text-ink-3">What this lesson covers</h4>
                    <ol className="list-decimal space-y-1 pl-5 text-[15px] text-ink-2">{notes.outline.map((o) => <li key={o}>{o}</li>)}</ol>
                  </div>
                )}
                {notes.keyPoints.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {notes.keyPoints.map((k, i) => {
                      const Icon = k.kind === 'note' ? Lightbulb : k.kind === 'example' ? BookOpenCheck : Wrench;
                      return (
                        <div key={i} className="rounded-xl border border-line bg-canvas p-4">
                          <div className="flex items-center gap-2 text-[14px] font-bold text-ink"><Icon className="h-4 w-4 text-lavender-ink" /> {k.title}</div>
                          <p className="mt-1 line-clamp-4 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-3">{k.text}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
                {(notes.videos.length > 0 || notes.links.length > 0) && (
                  <div>
                    <h4 className="mb-2 text-[12px] font-bold uppercase tracking-[0.1em] text-ink-3">Watch & read</h4>
                    <ul className="space-y-2 text-[14.5px]">
                      {notes.videos.map((v) => (
                        <li key={v.url}><a href={v.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-brand-ink hover:underline"><PlayCircle className="h-4 w-4 text-coral" /> {v.title}</a></li>
                      ))}
                      {notes.links.map((l) => (
                        <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-brand-ink hover:underline"><ExternalLink className="h-4 w-4" /> {l.label}</a>{l.description && <span className="text-ink-3"> — {l.description}</span>}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </section>
    </LiveBooksFrame>
  );
}

function UnitContent({ params }: UnitPageProps) {
  const { courseId, lessonId } = use(params);
  return (
    <AppShell fit>
      <UnitView courseId={courseId} lessonId={lessonId} />
    </AppShell>
  );
}

export default function UnitPage({ params }: UnitPageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <UnitContent params={params} />
    </Suspense>
  );
}

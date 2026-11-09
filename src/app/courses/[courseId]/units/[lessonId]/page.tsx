'use client';

/**
 * Strynkix Live Books — lesson page ("unit"). The book's contents in the margin;
 * beside it the lesson's three ways in: read the Lesson, Revision Notes, and Quiz.
 */

import { Breadcrumbs } from '@/components/ui/Page';
import React, { Suspense, use, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { LearningPathNav } from '@/components/livebook/LearningPathNav';
import { useLiveBook } from '@/components/livebook/useLiveBook';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { cx } from '@/components/ui/tones';
import { lessonNumber, lessonQuiz, lessonStatus, revisionNotes } from '@/lib/livebook/structure';
import { ArrowRight, BookOpen, BookOpenCheck, CheckCheck, ChevronDown, ClipboardCheck, ExternalLink, Lightbulb, NotebookPen, PlayCircle, Wrench } from 'lucide-react';

interface UnitPageProps {
  params: Promise<{ courseId: string; lessonId: string }>;
}

/** One way into the lesson: an index row, not a tile. */
function WayIn({ title, note, icon: Icon, href, onClick, expanded }: {
  title: string;
  note: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  href?: string;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const body = (
    <>
      <Icon className="h-5 w-5 shrink-0 text-ink-3 transition-colors duration-150 group-hover:text-brand" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-ink group-hover:text-brand-ink">{title}</span>
        <span className="block text-sm text-ink-3">{note}</span>
      </span>
      {href
        ? <ArrowRight className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
        : <ChevronDown className={cx('h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150', expanded && 'rotate-180')} aria-hidden="true" />}
    </>
  );
  const cls = 'group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-surface-muted/50 sm:px-5';
  return href ? <Link href={href} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls} aria-expanded={expanded}>{body}</button>;
}

function UnitView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { course, modules, lessons, lesson, progress, loading, error } = useLiveBook(courseId, lessonId);
  const [showNotes, setShowNotes] = useState(false);

  if (loading) return <div className="space-y-4" role="status"><span className="sr-only">Opening lesson…</span><Skeleton className="h-10 w-1/2" /><Skeleton className="h-56" /></div>;
  if (error || !course || !lesson) {
    return (
      <>
        <h1 className="sr-only">Live Books</h1>
        <EmptyState illustration="lock" title="Lesson unavailable" action={<Link href="/courses" className={buttonClasses('primary')}>Back to Live Books</Link>}>
          {error || 'Unable to open lesson.'}
        </EmptyState>
      </>
    );
  }

  const number = lessonNumber(modules, lessons, lesson.id) ?? '';
  const questions = lessonQuiz(lesson);
  const status = lessonStatus(progress, lesson.id);
  const notes = revisionNotes(lesson);
  const reader = `/courses/${courseId}/lessons/${lesson.id}`;

  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="order-last lg:order-first lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
        <LearningPathNav courseId={courseId} modules={modules} lessons={lessons} progress={progress} activeLessonId={lesson.id} />
      </aside>

      <section className="min-w-0 space-y-7">
        <header className="space-y-3 border-b border-line pb-6">
          <Breadcrumbs items={[{ label: 'Live Books', href: '/courses' }, { label: course.title, href: `/courses/${courseId}` }, { label: lesson.title }]} />
          <h1 className="type-page text-ink">{number && <span className="text-ink-3">{number}&ensp;</span>}{lesson.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
            <span>{lesson.estimatedMinutes} min</span>
            {status === 'completed' && <StatusPill tone="success" icon={CheckCheck} size="sm">Completed</StatusPill>}
            {status === 'in_progress' && <StatusPill tone="brand" size="sm">In progress</StatusPill>}
          </div>
        </header>

        <Link href={reader} className={buttonClasses('primary', 'lg', 'group')}>
          {status === 'completed' ? 'Read again' : status === 'in_progress' ? 'Continue reading' : 'Start reading'}
          <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>

        <div className="divide-y divide-line rounded-card border border-line bg-surface">
          <WayIn title="Lesson" icon={BookOpen} href={reader} note={status === 'completed' ? 'Read again' : `The full lesson, about ${lesson.estimatedMinutes} minutes`} />
          <WayIn title="Revision Notes" icon={NotebookPen} onClick={() => setShowNotes((v) => !v)} expanded={showNotes} note="The key points of this lesson, on one page" />
          <WayIn title="Quiz" icon={ClipboardCheck} href={questions.length ? `${reader}#quiz` : reader}
            note={questions.length ? `${questions.length} question${questions.length === 1 ? '' : 's'}` : 'No quiz for this lesson'} />
        </div>

        {showNotes && (
          <section aria-label="Revision notes" className="space-y-6 animate-rise">
            <h2 className="type-section text-ink">Revision Notes</h2>
            {notes.outline.length === 0 && notes.keyPoints.length === 0 && notes.videos.length === 0 && notes.links.length === 0 ? (
              <p className="text-sm text-ink-3">This lesson has no sections or key points to summarise yet. Open the lesson to read it in full.</p>
            ) : (
              <>
                {notes.outline.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-ink">What this lesson covers</h3>
                    <ol className="list-decimal space-y-1 pl-5 text-body text-ink-2">{notes.outline.map((o) => <li key={o}>{o}</li>)}</ol>
                  </div>
                )}
                {notes.keyPoints.length > 0 && (
                  <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                    {notes.keyPoints.map((k, i) => {
                      const Icon = k.kind === 'note' ? Lightbulb : k.kind === 'example' ? BookOpenCheck : Wrench;
                      return (
                        <li key={i} className="border-t border-line pt-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-ink-3" aria-hidden="true" /> {k.title}</div>
                          <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm text-ink-3">{k.text}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {(notes.videos.length > 0 || notes.links.length > 0) && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-ink">Watch and read</h3>
                    <ul className="space-y-2 text-sm">
                      {notes.videos.map((v) => (
                        <li key={v.url}><a href={v.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-medium text-brand-ink hover:underline"><PlayCircle className="h-4 w-4" aria-hidden="true" /> {v.title}</a></li>
                      ))}
                      {notes.links.map((l) => (
                        <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-medium text-brand-ink hover:underline"><ExternalLink className="h-4 w-4" aria-hidden="true" /> {l.label}</a>{l.description && <span className="text-ink-3"> {l.description}</span>}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </section>
    </div>
  );
}

function UnitContent({ params }: UnitPageProps) {
  const { courseId, lessonId } = use(params);
  return (
    <AppShell>
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

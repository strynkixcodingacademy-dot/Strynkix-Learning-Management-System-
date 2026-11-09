'use client';

/**
 * Strynkix Live Books — public landing page. It opens on a real lesson page
 * (its knowledge check works), then shows how a course is laid out, the
 * courses on offer and what a day looks like. Plain copy, no slogans.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { BrandMark } from '@/components/ui/Illustrations';
import { CourseCover } from '@/components/ui/CourseIcon';
import { cx } from '@/components/ui/tones';
import { ArrowRight, BadgeCheck, Check, CircleX, ClipboardList } from 'lucide-react';

const TRACKS = [
  { id: 'cpp', title: 'C++ Systems and Data Structures', level: 'Foundation to advanced', duration: '14 weeks', tagline: 'Memory models, pointers, STL containers, complexity analysis and problem solving.' },
  { id: 'ts', title: 'Modern TypeScript and Web Engineering', level: 'Intermediate', duration: '12 weeks', tagline: 'Full-stack development, component architecture, asynchronous workflows and API design.' },
  { id: 'data', title: 'Backend Systems and Database Design', level: 'Intermediate to advanced', duration: '10 weeks', tagline: 'Relational data modelling, transactions, distributed services and deployment.' },
];

// An example contents page, set the way the course page shows it.
const CONTENTS = [
  { title: 'Thinking in programs', lessons: ['Reading your first program', 'Values and variables', 'Making decisions'], done: 3 },
  { title: 'Functions', lessons: ['Writing and calling functions', 'Parameters and return values', 'Scope'], done: 1 },
  { title: 'Collections', lessons: ['Arrays', 'Objects'], done: 0 },
];

const DISPLAY = 'font-display font-[560] leading-[1.1] tracking-[-0.02em]';

/** The sample lesson. The check really works. */
function LessonPage() {
  const [choice, setChoice] = useState<string | null>(null);
  const options = [
    { id: 'a', text: 'Date.now(), which returns the current time' },
    { id: 'b', text: 'Math.max(x, y), which returns the larger number' },
  ];
  const right = 'b';
  return (
    <div className="rounded-md bg-surface p-5 text-ink shadow-[0_30px_60px_-30px_rgb(10_14_40/0.55),0_2px_6px_rgb(10_14_40/0.12)] sm:p-8">
      <p className="text-xs text-ink-3">Functions, lesson 2.4</p>
      <h2 className={cx('mt-1 text-[1.625rem] sm:text-[1.875rem]', DISPLAY)}>Pure functions</h2>
      <p className="mt-3 font-reading text-base leading-relaxed sm:text-[1.0625rem]">
        A pure function always returns the same result for the same arguments, and changes nothing outside itself. That makes it easy to test and easy to trust.
      </p>
      <figure className="mt-4 overflow-hidden rounded border border-code-line bg-code">
        <figcaption className="border-b border-code-line px-3 py-1 font-mono text-xs text-code-muted">progress.ts</figcaption>
        <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[0.75rem] leading-[1.7] text-code-ink sm:text-[0.8125rem]"><code><span className="text-syn-keyword">function</span> <span className="text-syn-fn">percent</span>(done, total) {'{'}{'\n'}{'  '}<span className="text-syn-keyword">if</span> (total === <span className="text-syn-number">0</span>) <span className="text-syn-keyword">return</span> <span className="text-syn-number">0</span>;{'\n'}{'  '}<span className="text-syn-keyword">return</span> Math.<span className="text-syn-fn">round</span>((done / total) * <span className="text-syn-number">100</span>);{'\n'}{'}'}</code></pre>
      </figure>
      <fieldset className="mt-5 border-t border-line pt-4">
        <legend className="float-left mb-2 w-full text-sm font-medium text-ink">Which of these is pure?</legend>
        <div className="clear-both space-y-1.5">
          {options.map((o, i) => {
            const picked = choice === o.id;
            const correct = choice !== null && o.id === right;
            const wrong = picked && o.id !== right;
            return (
              <label key={o.id} className={cx('flex cursor-pointer items-center gap-2.5 rounded border px-3 py-2 text-sm transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                correct ? 'border-success bg-success-soft' : wrong ? 'border-coral bg-coral-soft' : 'border-line-strong hover:bg-surface-muted/60')}>
                <input type="radio" name="sample-check" value={o.id} checked={picked} onChange={() => setChoice(o.id)} className="sr-only" />
                <span aria-hidden="true" className={cx('w-4 shrink-0 text-xs font-medium', correct ? 'text-success-ink' : wrong ? 'text-coral-ink' : 'text-ink-3')}>{String.fromCharCode(65 + i)}</span>
                <span className="min-w-0 flex-1">{o.text}</span>
                {correct && <BadgeCheck className="h-4 w-4 shrink-0 text-success-ink" aria-label="Correct" />}
                {wrong && <CircleX className="h-4 w-4 shrink-0 text-coral-ink" aria-label="Not this one" />}
              </label>
            );
          })}
        </div>
        <p aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-2">
          {choice === null ? 'Pick one. You’ll see straight away if you’re right.' : choice === right ? 'Right. Same inputs, same answer, nothing else touched.' : 'Not quite. The clock moves, so the answer changes every time.'}
        </p>
      </fieldset>
    </div>
  );
}

export default function HomePage() {
  const { status } = useAuth();
  const isAuthenticated = status === 'authenticated';
  const enterHref = isAuthenticated ? '/dashboard' : '/login';

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="absolute inset-x-0 top-0 z-10 text-foil">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline-foil" aria-label="Strynkix Live Books home">
            <BrandMark size={28} foil />
            <span className="font-display text-lg font-[560] leading-none">Strynkix</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm font-medium sm:gap-3">
            <Link href="/courses" className="hidden rounded-md px-2 py-2 text-foil/80 transition-colors hover:text-foil focus-visible:outline-foil sm:block">Courses</Link>
            <Link href={enterHref} className="rounded-md px-2 py-2 text-foil underline decoration-foil/40 underline-offset-4 transition-colors hover:decoration-foil focus-visible:outline-foil">
              {isAuthenticated ? 'Go to your workspace' : 'Sign In'}
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex flex-1 flex-col">
        {/* The cover */}
        <div className="relative overflow-hidden bg-cloth-cobalt text-foil">
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-2 bg-black/20 sm:w-3" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-24 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-16 lg:pb-24 lg:pt-32">
            <div className="min-w-0">
              <p className="text-sm text-foil/70">Strynkix Coding Academy</p>
              <h1 className="mt-4 max-w-[16ch] text-[clamp(2.5rem,1.9rem+2.8vw,4rem)] font-[540] leading-[1.06] tracking-[-0.025em]">
                Learn to program from books that check your work.
              </h1>
              <p className="mt-6 max-w-[44ch] text-lg leading-relaxed text-foil/80">
                Every lesson is a short chapter with real code and questions along the way. Your instructor sets a plan for each day and reads what you submit.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link href={enterHref} className="group inline-flex h-11 items-center gap-2 rounded-md bg-foil px-5 text-body font-semibold text-cloth-cobalt transition-colors hover:bg-white focus-visible:outline-foil">
                  {isAuthenticated ? 'Open your workspace' : 'Sign in to Live Books'} <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
                <Link href="/courses" className="text-body text-foil/85 underline decoration-foil/35 underline-offset-4 transition-colors hover:text-foil hover:decoration-foil focus-visible:outline-foil">
                  See the courses
                </Link>
              </div>
            </div>
            <div className="min-w-0 lg:rotate-[0.6deg]"><LessonPage /></div>
          </div>
        </div>

        <div className="space-y-20 py-16 lg:space-y-28 lg:py-24">
          {/* How a course is laid out, shown rather than told */}
          <section aria-labelledby="how-heading" className="mx-auto grid max-w-6xl gap-x-16 gap-y-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div>
              <h2 id="how-heading" className={cx('text-[clamp(1.75rem,1.5rem+1.2vw,2.5rem)]', DISPLAY)}>How a course is laid out</h2>
              <div className="mt-5 max-w-[46ch] space-y-4 text-body text-ink-2">
                <p>A course is a book, divided into chapters and short lessons. You read a lesson, try its practice task in your own editor, and answer a few questions at the end. Pass them and the lesson is marked complete.</p>
                <p>The course page always shows where you are, which lessons are on today’s plan, and what’s left.</p>
              </div>
            </div>
            <figure className="rounded-card border border-line bg-surface p-5 sm:p-7">
              <figcaption className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
                <span className="font-display text-lg font-[560]">JavaScript Foundations</span>
                <span className="text-xs text-ink-3">Contents</span>
              </figcaption>
              <ol className="mt-4 space-y-5">
                {CONTENTS.map((m, mi) => (
                  <li key={m.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2">
                    <span className="font-display text-xl font-[560] leading-none text-silver">{mi + 1}</span>
                    <div>
                      <p className="text-sm font-semibold text-ink">{m.title}</p>
                      <ol className="mt-2 space-y-1.5">
                        {m.lessons.map((l, li) => {
                          const done = li < m.done;
                          const here = mi === 1 && li === 1;
                          return (
                            <li key={l} className="flex items-center gap-2 text-sm">
                              <span className={cx('w-7 shrink-0 text-xs tabular-nums', here ? 'font-semibold text-brand-ink' : 'text-ink-4')}>{mi + 1}.{li + 1}</span>
                              <span className={cx('min-w-0 flex-1', done ? 'text-ink-3' : here ? 'font-medium text-ink' : 'text-ink-2')}>{l}</span>
                              {done && <Check className="h-3.5 w-3.5 text-success" aria-label="Done" />}
                              {here && <span className="text-xs font-medium text-brand-ink">You are here</span>}
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  </li>
                ))}
              </ol>
            </figure>
          </section>

          {/* Courses */}
          <section aria-labelledby="shelf-heading" className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line-strong pb-4">
              <h2 id="shelf-heading" className={cx('text-[clamp(1.75rem,1.5rem+1.2vw,2.5rem)]', DISPLAY)}>Courses</h2>
              <Link href="/courses" className="text-sm font-medium text-brand-ink underline decoration-brand-line underline-offset-4 hover:decoration-brand">All courses</Link>
            </div>
            <ul className="mt-9 grid gap-x-10 gap-y-10 md:grid-cols-3">
              {TRACKS.map((t) => (
                <li key={t.id} className="flex gap-5 md:block">
                  <Link href="/courses" tabIndex={-1} aria-hidden="true" className="w-24 shrink-0 md:block md:w-40">
                    <CourseCover course={t} className="shadow-[0_14px_24px_-16px_rgb(10_14_40/0.6)] transition-transform duration-200 ease-out hover:-translate-y-0.5" />
                  </Link>
                  <div className="min-w-0 md:mt-5">
                    <h3 className="text-base font-semibold leading-snug text-ink"><Link href="/courses" className="hover:text-brand-ink">{t.title}</Link></h3>
                    <p className="mt-1 text-sm text-ink-3">{t.level}, {t.duration}</p>
                    <p className="mt-2 max-w-[38ch] text-sm text-ink-2">{t.tagline}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* A day */}
          <section aria-labelledby="rhythm-heading" className="mx-auto grid max-w-6xl items-start gap-x-16 gap-y-10 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 id="rhythm-heading" className={cx('text-[clamp(1.75rem,1.5rem+1.2vw,2.5rem)]', DISPLAY)}>A plan for every day</h2>
              <p className="mt-5 max-w-[46ch] text-body text-ink-2">
                Each morning your home page shows that day’s plan: two or three lessons and usually one assignment. When you submit, your instructor marks it or asks for a correction, and you can fix it and send it again.
              </p>
              <p className="mt-4 max-w-[46ch] text-body text-ink-2">Progress figures are counted from what you’ve actually done, and each one says how it’s calculated.</p>
            </div>
            <figure className="relative rounded-card border border-line bg-surface p-5 sm:p-6">
              <span aria-hidden="true" className="ribbon absolute right-6 top-0" />
              <figcaption className="text-xs text-ink-3">Example: Thursday’s plan</figcaption>
              <p className="mt-1 text-base font-semibold text-ink">Functions, part one</p>
              <ol className="mt-5 space-y-4">
                <li className="flex items-center gap-3 text-sm"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-white"><Check className="h-3.5 w-3.5" strokeWidth={2.5} /></span><span className="text-ink-3 line-through decoration-ink-4">Writing and calling functions</span></li>
                <li className="flex items-center gap-3 text-sm"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-medium text-white">2</span><span className="font-medium text-ink">Parameters and return values</span><span className="ml-auto text-xs text-ink-3">16 min</span></li>
                <li className="flex items-center gap-3 text-sm"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-ink-3"><ClipboardList className="h-3 w-3" /></span><span className="text-ink-2">Assignment: grade calculator</span><span className="ml-auto text-xs text-ink-3">due 11 pm</span></li>
              </ol>
            </figure>
          </section>

          {/* For academies */}
          <section aria-labelledby="academy-heading" className="mx-auto grid max-w-6xl gap-x-16 gap-y-6 border-t border-line-strong px-4 pt-10 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <h2 id="academy-heading" className={cx('text-[clamp(1.5rem,1.35rem+0.8vw,2rem)]', DISPLAY)}>For the people who run the academy</h2>
            <div className="max-w-[52ch] space-y-4 text-body text-ink-2">
              <p>Each branch and remote cohort keeps its own records, and every role, from branch manager to instructor, sees only what its work needs.</p>
              <p>Quizzes are graded on the server, every submission is kept, and changes to people, fees and content are written to an audit log.</p>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-9 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5 text-ink-3">
            <BrandMark size={22} />
            <span><span className="font-display font-[560] text-ink">Strynkix</span> Coding Academy</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-ink-2">
            <Link href="/courses" className="hover:text-ink hover:underline">Courses</Link>
            <Link href="/dashboard" className="hover:text-ink hover:underline">Dashboard</Link>
            <Link href="/login" className="hover:text-ink hover:underline">Sign In</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

'use client';

/**
 * Strynkix Live Books — Public Landing Page
 * Welcomes students, instructors, and campus administrators into Strynkix Coding Academy's
 * interactive learning environment.
 */

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { BrandMark } from '@/components/ui/Illustrations';
import { Card } from '@/components/ui/Page';
import { buttonClasses } from '@/components/ui/Button';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ClipboardCheck,
  Code2,
  FileCode,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Lightbulb,
  LogIn,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

export default function HomePage() {
  const { profile, tenant, status } = useAuth();
  const isAuthenticated = status === 'authenticated';

  const pillars = [
    {
      icon: CalendarDays,
      iconBg: 'bg-warning-soft text-warning-ink',
      title: 'Daily Learning Rhythm',
      description:
        'Instructor-crafted daily plans with bite-sized lesson milestones, clear targets, and scheduled assignments designed for focused progress.',
    },
    {
      icon: BookOpen,
      iconBg: 'bg-brand-soft text-brand-ink',
      title: 'Interactive Live Books',
      description:
        'Comfortable reading typography (~68ch measure), syntax-highlighted code panels, collapsible worked solutions, and instant self-check quizzes.',
    },
    {
      icon: ClipboardCheck,
      iconBg: 'bg-teal-soft text-teal-ink',
      title: 'Real Assignment Reviews',
      description:
        'Submit written responses and code implementations. Receive constructive line-by-line feedback and permitted revision guidance from instructors.',
    },
    {
      icon: TrendingUp,
      iconBg: 'bg-success-soft text-success-ink',
      title: 'Real Progress Telemetry',
      description:
        'Transparent metrics for lesson completion, submission rates, and graded evaluations. Every figure reflects actual milestones achieved.',
    },
  ];

  const tracks = [
    {
      title: 'C++ Systems & Data Structures',
      level: 'Foundation to Advanced',
      duration: '14 Weeks',
      tagline: 'Memory models, pointers, STL containers, complexity analysis, and competitive problem solving.',
      accent: 'border-l-4 border-l-brand',
    },
    {
      title: 'Modern TypeScript & Web Engineering',
      level: 'Intermediate',
      duration: '12 Weeks',
      tagline: 'Full-stack application development, component architectures, asynchronous workflows, and API design.',
      accent: 'border-l-4 border-l-teal',
    },
    {
      title: 'Backend Systems & Database Design',
      level: 'Intermediate to Advanced',
      duration: '10 Weeks',
      tagline: 'Relational data modeling, ACID transactions, distributed services, and production deployment patterns.',
      accent: 'border-l-4 border-l-lavender',
    },
  ];

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col selection:bg-brand-soft selection:text-brand-ink">
      {/* Navigation Bar */}
      <header className="border-b border-line bg-surface/95 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none" aria-label="Strynkix Live Books Home">
            <BrandMark size={32} />
            <div className="leading-tight">
              <span className="block text-base font-extrabold tracking-tight text-ink">Live Books</span>
              <span className="block text-[11px] font-medium text-ink-3">Strynkix Coding Academy</span>
            </div>
          </Link>

          <nav className="flex items-center gap-3 sm:gap-4 text-xs font-semibold">
            <Link
              href="/courses"
              className="px-3 py-1.5 rounded-lg text-ink-2 hover:bg-surface-muted hover:text-ink transition hidden sm:inline-flex"
            >
              Curriculum
            </Link>

            {isAuthenticated ? (
              <Link
                href="/dashboard"
                className={buttonClasses('primary', 'sm')}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Go to Workspace</span>
              </Link>
            ) : (
              <Link
                href="/login"
                className={buttonClasses('primary', 'sm')}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 space-y-20 pb-20">
        <section className="pt-16 pb-12 sm:pt-24 sm:pb-16 px-4 sm:px-6 max-w-5xl mx-auto text-center space-y-8 animate-rise">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-warning-soft border border-warning-line text-warning-ink text-xs font-bold">
            <Sparkles className="w-4 h-4 text-warning-ink" />
            <span>Interactive Digital Textbooks for Software Engineers</span>
          </div>

          <div className="space-y-4 max-w-3xl mx-auto">
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-ink leading-[1.12]">
              Learn to build real software with <span className="text-brand">Live Books</span>.
            </h1>
            <p className="text-ink-2 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
              Step into a calm, structured learning space. Daily guided plans, interactive lesson reading,
              integrated code challenges, constructive assignment reviews, and continuous mastery telemetry.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href={isAuthenticated ? '/dashboard' : '/login'}
              className={buttonClasses('primary', 'lg', 'w-full sm:w-auto shadow-lift')}
            >
              <span>{isAuthenticated ? 'Open Learning Workspace' : 'Enter Live Books'}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/courses"
              className={buttonClasses('secondary', 'lg', 'w-full sm:w-auto')}
            >
              <span>Explore Curriculum</span>
            </Link>
          </div>

          {isAuthenticated && profile && (
            <p className="text-xs text-ink-3">
              Signed in as <strong className="text-ink-2">{profile.displayName || profile.email}</strong> • Role: <span className="uppercase font-mono text-brand-ink">{tenant?.role}</span>
            </p>
          )}
        </section>

        {/* Feature Highlights Grid */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8">
          <div className="text-center space-y-2">
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">
              The Live Books Experience
            </h2>
            <p className="text-sm text-ink-3 max-w-lg mx-auto">
              Purpose-built for coding academies: eliminating noisy dashboards in favor of motivated, daily learning.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {pillars.map((pillar, i) => {
              const Icon = pillar.icon;
              return (
                <Card key={i} className="p-6 space-y-4 hover:shadow-lift transition-shadow duration-200">
                  <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${pillar.iconBg}`}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="space-y-1.5">
                    <h3 className="text-base font-bold text-ink">{pillar.title}</h3>
                    <p className="text-xs sm:text-sm text-ink-3 leading-relaxed">{pillar.description}</p>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Live Book Lesson Demonstration Panel */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6">
          <Card className="p-6 sm:p-10 border border-line bg-surface shadow-lift space-y-6 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink font-bold">
                  LB
                </span>
                <div>
                  <div className="text-xs font-semibold text-brand-ink uppercase tracking-wider">Lesson Runtime Anatomy</div>
                  <h3 className="text-lg font-bold text-ink">Clean reading with rich block pedagogy</h3>
                </div>
              </div>
              <span className="text-xs font-mono text-ink-3 bg-surface-muted px-2.5 py-1 rounded-full self-start sm:self-auto">
                Comfortable ~68ch Column
              </span>
            </div>

            {/* Mock Lesson Anatomy */}
            <div className="space-y-5 max-w-2xl mx-auto py-2">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Module 2 · Control Flow & Functions</span>
                <h4 className="text-2xl font-extrabold text-ink font-display">Pure Functions & Immutability</h4>
                <p className="text-sm leading-relaxed text-ink-2">
                  A pure function always returns the exact same result when given the same arguments, and performs
                  no observable side effects. This makes testing and reasoning predictable.
                </p>
              </div>

              {/* Callout Demo */}
              <aside className="my-4 flex gap-3 rounded-r-xl border-l-4 border-brand bg-brand-soft px-4 py-3">
                <Lightbulb className="w-5 h-5 shrink-0 text-brand-ink mt-0.5" />
                <div className="space-y-0.5 text-xs text-ink-2">
                  <p className="font-bold text-brand-ink">Key Engineering Principle</p>
                  <p>Isolate side effects (network, disk, timers) at the boundaries of your architecture.</p>
                </div>
              </aside>

              {/* Code Demo */}
              <figure className="rounded-xl bg-code p-4 border border-code-line text-xs font-mono space-y-2">
                <div className="flex items-center justify-between text-code-muted text-[11px] pb-2 border-b border-code-line">
                  <span className="flex items-center gap-1.5"><FileCode className="w-3.5 h-3.5" /> immutability.ts</span>
                  <span className="text-[10px] text-syn-string">TypeScript</span>
                </div>
                <pre className="text-code-ink leading-relaxed overflow-x-auto">
                  <code>
                    <span className="text-syn-keyword">export function</span>{' '}
                    <span className="text-syn-fn">calculateProgress</span>(completed: <span className="text-syn-keyword">number</span>, total: <span className="text-syn-keyword">number</span>) &#123;{'\n'}
                    {'  '}<span className="text-syn-keyword">if</span> (total === <span className="text-syn-number">0</span>) <span className="text-syn-keyword">return</span> <span className="text-syn-number">0</span>;{'\n'}
                    {'  '}<span className="text-syn-keyword">return</span> Math.<span className="text-syn-fn">round</span>((completed / total) * <span className="text-syn-number">100</span>);{'\n'}
                    &#125;
                  </code>
                </pre>
              </figure>

              {/* Knowledge Check Demo */}
              <div className="rounded-xl border border-lavender-line bg-lavender-soft/40 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-lavender-ink">
                  <Sparkles className="w-3.5 h-3.5" /> Knowledge Check
                </div>
                <p className="text-xs font-semibold text-ink">Which of the following functions is pure?</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface border border-line text-ink">
                    <span className="h-5 w-5 rounded bg-surface-muted text-ink-2 font-bold flex items-center justify-center text-[10px]">A</span>
                    <span>Date.now() returning current millisecond timestamp</span>
                  </div>
                  <div className="flex items-center gap-2.5 p-2 rounded-lg bg-success-soft border border-success-line text-success-ink font-semibold">
                    <span className="h-5 w-5 rounded bg-success text-white font-bold flex items-center justify-center text-[10px]"><Check className="w-3 h-3" /></span>
                    <span>Math.max(x, y) returning the largest number</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* Featured Curriculum Tracks */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-1.5">
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">
                Curriculum Tracks
              </h2>
              <p className="text-sm text-ink-3">
                Structured courses with ordered modules, progressive milestones, and verified assignments.
              </p>
            </div>
            <Link
              href="/courses"
              className={buttonClasses('secondary', 'sm')}
            >
              <span>View All Courses</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {tracks.map((track, i) => (
              <Card key={i} className={`p-6 space-y-4 flex flex-col justify-between ${track.accent}`}>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-ink-3">
                    <span className="font-semibold uppercase tracking-wider text-[11px] px-2 py-0.5 rounded bg-surface-muted text-ink-2">
                      {track.level}
                    </span>
                    <span>{track.duration}</span>
                  </div>
                  <h3 className="text-lg font-bold text-ink leading-snug">{track.title}</h3>
                  <p className="text-xs sm:text-sm text-ink-3 leading-relaxed">{track.tagline}</p>
                </div>
                <div className="pt-4 border-t border-line">
                  <Link
                    href="/courses"
                    className="text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1"
                  >
                    <span>Inspect Syllabus</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Academy Tenancy & Trust */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="rounded-2xl border border-line bg-surface p-8 sm:p-10 space-y-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success-ink">
                <ShieldCheck className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-ink">Multi-Campus Academy Infrastructure</h3>
                <p className="text-xs text-ink-3">Production architecture built for universities and coding bootcamps</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-ink-2">
              <div className="p-4 rounded-xl bg-canvas border border-line space-y-1">
                <div className="font-bold text-ink flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-brand" /> Tenant & Branch Hubs
                </div>
                <p className="text-ink-3">Isolated campus boundaries for physical institutes and virtual remote cohorts.</p>
              </div>
              <div className="p-4 rounded-xl bg-canvas border border-line space-y-1">
                <div className="font-bold text-ink flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5 text-teal" /> Role Governance
                </div>
                <p className="text-ink-3">Super Admins, Campus Directors, Instructors, and Students with strictly verified privileges.</p>
              </div>
              <div className="p-4 rounded-xl bg-canvas border border-line space-y-1">
                <div className="font-bold text-ink flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-lavender" /> Secure Sandbox
                </div>
                <p className="text-ink-3">Student code solutions are safely recorded and reviewed without client-side arbitrary execution.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line bg-surface text-ink-3 text-xs py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BrandMark size={20} />
            <span className="font-semibold text-ink">Strynkix Live Books</span>
            <span>•</span>
            <span>Strynkix Coding Academy</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/courses" className="hover:text-ink transition">Curriculum</Link>
            <Link href="/dashboard" className="hover:text-ink transition">Dashboard</Link>
            <Link href="/login" className="hover:text-ink transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

'use client';

/**
 * Strynkix LMS — Course Catalog Page
 * Displays published courses available within the authenticated student's organization.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/context/AuthContext';
import { Course } from '@/types/domain';
import { BookOpen, Clock, Tag, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { RequireAuth } from '@/components/auth/RouteGuards';

function CourseCatalog() {
  const { tenant } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCourses() {
      if (!tenant?.orgId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const q = query(
          collection(db, 'courses'),
          where('orgId', '==', tenant.orgId),
          where('status', '==', 'published')
        );
        const snap = await getDocs(q);
        const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Course));
        setCourses(loaded);
      } catch (err) {
        console.error('Failed to load courses', err);
        setError('Unable to load courses. Please check your network connection.');
      } finally {
        setIsLoading(false);
      }
    }

    loadCourses();
  }, [tenant?.orgId]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-lg text-white shadow-lg shadow-indigo-500/20">
              S
            </div>
            <span className="font-semibold text-slate-100 tracking-tight">Strynkix Academy LMS</span>
          </Link>
          <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
            <div>
              Tenant: <strong className="text-indigo-400">{tenant?.orgId}</strong>
            </div>
            <Link
              href="/dashboard"
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold font-sans"
            >
              Dashboard &rarr;
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Course Curriculum</h1>
          <p className="text-slate-400 text-sm max-w-xl">
            Explore interactive Live Books designed for practical, real-world software engineering mastery.
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            <span className="text-xs text-slate-400 font-mono">Loading curriculum...</span>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/50 flex items-center gap-3 text-rose-300 text-xs">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && courses.length === 0 && (
          <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
            <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-base font-semibold text-slate-300">No Published Courses Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Your academy administrator has not published courses yet. Please check back soon or run the local emulator seed script.
            </p>
          </div>
        )}

        {/* Course Cards Grid */}
        {!isLoading && !error && courses.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {courses.map((course) => (
              <div
                key={course.id}
                className="group p-6 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-indigo-500/50 transition shadow-xl hover:shadow-indigo-500/10 flex flex-col justify-between space-y-6"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-semibold">
                      {course.level || 'Intermediate'}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-400 font-mono">
                      <Clock className="w-3.5 h-3.5" />
                      {course.estimatedWeeks || 12} Weeks
                    </span>
                  </div>

                  <h2 className="text-xl font-bold text-white group-hover:text-indigo-300 transition">
                    {course.title}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400 leading-relaxed line-clamp-3">
                    {course.tagline || course.description}
                  </p>

                  {course.tags && course.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {course.tags.map((t, idx) => (
                        <span
                          key={idx}
                          className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300"
                        >
                          <Tag className="w-3 h-3 text-slate-500" />
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400">Interactive Live Book</span>
                  <Link
                    href={`/courses/${course.id}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow-lg shadow-indigo-600/20"
                  >
                    <span>View Curriculum</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function CoursesPage() {
  return (
    <RequireAuth>
      <CourseCatalog />
    </RequireAuth>
  );
}

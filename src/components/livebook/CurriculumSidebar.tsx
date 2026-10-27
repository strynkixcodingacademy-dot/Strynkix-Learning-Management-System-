'use client';

/**
 * Strynkix LMS — Live Books Persistent Curriculum Sidebar & Mobile Drawer
 * Provides persistent curriculum navigation on desktop and accessible drawer on mobile.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  CheckCircle2,
  Circle,
  Menu,
  X,
  Clock,
  Code,
  FileText,
  Sparkles,
  ArrowLeft,
} from 'lucide-react';
import { Course, Module, Lesson, Progress } from '@/types/domain';
import { calculateCourseProgress } from '@/lib/livebook/curriculum';

interface CurriculumSidebarProps {
  course: Course;
  modules: Module[];
  lessons: Lesson[];
  activeLessonId: string;
  progressList: Progress[];
}

export function CurriculumSidebar({
  course,
  modules,
  lessons,
  activeLessonId,
  progressList,
}: CurriculumSidebarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const completedLessonIds = new Set(
    progressList.filter((p) => p.status === 'completed').map((p) => p.lessonId)
  );

  const { percentage, completedCount, totalCount } = calculateCourseProgress(
    lessons.length,
    completedLessonIds
  );

  // Group lessons by module
  const sortedModules = [...modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const lessonsByModule = new Map<string, Lesson[]>();

  sortedModules.forEach((m) => {
    const modLessons = lessons
      .filter((l) => l.moduleId === m.id)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    lessonsByModule.set(m.id, modLessons);
  });

  const getLessonTypeIcon = (type: Lesson['type']) => {
    switch (type) {
      case 'interactive_code':
        return <Code className="w-3.5 h-3.5" />;
      case 'exercise':
        return <Sparkles className="w-3.5 h-3.5" />;
      case 'concept':
      default:
        return <FileText className="w-3.5 h-3.5" />;
    }
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 text-slate-100">
      {/* Course Header */}
      <div className="p-4 border-b border-slate-800 space-y-3">
        <Link
          href={`/courses/${course.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-medium transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Course Curriculum</span>
        </Link>
        <div className="flex items-start gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shrink-0 shadow-lg shadow-indigo-500/20">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-white line-clamp-1">{course.title}</h2>
            <span className="text-[10px] font-mono text-slate-400 uppercase">Live Book</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5 pt-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Progress</span>
            <span className="font-mono text-emerald-400 font-semibold">
              {percentage}% ({completedCount}/{totalCount})
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </div>

      {/* Curriculum Outline */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {sortedModules.map((module, mIdx) => {
          const moduleLessons = lessonsByModule.get(module.id) || [];
          return (
            <div key={module.id} className="space-y-1">
              <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Module {mIdx + 1}: {module.title}
              </div>

              <div className="space-y-1">
                {moduleLessons.map((lesson) => {
                  const isActive = lesson.id === activeLessonId;
                  const isCompleted = completedLessonIds.has(lesson.id);

                  return (
                    <Link
                      key={lesson.id}
                      href={`/courses/${course.id}/lessons/${lesson.id}`}
                      onClick={() => setIsMobileOpen(false)}
                      className={`group flex items-center justify-between px-3 py-2.5 rounded-lg text-xs transition ${
                        isActive
                          ? 'bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-600/30'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isCompleted ? (
                          <CheckCircle2
                            className={`w-4 h-4 shrink-0 ${
                              isActive ? 'text-white' : 'text-emerald-400'
                            }`}
                          />
                        ) : (
                          <Circle
                            className={`w-4 h-4 shrink-0 ${
                              isActive ? 'text-indigo-200' : 'text-slate-600'
                            }`}
                          />
                        )}
                        <span className="truncate">{lesson.title}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 opacity-70 group-hover:opacity-100">
                        <span className="flex items-center gap-0.5 text-[10px] font-mono">
                          <Clock className="w-3 h-3" />
                          {lesson.estimatedMinutes}m
                        </span>
                        {getLessonTypeIcon(lesson.type)}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Top Toggle Bar */}
      <div className="lg:hidden sticky top-16 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="flex items-center gap-2 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition"
        >
          <Menu className="w-4 h-4" />
          <span>Curriculum Outline ({percentage}%)</span>
        </button>
        <span className="text-[11px] font-mono text-slate-400">
          Lesson {lessons.findIndex((l) => l.id === activeLessonId) + 1} of {lessons.length}
        </span>
      </div>

      {/* Desktop Persistent Sidebar */}
      <aside className="hidden lg:block w-80 shrink-0 sticky top-16 h-[calc(100vh-4rem)]">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop and Panel */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setIsMobileOpen(false)}
          />
          <div className="relative w-4/5 max-w-sm h-full z-10 shadow-2xl flex flex-col">
            <div className="absolute top-3 right-3 z-20">
              <button
                onClick={() => setIsMobileOpen(false)}
                className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}

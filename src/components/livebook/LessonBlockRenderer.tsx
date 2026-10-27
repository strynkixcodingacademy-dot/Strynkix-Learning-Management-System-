'use client';

/**
 * Strynkix LMS — Live Books Block Dispatcher & Renderer
 * Dispatches discriminated LessonBlock types to their specialized UI components.
 */

import React from 'react';
import { LessonBlock } from '@/types/domain';
import { lessonBlockSchema } from '@/types/validation';
import { AlertTriangle } from 'lucide-react';
import { CodeBlockView } from './CodeBlockView';
import { QuizBlockView } from './QuizBlockView';
import { PracticeTaskView } from './PracticeTaskView';
import { WorkedExampleView } from './WorkedExampleView';
import { CalloutView } from './CalloutView';

interface LessonBlockRendererProps {
  block: LessonBlock;
}

export function LessonBlockRenderer({ block }: LessonBlockRendererProps) {
  // Defensive validation: Ensure block conforms to runtime schema
  const parseResult = lessonBlockSchema.safeParse(block);
  if (!parseResult.success) {
    return (
      <div className="p-3 my-4 rounded-lg bg-amber-950/20 border border-amber-900/40 text-xs text-amber-300 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
        <span>Content block could not be rendered due to a schema mismatch.</span>
      </div>
    );
  }

  const validBlock = parseResult.data as LessonBlock;

  switch (validBlock.type) {
    case 'heading': {
      const headingText = validBlock.text;
      switch (validBlock.level) {
        case 1:
          return (
            <h1 className="mt-8 mb-4 text-2xl sm:text-3xl font-extrabold text-white tracking-tight border-b border-slate-800 pb-2">
              {headingText}
            </h1>
          );
        case 2:
          return (
            <h2 className="mt-7 mb-3 text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
              {headingText}
            </h2>
          );
        case 3:
          return (
            <h3 className="mt-6 mb-2 text-lg sm:text-xl font-semibold text-slate-200">
              {headingText}
            </h3>
          );
        case 4:
        default:
          return (
            <h4 className="mt-5 mb-2 text-base font-semibold text-slate-300">
              {headingText}
            </h4>
          );
      }
    }

    case 'text':
      return (
        <div className="my-4 text-sm sm:text-base text-slate-300 leading-relaxed space-y-3 whitespace-pre-line">
          {validBlock.content}
        </div>
      );

    case 'code_example':
      return <CodeBlockView block={validBlock} />;

    case 'image': {
      const isSafeUrl = /^https?:\/\//i.test(validBlock.url) || validBlock.url.startsWith('/');
      if (!isSafeUrl) {
        return (
          <div className="p-3 my-4 rounded-lg bg-rose-950/20 border border-rose-900/40 text-xs text-rose-300">
            Unsafe image URL blocked for security.
          </div>
        );
      }

      return (
        <figure className="my-6 space-y-2">
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={validBlock.url}
              alt={validBlock.altText}
              loading="lazy"
              className="w-full h-auto max-h-[500px] object-cover"
            />
          </div>
          {validBlock.caption && (
            <figcaption className="text-center text-xs text-slate-400 italic">
              {validBlock.caption}
            </figcaption>
          )}
        </figure>
      );
    }

    case 'callout':
      return <CalloutView block={validBlock} />;

    case 'worked_example':
      return <WorkedExampleView block={validBlock} />;

    case 'quiz':
      return <QuizBlockView block={validBlock} />;

    case 'practice_task':
      return <PracticeTaskView block={validBlock} />;

    default:
      return (
        <div className="p-3 my-4 rounded bg-slate-900 border border-slate-800 text-xs text-slate-400">
          (Unsupported block type)
        </div>
      );
  }
}

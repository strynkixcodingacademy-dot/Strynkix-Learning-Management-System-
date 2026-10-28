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

/** Stable anchor id for a heading block (used by the lesson outline). */
export function headingAnchor(blockId: string, text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `h-${slug || 'section'}-${blockId}`;
}

interface LessonBlockRendererProps {
  block: LessonBlock;
}

export function LessonBlockRenderer({ block }: LessonBlockRendererProps) {
  // Defensive validation: Ensure block conforms to runtime schema
  const parseResult = lessonBlockSchema.safeParse(block);
  if (!parseResult.success) {
    return (
      <div className="p-3 my-4 rounded-lg bg-warning-soft border border-warning-line text-xs text-warning-ink flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 text-warning-ink" />
        <span>Content block could not be rendered due to a schema mismatch.</span>
      </div>
    );
  }

  const validBlock = parseResult.data as LessonBlock;

  switch (validBlock.type) {
    case 'heading': {
      // The lesson title is the page's h1, so block headings sit one level below it.
      const id = headingAnchor(validBlock.id, validBlock.text);
      const styles = {
        1: 'mt-12 mb-4 text-2xl sm:text-[28px] font-extrabold tracking-tight text-ink',
        2: 'mt-10 mb-3 text-xl sm:text-2xl font-bold tracking-tight text-ink',
        3: 'mt-8 mb-2 text-lg font-bold text-ink',
        4: 'mt-6 mb-2 text-base font-bold text-ink-2',
      } as const;
      const Tag = (['h2', 'h3', 'h4', 'h5'] as const)[validBlock.level - 1] ?? 'h5';
      return (
        <Tag id={id} className={`scroll-mt-24 ${styles[validBlock.level] ?? styles[4]}`}>
          {validBlock.text}
        </Tag>
      );
    }

    case 'text':
      return (
        <div className="prose-reading my-5 whitespace-pre-line">
          {validBlock.content}
        </div>
      );

    case 'code_example':
      return <CodeBlockView block={validBlock} />;

    case 'image': {
      const isSafeUrl = /^https?:\/\//i.test(validBlock.url) || validBlock.url.startsWith('/');
      if (!isSafeUrl) {
        return (
          <div className="p-3 my-4 rounded-lg bg-danger-soft border border-danger-line text-xs text-danger-ink">
            Unsafe image URL blocked for security.
          </div>
        );
      }

      return (
        <figure className="my-8 space-y-2">
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={validBlock.url}
              alt={validBlock.altText}
              loading="lazy"
              className="w-full h-auto max-h-[500px] object-cover"
            />
          </div>
          {validBlock.caption && (
            <figcaption className="text-center text-sm text-ink-3">
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
        <div className="p-3 my-4 rounded bg-surface border border-line text-xs text-ink-3">
          (Unsupported block type)
        </div>
      );
  }
}

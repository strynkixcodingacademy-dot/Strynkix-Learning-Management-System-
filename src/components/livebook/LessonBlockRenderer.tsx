'use client';

/**
 * Strynkix LMS — Live Books Block Dispatcher & Renderer
 * Dispatches discriminated LessonBlock types to their specialized UI components.
 */

import React from 'react';
import { LessonBlock } from '@/types/domain';
import { lessonBlockSchema } from '@/types/validation';
import { AlertTriangle, Download, ExternalLink, FileText, PlayCircle } from 'lucide-react';
import { youtubeEmbedUrl } from '@/lib/livebook/video';
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
        1: 'mt-14 mb-4 font-display font-normal text-[1.75rem] sm:text-[2rem] leading-[1.15] text-ink',
        2: 'mt-12 mb-3 font-display font-normal text-[1.4375rem] sm:text-[1.625rem] leading-[1.2] text-ink',
        3: 'mt-9 mb-2 font-sans text-lg font-semibold leading-snug text-ink',
        4: 'mt-7 mb-1.5 font-sans text-base font-semibold text-ink-2',
      } as const;
      const Tag = (['h2', 'h3', 'h4', 'h5'] as const)[validBlock.level - 1] ?? 'h5';
      return (
        <Tag id={id} className={`scroll-mt-20 ${styles[validBlock.level] ?? styles[4]}`}>
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
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={validBlock.url}
              alt={validBlock.altText}
              loading="lazy"
              className="w-full h-auto max-h-[500px] object-cover"
            />
          </div>
          {validBlock.caption && (
            <figcaption className="font-sans text-sm text-ink-3">
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

    case 'video': {
      const src = youtubeEmbedUrl(validBlock.url);
      if (!src) return null;
      return (
        <figure className="my-8 space-y-2">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-surface-sunken">
            <iframe
              src={src}
              title={validBlock.title}
              loading="lazy"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <figcaption className="flex flex-wrap items-center gap-1.5 text-sm text-ink-3">
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            <span className="font-medium text-ink-2">{validBlock.title}</span>
            {validBlock.caption && <span>{validBlock.caption}</span>}
          </figcaption>
        </figure>
      );
    }

    case 'document': {
      // PDFs are previewed inline (the browser's own viewer); other documents open in a new tab.
      const KIND = { pdf: 'PDF', slides: 'Slides', document: 'Document', other: 'File' } as const;
      return (
        <figure className="my-8 overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <FileText className="h-5 w-5 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-ink">{validBlock.title}</div>
              <div className="text-xs text-ink-3">{KIND[validBlock.kind]}{validBlock.description ? ` · ${validBlock.description}` : ''}</div>
            </div>
            <a href={validBlock.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-xs font-semibold text-ink hover:bg-surface-muted">
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open<span className="sr-only"> {validBlock.title} (opens in a new tab)</span>
            </a>
            {validBlock.allowDownload && (
              <a href={validBlock.url} download className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
                <Download className="h-4 w-4" aria-hidden="true" /> Download
              </a>
            )}
          </div>
          {validBlock.kind === 'pdf' && (
            <iframe src={validBlock.url} title={validBlock.title} loading="lazy" referrerPolicy="no-referrer" className="h-[70vh] w-full bg-surface-sunken" />
          )}
        </figure>
      );
    }

    case 'references':
      return (
        <section className="my-10 border-t border-line pt-6">
          <h3 className="mb-3 font-display text-lg font-[560] text-ink">{validBlock.title || 'References & further reading'}</h3>
          <ul className="space-y-3">
            {validBlock.links.map((l) => (
              <li key={l.url} className="text-sm leading-relaxed text-ink-2">
                                <span>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-ink underline decoration-brand-line underline-offset-2 hover:decoration-brand">
                    {l.label}<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  {l.description && <> {l.description}</>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      );

    default:
      return (
        <div className="p-3 my-4 rounded bg-surface border border-line text-xs text-ink-3">
          (Unsupported block type)
        </div>
      );
  }
}

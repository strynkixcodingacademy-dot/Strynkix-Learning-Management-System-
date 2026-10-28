'use client';

/**
 * Strynkix Live Books — code panels.
 * A dark "ink page" inside the light book: line numbers hidden from assistive
 * tech, optional highlighted lines, copy to clipboard, and light syntax colour.
 */

import React, { useState } from 'react';
import { Copy, Check, FileCode } from 'lucide-react';
import { CodeExampleBlock } from '@/types/domain';
import { tokenizeLine, TokenKind } from './highlight';

const TOKEN_CLASS: Record<TokenKind, string> = {
  keyword: 'text-syn-keyword',
  string: 'text-syn-string',
  number: 'text-syn-number',
  comment: 'text-syn-comment italic',
  fn: 'text-syn-fn',
  plain: '',
};

export function CopyButton({ text, label = 'Copy code' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };
  return (
    <button
      onClick={handleCopy}
      type="button"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-code-muted transition-colors hover:bg-code-line hover:text-code-ink"
      aria-label={label}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-syn-string" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/** Shared dark code panel used by code examples, worked solutions and practice starters. */
export function CodePanel({
  code,
  language,
  filename,
  highlightLines = [],
  caption,
}: {
  code: string;
  language: string;
  filename?: string;
  highlightLines?: number[];
  caption?: string;
}) {
  const lines = code.replace(/\n$/, '').split('\n');
  const highlight = new Set(highlightLines);
  return (
    <figure className="my-6 overflow-hidden rounded-xl bg-code shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-code-line px-4 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-code-muted">
          <FileCode className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono">{filename || language.toLowerCase()}</span>
        </div>
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto py-3 text-[13px] leading-6 font-mono">
        <pre className="m-0">
          <code className={`block w-max min-w-full text-code-ink language-${language.toLowerCase()}`}>
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const isHighlighted = highlight.has(lineNum);
              return (
                <span
                  key={lineNum}
                  data-line={lineNum}
                  data-highlighted={isHighlighted || undefined}
                  className={`grid grid-cols-[3rem_auto] border-l-2 pr-6 ${isHighlighted ? 'border-syn-number bg-syn-highlight' : 'border-transparent'}`}
                >
                  <span aria-hidden="true" className="select-none pr-4 text-right text-code-muted/70">{lineNum}</span>
                  <span className="whitespace-pre">
                    {line ? tokenizeLine(line, language).map((t, i) => (
                      <span key={i} className={TOKEN_CLASS[t.kind]}>{t.text}</span>
                    )) : ' '}
                  </span>
                </span>
              );
            })}
          </code>
        </pre>
      </div>
      {caption && <figcaption className="border-t border-code-line px-4 py-2 text-xs text-code-muted">{caption}</figcaption>}
    </figure>
  );
}

export function CodeBlockView({ block }: { block: CodeExampleBlock }) {
  return (
    <CodePanel code={block.code} language={block.language} filename={block.filename} highlightLines={block.highlightLines} caption={block.caption} />
  );
}

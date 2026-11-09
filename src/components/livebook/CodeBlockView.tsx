'use client';

/**
 * Strynkix Live Books — code panels, typeset like good developer documentation:
 * filename tab, line numbers hidden from assistive tech, optional highlighted
 * lines, copy to clipboard, and restrained syntax colour.
 */

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
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

/** Shared code panel used by code examples, worked solutions and practice starters. */
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
    <figure className="my-7 overflow-hidden rounded-lg border border-code-line bg-code">
      <div className="flex items-center justify-between gap-3 border-b border-code-line bg-surface-muted/50 py-1 pl-4 pr-1.5">
        <span className="truncate font-mono text-xs text-code-muted">{filename || language.toLowerCase()}</span>
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto py-3.5 font-mono text-[0.8125rem] leading-[1.7]">
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
                  className={`grid grid-cols-[2.75rem_auto] pr-6 ${isHighlighted ? 'bg-syn-highlight' : ''}`}
                >
                  <span aria-hidden="true" className={`select-none pr-4 text-right ${isHighlighted ? 'text-warning-ink' : 'text-silver'}`}>{lineNum}</span>
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

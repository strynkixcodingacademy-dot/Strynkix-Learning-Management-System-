'use client';

/**
 * Strynkix LMS — Live Books Code Block Viewer
 * Zero-dependency, accessible, responsive code display with syntax highlights,
 * line numbers, copy-to-clipboard, and line emphasis.
 */

import React, { useState } from 'react';
import { Copy, Check, FileCode } from 'lucide-react';
import { CodeExampleBlock } from '@/types/domain';

interface CodeBlockViewProps {
  block: CodeExampleBlock;
}

export function CodeBlockView({ block }: CodeBlockViewProps) {
  const [copied, setCopied] = useState(false);

  const lines = block.code.split('\n');
  const highlightSet = new Set(block.highlightLines || []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(block.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code to clipboard', err);
    }
  };

  return (
    <div className="my-6 rounded-xl border border-slate-800 bg-slate-950/90 overflow-hidden shadow-2xl">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-2 text-slate-300 font-mono">
          <FileCode className="w-4 h-4 text-indigo-400" />
          <span>{block.filename || `${block.language.toLowerCase()} snippet`}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
            {block.language}
          </span>
          <button
            onClick={handleCopy}
            type="button"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs font-mono"
            aria-label="Copy code snippet"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Body */}
      <div className="p-4 overflow-x-auto text-xs sm:text-sm font-mono leading-relaxed">
        <pre className="table w-full">
          <tbody>
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const isHighlighted = highlightSet.has(lineNum);
              return (
                <tr
                  key={lineNum}
                  className={`${
                    isHighlighted ? 'bg-indigo-950/40 border-l-2 border-indigo-500' : ''
                  } hover:bg-slate-900/40 transition-colors`}
                >
                  <td className="table-cell pr-4 select-none text-right text-slate-600 w-10 text-[11px]">
                    {lineNum}
                  </td>
                  <td className="table-cell text-slate-200 whitespace-pre">{line || ' '}</td>
                </tr>
              );
            })}
          </tbody>
        </pre>
      </div>

      {/* Optional Caption */}
      {block.caption && (
        <div className="px-4 py-2 bg-slate-900/40 border-t border-slate-800/80 text-[11px] text-slate-400 italic">
          💡 {block.caption}
        </div>
      )}
    </div>
  );
}

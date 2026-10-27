'use client';

/**
 * Strynkix LMS — Live Books Hands-On Practice Task Block
 * Displays structured coding tasks, instructions, starter code, hints,
 * and expected outcomes without running insecure server sandboxes.
 */

import React, { useState } from 'react';
import { Terminal, CheckSquare, Square, Lightbulb, Target, Copy, Check } from 'lucide-react';
import { PracticeTaskBlock } from '@/types/domain';

interface PracticeTaskViewProps {
  block: PracticeTaskBlock;
}

export function PracticeTaskView({ block }: PracticeTaskViewProps) {
  const [isCompletedLocally, setIsCompletedLocally] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!block.starterCode) return;
    try {
      await navigator.clipboard.writeText(block.starterCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy starter code', err);
    }
  };

  return (
    <div className="my-8 rounded-xl border border-indigo-500/30 bg-slate-900/90 p-6 shadow-2xl space-y-5">
      {/* Title Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400 font-bold">
              Hands-On Practice Task
            </span>
            <h3 className="text-base font-bold text-white">{block.title}</h3>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsCompletedLocally(!isCompletedLocally)}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
            isCompletedLocally
              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
              : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'
          }`}
        >
          {isCompletedLocally ? (
            <>
              <CheckSquare className="w-4 h-4 text-emerald-400" />
              <span>Completed in Local Workspace</span>
            </>
          ) : (
            <>
              <Square className="w-4 h-4 text-slate-400" />
              <span>Mark as Practiced</span>
            </>
          )}
        </button>
      </div>

      {/* Instructions */}
      <div className="space-y-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
        <h4 className="font-semibold text-slate-100 flex items-center gap-1.5 text-xs uppercase tracking-wider">
          Instructions:
        </h4>
        <p className="whitespace-pre-line">{block.instructions}</p>
      </div>

      {/* Starter Code Section (If provided) */}
      {block.starterCode && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono text-[11px] uppercase">
              Starter Template ({block.language || 'code'}):
            </span>
            <button
              onClick={handleCopy}
              type="button"
              className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-mono transition"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Template</span>
                </>
              )}
            </button>
          </div>
          <div className="rounded-lg bg-slate-950 border border-slate-800 p-3 font-mono text-xs text-slate-200 overflow-x-auto">
            <pre>{block.starterCode}</pre>
          </div>
        </div>
      )}

      {/* Expected Outcome */}
      <div className="p-3.5 rounded-lg bg-indigo-950/20 border border-indigo-900/40 text-xs space-y-1">
        <div className="flex items-center gap-1.5 font-bold text-indigo-300">
          <Target className="w-4 h-4 text-indigo-400" />
          <span>Expected Outcome / Verification:</span>
        </div>
        <p className="text-slate-300">{block.expectedOutcome}</p>
      </div>

      {/* Hints Toggle */}
      {block.hints && block.hints.length > 0 && (
        <div className="pt-2 border-t border-slate-800/80">
          <button
            type="button"
            onClick={() => setShowHints(!showHints)}
            className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span>{showHints ? 'Hide Hints' : `Need guidance? Show Hints (${block.hints.length})`}</span>
          </button>
          {showHints && (
            <ul className="mt-2 space-y-1.5 pl-4 list-disc text-xs text-amber-200/90">
              {block.hints.map((hint, i) => (
                <li key={i}>{hint}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

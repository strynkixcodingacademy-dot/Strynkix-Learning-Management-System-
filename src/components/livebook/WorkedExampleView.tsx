'use client';

/**
 * Strynkix LMS — Live Books Worked Example Block
 * Displays pedagogical problem solving: problem statement, walk-through, solution, and takeaway.
 */

import React, { useState } from 'react';
import { Lightbulb, Code2, ChevronDown, ChevronUp } from 'lucide-react';
import { WorkedExampleBlock } from '@/types/domain';

interface WorkedExampleViewProps {
  block: WorkedExampleBlock;
}

export function WorkedExampleView({ block }: WorkedExampleViewProps) {
  const [isSolutionOpen, setIsSolutionOpen] = useState(true);

  return (
    <div className="my-8 rounded-xl border border-purple-900/40 bg-slate-900/90 overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="px-5 py-3 bg-purple-950/30 border-b border-purple-900/40 flex items-center justify-between">
        <div className="flex items-center gap-2 text-purple-300 font-semibold text-xs sm:text-sm">
          <Lightbulb className="w-4 h-4 text-purple-400" />
          <span>Worked Example: {block.title}</span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Problem Description */}
        <div className="space-y-1.5">
          <h4 className="text-xs uppercase font-bold tracking-wider text-slate-400">
            Problem Scenario
          </h4>
          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed bg-slate-950/60 p-3.5 rounded-lg border border-slate-800">
            {block.problem}
          </p>
        </div>

        {/* Collapsible Solution Code */}
        {block.solutionCode && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs uppercase font-bold tracking-wider text-purple-400 flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5" />
                Solution Walkthrough ({block.language || 'code'})
              </h4>
              <button
                type="button"
                onClick={() => setIsSolutionOpen(!isSolutionOpen)}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition"
              >
                {isSolutionOpen ? (
                  <>
                    <span>Collapse Code</span>
                    <ChevronUp className="w-3.5 h-3.5" />
                  </>
                ) : (
                  <>
                    <span>View Code</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
            {isSolutionOpen && (
              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-purple-200 overflow-x-auto">
                <pre>{block.solutionCode}</pre>
              </div>
            )}
          </div>
        )}

        {/* Conceptual Explanation */}
        <div className="space-y-1.5 pt-2 border-t border-slate-800">
          <h4 className="text-xs uppercase font-bold tracking-wider text-slate-400">
            Key Architectural Takeaway
          </h4>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            {block.explanation}
          </p>
        </div>
      </div>
    </div>
  );
}

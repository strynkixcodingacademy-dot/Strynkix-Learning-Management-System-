'use client';

/**
 * Strynkix LMS — Live Books Interactive Multiple-Choice Quiz Block
 * Supports self-assessment, immediate feedback, hints, and learning explanations.
 */

import React, { useState } from 'react';
import { HelpCircle, CheckCircle, XCircle, Lightbulb, RefreshCw } from 'lucide-react';
import { QuizBlock } from '@/types/domain';

interface QuizBlockViewProps {
  block: QuizBlock;
}

export function QuizBlockView({ block }: QuizBlockViewProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const isCorrect = selectedOptionId === block.correctOptionId;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOptionId) return;
    setIsSubmitted(true);
  };

  const handleReset = () => {
    setSelectedOptionId(null);
    setIsSubmitted(false);
  };

  return (
    <div className="my-8 rounded-xl border border-indigo-900/40 bg-slate-900/80 p-6 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
          <HelpCircle className="w-4 h-4" />
          <span>Knowledge Check</span>
        </div>
        {block.hint && (
          <button
            type="button"
            onClick={() => setShowHint(!showHint)}
            className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span>{showHint ? 'Hide Hint' : 'Need a Hint?'}</span>
          </button>
        )}
      </div>

      {/* Hint Alert */}
      {showHint && block.hint && (
        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-xs text-amber-200">
          💡 <strong>Hint:</strong> {block.hint}
        </div>
      )}

      {/* Question */}
      <h3 className="text-base sm:text-lg font-bold text-white leading-snug">
        {block.question}
      </h3>

      {/* Options Form */}
      <form onSubmit={handleSubmit} className="space-y-2.5 pt-2">
        {block.options.map((opt) => {
          const isSelected = selectedOptionId === opt.id;
          let optionBorder = 'border-slate-800 hover:border-slate-700 bg-slate-950/60';

          if (isSubmitted) {
            if (opt.id === block.correctOptionId) {
              optionBorder = 'border-emerald-600 bg-emerald-950/30 text-emerald-100';
            } else if (isSelected && !isCorrect) {
              optionBorder = 'border-rose-600 bg-rose-950/30 text-rose-100';
            }
          } else if (isSelected) {
            optionBorder = 'border-indigo-500 bg-indigo-950/40 text-indigo-200 ring-1 ring-indigo-500';
          }

          return (
            <label
              key={opt.id}
              className={`flex items-start gap-3 p-3.5 rounded-lg border text-sm cursor-pointer transition ${optionBorder}`}
            >
              <input
                type="radio"
                name={`quiz_${block.id}`}
                value={opt.id}
                disabled={isSubmitted}
                checked={isSelected}
                onChange={() => setSelectedOptionId(opt.id)}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="flex-1 select-none">{opt.text}</span>
              {isSubmitted && opt.id === block.correctOptionId && (
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              )}
              {isSubmitted && isSelected && !isCorrect && (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
            </label>
          );
        })}

        {/* Action Controls */}
        <div className="pt-3 flex items-center justify-between">
          {!isSubmitted ? (
            <button
              type="submit"
              disabled={!selectedOptionId}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition"
            >
              Check Answer
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try Again
            </button>
          )}
        </div>
      </form>

      {/* Explanation Banner */}
      {isSubmitted && (
        <div
          className={`p-4 rounded-lg border text-xs leading-relaxed space-y-1 ${
            isCorrect
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/30 border-rose-800 text-rose-200'
          }`}
        >
          <div className="font-bold flex items-center gap-1.5">
            {isCorrect ? '✓ Correct Answer!' : '✕ Not quite right.'}
          </div>
          <p>{block.explanation}</p>
        </div>
      )}
    </div>
  );
}

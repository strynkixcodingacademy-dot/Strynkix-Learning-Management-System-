'use client';

/**
 * Strynkix Live Books — quiz results tables (milestone G22/G23).
 * Rows come from each lesson's server-written quiz summary (progress.quiz);
 * expanding a row loads that lesson's immutable attempt history. Nothing here
 * contains or reveals an answer key.
 */

import React, { useMemo, useState } from 'react';
import { Progress, QuizAttempt } from '@/types/domain';
import { getQuizAttempts } from '@/lib/livebook/service';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/States';
import { fieldClasses } from '@/components/ui/Page';
import { cx } from '@/components/ui/tones';
import { ChevronDown, ChevronRight, CircleCheck, RotateCcw } from 'lucide-react';

export interface QuizResultRow {
  key: string;
  progress: Progress;
  lessonTitle: string;
  /** Course title (student view) or student name (staff view). */
  context: string;
}

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '–');

function Attempts({ progressId, scope }: { progressId: string; scope: { orgId: string; studentId?: string; batchId?: string } }) {
  const [attempts, setAttempts] = useState<QuizAttempt[] | null>(null);
  const [error, setError] = useState(false);
  React.useEffect(() => {
    let alive = true;
    getQuizAttempts(progressId, scope)
      .then((a) => alive && setAttempts(a))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressId]);
  if (error) return <p className="px-4 pb-3 text-xs text-danger-ink">The attempt history couldn’t be loaded.</p>;
  if (!attempts) return <p className="px-4 pb-3 text-xs text-ink-3">Loading attempts…</p>;
  if (!attempts.length) return <p className="px-4 pb-3 text-xs text-ink-3">No attempts recorded.</p>;
  return (
    <ol className="space-y-1 px-4 pb-3">
      {attempts.map((a) => (
        <li key={a.attemptNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
          <span className="font-semibold text-ink">Attempt {a.attemptNumber}</span>
          <span>{fmt(a.attemptedAt)}</span>
          <span>{a.correct}/{a.total} · {a.percent}%</span>
          {a.passed ? <StatusPill tone="success" size="sm" icon={CircleCheck}>Passed</StatusPill> : <StatusPill tone="warning" size="sm" icon={RotateCcw}>Not passed</StatusPill>}
        </li>
      ))}
    </ol>
  );
}

type SortKey = 'recent' | 'context' | 'best';

export function QuizResultsTable({ rows, contextLabel, scopeFor, emptyText, showFilters = false }: {
  rows: QuizResultRow[];
  contextLabel: string;
  scopeFor: (p: Progress) => { orgId: string; studentId?: string; batchId?: string };
  emptyText: string;
  showFilters?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [lesson, setLesson] = useState('all');
  const [status, setStatus] = useState<'all' | 'passed' | 'not_passed'>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const lessons = useMemo(() => [...new Set(rows.map((r) => r.lessonTitle))].sort(), [rows]);

  const shown = rows
    .filter((r) => lesson === 'all' || r.lessonTitle === lesson)
    .filter((r) => status === 'all' || (status === 'passed') === Boolean(r.progress.quiz?.passed))
    .sort((a, b) => sort === 'context' ? a.context.localeCompare(b.context)
      : sort === 'best' ? (b.progress.quiz?.bestPercent ?? 0) - (a.progress.quiz?.bestPercent ?? 0)
        : (b.progress.quiz?.lastAttemptAt ?? '').localeCompare(a.progress.quiz?.lastAttemptAt ?? ''));

  if (!rows.length) return <EmptyState compact illustration="inbox" title="No quiz attempts yet">{emptyText}</EmptyState>;

  return (
    <div>
      {showFilters && (
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <label className="sr-only" htmlFor="qr-lesson">Lesson</label>
          <select id="qr-lesson" value={lesson} onChange={(e) => setLesson(e.target.value)} className={cx(fieldClasses, 'h-9 w-auto py-1 text-xs')}>
            <option value="all">All lessons</option>
            {lessons.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <label className="sr-only" htmlFor="qr-status">Result</label>
          <select id="qr-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={cx(fieldClasses, 'h-9 w-auto py-1 text-xs')}>
            <option value="all">All results</option>
            <option value="passed">Passed</option>
            <option value="not_passed">Not passed yet</option>
          </select>
          <label className="sr-only" htmlFor="qr-sort">Sort</label>
          <select id="qr-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={cx(fieldClasses, 'h-9 w-auto py-1 text-xs')}>
            <option value="recent">Most recent attempt</option>
            <option value="context">{contextLabel} A–Z</option>
            <option value="best">Best score</option>
          </select>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3">
            <tr className="border-b border-line">
              <th className="px-4 py-2.5" scope="col"><span className="sr-only">Expand</span></th>
              <th className="px-2 py-2.5" scope="col">Lesson</th>
              <th className="px-2 py-2.5" scope="col">{contextLabel}</th>
              <th className="px-2 py-2.5" scope="col">Attempts</th>
              <th className="px-2 py-2.5" scope="col">Best</th>
              <th className="px-2 py-2.5" scope="col">Last</th>
              <th className="px-2 py-2.5" scope="col">Status</th>
              <th className="px-2 py-2.5" scope="col">Last attempt</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const q = r.progress.quiz!;
              const isOpen = open === r.key;
              return (
                <React.Fragment key={r.key}>
                  <tr className="border-b border-line align-middle">
                    <td className="px-4 py-2.5">
                      <button type="button" onClick={() => setOpen(isOpen ? null : r.key)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} attempts for ${r.lessonTitle}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-2 py-2.5 font-semibold text-ink">{r.lessonTitle}</td>
                    <td className="px-2 py-2.5 text-ink-2">{r.context}</td>
                    <td className="px-2 py-2.5 text-ink-2">{q.attemptCount}</td>
                    <td className="px-2 py-2.5 font-semibold text-ink">{q.bestPercent}%</td>
                    <td className="px-2 py-2.5 text-ink-2">{q.lastPercent}%</td>
                    <td className="px-2 py-2.5">
                      {q.passed ? <StatusPill tone="success" size="sm" icon={CircleCheck}>Passed</StatusPill> : <StatusPill tone="warning" size="sm" icon={RotateCcw}>Not passed yet</StatusPill>}
                    </td>
                    <td className="px-2 py-2.5 text-xs text-ink-3">{fmt(q.lastAttemptAt)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-line bg-surface-muted/50">
                      <td colSpan={8} className="pt-2"><Attempts progressId={r.progress.id} scope={scopeFor(r.progress)} /></td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!shown.length && <p className="p-4 text-center text-sm text-ink-3">No results match these filters.</p>}
    </div>
  );
}

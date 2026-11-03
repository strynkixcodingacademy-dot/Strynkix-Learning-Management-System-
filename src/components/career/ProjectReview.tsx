'use client';

/**
 * Project review for a portfolio entry (student side): status, "Verified by
 * instructor" only after an authorized instructor approved it, submit for
 * review with the related course, and the review history.
 */

import React, { useState } from 'react';
import { careerApi } from '@/lib/academy/api';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import type { PortfolioEntry } from '@/types/academy';
import { Button } from '@/components/ui/Button';
import { fieldClasses } from '@/components/ui/Page';
import { StatusPill } from '@/components/ui/StatusPill';
import type { Tone } from '@/components/ui/tones';
import { BadgeCheck } from 'lucide-react';

export const REVIEW_LABEL: Record<string, string> = { draft: 'Draft', submitted: 'Submitted for review', under_review: 'Under review', changes_requested: 'Changes requested', approved: 'Approved' };
export const REVIEW_TONE: Record<string, Tone> = { draft: 'neutral', submitted: 'brand', under_review: 'teal', changes_requested: 'warning', approved: 'success' };

export function ReviewHistory({ entryId }: { entryId: string }) {
  const [rows, setRows] = useState<{ id: string; authorName: string; toStatus: string; body: string; createdAt: string }[] | null>(null);
  if (!rows) return <button type="button" className="text-xs font-semibold text-brand-ink" onClick={async () => setRows((await careerApi<{ reviews: { id: string; authorName: string; toStatus: string; body: string; createdAt: string }[] }>({ action: 'project_reviews', entryId })).reviews)}>Show review history</button>;
  return <ul className="space-y-1 text-xs text-ink-2">{rows.length === 0 ? <li>No review activity yet.</li> : rows.map((r) => <li key={r.id}>{formatWhen(r.createdAt)} · {r.authorName} · {REVIEW_LABEL[r.toStatus] ?? r.toStatus}{r.body ? ` — “${r.body}”` : ''}</li>)}</ul>;
}

export function ProjectReview({ entry, courses, onChanged }: { entry: PortfolioEntry; courses: { courseId: string; title: string }[]; onChanged: () => void }) {
  const status = entry.reviewStatus ?? 'draft';
  const [courseId, setCourseId] = useState(entry.courseId ?? courses[0]?.courseId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-line p-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill size="sm" tone={REVIEW_TONE[status]}>{REVIEW_LABEL[status]}</StatusPill>
        {entry.verified && <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-ink"><BadgeCheck className="h-4 w-4" /> Verified by {entry.verifiedByName ?? 'an instructor'}</span>}
      </div>
      {(status === 'draft' || status === 'changes_requested') && courses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Course for review" value={courseId} onChange={(e) => setCourseId(e.target.value)} className={`${fieldClasses} w-auto py-1.5`}>{courses.map((c) => <option key={c.courseId} value={c.courseId}>{c.title}</option>)}</select>
          <Button size="sm" variant="secondary" loading={busy} onClick={async () => { setBusy(true); setError(null); try { await careerApi({ action: 'submit_project', entryId: entry.id, courseId }); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{status === 'changes_requested' ? 'Resubmit for review' : 'Submit for instructor review'}</Button>
        </div>
      )}
      {error && <p className="text-xs text-danger-ink" role="alert">{error}</p>}
      {status !== 'draft' && <ReviewHistory entryId={entry.id} />}
      {status === 'approved' && <p className="text-[11px] text-ink-3">Editing the project’s title, description or links sends it back to draft for a new review.</p>}
    </div>
  );
}

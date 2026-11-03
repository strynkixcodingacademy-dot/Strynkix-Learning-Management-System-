'use client';

/**
 * Strynkix LMS — project reviews for instructors and managers: projects
 * students submitted for their batches, with links, review history and the
 * actions to start a review, request changes or approve. Approval is what
 * marks a project "Verified by instructor".
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { careerApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import type { PortfolioEntry } from '@/types/academy';
import { REVIEW_LABEL, REVIEW_TONE, ReviewHistory } from '@/components/career/ProjectReview';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';

type Row = PortfolioEntry & { studentName: string };

function Reviewer({ p, onDone }: { p: Row; onDone: (msg: string) => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: 'start' | 'changes' | 'approve') => {
    setBusy(true); setError(null);
    try { await careerApi({ action: 'review_project', entryId: p.id, decision, ...(comment.trim() ? { comment: comment.trim() } : {}) }); onDone(decision === 'approve' ? `Approved “${p.title}”.` : decision === 'changes' ? `Asked for changes on “${p.title}”.` : `Review started for “${p.title}”.`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <Field label="Comment for the student" htmlFor={`rc-${p.id}`} hint="Required when asking for changes."><textarea id={`rc-${p.id}`} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} className={fieldClasses} /></Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        {p.reviewStatus === 'submitted' && <Button size="sm" variant="ghost" loading={busy} onClick={() => decide('start')}>Start review</Button>}
        <Button size="sm" variant="secondary" disabled={busy || !comment.trim()} onClick={() => decide('changes')}>Request improvements</Button>
        <Button size="sm" variant="success" disabled={busy} onClick={() => decide('approve')}>Approve (verified)</Button>
      </div>
      <p className="text-[11px] text-ink-3">Approve only after you have opened and checked the repository or demo. Approval shows as “Verified by {'{your name}'}” on the student’s portfolio.</p>
    </div>
  );
}

function Queue() {
  const [status, setStatus] = useState('');
  const { data, error, reload } = useApiData(status, () => careerApi<{ projects: Row[] }>({ action: 'project_queue', ...(status ? { status } : {}) }));
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  return (
    <div className="space-y-6">
      <PageHeader title="Project reviews" description="Projects your students submitted for review. Check the work, comment, request improvements or approve." />
      <Field label="Show" htmlFor="pq-st"><select id="pq-st" value={status} onChange={(e) => setStatus(e.target.value)} className={`${fieldClasses} max-w-xs`}><option value="">Waiting for review</option><option value="changes_requested">Changes requested</option><option value="approved">Approved</option></select></Field>
      {msg && <Notice kind="success">{msg}</Notice>}
      {!data ? <LoadingState label="Loading projects…" /> : data.projects.length === 0 ? <EmptyState title="Nothing to review">Submitted projects from your batches appear here.</EmptyState> : (
        <ul className="space-y-3">{data.projects.map((p) => (
          <li key={p.id}><Card className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2"><span className="font-bold text-ink">{p.title}</span><StatusPill size="sm" tone={REVIEW_TONE[p.reviewStatus ?? 'draft']}>{REVIEW_LABEL[p.reviewStatus ?? 'draft']}</StatusPill><span className="ml-auto text-xs text-ink-3"><Link href={`/dashboard/people/${p.studentId}`} className="hover:underline">{p.studentName}</Link> · submitted {formatWhen(p.submittedAt)}</span></div>
            <p className="whitespace-pre-wrap text-sm text-ink-2">{p.description}</p>
            {p.technologies.length > 0 && <p className="text-xs text-ink-3">{p.technologies.join(' · ')}</p>}
            <div className="flex flex-wrap gap-3 text-sm">{p.repoUrl && <a href={p.repoUrl} target="_blank" rel="noopener noreferrer" className="text-brand-ink underline">Repository</a>}{p.liveUrl && <a href={p.liveUrl} target="_blank" rel="noopener noreferrer" className="text-brand-ink underline">Live demo</a>}</div>
            <ReviewHistory entryId={p.id} />
            {['submitted', 'under_review'].includes(p.reviewStatus ?? '') && <Reviewer p={p} onDone={(m) => { setMsg(m); reload(); }} />}
          </Card></li>
        ))}</ul>
      )}
    </div>
  );
}

export default function ProjectReviewPage() {
  return <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor']}><AppShell><Queue /></AppShell></RequireRole>;
}

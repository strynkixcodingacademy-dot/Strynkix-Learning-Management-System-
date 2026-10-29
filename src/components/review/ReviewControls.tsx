'use client';

/**
 * Strynkix LMS — review and publication controls for a course or lesson
 * (Stage C2). Shows where the content is in its lifecycle and the actions the
 * signed-in user may take. Which actions appear is decided by the same pure
 * workflow the server runs, so hidden buttons match refusals; the server
 * route remains the authority.
 */

import React, { useState } from 'react';
import { Archive, CheckCircle2, CircleDot, History, MessageSquareWarning, PencilLine, Send, Undo2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { AuditEntry, ContentAction, Course, UserProfile } from '@/types/domain';
import { MIN_REASON_LENGTH } from '@/types/validation';
import { ReviewError, ReviewTarget, planContentAction, reviewStateOf } from '@/lib/review/workflow';
import { getContentHistory, performContentAction } from '@/lib/courses/service';
import { ApiError } from '@/lib/api/authed';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { Notice } from '@/components/ui/States';
import { Tone } from '@/components/ui/tones';

type Availability = 'yes' | 'needs_reason' | 'no';

const LABEL: Record<ContentAction, string> = {
  submit: 'Submit for review',
  reopen: 'Reopen for editing',
  approve: 'Approve',
  request_changes: 'Request changes',
  publish: 'Publish',
  unpublish: 'Unpublish',
  archive: 'Archive',
};

const ORDER: ContentAction[] = ['submit', 'approve', 'request_changes', 'reopen', 'publish', 'unpublish', 'archive'];

function lifecycle(target: ReviewTarget): { label: string; tone: Tone; icon: typeof CircleDot } {
  if (target.status === 'published') {
    const rev = target.revision ? reviewStateOf(target.revision) : null;
    const suffix = rev === null ? '' : rev === 'none' ? ' · revision draft' : ` · revision ${rev.replace('_', ' ')}`;
    return { label: `Published${suffix}`, tone: 'success', icon: CheckCircle2 };
  }
  if (target.status === 'archived') return { label: 'Archived', tone: 'neutral', icon: Archive };
  switch (reviewStateOf(target)) {
    case 'in_review': return { label: 'In review', tone: 'brand', icon: Send };
    case 'changes_requested': return { label: 'Changes requested', tone: 'warning', icon: MessageSquareWarning };
    case 'approved': return { label: 'Approved', tone: 'teal', icon: CheckCircle2 };
    default: return { label: 'Draft', tone: 'neutral', icon: PencilLine };
  }
}

/** True when content can't be edited until it is reopened (mirrors firestore.rules). */
export function isFrozenForReview(target: Pick<ReviewTarget, 'review'>): boolean {
  const s = reviewStateOf(target);
  return s === 'in_review' || s === 'approved';
}

export function ReviewControls({
  target,
  course,
  keyUpdatedById,
  compact = false,
  onChanged,
}: {
  target: ReviewTarget;
  course: Pick<Course, 'id' | 'orgId' | 'status'>;
  keyUpdatedById?: string;
  compact?: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const { profile, user } = useAuth();
  const [pending, setPending] = useState<ContentAction | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditEntry[] | null>(null);

  const actor = profile && user ? ({ ...profile, id: user.uid } as UserProfile) : null;
  const availability = (action: ContentAction): Availability => {
    try {
      planContentAction({ actor, target, course, keyUpdatedById, action, comment: 'x', nowIso: new Date().toISOString() });
      return 'yes';
    } catch (err) {
      return err instanceof ReviewError && err.code === 'reason_required' ? 'needs_reason' : 'no';
    }
  };
  const actions = ORDER.map((a) => [a, availability(a)] as const).filter(([, v]) => v !== 'no');
  const state = lifecycle(target);
  const needsText = (a: ContentAction) => a === 'request_changes' || (a === 'publish' && availability('publish') === 'needs_reason');
  const asksText = (a: ContentAction) => needsText(a) || a === 'approve' || a === 'unpublish' || a === 'archive';

  const run = async (action: ContentAction, input?: string) => {
    setBusy(true);
    setError(null);
    try {
      const textField = action === 'publish' || action === 'unpublish' || action === 'archive' ? 'reason' : 'comment';
      await performContentAction({ targetType: target.type, targetId: target.id, action, ...(input ? { [textField]: input } : {}) });
      setPending(null);
      setText('');
      if (history) setHistory(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'This action is unavailable right now. Try again later.');
    } finally {
      setBusy(false);
    }
  };

  const start = (action: ContentAction) => {
    setError(null);
    if (asksText(action)) {
      setPending(action);
      setText('');
    } else {
      void run(action);
    }
  };

  const toggleHistory = async () => {
    if (history) return setHistory(null);
    try {
      setHistory(await getContentHistory({ orgId: target.orgId, courseId: target.courseId, targetId: target.id }));
    } catch {
      setError('The review history couldn’t be loaded.');
    }
  };

  const minLength = pending === 'publish' && needsText('publish') ? MIN_REASON_LENGTH : pending === 'request_changes' ? 1 : 0;
  const prompt = pending === 'request_changes' ? 'What needs to change? (required)'
    : pending === 'publish' ? `This content isn’t approved. Reason for publishing anyway (at least ${MIN_REASON_LENGTH} characters, recorded in the audit log)`
      : pending === 'approve' ? 'Note for the author (optional)'
        : 'Reason (optional, recorded in the audit log)';

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-1.5' : 'space-y-2'}>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill tone={state.tone} icon={state.icon} size={compact ? 'sm' : 'md'}>{state.label}</StatusPill>
        {actions.map(([a, v]) => (
          <Button key={a} size="sm" variant={a === 'publish' ? 'success' : a === 'archive' || a === 'request_changes' ? 'danger' : 'secondary'}
            disabled={busy} onClick={() => start(a)} aria-pressed={pending === a}>
            {a === 'publish' && v === 'needs_reason' ? 'Publish without approval…' : a === 'reopen' && reviewStateOf(target) === 'in_review' ? 'Withdraw from review' : LABEL[a]}
          </Button>
        ))}
        {!compact && (
          <Button size="sm" variant="ghost" icon={<History className="h-3.5 w-3.5" />} onClick={toggleHistory}>{history ? 'Hide history' : 'History'}</Button>
        )}
      </div>

      {!compact && target.review?.comment && target.status === 'draft' && (
        <p className="text-xs text-ink-2"><strong>Reviewer note:</strong> {target.review.comment}</p>
      )}

      {pending && (
        <form className="w-full space-y-2 rounded-xl border border-line bg-surface p-3" onSubmit={(e) => { e.preventDefault(); void run(pending, text.trim() || undefined); }}>
          <label className="block text-xs font-semibold text-ink-2" htmlFor={`review-text-${target.id}`}>{prompt}</label>
          <textarea id={`review-text-${target.id}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={pending === 'request_changes' || pending === 'approve' ? 2000 : 1000}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink" />
          <div className="flex gap-2">
            <Button size="sm" type="submit" loading={busy} disabled={text.trim().length < minLength}>{LABEL[pending]}</Button>
            <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {error && <Notice kind="error" className="w-full">{error}</Notice>}

      {history && (
        <ol className="w-full space-y-1 rounded-xl border border-line bg-surface-muted p-3 text-xs text-ink-2">
          {history.length === 0 && <li>No review activity yet.</li>}
          {history.map((h, i) => (
            <li key={i}>
              <strong>{h.action.replace('_', ' ')}</strong>{h.override ? ' (override)' : ''} · {(h.at as { toDate?: () => Date } | null)?.toDate?.().toLocaleString() ?? 'just now'}
              {h.comment ? ` — ${h.comment}` : ''}{h.reason ? ` — reason: ${h.reason}` : ''}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

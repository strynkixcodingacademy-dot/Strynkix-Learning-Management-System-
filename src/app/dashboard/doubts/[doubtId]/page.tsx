'use client';

/** Strynkix LMS — one doubt: the question, the full discussion history, replies and status changes. */

import React, { Suspense, use, useState } from 'react';
import { AppShell, ROLE_LABELS } from '@/components/dashboard/AppShell';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { doubtsApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { DOUBT_STATUS_LABEL } from '@/components/engagement/types';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import type { UserRole } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { cx } from '@/components/ui/tones';
import type { Tone } from '@/components/ui/tones';

const TONE: Record<string, Tone> = { open: 'brand', assigned: 'info', in_progress: 'teal', waiting_for_student: 'warning', resolved: 'success' };
interface Detail {
  doubt: { id: string; title: string; body: string; references: string[]; courseTitle: string; lessonTitle: string | null; studentId: string; studentName: string; status: string; priority: string; assignedToId: string | null; assignedToName: string | null; createdAt: string };
  messages: { id: string; kind: 'message' | 'status'; body: string; authorId: string; authorName: string; authorRole: UserRole; fromStatus?: string; toStatus?: string; createdAt: string }[];
  isStudent: boolean; isStaff: boolean; instructors: { id: string; name: string }[];
}

function Thread({ id }: { id: string }) {
  const { data, error, reload } = useApiData(id, () => doubtsApi<Detail>({ action: 'get', doubtId: id }));
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading the discussion…" />;
  const d = data.doubt;
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setMsg(null);
    try { await doubtsApi({ doubtId: id, ...body }); setReply(''); reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const resolved = d.status === 'resolved';
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader breadcrumbs={[{ label: 'Doubts', href: '/dashboard/doubts' }, { label: d.title }]} title={d.title}
        description={`${d.courseTitle}${d.lessonTitle ? ` · ${d.lessonTitle}` : ''} · asked by ${data.isStudent ? 'you' : d.studentName} · ${formatWhen(d.createdAt)}`}
        actions={<><StatusPill tone={TONE[d.status]}>{DOUBT_STATUS_LABEL[d.status]}</StatusPill>{d.priority === 'high' && <StatusPill tone="coral">Urgent</StatusPill>}</>} />
      <div className="space-y-2"><p className="whitespace-pre-wrap font-reading text-[1.0625rem] leading-relaxed text-ink">{d.body}</p>{d.references.length > 0 && <ul className="text-sm">{d.references.map((r) => <li key={r}><a href={r} target="_blank" rel="noopener noreferrer" className="text-brand-ink underline">{r}</a></li>)}</ul>}</div>
      <ol className="space-y-2" aria-label="Discussion">{data.messages.map((m) => m.kind === 'status' ? (
        <li key={m.id} className="text-center text-xs text-ink-3">{m.authorName} {m.toStatus && m.fromStatus !== m.toStatus ? `changed the status to “${DOUBT_STATUS_LABEL[m.toStatus]}”` : ''}{m.body ? ` — ${m.body}` : ''} · {formatWhen(m.createdAt)}</li>
      ) : (
        <li key={m.id} className={cx('rounded-lg p-3.5 text-sm', m.authorId === d.studentId ? 'border border-line bg-surface' : 'bg-brand-soft/60')}>
          <div className="mb-1 text-xs text-ink-3"><span className="font-medium text-ink">{m.authorName}</span>, {m.authorId === d.studentId ? 'Student' : ROLE_LABELS[m.authorRole]}, {formatWhen(m.createdAt)}</div>
          <p className="whitespace-pre-wrap text-ink">{m.body}</p>
        </li>
      ))}</ol>
      {msg && <Notice kind="error">{msg}</Notice>}
      {resolved ? (
        <Card className="flex flex-wrap items-center gap-3 p-4"><span className="text-sm text-ink-2">This doubt is resolved.</span><Button size="sm" variant="secondary" loading={busy} onClick={() => act({ action: 'set_status', status: 'reopen' })}>Reopen</Button></Card>
      ) : (
        <Card className="space-y-3 p-4">
          <Field label={data.isStudent ? 'Reply' : 'Reply to the student'} htmlFor="reply"><textarea id="reply" rows={4} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)} className={fieldClasses} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} disabled={reply.trim().length < 2} onClick={() => act({ action: 'reply', body: reply.trim() })}>Send reply</Button>
            {data.isStudent && <Button variant="success" disabled={busy} onClick={() => act({ action: 'set_status', status: 'resolved' })}>My doubt is resolved</Button>}
            {data.isStaff && <>
              <Button variant="secondary" disabled={busy || reply.trim().length < 2} onClick={async () => { await act({ action: 'reply', body: reply.trim() }); await act({ action: 'set_status', status: 'waiting_for_student', note: 'Waiting for the student’s answer' }); }}>Reply and ask for clarification</Button>
              <Button variant="success" disabled={busy} onClick={() => act({ action: 'set_status', status: 'resolved' })}>Mark resolved</Button>
            </>}
          </div>
          {data.isStaff && data.instructors.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <Field label="Assign to" htmlFor="assign"><select id="assign" defaultValue={d.assignedToId ?? ''} onChange={(e) => e.target.value && act({ action: 'assign', instructorId: e.target.value })} className={fieldClasses}><option value="">Not assigned</option>{data.instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
              {d.status !== 'in_progress' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act({ action: 'set_status', status: 'in_progress' })}>Mark in progress</Button>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Content({ params }: { params: Promise<{ doubtId: string }> }) {
  const { doubtId } = use(params);
  return <RequireAuth><AppShell><Thread id={doubtId} /></AppShell></RequireAuth>;
}

export default function DoubtPage(props: Parameters<typeof Content>[0]) {
  return <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}><Content {...props} /></Suspense>;
}

'use client';

/**
 * Strynkix LMS — Doubts. Students ask questions about their courses and follow
 * the answers; instructors and managers see the doubts of their batches and
 * branch, filter them and respond. Never visible across academies.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { doubtsApi, studentApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { getCourseWithCurriculum } from '@/lib/livebook/service';
import { DOUBT_STATUS_LABEL } from '@/components/engagement/types';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import type { Tone } from '@/components/ui/tones';

interface Row { id: string; title: string; courseTitle: string; lessonTitle: string | null; studentName: string; status: string; priority: string; assignedToName: string | null; messageCount: number; lastActivityAt: string; createdAt: string }
const STATUS_TONE: Record<string, Tone> = { open: 'brand', assigned: 'lavender', in_progress: 'teal', waiting_for_student: 'warning', resolved: 'success' };

function Ask({ onCreated }: { onCreated: (id: string) => void }) {
  const { tenant } = useAuth();
  const courses = useApiData('ask-courses', () => studentApi<{ courses: { courseId: string; title: string; enrollmentStatus: string }[] }>({ action: 'courses' }));
  const [courseId, setCourseId] = useState('');
  const [lessons, setLessons] = useState<{ id: string; title: string }[]>([]);
  const [lessonId, setLessonId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [refs, setRefs] = useState('');
  const [priority, setPriority] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = (courses.data?.courses ?? []).filter((c) => c.enrollmentStatus === 'active');
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-sm font-bold text-ink">Ask a doubt</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Course" htmlFor="dq-course" required><select id="dq-course" value={courseId} onChange={async (e) => { setCourseId(e.target.value); setLessonId(''); const c = tenant && e.target.value ? await getCourseWithCurriculum(e.target.value, tenant.orgId).catch(() => null) : null; setLessons(c?.lessons.map((l) => ({ id: l.id, title: l.title })) ?? []); }} className={fieldClasses}><option value="">Choose</option>{active.map((c) => <option key={c.courseId} value={c.courseId}>{c.title}</option>)}</select></Field>
        <Field label="Lesson (optional)" htmlFor="dq-lesson"><select id="dq-lesson" value={lessonId} disabled={!lessons.length} onChange={(e) => setLessonId(e.target.value)} className={fieldClasses}><option value="">Not about a specific lesson</option>{lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></Field>
        <Field label="Priority" htmlFor="dq-pri"><select id="dq-pri" value={priority} onChange={(e) => setPriority(e.target.value)} className={fieldClasses}><option value="normal">Normal</option><option value="high">Urgent (blocking my work)</option></select></Field>
      </div>
      <Field label="Short title" htmlFor="dq-title" required><input id="dq-title" value={title} maxLength={150} placeholder="e.g. Why does my fetch call return undefined?" onChange={(e) => setTitle(e.target.value)} className={fieldClasses} /></Field>
      <Field label="Explain your doubt" htmlFor="dq-body" required hint="Say what you tried and what happened. Paste error messages or code."><textarea id="dq-body" rows={5} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} className={fieldClasses} /></Field>
      <Field label="Reference links (optional, one per line)" htmlFor="dq-refs" hint="e.g. a GitHub link to your code. File uploads aren’t available yet."><textarea id="dq-refs" rows={2} value={refs} onChange={(e) => setRefs(e.target.value)} className={fieldClasses} /></Field>
      {error && <Notice kind="error">{error}</Notice>}
      <Button loading={busy} disabled={!courseId || title.trim().length < 5 || body.trim().length < 10} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const r = await doubtsApi<{ doubtId: string }>({ action: 'create', courseId, ...(lessonId ? { lessonId } : {}), title: title.trim(), body: body.trim(), priority, references: refs.split('\n').map((x) => x.trim()).filter(Boolean) });
          onCreated(r.doubtId);
        } catch (e) { setError((e as Error).message); setBusy(false); }
      }}>Ask your instructors</Button>
    </Card>
  );
}

function Doubts() {
  const { tenant } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [asking, setAsking] = useState(false);
  const { data, error, reload } = useApiData(`${status}|${priority}`, () => doubtsApi<{ doubts: Row[]; canManage: boolean }>({ action: 'list', ...(status ? { status } : {}), ...(priority ? { priority } : {}) }));
  const student = tenant?.role === 'student';
  return (
    <div className="space-y-6">
      <PageHeader title={student ? 'My doubts' : 'Student doubts'} description={student ? 'Ask your instructors anything about your course. Only you, your instructors and your branch staff can see your questions.' : 'Questions from students in your batches and branch. Reply, ask for clarification, and mark them resolved.'}
        actions={student && !asking ? <Button onClick={() => setAsking(true)}>Ask a doubt</Button> : undefined} />
      {student && asking && <Ask onCreated={(id) => router.push(`/dashboard/doubts/${id}`)} />}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Status" htmlFor="dl-st"><select id="dl-st" value={status} onChange={(e) => setStatus(e.target.value)} className={fieldClasses}><option value="">All</option>{Object.entries(DOUBT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {!student && <Field label="Priority" htmlFor="dl-pr"><select id="dl-pr" value={priority} onChange={(e) => setPriority(e.target.value)} className={fieldClasses}><option value="">All</option><option value="high">Urgent</option><option value="normal">Normal</option></select></Field>}
      </div>
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Loading doubts…" /> : data.doubts.length === 0 ? <EmptyState title="No doubts here">{student ? 'Questions you ask appear here with your instructors’ answers.' : 'No questions from your students match these filters.'}</EmptyState> : (
        <ul className="space-y-2">{data.doubts.map((d) => (
          <li key={d.id}><Link href={`/dashboard/doubts/${d.id}`}><Card interactive className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1"><div className="font-bold text-ink">{d.title}</div><div className="text-xs text-ink-3">{d.courseTitle}{d.lessonTitle ? ` · ${d.lessonTitle}` : ''}{!student ? ` · ${d.studentName}` : ''}{d.assignedToName ? ` · assigned to ${d.assignedToName}` : ''} · {d.messageCount} repl{d.messageCount === 1 ? 'y' : 'ies'} · {formatWhen(d.lastActivityAt)}</div></div>
            {d.priority === 'high' && <StatusPill size="sm" tone="danger">Urgent</StatusPill>}
            <StatusPill size="sm" tone={STATUS_TONE[d.status]}>{DOUBT_STATUS_LABEL[d.status]}</StatusPill>
          </Card></Link></li>
        ))}</ul>
      )}
    </div>
  );
}

export default function DoubtsPage() {
  return <RequireAuth><AppShell><Doubts /></AppShell></RequireAuth>;
}

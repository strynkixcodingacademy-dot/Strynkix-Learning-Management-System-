'use client';

/**
 * Strynkix LMS — Feedback.
 * Students: give feedback on their courses, lessons, submitted assignments,
 * teaching, materials, facilities and overall experience; correct it within
 * the allowed window; see staff responses. Staff: summaries for their scope
 * (averages only with enough responses; themes from chosen tags) and the
 * written comments they are allowed to read.
 */

import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { feedbackApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { getCourseWithCurriculum } from '@/lib/livebook/service';
import { formatDate } from '@/lib/academy/format';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs } from '@/components/ui/Tabs';
import { cx } from '@/components/ui/tones';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Star } from 'lucide-react';

const TARGET_LABEL: Record<string, string> = { course: 'A course', lesson: 'A lesson', assignment: 'An assignment', teaching: 'Teaching in my batch', materials: 'Learning materials', facilities: 'Branch facilities', overall: 'Overall experience' };
const RATED = ['course', 'lesson', 'teaching', 'materials', 'facilities', 'overall'];

interface Eligible { courses: { id: string; title: string }[]; batches: { id: string; name: string; instructors: string[] }[]; assignments: { id: string; title: string }[]; branchId: string | null; orgId: string; tags: { positive: string[]; improve: string[] }; minResponses: number }
interface Mine { id: string; targetId: string; targetType: string; targetLabel: string; rating: number | null; comment: string; suggestion: string; tags: string[]; anonymous: boolean; status: string; staffNote?: string; submittedAt: string; editCount: number }

function Stars({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onChange(n)} className="rounded p-0.5">
          <Star className={cx('h-7 w-7', n <= value ? 'fill-warning text-warning' : 'text-ink-4')} />
        </button>
      ))}
    </div>
  );
}

function GiveFeedback({ el, onDone, preset }: { el: Eligible; onDone: () => void; preset?: Mine }) {
  const { tenant } = useAuth();
  const [type, setType] = useState(preset?.targetType ?? 'course');
  const [targetId, setTargetId] = useState('');
  const [courseForLesson, setCourseForLesson] = useState('');
  const [lessons, setLessons] = useState<{ id: string; title: string }[]>([]);
  const [rating, setRating] = useState(preset?.rating ?? 0);
  const [comment, setComment] = useState(preset?.comment ?? '');
  const [suggestion, setSuggestion] = useState(preset?.suggestion ?? '');
  const [tags, setTags] = useState<string[]>(preset?.tags ?? []);
  const [anonymous, setAnonymous] = useState(preset?.anonymous ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const options = type === 'course' || type === 'materials' ? el.courses.map((c) => ({ id: c.id, label: c.title }))
    : type === 'assignment' ? el.assignments.map((a) => ({ id: a.id, label: a.title }))
      : type === 'teaching' ? el.batches.map((b) => ({ id: b.id, label: `${b.name}${b.instructors.length ? ` — ${b.instructors.join(', ')}` : ''}` }))
        : type === 'lesson' ? lessons.map((l) => ({ id: l.id, label: l.title })) : [];
  const fixedTarget = type === 'facilities' ? el.branchId : type === 'overall' ? el.orgId : null;
  const tagButton = (t: string) => (
    <button key={t} type="button" aria-pressed={tags.includes(t)} onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))} className={cx('rounded-full border px-2.5 py-1 text-xs font-semibold', tags.includes(t) ? 'border-brand bg-brand text-white' : 'border-line text-ink-2')}>{t}</button>
  );
  return (
    <Card className="space-y-4 p-5">
      {!preset && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What is your feedback about?" htmlFor="fb-type"><select id="fb-type" value={type} onChange={(e) => { setType(e.target.value); setTargetId(''); }} className={fieldClasses}>{Object.entries(TARGET_LABEL).filter(([k]) => k !== 'facilities' || el.branchId).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {type === 'lesson' && (
            <Field label="Course" htmlFor="fb-lc"><select id="fb-lc" value={courseForLesson} onChange={async (e) => { setCourseForLesson(e.target.value); setTargetId(''); const c = tenant ? await getCourseWithCurriculum(e.target.value, tenant.orgId).catch(() => null) : null; setLessons(c?.lessons.map((l) => ({ id: l.id, title: l.title })) ?? []); }} className={fieldClasses}><option value="">Choose a course</option>{el.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
          )}
          {!fixedTarget && (type !== 'lesson' || courseForLesson) && (
            <Field label="Which one?" htmlFor="fb-target"><select id="fb-target" value={targetId} onChange={(e) => setTargetId(e.target.value)} className={fieldClasses}><option value="">Choose</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
          )}
        </div>
      )}
      {!preset && !fixedTarget && options.length === 0 && type !== 'lesson' && <p className="text-sm text-ink-3">Nothing to choose here yet{type === 'assignment' ? ' — you can give feedback on an assignment after submitting it' : ''}.</p>}
      {RATED.includes(type) ? <div><div className="mb-1 text-sm font-semibold text-ink-2">Your rating</div><Stars value={rating} onChange={setRating} label="Rating" /></div> : null}
      <div className="space-y-2">
        <div className="text-sm font-semibold text-ink-2">What went well? <span className="font-normal text-ink-3">(optional)</span></div>
        <div className="flex flex-wrap gap-1.5">{el.tags.positive.map(tagButton)}</div>
        <div className="text-sm font-semibold text-ink-2">What could be better? <span className="font-normal text-ink-3">(optional)</span></div>
        <div className="flex flex-wrap gap-1.5">{el.tags.improve.map(tagButton)}</div>
      </div>
      <Field label="Your comments" htmlFor="fb-comment"><textarea id="fb-comment" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} className={fieldClasses} /></Field>
      <Field label="Suggestion (optional)" htmlFor="fb-sug"><input id="fb-sug" maxLength={1000} value={suggestion} onChange={(e) => setSuggestion(e.target.value)} className={fieldClasses} /></Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        <span><strong>Hide my name from staff.</strong> Instructors and managers will see your feedback without your name. This is not fully anonymous: the system still records that you sent it, so you can’t submit twice and misuse can be investigated.</span></label>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Button loading={busy} disabled={(!preset && !fixedTarget && !targetId) || (RATED.includes(type) && !rating)} onClick={async () => {
        setBusy(true); setMsg(null);
        try {
          const r = await feedbackApi<{ corrected: boolean; editsLeft: number }>({ action: 'submit', targetType: type, targetId: preset ? preset.targetId : fixedTarget ?? targetId, rating: rating || null, comment, suggestion, tags, anonymous });
          setMsg({ kind: 'success', text: r.corrected ? `Correction saved (${r.editsLeft} corrections left).` : 'Thank you — your feedback was sent.' });
          onDone();
        } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
      }}>{preset ? 'Save correction' : 'Send feedback'}</Button>
    </Card>
  );
}

function StudentFeedback() {
  const el = useApiData('fb-el', () => feedbackApi<Eligible>({ action: 'eligible' }));
  const mine = useApiData('fb-mine', () => feedbackApi<{ feedback: Mine[]; editDays: number; maxEdits: number }>({ action: 'mine' }));
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<'give' | 'mine'>('give');
  const [editing, setEditing] = useState<string | null>(null);
  if (el.error || mine.error) return <ErrorState onRetry={() => { el.reload(); mine.reload(); }}>{el.error ?? mine.error}</ErrorState>;
  if (!el.data || !mine.data) return <LoadingState label="Loading…" />;
  const canEdit = (f: Mine) => f.status === 'submitted' && f.editCount < mine.data!.maxEdits && now - Date.parse(f.submittedAt) < mine.data!.editDays * 86400_000;
  return (
    <div className="space-y-6">
      <PageHeader title="Feedback" description="Tell your academy what works and what doesn’t. Your feedback goes to the staff responsible; it is never shown publicly." />
      <Tabs idPrefix="fb" label="Feedback" value={tab} onChange={setTab} items={[{ id: 'give', label: 'Give feedback' }, { id: 'mine', label: 'My feedback', count: mine.data.feedback.length }]} />
      {tab === 'give' ? <GiveFeedback el={el.data} onDone={mine.reload} /> : mine.data.feedback.length === 0 ? <EmptyState title="No feedback yet">Feedback you send appears here.</EmptyState> : (
        <ul className="space-y-3">{mine.data.feedback.map((f) => (
          <li key={f.id}><Card className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{f.targetLabel}</span>{f.rating ? <span className="text-sm text-warning-ink">{'★'.repeat(f.rating)}</span> : null}<StatusPill size="sm" tone={f.status === 'submitted' ? 'neutral' : 'success'}>{f.status === 'submitted' ? 'Sent' : f.status === 'acknowledged' ? 'Read by staff' : 'Acted on'}</StatusPill>{f.anonymous && <span className="text-xs text-ink-3">Name hidden from staff</span>}<span className="ml-auto text-xs text-ink-3">{formatDate(f.submittedAt)}</span></div>
            {f.comment && <p className="text-sm text-ink-2">{f.comment}</p>}
            {f.staffNote && <Notice kind="info">Staff response: {f.staffNote}</Notice>}
            {canEdit(f) ? (editing === f.id ? <GiveFeedback el={el.data!} preset={f} onDone={() => { setEditing(null); mine.reload(); }} /> : <Button size="sm" variant="ghost" onClick={() => setEditing(f.id)}>Correct it</Button>)
              : <p className="text-xs text-ink-3">{f.status !== 'submitted' ? 'Staff have responded, so it can no longer be changed.' : `Corrections are allowed for ${mine.data!.editDays} days, ${mine.data!.maxEdits} times.`}</p>}
          </Card></li>
        ))}</ul>
      )}
    </div>
  );
}

interface Summary { minResponses: number; total: number; canRespond: boolean; targets: { targetType: string; targetId: string; label: string; responses: number; rating: { responses: number; average: number | null; distribution: number[] }; positive: { tag: string; count: number }[]; improve: { tag: string; count: number }[] }[]; trend: { month: string; responses: number; average: number | null }[]; comments: { id: string; targetLabel: string; rating: number | null; comment: string; suggestion: string; status: string; staffNote: string | null; submittedAt: string; student: { id: string; name: string } | null }[] }

function StaffFeedback() {
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { prompt, dialog } = useConfirm();
  const key = JSON.stringify({ type, from, to });
  const respond = async (feedbackId: string, status: 'acknowledged' | 'actioned') => {
    const note = await prompt(status === 'actioned'
      ? { title: 'Mark as acted on', label: 'What was done? (shown to the student)', confirmLabel: 'Mark acted on' }
      : { title: 'Mark as read', label: 'Reply to the student (optional)', minLength: 0, confirmLabel: 'Mark read' });
    if (note === null) return;
    setMsg(null);
    try { await feedbackApi({ action: 'set_status', feedbackId, status, ...(note ? { note } : {}) }); setMsg({ kind: 'success', text: 'Saved. The student has been told.' }); reload(); }
    catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); }
  };
  const { data, error, reload } = useApiData(key, () => feedbackApi<Summary>({ action: 'summary', ...(type ? { targetType: type } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }));
  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader title="Student feedback" description="What students say about the courses, teaching and facilities in your scope. Averages appear only once there are enough responses, and nothing is ranked." />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="About" htmlFor="sf-type"><select id="sf-type" value={type} onChange={(e) => setType(e.target.value)} className={fieldClasses}><option value="">Everything</option>{Object.entries(TARGET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="From" htmlFor="sf-from"><input id="sf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClasses} /></Field>
        <Field label="To" htmlFor="sf-to"><input id="sf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClasses} /></Field>
      </div>
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Loading feedback…" /> : data.total === 0 ? <EmptyState title="No feedback yet">Feedback from students in your scope appears here.</EmptyState> : (
        <>
          <ul className="grid gap-3 md:grid-cols-2">{data.targets.map((t) => (
            <li key={`${t.targetType}:${t.targetId}`}><Card className="h-full space-y-2 p-4">
              <div className="font-semibold text-ink">{t.label}</div>
              <div className="text-sm text-ink-2">{t.responses} response{t.responses === 1 ? '' : 's'} · {t.rating.average !== null ? <strong>{t.rating.average} / 5 average</strong> : `average shown from ${data.minResponses} ratings`}</div>
              {t.positive.length > 0 && <p className="text-xs text-success-ink">Went well: {t.positive.map((p) => `${p.tag} (${p.count})`).join(', ')}</p>}
              {t.improve.length > 0 && <p className="text-xs text-warning-ink">Could be better: {t.improve.map((p) => `${p.tag} (${p.count})`).join(', ')}</p>}
            </Card></li>
          ))}</ul>
          {data.trend.some((m) => m.average !== null) && <Card className="p-4 text-sm"><h2 className="mb-2 font-semibold text-ink">Average rating by month</h2><ul className="space-y-0.5">{data.trend.map((m) => <li key={m.month} className="flex justify-between"><span>{m.month}</span><span>{m.average !== null ? `${m.average} / 5 (${m.responses})` : `${m.responses} ratings — too few for an average`}</span></li>)}</ul></Card>}
          <h2 className="type-section text-ink">Written comments</h2>
          <ul className="space-y-2">{data.comments.map((c) => (
            <li key={c.id}><Card className="space-y-1 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{c.targetLabel}</span>{c.rating ? <span className="text-warning-ink">{'★'.repeat(c.rating)}</span> : null}<span className="text-xs text-ink-3">{c.student ? c.student.name : 'Name hidden by the student'} · {formatDate(c.submittedAt)}</span><StatusPill size="sm" tone={c.status === 'submitted' ? 'warning' : 'success'}>{c.status}</StatusPill></div>
              {c.comment && <p className="text-ink-2">{c.comment}</p>}
              {c.suggestion && <p className="text-ink-3">Suggestion: {c.suggestion}</p>}
              {c.staffNote && <p className="text-xs text-ink-3">Response: {c.staffNote}</p>}
              {data.canRespond && c.status === 'submitted' && (
                <div className="flex gap-2">
                  {(['acknowledged', 'actioned'] as const).map((st) => <Button key={st} size="sm" variant="ghost" onClick={() => respond(c.id, st)}>{st === 'acknowledged' ? 'Mark read' : 'Mark acted on'}</Button>)}
                </div>
              )}
            </Card></li>
          ))}</ul>
        </>
      )}
    </div>
  );
}

export default function FeedbackPage() {
  const { tenant } = useAuth();
  return (
    <RequireAuth>
      <AppShell>
        {!tenant ? <LoadingState label="Loading…" /> : tenant.role === 'student' ? <StudentFeedback /> : ['super_admin', 'university_admin', 'branch_admin', 'instructor'].includes(tenant.role) ? <StaffFeedback /> : <EmptyState title="Not available">Feedback is given by students and read by teaching staff.</EmptyState>}
      </AppShell>
    </RequireAuth>
  );
}

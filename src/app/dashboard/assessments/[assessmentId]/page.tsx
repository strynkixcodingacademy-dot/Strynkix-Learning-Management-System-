'use client';

/**
 * Strynkix LMS — submissions for one activity or examination, and marking.
 * MCQs are already scored; evaluators mark written answers and practical work,
 * give feedback, finalize, or return the work for correction. Only attempts in
 * the evaluator's scope (their batches or branch) are listed.
 */

import React, { Suspense, use, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { evaluateAttempt, listAttempts, releaseResults, returnAttempt } from '@/lib/assessments/service';
import { EXAM_TYPE_LABELS, KIND_LABELS, isAutoQuestion } from '@/lib/assessments/grading';
import type { Assessment, AssessmentAttempt, AssessmentKeyItem } from '@/types/academy';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { AttemptStatusPill, formatWhen } from '@/components/assessments/AttemptStatusPill';
import { cx } from '@/components/ui/tones';

function Marker({ assessment, keyItems, attempt, onSaved }: { assessment: Assessment; keyItems: AssessmentKeyItem[]; attempt: AssessmentAttempt; onSaved: () => void }) {
  const keyBy = new Map(keyItems.map((k) => [k.questionId, k]));
  const autoMarks = (attempt as AssessmentAttempt & { autoMarks?: Record<string, number> }).autoMarks ?? {};
  const [marks, setMarks] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(attempt.manualScores ?? {}).map(([k, v]) => [k, String(v)])));
  const [qf, setQf] = useState<Record<string, string>>(attempt.questionFeedback ?? {});
  const [feedback, setFeedback] = useState(attempt.feedback ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const editable = ['submitted', 'under_evaluation', 'evaluated'].includes(attempt.status);

  const run = async (finalize: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const manualScores = Object.fromEntries(Object.entries(marks).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
      const r = await evaluateAttempt(attempt.id, { manualScores, questionFeedback: Object.fromEntries(Object.entries(qf).filter(([, v]) => v.trim())), feedback: feedback.trim() || undefined, finalize });
      setMsg({ kind: 'success', text: finalize ? `Evaluated: ${r.score} / ${attempt.totalMarks} (${r.percent}%).` : 'Marks saved as a draft.' });
      onSaved();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">{attempt.studentName}</div>
          <div className="text-xs text-ink-3">Attempt {attempt.attemptNumber} · submitted {formatWhen(attempt.submittedAt)}{attempt.overTime ? ' · after the time limit' : ''}</div>
        </div>
        <AttemptStatusPill status={attempt.status} late={attempt.late} resubmission={attempt.resubmission} />
      </div>
      {attempt.autoScore !== undefined && assessment.questions.some(isAutoQuestion) && <p className="text-sm text-ink-2">MCQ score (automatic): <strong>{attempt.autoScore}</strong></p>}

      {assessment.kind === 'practical' ? (
        <div className="space-y-3">
          <div className="space-y-1 rounded-xl border border-line p-3 text-sm text-ink-2">
            {attempt.practical?.text && <p className="whitespace-pre-wrap">{attempt.practical.text}</p>}
            {attempt.practical?.repoUrl && <p>Repository: <a className="text-brand-ink underline" href={attempt.practical.repoUrl} target="_blank" rel="noopener noreferrer">{attempt.practical.repoUrl}</a></p>}
            {attempt.practical?.liveUrl && <p>Live: <a className="text-brand-ink underline" href={attempt.practical.liveUrl} target="_blank" rel="noopener noreferrer">{attempt.practical.liveUrl}</a></p>}
          </div>
          <Field label={`Marks (out of ${assessment.practicalMarks})`} htmlFor={`pm-${attempt.id}`}>
            <input id={`pm-${attempt.id}`} type="number" min={0} max={assessment.practicalMarks} step={0.5} disabled={!editable} value={marks.practical ?? ''} onChange={(e) => setMarks((m) => ({ ...m, practical: e.target.value }))} className={fieldClasses} />
          </Field>
        </div>
      ) : (
        <ol className="space-y-4">
          {assessment.questions.map((q, i) => {
            const r = attempt.responses?.[q.id];
            const k = keyBy.get(q.id);
            return (
              <li key={q.id} className="space-y-2 border-b border-line pb-4 last:border-0">
                <p className="text-sm font-semibold text-ink">{i + 1}. {q.prompt} <span className="font-normal text-ink-3">({q.marks} marks)</span></p>
                {isAutoQuestion(q) ? (
                  <div className="text-sm">
                    <ul>{q.options?.map((o) => {
                      const mine = r?.optionIds?.includes(o.id);
                      const right = k?.correctOptionIds?.includes(o.id);
                      return <li key={o.id} className={cx(right && 'font-semibold text-success-ink', mine && !right && 'text-danger-ink')}>{mine ? '● ' : '○ '}{o.text}{right ? ' ✓' : ''}</li>;
                    })}</ul>
                    <p className="text-xs text-ink-3">Scored {autoMarks[q.id] ?? 0} automatically.</p>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap rounded-xl bg-surface-muted p-3 text-sm text-ink-2">{r?.text || <em>No answer</em>}</p>
                    {k?.modelAnswer && <p className="text-xs text-ink-3">Model answer: {k.modelAnswer}</p>}
                    <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                      <input aria-label={`Marks for question ${i + 1}`} type="number" min={0} max={q.marks} step={0.5} disabled={!editable} placeholder={`0–${q.marks}`} value={marks[q.id] ?? ''} onChange={(e) => setMarks((m) => ({ ...m, [q.id]: e.target.value }))} className={fieldClasses} />
                      <input aria-label={`Feedback for question ${i + 1}`} disabled={!editable} placeholder="Feedback on this answer (optional)" value={qf[q.id] ?? ''} onChange={(e) => setQf((f) => ({ ...f, [q.id]: e.target.value }))} className={fieldClasses} />
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {editable && (
        <>
          <Field label="Overall feedback for the student" htmlFor={`fb-${attempt.id}`}>
            <textarea id={`fb-${attempt.id}`} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} className={fieldClasses} />
          </Field>
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run(true)} loading={busy}>{attempt.status === 'evaluated' ? 'Save corrected marks' : 'Finalize evaluation'}</Button>
            {attempt.status !== 'evaluated' && <Button variant="secondary" onClick={() => run(false)} disabled={busy}>Save as draft</Button>}
          </div>
          {attempt.status !== 'evaluated' && assessment.allowResubmission && (
            <div className="space-y-2 rounded-xl border border-line p-3">
              <Field label="Return for correction" htmlFor={`rt-${attempt.id}`} hint="The student can submit a corrected version. This attempt stays in their history.">
                <input id={`rt-${attempt.id}`} value={reason} placeholder="What should the student correct?" onChange={(e) => setReason(e.target.value)} className={fieldClasses} />
              </Field>
              <Button variant="ghost" size="sm" disabled={busy || reason.trim().length < 5} onClick={async () => {
                setBusy(true);
                try { await returnAttempt(attempt.id, reason.trim()); setMsg({ kind: 'success', text: 'Returned to the student.' }); onSaved(); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
              }}>Return to student</Button>
            </div>
          )}
        </>
      )}
      {attempt.status === 'returned' && <Notice kind="warning">Returned: {attempt.returnedReason}</Notice>}
    </Card>
  );
}

function Submissions({ assessmentId, focus }: { assessmentId: string; focus?: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof listAttempts>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [version, setVersion] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listAttempts(assessmentId).then((d) => live && setData(d)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [assessmentId, version]);

  const shown = useMemo(() => (data?.attempts ?? []).filter((t) => filter === 'all' || ['submitted', 'under_evaluation'].includes(t.status)), [data, filter]);
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading submissions…" />;
  const a = data.assessment;
  const current = data.attempts.find((t) => t.id === selected) ?? null;
  const evaluated = data.attempts.filter((t) => t.status === 'evaluated');
  const avg = evaluated.length ? Math.round(evaluated.reduce((s, t) => s + (t.percent ?? 0), 0) / evaluated.length) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Evaluate', href: '/dashboard/assessments' }, { label: a.title }]}
        eyebrow={a.kind === 'exam' && a.examType ? EXAM_TYPE_LABELS[a.examType] : KIND_LABELS[a.kind]} title={a.title}
        description={`${data.attempts.length} submissions in your scope · ${evaluated.length} evaluated${avg !== null ? ` · average ${avg}%` : ''}`}
        actions={a.resultRelease === 'manual' && !a.resultsReleasedAt && (
          <Button variant="success" onClick={async () => {
            try { await releaseResults(a.id); setNote('Results released. Students can now see their evaluated results.'); setVersion((v) => v + 1); } catch (e) { setNote((e as Error).message); }
          }}>Release results</Button>
        )}
      />
      {note && <Notice kind="info">{note}</Notice>}
      {a.resultRelease === 'manual' && a.resultsReleasedAt && <Notice kind="success">Results were released on {formatWhen(a.resultsReleasedAt)}.</Notice>}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={filter === 'pending' ? 'primary' : 'ghost'} onClick={() => setFilter('pending')}>Waiting</Button>
            <Button size="sm" variant={filter === 'all' ? 'primary' : 'ghost'} onClick={() => setFilter('all')}>All</Button>
          </div>
          {shown.length === 0 ? <EmptyState title="Nothing to show">{filter === 'pending' ? 'No submissions are waiting.' : 'No submissions yet.'}</EmptyState> : (
            <ul className="space-y-1.5">
              {shown.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setSelected(t.id)} aria-pressed={selected === t.id} className={cx('w-full rounded-xl border p-3 text-left', selected === t.id ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface-muted')}>
                    <div className="text-sm font-semibold text-ink">{t.studentName}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">Attempt {t.attemptNumber} <AttemptStatusPill status={t.status} late={t.late} size="sm" /> {t.score !== undefined && t.status === 'evaluated' ? `${t.score}/${t.totalMarks}` : ''}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>{current ? <Marker key={`${current.id}-${version}`} assessment={a} keyItems={data.key} attempt={current} onSaved={() => setVersion((v) => v + 1)} /> : <EmptyState title="Choose a submission">Select a student on the left to see their answers and mark them.</EmptyState>}</div>
      </div>
    </div>
  );
}

function AssessmentSubmissionsPageContent({ params, searchParams }: { params: Promise<{ assessmentId: string }>; searchParams: Promise<{ attempt?: string }> }) {
  const { assessmentId } = use(params);
  const sp = use(searchParams);
  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor', 'content_lead', 'content_designer']}>
      <AppShell><Submissions assessmentId={assessmentId} focus={sp.attempt} /></AppShell>
    </RequireRole>
  );
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function AssessmentSubmissionsPage(props: Parameters<typeof AssessmentSubmissionsPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <AssessmentSubmissionsPageContent {...props} />
    </Suspense>
  );
}

'use client';

/**
 * Strynkix LMS — a student's lesson activity or examination: instructions,
 * the attempt itself (autosaved, timed when configured), and every earlier
 * attempt with its evaluation once results are released.
 */

import React, { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import {
  getStudentAssessment, saveAttemptProgress, startAttempt, submitAttempt, type StudentAttemptView,
} from '@/lib/assessments/service';
import { EXAM_TYPE_LABELS, KIND_LABELS, isAutoQuestion, secondsLeft } from '@/lib/assessments/grading';
import type { Assessment, AttemptResponse } from '@/types/academy';
import { AttemptStatusPill, formatWhen } from '@/components/assessments/AttemptStatusPill';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader, fieldClasses } from '@/components/ui/Page';
import { ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { cx } from '@/components/ui/tones';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';

type Practical = { text?: string; repoUrl?: string; liveUrl?: string };

function Timer({ deadlineAt, onExpire }: { deadlineAt: string; onExpire: () => void }) {
  const [left, setLeft] = useState(() => secondsLeft({ deadlineAt }) ?? 0);
  const fired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      const s = secondsLeft({ deadlineAt }) ?? 0;
      setLeft(s);
      if (s === 0 && !fired.current) { fired.current = true; onExpire(); }
    }, 1000);
    return () => clearInterval(t);
  }, [deadlineAt, onExpire]);
  const m = Math.floor(left / 60), s = left % 60;
  return (
    <div role="timer" aria-live={left < 60 ? 'assertive' : 'off'} className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium tabular-nums', left < 120 ? 'bg-coral-soft text-coral-ink' : 'bg-surface-muted text-ink')}>
      <Clock className="h-4 w-4" aria-hidden="true" /> {m}:{String(s).padStart(2, '0')} left
    </div>
  );
}

function AttemptForm({ assessment, attempt, onDone }: { assessment: Assessment; attempt: StudentAttemptView; onDone: (msg: string) => void }) {
  const [responses, setResponses] = useState<Record<string, AttemptResponse>>(attempt.responses ?? {});
  const [practical, setPractical] = useState<Practical>(attempt.practical ?? {});
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const latest = useRef({ responses, practical });
  useEffect(() => { latest.current = { responses, practical }; }, [responses, practical]);

  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setSaving('saving');
    try {
      await saveAttemptProgress(attempt.id, latest.current.responses, assessment.kind === 'practical' ? latest.current.practical : undefined);
      setSaving('saved');
    } catch {
      dirty.current = true;
      setSaving('error');
    }
  }, [attempt.id, assessment.kind]);

  useEffect(() => {
    const t = setInterval(save, 20000);
    return () => clearInterval(t);
  }, [save]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await submitAttempt(attempt.id, latest.current.responses, assessment.kind === 'practical' ? latest.current.practical : undefined);
      onDone(r.released && r.score !== undefined ? `Submitted. You scored ${r.score} / ${assessment.totalMarks}${r.passed ? ' — passed.' : '.'}` : r.status === 'evaluated' ? 'Submitted. Your result will appear when results are released.' : 'Submitted. Your instructor will evaluate it.');
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }, [attempt.id, assessment.kind, assessment.totalMarks, onDone]);

  const setResponse = (qid: string, r: AttemptResponse) => { dirty.current = true; setResponses((p) => ({ ...p, [qid]: r })); };
  const answered = assessment.questions.filter((q) => (responses[q.id]?.optionIds?.length ?? 0) > 0 || responses[q.id]?.text?.trim()).length;

  return (
    <Card className="space-y-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-ink-3">
          Attempt {attempt.attemptNumber}{assessment.kind !== 'practical' ? ` · ${answered} of ${assessment.questions.length} answered` : ''}
          <span className="ml-2 text-xs" aria-live="polite">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Not saved — check your connection' : ''}</span>
        </div>
        {attempt.deadlineAt && <Timer deadlineAt={attempt.deadlineAt} onExpire={submit} />}
      </div>

      {assessment.kind === 'practical' ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="pr-text" className="block text-sm font-semibold text-ink-2">Describe your work</label>
            <textarea id="pr-text" rows={8} maxLength={20000} value={practical.text ?? ''} onBlur={save} onChange={(e) => { dirty.current = true; setPractical((p) => ({ ...p, text: e.target.value })); }} className={fieldClasses} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="pr-repo" className="block text-sm font-semibold text-ink-2">GitHub repository link</label>
              <input id="pr-repo" type="url" placeholder="https://github.com/…" value={practical.repoUrl ?? ''} onBlur={save} onChange={(e) => { dirty.current = true; setPractical((p) => ({ ...p, repoUrl: e.target.value })); }} className={fieldClasses} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pr-live" className="block text-sm font-semibold text-ink-2">Live project link</label>
              <input id="pr-live" type="url" placeholder="https://…" value={practical.liveUrl ?? ''} onBlur={save} onChange={(e) => { dirty.current = true; setPractical((p) => ({ ...p, liveUrl: e.target.value })); }} className={fieldClasses} />
            </div>
          </div>
          <p className="text-xs text-ink-3">File uploads aren’t available yet. Share your files through a repository or a link.</p>
        </div>
      ) : (
        <ol className="space-y-6">
          {assessment.questions.map((q, i) => (
            <li key={q.id} className="space-y-3 border-b border-line pb-6 last:border-0">
              <div className="flex items-start justify-between gap-3">
                <p className="font-reading text-[1.0625rem] font-medium leading-snug text-ink"><span className="mr-1 text-ink-3">{i + 1}.</span> <span className="whitespace-pre-wrap">{q.prompt}</span></p>
                <span className="shrink-0 pt-1 text-xs text-ink-3">{q.marks} mark{q.marks === 1 ? '' : 's'}{q.negativeMarks ? ` · −${q.negativeMarks} if wrong` : ''}</span>
              </div>
              {isAutoQuestion(q) ? (
                <fieldset className="space-y-2">
                  <legend className="sr-only">Question {i + 1} options</legend>
                  {q.type === 'mcq_multi' && <p className="text-xs text-ink-3">Choose every correct option.</p>}
                  {q.options?.map((o) => {
                    const chosen = responses[q.id]?.optionIds ?? [];
                    const checked = chosen.includes(o.id);
                    return (
                      <label key={o.id} className={cx('flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors duration-150', checked ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-silver hover:bg-surface-muted/50')}>
                        <input
                          type={q.type === 'mcq_single' ? 'radio' : 'checkbox'} name={`q_${q.id}`} value={o.id} checked={checked}
                          onChange={() => setResponse(q.id, { optionIds: q.type === 'mcq_single' ? [o.id] : checked ? chosen.filter((x) => x !== o.id) : [...chosen, o.id] })}
                        />
                        <span>{o.text}</span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : (
                <textarea
                  aria-label={`Answer to question ${i + 1}`} rows={q.type === 'short' ? 3 : 10} maxLength={q.type === 'short' ? 2000 : 20000}
                  value={responses[q.id]?.text ?? ''} onBlur={save} onChange={(e) => setResponse(q.id, { text: e.target.value })} className={fieldClasses}
                />
              )}
            </li>
          ))}
        </ol>
      )}

      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button loading={submitting} onClick={async () => {
          const unanswered = assessment.kind !== 'practical' && answered < assessment.questions.length;
          const ok = await confirm({
            title: 'Submit your answers?', confirmLabel: 'Submit',
            body: `${unanswered ? `You have answered ${answered} of ${assessment.questions.length} questions. ` : ''}You can’t change your answers after submitting.`,
          });
          if (ok) submit();
        }}>Submit</Button>
        <Button variant="secondary" onClick={() => { dirty.current = true; save(); }}>Save and continue later</Button>
      </div>
      {dialog}
    </Card>
  );
}

function PastAttempt({ assessment, attempt }: { assessment: Assessment; attempt: StudentAttemptView }) {
  const review = new Map((attempt.review ?? []).map((k) => [k.questionId, k]));
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-ink">Attempt {attempt.attemptNumber}</div>
        <AttemptStatusPill status={attempt.status} late={attempt.late} resubmission={attempt.resubmission} />
      </div>
      <div className="text-xs text-ink-3">Submitted {formatWhen(attempt.submittedAt)}{attempt.overTime ? ' · after the time limit' : ''}</div>
      {attempt.released ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="type-figure text-[1.625rem] text-ink">{attempt.score}<span className="font-sans text-base text-ink-3"> / {assessment.totalMarks}</span></span>
          <span className="text-sm text-ink-3">{attempt.percent}%</span>
          {attempt.passed ? <span className="inline-flex items-center gap-1 text-sm font-semibold text-success-ink"><CheckCircle2 className="h-4 w-4" /> Passed</span>
            : <span className="inline-flex items-center gap-1 text-sm font-semibold text-danger-ink"><XCircle className="h-4 w-4" /> Not passed</span>}
          <span className="text-xs text-ink-3">Final result</span>
        </div>
      ) : attempt.status === 'evaluated' ? (
        <p className="text-sm text-ink-3">Evaluated. The result will be shown when results are released.</p>
      ) : attempt.provisionalAutoScore !== undefined ? (
        <p className="text-sm text-ink-3">Provisional MCQ score: <strong>{attempt.provisionalAutoScore}</strong>. Written answers are still being evaluated.</p>
      ) : null}
      {attempt.status === 'returned' && attempt.returnedReason && <Notice kind="warning">Returned for correction: {attempt.returnedReason}</Notice>}
      {attempt.released && attempt.feedback && <Notice kind="info">Instructor feedback: {attempt.feedback}</Notice>}
      {attempt.practical && (
        <div className="space-y-1 text-sm text-ink-2">
          {attempt.practical.text && <p className="whitespace-pre-wrap">{attempt.practical.text}</p>}
          {attempt.practical.repoUrl && <p>Repository: <a className="text-brand-ink underline" href={attempt.practical.repoUrl} target="_blank" rel="noopener noreferrer">{attempt.practical.repoUrl}</a></p>}
          {attempt.practical.liveUrl && <p>Live: <a className="text-brand-ink underline" href={attempt.practical.liveUrl} target="_blank" rel="noopener noreferrer">{attempt.practical.liveUrl}</a></p>}
        </div>
      )}
      {(attempt.released || review.size > 0) && assessment.questions.length > 0 && (
        <details className="border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-2">Your answers{review.size ? ' and the correct answers' : ''}</summary>
          <ol className="mt-3 space-y-4">
            {assessment.questions.map((q, i) => {
              const r = attempt.responses?.[q.id];
              const k = review.get(q.id);
              return (
                <li key={q.id} className="space-y-1 text-sm">
                  <p className="font-semibold text-ink">{i + 1}. {q.prompt}</p>
                  {isAutoQuestion(q) ? (
                    <ul className="space-y-0.5">
                      {q.options?.map((o) => {
                        const mine = r?.optionIds?.includes(o.id);
                        const right = k?.correctOptionIds?.includes(o.id);
                        return <li key={o.id} className={cx(right && 'font-semibold text-success-ink', mine && !right && k && 'text-danger-ink')}>{mine ? '● ' : '○ '}{o.text}{right ? ' (correct)' : ''}</li>;
                      })}
                    </ul>
                  ) : <p className="whitespace-pre-wrap text-ink-2">{r?.text || <em>No answer</em>}</p>}
                  {attempt.manualScores?.[q.id] !== undefined && <p className="text-xs text-ink-3">Marks: {attempt.manualScores[q.id]} / {q.marks}</p>}
                  {attempt.autoMarks?.[q.id] !== undefined && <p className="text-xs text-ink-3">Marks: {attempt.autoMarks[q.id]} / {q.marks}</p>}
                  {attempt.questionFeedback?.[q.id] && <p className="text-xs text-ink-2">Feedback: {attempt.questionFeedback[q.id]}</p>}
                  {k?.explanation && <p className="text-xs text-ink-2">Explanation: {k.explanation}</p>}
                  {k?.modelAnswer && <p className="text-xs text-ink-2">Model answer: {k.modelAnswer}</p>}
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </Card>
  );
}

function ActivityView({ courseId, assessmentId }: { courseId: string; assessmentId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getStudentAssessment>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    getStudentAssessment(assessmentId).then((d) => live && setData(d)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [assessmentId, version]);

  const reload = () => setVersion((v) => v + 1);
  const a = data?.assessment;
  const inProgress = useMemo(() => data?.attempts.find((t) => t.status === 'in_progress') ?? null, [data]);
  const past = data?.attempts.filter((t) => t.status !== 'in_progress') ?? [];

  if (error) return <ErrorState title="This activity isn’t available" onRetry={() => { setError(null); reload(); }}>{error}</ErrorState>;
  if (!data || !a) return <LoadingState label="Opening the activity…" />;

  const kindLabel = a.kind === 'exam' && a.examType ? EXAM_TYPE_LABELS[a.examType] : KIND_LABELS[a.kind];
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'My Courses', href: '/courses' }, { label: 'Course', href: `/courses/${courseId}` }, { label: a.title }]}
        eyebrow={kindLabel} title={a.title} description={a.description || undefined}
      />
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line pb-5 text-sm sm:grid-cols-4">
        <div><div className="text-xs text-ink-3">Total marks</div><div className="font-semibold text-ink">{a.totalMarks}</div></div>
        <div><div className="text-xs text-ink-3">Pass mark</div><div className="font-semibold text-ink">{a.passingPercent}%</div></div>
        <div><div className="text-xs text-ink-3">Attempts</div><div className="font-semibold text-ink">{past.length + (inProgress ? 1 : 0)} of {a.maxAttempts || 'unlimited'}</div></div>
        <div><div className="text-xs text-ink-3">{a.timeLimitMinutes ? 'Time limit' : 'Due'}</div><div className="font-semibold text-ink">{a.timeLimitMinutes ? `${a.timeLimitMinutes} min` : formatWhen(a.closesAt)}</div></div>
        {a.opensAt && <div className="col-span-2"><div className="text-xs text-ink-3">Opens</div><div className="font-semibold text-ink">{formatWhen(a.opensAt)}</div></div>}
        {a.closesAt && a.timeLimitMinutes && <div className="col-span-2"><div className="text-xs text-ink-3">Closes</div><div className="font-semibold text-ink">{formatWhen(a.closesAt)}</div></div>}
      </div>
      {a.instructions && <div><h2 className="type-section mb-2 text-ink">Instructions</h2><p className="max-w-[66ch] whitespace-pre-wrap font-reading text-[1.0625rem] leading-relaxed text-ink">{a.instructions}</p></div>}
      {message && <Notice kind="success">{message}</Notice>}

      {inProgress ? (
        <AttemptForm assessment={a} attempt={inProgress} onDone={(m) => { setMessage(m); reload(); }} />
      ) : data.canStart ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-ink-2">{past[0]?.status === 'returned' ? 'Your instructor returned your work. Start a corrected submission.' : a.timeLimitMinutes ? `The timer starts when you begin and runs for ${a.timeLimitMinutes} minutes.` : 'Your answers are saved as you go.'}</p>
          <Button loading={starting} onClick={async () => {
            setStarting(true);
            try { await startAttempt(a.id); reload(); } catch (e) { setError((e as Error).message); } finally { setStarting(false); }
          }}>{past.length ? 'Start a new attempt' : a.kind === 'exam' ? 'Start the exam' : 'Start'}</Button>
        </Card>
      ) : data.startBlockedReason && !past.length ? <Notice kind="info">{data.startBlockedReason}</Notice> : null}

      {past.length > 0 && (
        <section className="space-y-3" aria-labelledby="history">
          <h2 id="history" className="type-section text-ink">Submission history</h2>
          {past.map((t) => <PastAttempt key={t.id} assessment={a} attempt={t} />)}
        </section>
      )}
    </div>
  );
}

function ActivityPageContent({ params }: { params: Promise<{ courseId: string; assessmentId: string }> }) {
  const { courseId, assessmentId } = use(params);
  return (
    <RequireRole allowedRoles={['student']}>
      <AppShell>
        <ActivityView courseId={courseId} assessmentId={assessmentId} />
      </AppShell>
    </RequireRole>
  );
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function ActivityPage(props: Parameters<typeof ActivityPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <ActivityPageContent {...props} />
    </Suspense>
  );
}

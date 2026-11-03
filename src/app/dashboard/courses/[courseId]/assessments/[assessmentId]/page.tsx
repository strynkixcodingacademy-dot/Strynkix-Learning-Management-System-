'use client';

/**
 * Strynkix LMS — create or edit a lesson activity or an examination. Answers
 * are sent to the server, which stores them in the confidential answer key.
 * Once students have attempted it, questions and marks are locked.
 */

import React, { Suspense, use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { getCourseWithCurriculum, type CourseWithCurriculum } from '@/lib/livebook/service';
import { getBatchesForTenant } from '@/lib/batches/service';
import {
  getAssessmentForEdit, saveAssessment, setAssessmentStatus, type AssessmentDraft, type QuestionDraft,
} from '@/lib/assessments/service';
import { KIND_LABELS, QUESTION_TYPES_FOR, roundMarks } from '@/lib/assessments/grading';
import type { Assessment, AssessmentKind, QuestionType } from '@/types/academy';
import type { Batch } from '@/types/domain';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

const QTYPE_LABELS: Record<QuestionType, string> = { mcq_single: 'MCQ — one correct answer', mcq_multi: 'MCQ — several correct answers', short: 'Short answer', long: 'Long answer' };
const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function newQuestion(type: QuestionType): QuestionDraft {
  const auto = type === 'mcq_single' || type === 'mcq_multi';
  return {
    id: uid('q'), type, prompt: '', marks: 1,
    ...(auto ? { options: [{ id: uid('o'), text: '' }, { id: uid('o'), text: '' }], correctOptionIds: [] } : {}),
  };
}

const toLocalInput = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);

function emptyDraft(courseId: string, kind: AssessmentKind, lessonId?: string): AssessmentDraft {
  return {
    courseId, kind, title: '', description: '', instructions: '', questions: kind === 'practical' ? [] : [newQuestion(QUESTION_TYPES_FOR[kind][0])],
    passingPercent: 40, maxAttempts: kind === 'exam' ? 1 : 3, allowLate: false, allowResubmission: kind !== 'exam',
    negativeMarking: false, resultRelease: kind === 'exam' ? 'manual' : 'immediate',
    ...(kind === 'exam' ? { examType: 'practice' as const } : {}), ...(kind === 'practical' ? { practicalMarks: 10 } : {}),
    ...(lessonId ? { lessonId } : {}),
  };
}

function QuestionEditor({ q, index, count, kind, negative, locked, onChange, onMove, onRemove }: {
  q: QuestionDraft; index: number; count: number; kind: AssessmentKind; negative: boolean; locked: boolean;
  onChange: (q: QuestionDraft) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const auto = q.type === 'mcq_single' || q.type === 'mcq_multi';
  const toggleCorrect = (id: string) => {
    const cur = q.correctOptionIds ?? [];
    onChange({ ...q, correctOptionIds: q.type === 'mcq_single' ? [id] : cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-ink">Question {index + 1}</span>
        <select aria-label={`Question ${index + 1} type`} disabled={locked} value={q.type} className={`${fieldClasses} w-auto py-1.5`}
          onChange={(e) => {
            const t = e.target.value as QuestionType;
            const nq = newQuestion(t);
            onChange({ ...nq, id: q.id, prompt: q.prompt, marks: q.marks, ...(nq.options && q.options ? { options: q.options, correctOptionIds: t === 'mcq_single' ? (q.correctOptionIds ?? []).slice(0, 1) : q.correctOptionIds } : {}) });
          }}>
          {QUESTION_TYPES_FOR[kind].map((t) => <option key={t} value={t}>{QTYPE_LABELS[t]}</option>)}
        </select>
        <span className="flex-1" />
        <button type="button" disabled={locked || index === 0} onClick={() => onMove(-1)} aria-label={`Move question ${index + 1} up`} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-muted disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
        <button type="button" disabled={locked || index === count - 1} onClick={() => onMove(1)} aria-label={`Move question ${index + 1} down`} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-muted disabled:opacity-40"><ArrowDown className="h-4 w-4" /></button>
        <button type="button" disabled={locked} onClick={onRemove} aria-label={`Remove question ${index + 1}`} className="rounded-lg p-1.5 text-danger-ink hover:bg-danger-soft disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
      </div>
      <textarea aria-label={`Question ${index + 1} text`} disabled={locked} rows={2} value={q.prompt} placeholder="Write the question" onChange={(e) => onChange({ ...q, prompt: e.target.value })} className={fieldClasses} />
      {auto && (
        <div className="space-y-2">
          <p className="text-xs text-ink-3">{q.type === 'mcq_single' ? 'Select the one correct option.' : 'Tick every correct option. Students must choose exactly these.'}</p>
          {q.options?.map((o, oi) => (
            <div key={o.id} className="flex items-center gap-2">
              <input type={q.type === 'mcq_single' ? 'radio' : 'checkbox'} name={`correct_${q.id}`} disabled={locked} checked={(q.correctOptionIds ?? []).includes(o.id)} onChange={() => toggleCorrect(o.id)} aria-label={`Option ${oi + 1} is correct`} />
              <input aria-label={`Option ${oi + 1}`} disabled={locked} value={o.text} placeholder={`Option ${oi + 1}`} onChange={(e) => onChange({ ...q, options: q.options!.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })} className={fieldClasses} />
              <button type="button" disabled={locked || (q.options?.length ?? 0) <= 2} onClick={() => onChange({ ...q, options: q.options!.filter((x) => x.id !== o.id), correctOptionIds: (q.correctOptionIds ?? []).filter((x) => x !== o.id) })} aria-label={`Remove option ${oi + 1}`} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-muted disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {(q.options?.length ?? 0) < 10 && !locked && (
            <button type="button" onClick={() => onChange({ ...q, options: [...(q.options ?? []), { id: uid('o'), text: '' }] })} className="text-sm font-semibold text-brand-ink">+ Add option</button>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Marks" htmlFor={`m-${q.id}`}>
          <input id={`m-${q.id}`} type="number" min={0.25} step={0.25} disabled={locked} value={q.marks} onChange={(e) => onChange({ ...q, marks: Number(e.target.value) })} className={fieldClasses} />
        </Field>
        {auto && negative && (
          <Field label="Marks lost if wrong" htmlFor={`n-${q.id}`}>
            <input id={`n-${q.id}`} type="number" min={0} step={0.25} disabled={locked} value={q.negativeMarks ?? 0} onChange={(e) => onChange({ ...q, negativeMarks: Number(e.target.value) || undefined })} className={fieldClasses} />
          </Field>
        )}
      </div>
      {!auto && (
        <Field label="Model answer (for evaluators; shown to students after results are released)" htmlFor={`ma-${q.id}`}>
          <textarea id={`ma-${q.id}`} rows={2} disabled={locked} value={q.modelAnswer ?? ''} onChange={(e) => onChange({ ...q, modelAnswer: e.target.value || undefined })} className={fieldClasses} />
        </Field>
      )}
      <Field label="Explanation (optional, shown after results are released)" htmlFor={`ex-${q.id}`}>
        <input id={`ex-${q.id}`} disabled={locked} value={q.explanation ?? ''} onChange={(e) => onChange({ ...q, explanation: e.target.value || undefined })} className={fieldClasses} />
      </Field>
    </Card>
  );
}

function Editor({ courseId, assessmentId, initialKind, initialLesson }: { courseId: string; assessmentId: string; initialKind: AssessmentKind; initialLesson?: string }) {
  const { tenant, user } = useAuth();
  const router = useRouter();
  const isNew = assessmentId === 'new';
  const [curriculum, setCurriculum] = useState<CourseWithCurriculum | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [draft, setDraft] = useState<AssessmentDraft | null>(isNew ? emptyDraft(courseId, initialKind, initialLesson) : null);
  const [meta, setMeta] = useState<Pick<Assessment, 'status' | 'resultsReleasedAt'> | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tenant || !user) return;
    let live = true;
    Promise.all([
      getCourseWithCurriculum(courseId, tenant.orgId, true),
      getBatchesForTenant(tenant, user.uid).catch(() => [] as Batch[]),
      isNew ? Promise.resolve(null) : getAssessmentForEdit(assessmentId),
    ]).then(([c, b, edit]) => {
      if (!live) return;
      setCurriculum(c);
      setBatches(b.filter((x) => x.courseId === courseId));
      if (edit) {
        const keyBy = new Map(edit.key.map((k) => [k.questionId, k]));
        const { assessment: a } = edit;
        setDraft({
          courseId, kind: a.kind, examType: a.examType, lessonId: a.lessonId, moduleId: a.moduleId, batchIds: a.batchIds,
          title: a.title, description: a.description, instructions: a.instructions, practicalMarks: a.practicalMarks,
          passingPercent: a.passingPercent, maxAttempts: a.maxAttempts, timeLimitMinutes: a.timeLimitMinutes, opensAt: a.opensAt, closesAt: a.closesAt,
          allowLate: a.allowLate, allowResubmission: a.allowResubmission, negativeMarking: a.negativeMarking, resultRelease: a.resultRelease,
          questions: a.questions.map((q) => ({ ...q, correctOptionIds: keyBy.get(q.id)?.correctOptionIds, modelAnswer: keyBy.get(q.id)?.modelAnswer, explanation: keyBy.get(q.id)?.explanation })),
        });
        setMeta({ status: a.status, resultsReleasedAt: a.resultsReleasedAt });
        setLocked(edit.locked);
      }
    }).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [courseId, assessmentId, isNew, tenant, user]);

  const total = useMemo(() => (draft ? (draft.kind === 'practical' ? draft.practicalMarks ?? 0 : roundMarks(draft.questions.reduce((s, q) => s + (q.marks || 0), 0))) : 0), [draft]);

  if (error) return <ErrorState title="This activity can’t be opened">{error}</ErrorState>;
  if (!draft || !curriculum) return <LoadingState label="Opening the editor…" />;
  const set = (patch: Partial<AssessmentDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setQ = (i: number, q: QuestionDraft) => set({ questions: draft.questions.map((x, j) => (j === i ? q : x)) });

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const payload: AssessmentDraft = {
        ...draft,
        questions: draft.questions.map((q) => ({ ...q, prompt: q.prompt.trim(), ...(q.negativeMarks ? {} : { negativeMarks: undefined }) })),
      };
      const clean = JSON.parse(JSON.stringify(payload)) as AssessmentDraft;
      const r = await saveAssessment(clean, isNew ? undefined : assessmentId);
      setMessage({ kind: 'success', text: `Saved. Total ${r.totalMarks} marks.` });
      if (isNew) router.replace(`/dashboard/courses/${courseId}/assessments/${r.assessmentId}`);
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: Assessment['status']) => {
    setBusy(true);
    setMessage(null);
    try {
      await setAssessmentStatus(assessmentId, status);
      setMeta((m) => (m ? { ...m, status } : m));
      setMessage({ kind: 'success', text: status === 'published' ? 'Published. Students can now see it.' : status === 'archived' ? 'Archived.' : 'Moved back to draft.' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const lessonsByModule = curriculum.modules.map((m) => ({ m, lessons: curriculum.lessons.filter((l) => l.moduleId === m.id) }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Course Authoring', href: '/dashboard/courses' }, { label: curriculum.course.title, href: `/dashboard/courses/${courseId}` }, { label: 'Activities & exams', href: `/dashboard/courses/${courseId}/assessments` }, { label: isNew ? 'New' : draft.title || 'Edit' }]}
        title={isNew ? (draft.kind === 'exam' ? 'New examination' : 'New lesson activity') : draft.title || 'Edit'}
        actions={meta && <StatusPill tone={meta.status === 'published' ? 'success' : meta.status === 'draft' ? 'warning' : 'neutral'}>{meta.status}</StatusPill>}
      />
      {locked && <Notice kind="info">Students have already attempted this, so its questions, answers and marks are locked. You can still change the dates, attempts and instructions.</Notice>}

      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="kind">
            <select id="kind" disabled={!isNew} value={draft.kind} onChange={(e) => setDraft(emptyDraft(courseId, e.target.value as AssessmentKind, draft.lessonId))} className={fieldClasses}>
              {(['quiz', 'short_answer', 'long_answer', 'practical', 'exam'] as AssessmentKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </Field>
          {draft.kind === 'exam' ? (
            <Field label="Examination type" htmlFor="examType">
              <select id="examType" value={draft.examType} onChange={(e) => set({ examType: e.target.value as AssessmentDraft['examType'] })} className={fieldClasses}>
                <option value="demo">Demo exam</option><option value="practice">Practice exam</option><option value="final">Final exam</option>
              </select>
            </Field>
          ) : (
            <Field label="Lesson" htmlFor="lesson" hint="Students see it at the end of this lesson.">
              <select id="lesson" value={draft.lessonId ?? ''} onChange={(e) => { const l = curriculum.lessons.find((x) => x.id === e.target.value); set({ lessonId: l?.id, moduleId: l?.moduleId }); }} className={fieldClasses}>
                <option value="">Not attached to a lesson</option>
                {lessonsByModule.map(({ m, lessons }) => <optgroup key={m.id} label={m.title}>{lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</optgroup>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Title" htmlFor="title" required>
          <input id="title" value={draft.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} className={fieldClasses} />
        </Field>
        <Field label="Short description" htmlFor="desc">
          <input id="desc" value={draft.description} maxLength={2000} onChange={(e) => set({ description: e.target.value })} className={fieldClasses} />
        </Field>
        <Field label="Instructions for students" htmlFor="instr">
          <textarea id="instr" rows={4} value={draft.instructions} maxLength={5000} onChange={(e) => set({ instructions: e.target.value })} className={fieldClasses} />
        </Field>
        {batches.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink-2">Batches</legend>
            <p className="text-xs text-ink-3">Leave all unticked to offer it to every batch of this course.</p>
            <div className="flex flex-wrap gap-3">
              {batches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm text-ink-2">
                  <input type="checkbox" checked={(draft.batchIds ?? []).includes(b.id)} onChange={(e) => set({ batchIds: e.target.checked ? [...(draft.batchIds ?? []), b.id] : (draft.batchIds ?? []).filter((x) => x !== b.id) })} /> {b.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <Field label="Pass mark (%)" htmlFor="pass">
          <input id="pass" type="number" min={0} max={100} value={draft.passingPercent} onChange={(e) => set({ passingPercent: Number(e.target.value) })} className={fieldClasses} />
        </Field>
        <Field label="Attempts allowed" htmlFor="att" hint="0 = unlimited">
          <input id="att" type="number" min={0} max={50} value={draft.maxAttempts} onChange={(e) => set({ maxAttempts: Number(e.target.value) })} className={fieldClasses} />
        </Field>
        <Field label="Time limit (minutes)" htmlFor="time" hint="Leave empty for no limit">
          <input id="time" type="number" min={1} max={600} value={draft.timeLimitMinutes ?? ''} onChange={(e) => set({ timeLimitMinutes: e.target.value ? Number(e.target.value) : undefined })} className={fieldClasses} />
        </Field>
        <Field label="Opens" htmlFor="opens">
          <input id="opens" type="datetime-local" value={toLocalInput(draft.opensAt)} onChange={(e) => set({ opensAt: fromLocalInput(e.target.value) })} className={fieldClasses} />
        </Field>
        <Field label={draft.kind === 'exam' ? 'Closes' : 'Deadline'} htmlFor="closes">
          <input id="closes" type="datetime-local" value={toLocalInput(draft.closesAt)} onChange={(e) => set({ closesAt: fromLocalInput(e.target.value) })} className={fieldClasses} />
        </Field>
        <Field label="Results shown" htmlFor="release">
          <select id="release" value={draft.resultRelease} onChange={(e) => set({ resultRelease: e.target.value as AssessmentDraft['resultRelease'] })} className={fieldClasses}>
            <option value="immediate">As soon as it is evaluated</option>
            <option value="after_close">After it closes</option>
            <option value="manual">When I release them</option>
          </select>
        </Field>
        <div className="flex flex-col gap-2 text-sm text-ink-2 sm:col-span-3 sm:flex-row sm:flex-wrap sm:gap-6">
          {draft.kind !== 'exam' && <label className="flex items-center gap-2"><input type="checkbox" checked={draft.allowLate} onChange={(e) => set({ allowLate: e.target.checked })} /> Accept late submissions (marked late)</label>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.allowResubmission} onChange={(e) => set({ allowResubmission: e.target.checked })} /> Allow resubmission when returned</label>
          {(draft.kind === 'quiz' || draft.kind === 'exam') && <label className="flex items-center gap-2"><input type="checkbox" disabled={locked} checked={draft.negativeMarking} onChange={(e) => set({ negativeMarking: e.target.checked, ...(e.target.checked ? {} : { questions: draft.questions.map((q) => ({ ...q, negativeMarks: undefined })) }) })} /> Negative marking for wrong MCQ answers</label>}
        </div>
      </Card>

      {draft.kind === 'practical' ? (
        <Card className="p-5">
          <Field label="Total marks" htmlFor="pmarks">
            <input id="pmarks" type="number" min={1} disabled={locked} value={draft.practicalMarks ?? ''} onChange={(e) => set({ practicalMarks: Number(e.target.value) || undefined })} className={fieldClasses} />
          </Field>
          <p className="mt-2 text-xs text-ink-3">Students submit a description, a GitHub repository link and/or a live link. Instructors mark it and give feedback.</p>
        </Card>
      ) : (
        <section className="space-y-3" aria-label="Questions">
          {draft.questions.map((q, i) => (
            <QuestionEditor key={q.id} q={q} index={i} count={draft.questions.length} kind={draft.kind} negative={draft.negativeMarking} locked={locked}
              onChange={(nq) => setQ(i, nq)}
              onMove={(d) => { const qs = [...draft.questions]; const [m] = qs.splice(i, 1); qs.splice(i + d, 0, m); set({ questions: qs }); }}
              onRemove={() => set({ questions: draft.questions.filter((_, j) => j !== i) })} />
          ))}
          {!locked && (
            <div className="flex flex-wrap gap-2">
              {QUESTION_TYPES_FOR[draft.kind].map((t) => (
                <Button key={t} variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => set({ questions: [...draft.questions, newQuestion(t)] })}>{QTYPE_LABELS[t]}</Button>
              ))}
            </div>
          )}
        </section>
      )}

      <Card className="sticky bottom-3 flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-semibold text-ink">Total: {total} marks</span>
        <span className="flex-1" />
        {message && <span className="w-full sm:w-auto"><Notice kind={message.kind}>{message.text}</Notice></span>}
        <Button onClick={save} loading={busy}>Save</Button>
        {meta?.status === 'draft' && <Button variant="success" onClick={() => changeStatus('published')} disabled={busy}>Publish</Button>}
        {meta?.status === 'published' && <Button variant="ghost" onClick={() => changeStatus('archived')} disabled={busy}>Archive</Button>}
        {!isNew && <Link href={`/dashboard/assessments/${assessmentId}`} className={buttonClasses('ghost')}>Submissions</Link>}
      </Card>
    </div>
  );
}

function AssessmentEditorPageContent({ params, searchParams }: { params: Promise<{ courseId: string; assessmentId: string }>; searchParams: Promise<{ kind?: string; lessonId?: string }> }) {
  const { courseId, assessmentId } = use(params);
  const sp = use(searchParams);
  const kind = (['quiz', 'short_answer', 'long_answer', 'practical', 'exam'].includes(sp.kind ?? '') ? sp.kind : 'quiz') as AssessmentKind;
  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'instructor', 'content_lead', 'content_designer']}>
      <AppShell><Editor courseId={courseId} assessmentId={assessmentId} initialKind={kind} initialLesson={sp.lessonId} /></AppShell>
    </RequireRole>
  );
}

/** `params` / `searchParams` are read inside Suspense so the route can stream (Next 16). */
export default function AssessmentEditorPage(props: Parameters<typeof AssessmentEditorPageContent>[0]) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" role="status"><span className="sr-only">Loading…</span></div>}>
      <AssessmentEditorPageContent {...props} />
    </Suspense>
  );
}

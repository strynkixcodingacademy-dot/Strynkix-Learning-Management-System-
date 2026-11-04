'use client';

/**
 * Strynkix Live Books — course maintenance controls for the Curriculum Builder
 * (milestone G28–G30): edit draft course details, edit/reorder/delete modules,
 * reorder/move/delete draft lessons. Every action goes through the audited
 * POST /api/content/structure, which re-checks authority and refuses changes
 * to published content; these controls only hide what would be refused.
 */

import React, { useState } from 'react';
import { changeCourseStructure } from '@/lib/courses/service';
import { ApiError } from '@/lib/api/authed';
import { Course, CourseLevel, Module } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { Field, fieldClasses } from '@/components/ui/Page';
import { Notice } from '@/components/ui/States';
import { ArrowDown, ArrowUp, Pencil, Trash2, X } from 'lucide-react';
import type { StructureRequest } from '@/lib/server/content-structure';
import { firestoreErrorMessage } from '@/lib/firebase/errors';

export async function runStructureChange(req: StructureRequest): Promise<string | null> {
  try {
    await changeCourseStructure(req);
    return null;
  } catch (err) {
    return err instanceof ApiError ? err.message : firestoreErrorMessage(err, 'The change couldn’t be saved.');
  }
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-scrim backdrop-blur-[3px] animate-fade" />
      <section role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-float animate-rise">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[18px] font-extrabold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

const LEVELS: CourseLevel[] = ['beginner', 'intermediate', 'advanced'];

/** G28: edit the details of a draft course. */
export function CourseDetailsDialog({ course, onClose, onSaved }: { course: Course; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(course.title);
  const [tagline, setTagline] = useState(course.tagline ?? '');
  const [description, setDescription] = useState(course.description ?? '');
  const [level, setLevel] = useState<CourseLevel>(course.level ?? 'beginner');
  const [tags, setTags] = useState((course.tags ?? []).join(', '));
  const [weeks, setWeeks] = useState(course.estimatedWeeks ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (title.trim().length < 2) return setError('Give the course a title of at least 2 characters.');
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) return setError('Estimated weeks must be a whole number from 1 to 52.');
    setBusy(true);
    setError(null);
    const err = await runStructureChange({
      action: 'update_course', courseId: course.id,
      fields: { title: title.trim(), tagline: tagline.trim(), description: description.trim(), level, tags: tagList, estimatedWeeks: weeks },
    });
    setBusy(false);
    if (err) return setError(err);
    onSaved();
  };

  return (
    <Dialog title="Edit course details" onClose={onClose}>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Title" htmlFor="cd-title" required>
          <input id="cd-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className={fieldClasses} />
        </Field>
        <Field label="Tagline" htmlFor="cd-tagline">
          <input id="cd-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={240} className={fieldClasses} />
        </Field>
        <Field label="Description" htmlFor="cd-description">
          <textarea id="cd-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClasses} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Level" htmlFor="cd-level">
            <select id="cd-level" value={level} onChange={(e) => setLevel(e.target.value as CourseLevel)} className={fieldClasses}>
              {LEVELS.map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Estimated weeks" htmlFor="cd-weeks">
            <input id="cd-weeks" type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className={fieldClasses} />
          </Field>
        </div>
        <Field label="Tags" htmlFor="cd-tags" hint="Comma-separated, up to 15.">
          <input id="cd-tags" value={tags} onChange={(e) => setTags(e.target.value)} className={fieldClasses} />
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Save details</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** G29: edit a module's title and summary. */
export function ModuleDetailsDialog({ module, onClose, onSaved }: { module: Module; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(module.title);
  const [summary, setSummary] = useState(module.summary ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 2) return setError('Give the module a title of at least 2 characters.');
    setBusy(true);
    setError(null);
    const err = await runStructureChange({ action: 'update_module', moduleId: module.id, fields: { title: title.trim(), summary: summary.trim() } });
    setBusy(false);
    if (err) return setError(err);
    onSaved();
  };

  return (
    <Dialog title="Edit module" onClose={onClose}>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Title" htmlFor="md-title" required>
          <input id="md-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className={fieldClasses} />
        </Field>
        <Field label="Summary" htmlFor="md-summary">
          <textarea id="md-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} className={fieldClasses} />
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Save module</Button>
        </div>
      </form>
    </Dialog>
  );
}

const iconButton = 'inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent';

/** Up / down / edit / delete buttons for one row. Missing handlers hide the button. */
export function RowControls({ label, busy, onUp, onDown, onEdit, onDelete }: {
  label: string;
  busy?: boolean;
  onUp?: (() => void) | null;
  onDown?: (() => void) | null;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {onUp !== undefined && <button type="button" className={iconButton} disabled={busy || !onUp} onClick={() => onUp?.()} aria-label={`Move ${label} up`} title="Move up"><ArrowUp className="h-4 w-4" /></button>}
      {onDown !== undefined && <button type="button" className={iconButton} disabled={busy || !onDown} onClick={() => onDown?.()} aria-label={`Move ${label} down`} title="Move down"><ArrowDown className="h-4 w-4" /></button>}
      {onEdit && <button type="button" className={iconButton} disabled={busy} onClick={onEdit} aria-label={`Edit ${label}`} title="Edit"><Pencil className="h-4 w-4" /></button>}
      {onDelete && <button type="button" className={`${iconButton} hover:text-danger-ink`} disabled={busy} onClick={onDelete} aria-label={`Delete ${label}`} title="Delete"><Trash2 className="h-4 w-4" /></button>}
    </div>
  );
}

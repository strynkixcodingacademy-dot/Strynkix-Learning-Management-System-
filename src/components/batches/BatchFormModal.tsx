'use client';

/**
 * Strynkix LMS — Batch Create / Edit Modal
 * Branch and course are chosen at creation and are immutable afterwards.
 */

import React, { useEffect, useState } from 'react';
import { Batch, BatchStatus, Branch, Course, UserProfile } from '@/types/domain';
import { TenantContext } from '@/types/auth';
import { createBatch, getAssignableInstructors, updateBatch } from '@/lib/batches/service';
import { MAX_BATCH_INSTRUCTORS } from '@/types/validation';
import { AlertCircle, Layers, Loader2 } from 'lucide-react';

interface BatchFormModalProps {
  tenant: TenantContext;
  actorUid: string;
  branches: Branch[];
  courses: Course[];
  /** When provided, the modal edits this batch instead of creating one. */
  batch?: Batch | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const EDITABLE_STATUSES: { value: BatchStatus; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand';

function toDateInput(iso?: string): string {
  return iso ? iso.slice(0, 10) : '';
}

function fromDateInput(value: string): string | undefined {
  return value ? `${value}T00:00:00.000Z` : undefined;
}

export function BatchFormModal({ tenant, actorUid, branches, courses, batch, onClose, onSaved }: BatchFormModalProps) {
  const isEdit = Boolean(batch);

  const [branchId, setBranchId] = useState(batch?.branchId || branches[0]?.id || '');
  const selectedBranch = branches.find((b) => b.id === branchId) || null;
  const orgId = batch?.orgId || selectedBranch?.orgId || '';
  const courseOptions = courses.filter((c) => c.orgId === orgId && (c.status !== 'archived' || c.id === batch?.courseId));

  const [courseId, setCourseId] = useState(batch?.courseId || '');
  // Falls back to the first course of the selected branch's org when the branch changes.
  const effectiveCourseId = courseOptions.some((c) => c.id === courseId) ? courseId : courseOptions[0]?.id || '';
  const [name, setName] = useState(batch?.name || '');
  const [code, setCode] = useState(batch?.code || '');
  const [startDate, setStartDate] = useState(toDateInput(batch?.startDate));
  const [endDate, setEndDate] = useState(toDateInput(batch?.endDate));
  const [maxStudents, setMaxStudents] = useState(batch?.maxStudents ? String(batch.maxStudents) : '');
  const [status, setStatus] = useState<BatchStatus>(batch?.status || 'upcoming');
  const [instructorIds, setInstructorIds] = useState<string[]>(batch?.instructorUserIds || []);

  const [instructors, setInstructors] = useState<UserProfile[]>([]);
  const [instructorsLoading, setInstructorsLoading] = useState(false);
  const [instructorsError, setInstructorsError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Instructors must belong to the batch's org and (if scoped) branch.
  useEffect(() => {
    let isMounted = true;
    async function loadInstructors() {
      if (!orgId || !branchId) {
        setInstructors([]);
        return;
      }
      setInstructorsLoading(true);
      setInstructorsError(null);
      try {
        const loaded = await getAssignableInstructors({ orgId, branchId }, tenant);
        if (isMounted) setInstructors(loaded);
      } catch (err) {
        console.error('Failed to load instructors', err);
        if (isMounted) setInstructorsError('Unable to load instructors for this branch.');
      } finally {
        if (isMounted) setInstructorsLoading(false);
      }
    }
    loadInstructors();
    return () => {
      isMounted = false;
    };
  }, [orgId, branchId, tenant]);

  const toggleInstructor = (uid: string) => {
    setInstructorIds((current) =>
      current.includes(uid) ? current.filter((id) => id !== uid) : [...current, uid]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (instructorIds.length > MAX_BATCH_INSTRUCTORS) {
      setFormError(`Select at most ${MAX_BATCH_INSTRUCTORS} instructors.`);
      return;
    }
    const parsedMax = maxStudents.trim() ? Number(maxStudents) : undefined;
    if (parsedMax !== undefined && !Number.isInteger(parsedMax)) {
      setFormError('Maximum students must be a whole number.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (batch) {
        await updateBatch(
          batch,
          {
            name: name.trim(),
            code: code.trim(),
            startDate: fromDateInput(startDate),
            endDate: fromDateInput(endDate),
            maxStudents: parsedMax,
            status,
            instructorUserIds: instructorIds,
          },
          tenant
        );
        onSaved(`Batch "${name.trim()}" updated.`);
      } else {
        if (!selectedBranch) throw new Error('Select a branch.');
        if (!effectiveCourseId) throw new Error('Select a course.');
        if (!startDate) throw new Error('Start date is required.');
        await createBatch(
          {
            orgId: selectedBranch.orgId,
            branchId,
            courseId: effectiveCourseId,
            name: name.trim(),
            code: code.trim(),
            instructorUserIds: instructorIds,
            startDate: fromDateInput(startDate)!,
            endDate: fromDateInput(endDate),
            maxStudents: parsedMax,
            status,
          },
          tenant,
          actorUid
        );
        onSaved(`Batch "${name.trim()}" created.`);
      }
    } catch (err: unknown) {
      setFormError((err as Error).message || 'Failed to save batch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
      <div className="max-w-lg w-full max-h-[90vh] overflow-y-auto rounded-2xl bg-surface border border-line shadow-lift p-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div className="flex items-center gap-2 text-brand-ink font-bold text-sm">
            <Layers className="w-5 h-5" />
            <span>{isEdit ? 'Edit Batch' : 'Create Batch'}</span>
          </div>
          <button onClick={onClose} className="text-ink-3 hover:text-ink text-xs font-mono">
            Cancel
          </button>
        </div>

        {formError && (
          <div className="p-3 rounded-lg bg-danger-soft border border-danger-line text-xs text-danger-ink flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-2">
                Branch <span className="text-danger-ink">*</span>
              </label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                disabled={isEdit}
                required
                className={`${inputClass} font-mono disabled:opacity-60`}
              >
                {branches.length === 0 && <option value="">No branches available</option>}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-2">
                Course <span className="text-danger-ink">*</span>
              </label>
              <select
                value={effectiveCourseId}
                onChange={(e) => setCourseId(e.target.value)}
                disabled={isEdit}
                required
                className={`${inputClass} disabled:opacity-60`}
              >
                {courseOptions.length === 0 && <option value="">No courses in this organization</option>}
                {courseOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} {c.status !== 'published' ? `(${c.status})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {isEdit && (
            <p className="text-[11px] text-ink-3">Branch and course cannot be changed after a batch is created.</p>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-semibold text-ink-2">
                Batch Name <span className="text-danger-ink">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Full-Stack Alpha 2026"
                required
                minLength={2}
                maxLength={160}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-2">
                Code <span className="text-danger-ink">*</span>
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="FSA-26"
                required
                minLength={2}
                maxLength={30}
                className={`${inputClass} font-mono uppercase`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-2">
                Start Date <span className="text-danger-ink">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-2">End Date</label>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-2">Max Students</label>
              <input
                type="number"
                min={1}
                max={200}
                value={maxStudents}
                onChange={(e) => setMaxStudents(e.target.value)}
                placeholder="Unlimited"
                className={inputClass}
              />
            </div>
          </div>

          {(!isEdit || batch?.status !== 'archived') && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-2">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BatchStatus)}
                className={inputClass}
              >
                {EDITABLE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-ink-2">Instructors</label>
              <span className="text-[11px] font-mono text-ink-3">
                {instructorIds.length}/{MAX_BATCH_INSTRUCTORS} selected
              </span>
            </div>
            {instructorsLoading && (
              <div className="flex items-center gap-2 text-xs text-ink-3">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Loading instructors...</span>
              </div>
            )}
            {instructorsError && <p className="text-xs text-danger-ink">{instructorsError}</p>}
            {!instructorsLoading && !instructorsError && instructors.length === 0 && (
              <p className="text-xs text-ink-3">
                No active instructors are available for this branch. You can assign instructors later.
              </p>
            )}
            {!instructorsLoading && instructors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                {instructors.map((inst) => (
                  <label
                    key={inst.id}
                    className="flex items-center gap-3 px-3 py-2 text-xs text-ink-2 cursor-pointer hover:bg-surface-muted"
                  >
                    <input
                      type="checkbox"
                      checked={instructorIds.includes(inst.id)}
                      onChange={() => toggleInstructor(inst.id)}
                      disabled={!instructorIds.includes(inst.id) && instructorIds.length >= MAX_BATCH_INSTRUCTORS}
                      className="rounded border-line text-brand-ink focus:ring-brand"
                    />
                    <span className="font-semibold">{inst.displayName}</span>
                    <span className="text-ink-3 font-mono truncate">{inst.email}</span>
                  </label>
                ))}
              </div>
            )}
            {!instructorsLoading &&
              instructorIds
                .filter((id) => !instructors.some((i) => i.id === id))
                .map((id) => (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-warning-soft border border-warning-line text-[11px] text-warning-ink"
                  >
                    <span>
                      <span className="font-mono">{id}</span> is no longer eligible or is outside your scope.
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleInstructor(id)}
                      className="shrink-0 font-semibold text-warning-ink hover:text-warning-ink"
                    >
                      Remove
                    </button>
                  </div>
                ))}
          </div>

          <div className="pt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink-2 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (!isEdit && (branches.length === 0 || courseOptions.length === 0))}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Batch'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

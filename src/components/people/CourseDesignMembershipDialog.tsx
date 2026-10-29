'use client';

/**
 * Strynkix Live Books — assign, update or revoke Course Design membership on an
 * existing account (Super Admin only; enforced by firestore.rules).
 */

import React, { useState } from 'react';
import { assignCourseDesignMembership, revokeCourseDesignMembership } from '@/lib/admin/service';
import { MembershipInput } from '@/lib/admin/course-design';
import { courseDesignInputSchema } from '@/types/validation';
import { CourseDesignProfile, UserProfile } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/States';
import { PenTool, X } from 'lucide-react';
import { CourseDesignFields } from './CourseDesignFields';

export function CourseDesignMembershipDialog({
  person,
  onClose,
  onSaved,
}: {
  person: UserProfile;
  onClose: () => void;
  onSaved: (courseDesign: CourseDesignProfile | undefined) => void;
}) {
  const [value, setValue] = useState<MembershipInput>({
    responsibilities: person.courseDesign?.responsibilities ?? [],
    assignedCourseIds: person.courseDesign?.assignedCourseIds ?? [],
  });
  const [busy, setBusy] = useState<'save' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const parsed = courseDesignInputSchema.safeParse(value);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Choose responsibilities and a course scope.');
    setBusy('save');
    setError(null);
    try {
      onSaved(await assignCourseDesignMembership(person.id, parsed.data));
    } catch (err) {
      setError((err as Error).message || 'Membership couldn’t be saved.');
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy('revoke');
    setError(null);
    try {
      await revokeCourseDesignMembership(person.id);
      onSaved(undefined);
    } catch (err) {
      setError((err as Error).message || 'Membership couldn’t be removed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20 backdrop-blur-[3px] animate-fade" />
      <section role="dialog" aria-modal="true" aria-labelledby="cd-title" className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-float animate-rise">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-coral-soft text-coral-ink"><PenTool className="h-5 w-5" /></span>
          <div className="flex-1">
            <h2 id="cd-title" className="text-[18px] font-extrabold text-ink">Course Design membership</h2>
            <p className="text-sm text-ink-3">{person.displayName} · {person.email}</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <p className="mt-4 text-xs text-ink-3">Members edit draft courses in their scope. Publishing stays with the Super Admin; review and assessment tools arrive in a later stage.</p>
        <div className="mt-4"><CourseDesignFields orgId={person.orgId} value={value} onChange={setValue} /></div>
        {error && <Notice kind="error" className="mt-4">{error}</Notice>}
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          {person.courseDesign ? <Button variant="danger" loading={busy === 'revoke'} disabled={busy !== null} onClick={revoke}>Remove membership</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button loading={busy === 'save'} disabled={busy !== null} onClick={save}>{person.courseDesign ? 'Save changes' : 'Assign membership'}</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

'use client';

/**
 * Strynkix Live Books — "Add content team member" (Super Admin).
 * Creates a Content Designer or Content Lead account. The role is a label;
 * what the person can do comes only from the responsibilities and course scope
 * chosen here (nothing is pre-selected). Credentials are shown once.
 */

import React, { useState } from 'react';
import { createContentMember, generateTempPassword, validateProvisionInput } from '@/lib/admin/service';
import { MembershipInput } from '@/lib/admin/course-design';
import { courseDesignInputSchema } from '@/types/validation';
import { UserProfile } from '@/types/domain';
import { CourseDesignFields } from './CourseDesignFields';
import { Button } from '@/components/ui/Button';
import { Field, fieldClasses } from '@/components/ui/Page';
import { Notice } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { Check, Copy, KeyRound, PenTool, X } from 'lucide-react';

type ContentRole = 'content_designer' | 'content_lead';

const ROLE_INFO: Record<ContentRole, { label: string; body: string }> = {
  content_designer: { label: 'Content Designer', body: 'A member of the Course Design team. Works on draft courses in their scope.' },
  content_lead: { label: 'Content Lead', body: 'Leads the Course Design team. Same draft access as their responsibilities allow; only the Super Admin publishes.' },
};

export function ContentMemberDialog({ orgId, onClose, onCreated }: { orgId: string; onClose: () => void; onCreated: (p: UserProfile) => void }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ContentRole>('content_designer');
  const [password, setPassword] = useState(() => generateTempPassword());
  const [membership, setMembership] = useState<MembershipInput>({ responsibilities: [], assignedCourseIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; role: ContentRole } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateProvisionInput({ email, password, displayName, orgId, branchId: '' });
    if (invalid) return setError(invalid);

    const parsed = courseDesignInputSchema.safeParse(membership);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Choose responsibilities and a course scope.');

    setBusy(true);
    setError(null);
    try {
      const account = await createContentMember(role, { email, password, displayName, orgId, courseDesign: parsed.data });
      onCreated(account.profile);
      setCreated({ name: account.displayName, email: account.email, role });
    } catch (err) {
      setError((err as Error).message || 'The account couldn’t be created.');
    } finally {
      setBusy(false);
    }
  };

  const credentials = created
    ? `Strynkix Live Books — ${ROLE_INFO[created.role].label}\nSign in: ${typeof window !== 'undefined' ? window.location.origin : ''}/login\nEmail: ${created.email}\nTemporary password: ${password}\nPlease set your own password with “Forgot password?” after your first sign-in.`
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20 backdrop-blur-[3px] animate-fade" />
      <section role="dialog" aria-modal="true" aria-labelledby="content-member-title" className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-float animate-rise">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-coral-soft text-coral-ink"><PenTool className="h-5 w-5" /></span>
          <div className="flex-1">
            <h2 id="content-member-title" className="text-[18px] font-extrabold text-ink">{created ? 'Account created' : 'Add content team member'}</h2>
            <p className="text-sm text-ink-3">Course Design department · access only to the courses you choose.</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {created ? (
          <div className="mt-5 space-y-4">
            <Notice kind="success">{created.name} can now sign in as a {ROLE_INFO[created.role].label}.</Notice>
            <pre className="whitespace-pre-wrap rounded-xl border border-line bg-surface-muted p-4 font-mono text-xs text-ink-2">{credentials}</pre>
            <p className="text-xs text-ink-3">Share these privately. The password is shown only now.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                onClick={() => { navigator.clipboard?.writeText(credentials).then(() => setCopied(true)).catch(() => setCopied(false)); }}>
                {copied ? 'Copied' : 'Copy credentials'}
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-2">Role</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(ROLE_INFO) as ContentRole[]).map((r) => (
                  <label key={r} className={cx('cursor-pointer rounded-xl border p-3 transition-colors', role === r ? 'border-brand bg-brand-soft' : 'border-line hover:border-silver')}>
                    <input type="radio" name="content-role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                    <span className="block text-sm font-bold text-ink">{ROLE_INFO[r].label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{ROLE_INFO[r].body}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <CourseDesignFields orgId={orgId} value={membership} onChange={setMembership} />
            <Field label="Full name" htmlFor="cm-name" required>
              <input id="cm-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} autoComplete="off" className={fieldClasses} />
            </Field>
            <Field label="Email address" htmlFor="cm-email" required>
              <input id="cm-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={fieldClasses} />
            </Field>
            <Field label="Temporary password" htmlFor="cm-password" required hint="They should replace it with the reset link after first sign-in.">
              <div className="flex gap-2">
                <input id="cm-password" value={password} onChange={(e) => setPassword(e.target.value)} className={cx(fieldClasses, 'font-mono')} />
                <Button variant="secondary" onClick={() => setPassword(generateTempPassword())} icon={<KeyRound className="h-4 w-4" />}>New</Button>
              </div>
            </Field>
            {error && <Notice kind="error">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={busy}>Create account</Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

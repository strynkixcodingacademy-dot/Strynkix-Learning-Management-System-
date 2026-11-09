'use client';

/**
 * Strynkix Live Books — "Add University Admin" (Super Admin, milestone G37).
 * Creates an academy-wide administrator for one academy through the audited
 * server route. The academy is fixed by the card it was opened from; nobody
 * chooses their own role or academy. Credentials are shown once.
 */

import React, { useState } from 'react';
import { ModalFrame } from '@/components/ui/Modal';
import { createUniversityAdmin, generateTempPassword, validateProvisionInput } from '@/lib/admin/service';
import { Button } from '@/components/ui/Button';
import { Field, fieldClasses } from '@/components/ui/Page';
import { Notice } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { Check, Copy, KeyRound, ShieldCheck, X } from 'lucide-react';

export function UniversityAdminDialog({ orgId, orgName, onClose }: { orgId: string; orgName: string; onClose: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generateTempPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateProvisionInput({ email, password, displayName, orgId, branchId: '' });
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      const account = await createUniversityAdmin({ email, password, displayName, orgId });
      setCreated({ name: account.displayName, email: account.email });
    } catch (err) {
      setError((err as Error).message || 'The account couldn’t be created.');
    } finally {
      setBusy(false);
    }
  };

  const credentials = created
    ? `Strynkix Live Books — University Admin (${orgName})\nSign in: ${typeof window !== 'undefined' ? window.location.origin : ''}/login\nEmail: ${created.email}\nTemporary password: ${password}\nPlease change your password from My Profile after your first sign-in.`
    : '';

  return (
    <ModalFrame onClose={onClose}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" />
      <section role="dialog" aria-modal="true" aria-labelledby="uni-admin-title" className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-float animate-rise">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-info-soft text-info-ink"><ShieldCheck className="h-5 w-5" /></span>
          <div className="flex-1">
            <h2 id="uni-admin-title" className="type-section text-ink">{created ? 'Account created' : 'Add University Admin'}</h2>
            <p className="text-sm text-ink-3">{orgName} · manages branches, managers, instructors and students of this academy.</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {created ? (
          <div className="mt-5 space-y-4">
            <Notice kind="success">{created.name} can now sign in as University Admin of {orgName}.</Notice>
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
            <Field label="Full name" htmlFor="ua-name" required>
              <input id="ua-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} autoComplete="off" className={fieldClasses} />
            </Field>
            <Field label="Email address" htmlFor="ua-email" required>
              <input id="ua-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={fieldClasses} />
            </Field>
            <Field label="Temporary password" htmlFor="ua-password" required hint="They should change it from My Profile after first sign-in.">
              <div className="flex gap-2">
                <input id="ua-password" value={password} onChange={(e) => setPassword(e.target.value)} className={cx(fieldClasses, 'font-mono')} />
                <Button variant="secondary" onClick={() => setPassword(generateTempPassword())} icon={<KeyRound className="h-4 w-4" />}>New</Button>
              </div>
            </Field>
            {error && <Notice kind="error">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" loading={busy}>Create account</Button>
            </div>
          </form>
        )}
      </section>
    </ModalFrame>
  );
}

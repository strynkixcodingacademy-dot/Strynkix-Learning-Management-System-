'use client';

/**
 * Strynkix Live Books — signed-in password and email changes (milestone G05/G06).
 * Both confirm the current password first (Firebase requires a recent
 * sign-in). Passwords are sent only to Firebase Authentication — never stored
 * or logged. An email change takes effect when the link sent to the new
 * address is opened; the profile then follows on the next sign-in.
 */

import React, { useState } from 'react';
import { changeOwnPassword, requestOwnEmailChange } from '@/lib/account/service';
import { Button } from '@/components/ui/Button';
import { Field, fieldClasses } from '@/components/ui/Page';
import { Notice } from '@/components/ui/States';

export function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < 8;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch || tooShort || !current) return;
    setBusy(true);
    setMessage(null);
    try {
      await changeOwnPassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ kind: 'success', text: 'Password changed. Use the new password next time you sign in.' });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-3" aria-label="Change password">
      <Field label="Current password" htmlFor="pw-current" required>
        <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={fieldClasses} />
      </Field>
      <Field label="New password" htmlFor="pw-new" required hint="At least 8 characters." error={tooShort ? 'Use at least 8 characters.' : null}>
        <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={fieldClasses} />
      </Field>
      <Field label="Confirm new password" htmlFor="pw-confirm" required error={mismatch ? 'The passwords don’t match.' : null}>
        <input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={fieldClasses} />
      </Field>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Button type="submit" loading={busy} disabled={!current || !next || !confirm || mismatch || tooShort}>Change password</Button>
    </form>
  );
}

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await requestOwnEmailChange(password, email);
      setMessage({ kind: 'success', text: `We sent a verification link to ${email.trim().toLowerCase()}. Your sign-in email changes when you open it; until then, keep using ${currentEmail}.` });
      setPassword('');
      setEmail('');
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-3" aria-label="Change email">
      <Field label="New email address" htmlFor="em-new" required>
        <input id="em-new" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClasses} />
      </Field>
      <Field label="Current password" htmlFor="em-password" required>
        <input id="em-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClasses} />
      </Field>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Button type="submit" variant="secondary" loading={busy} disabled={!email.trim() || !password}>Send verification link</Button>
    </form>
  );
}

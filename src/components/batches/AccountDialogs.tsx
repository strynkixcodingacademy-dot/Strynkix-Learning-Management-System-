'use client';

/**
 * Strynkix LMS — the batch page's "create an account" and "share the login"
 * dialogs, shared by instructors (assigned to the batch) and students
 * (enrolled into it). The page decides what creating an account does.
 */

import React, { useState } from 'react';
import { generateTempPassword } from '@/lib/admin/service';
import { firestoreErrorMessage } from '@/lib/firebase/errors';
import { AlertCircle, Check, CheckCircle2, Copy, Eye, EyeOff, GraduationCap, Loader2, Sparkles, UserPlus, X } from 'lucide-react';

export type AccountKind = 'instructor' | 'student';

export interface NewAccountInput {
  name: string;
  email: string;
  password: string;
}

export interface IssuedCredentials {
  name: string;
  email: string;
  password?: string;
  batchName: string;
  loginUrl: string;
}

const COPY: Record<AccountKind, {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  target: string;
  namePlaceholder: string;
  emailPlaceholder: string;
  submit: string;
  submitting: string;
  failed: string;
  doneTitle: string;
  doneSubtitle: string;
  role: string | null;
  share: (c: IssuedCredentials) => string;
}> = {
  instructor: {
    icon: GraduationCap,
    title: 'Add Lead Instructor',
    subtitle: 'Set up an instructor account and assign them to this batch',
    target: 'Assigning to Batch:',
    namePlaceholder: 'e.g. Prof. Priya Nair',
    emailPlaceholder: 'e.g. priya@strynkix.com',
    submit: 'Create & Assign Instructor',
    submitting: 'Creating & Assigning...',
    failed: 'Failed to create instructor.',
    doneTitle: 'Instructor Assigned Successfully!',
    doneSubtitle: 'Share these login credentials with the instructor',
    role: 'Lead Instructor',
    share: (c) => `🎓 Welcome to Strynkix Coding Academy!

You have been assigned as Instructor for: ${c.batchName}
Role: Instructor
Login URL: ${c.loginUrl}
Email: ${c.email}
Password: ${c.password}

Please log in to manage daily plans, post assignments, and review student code!`,
  },
  student: {
    icon: UserPlus,
    title: 'Create & Enroll Student',
    subtitle: 'Set up a student account and enroll them into this cohort',
    target: 'Enrolling into Batch:',
    namePlaceholder: 'e.g. Rahul Sharma',
    emailPlaceholder: 'e.g. rahul@strynkix.com',
    submit: 'Create & Enroll Student',
    submitting: 'Creating & Enrolling...',
    failed: 'Failed to create student.',
    doneTitle: 'Student Enrolled Successfully!',
    doneSubtitle: 'Share these login credentials with the student',
    role: null,
    share: (c) => `🎓 Welcome to Strynkix Coding Academy!

You have been enrolled in: ${c.batchName}
Role: Student
Login URL: ${c.loginUrl}
Email: ${c.email}
Password: ${c.password}

Please log in to start learning!`,
  },
};

const scrim = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim backdrop-blur-[3px] animate-fade';
const panel = 'relative w-full max-w-lg rounded-2xl bg-surface border border-line shadow-2xl p-6 space-y-5';
const input = 'w-full px-3.5 py-2 rounded-xl bg-canvas border border-line text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand';

/** Creates an account; `onCreate` does the work and resolves once it is done. */
export function CreateAccountDialog({ kind, batch, onCreate, onClose }: {
  kind: AccountKind;
  batch: { name: string; code: string };
  onCreate: (input: NewAccountInput) => Promise<void>;
  onClose: () => void;
}) {
  const copy = COPY[kind];
  const Icon = copy.icon;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generateTempPassword());
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name, email, password });
    } catch (err) {
      setError(firestoreErrorMessage(err, copy.failed));
      setBusy(false);
    }
  };

  return (
    <div className={scrim}>
      <div className={panel}>
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand-ink">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink">{copy.title}</h3>
              <p className="text-xs text-ink-3">{copy.subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-surface-muted border border-line text-xs space-y-1">
          <div className="font-semibold text-ink">{copy.target}</div>
          <div className="text-brand-ink">{batch.name} ({batch.code})</div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-danger-soft border border-danger-line flex items-center gap-2 text-danger-ink text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink">Full Name</label>
            <input type="text" required placeholder={copy.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink">Email Address</label>
            <input type="email" required placeholder={copy.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-ink">Initial Password</label>
              <button type="button" onClick={() => setPassword(generateTempPassword())} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-ink hover:underline">
                <Sparkles className="w-3 h-3" />
                Generate Strong
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-3.5 pr-10 py-2 rounded-xl bg-canvas border border-line text-xs font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-ink-3 hover:text-ink">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-line">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-ink hover:bg-surface-muted transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name || !email || !password}
              className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-brand/20 transition-all"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{busy ? copy.submitting : copy.submit}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Shows a new account's login once, with a button to copy it for sharing. */
export function CredentialsDialog({ kind, creds, onClose }: { kind: AccountKind; creds: IssuedCredentials; onClose: () => void }) {
  const copy = COPY[kind];
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(copy.share(creds));
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const row = 'flex justify-between items-center pb-2 border-b border-line';
  return (
    <div className={scrim}>
      <div className={panel}>
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/15 border border-success/30 flex items-center justify-center text-success-ink">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink">{copy.doneTitle}</h3>
              <p className="text-xs text-ink-3">{copy.doneSubtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 p-4 rounded-xl bg-surface-muted border border-line text-xs font-mono">
          <div className={row}>
            <span className="text-ink-3">Cohort / Batch:</span>
            <span className="font-bold text-ink">{creds.batchName}</span>
          </div>
          <div className={row}>
            <span className="text-ink-3">Full Name:</span>
            <span className="font-bold text-ink">{creds.name}</span>
          </div>
          {copy.role && (
            <div className={row}>
              <span className="text-ink-3">Role:</span>
              <span className="font-bold text-brand-ink">{copy.role}</span>
            </div>
          )}
          <div className={row}>
            <span className="text-ink-3">Email:</span>
            <span className="font-bold text-brand-ink">{creds.email}</span>
          </div>
          <div className={row}>
            <span className="text-ink-3">Password:</span>
            <span className="font-bold text-ink">{creds.password}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-ink-3">Login URL:</span>
            <span className="text-ink underline">{creds.loginUrl}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2 border-t border-line">
          <button
            type="button"
            onClick={copyToClipboard}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-surface border border-line hover:bg-surface-sunken text-xs font-semibold text-ink transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-success-ink" />
                <span className="text-success-ink">Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy Credentials to Share</span>
              </>
            )}
          </button>
          <button type="button" onClick={onClose} className="w-full sm:w-auto px-5 py-2 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold transition-all">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

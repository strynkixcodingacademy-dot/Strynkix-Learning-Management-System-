'use client';

/**
 * Strynkix Live Books — edit an academy or a branch, and switch it between
 * active and deactivated (milestone G35). Changes go through the audited
 * POST /api/admin/academy; nothing is ever deleted.
 */

import React, { useState } from 'react';
import { changeAcademy } from '@/lib/admin/service';
import { ApiError } from '@/lib/api/authed';
import { Branch, Organization } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { Field, fieldClasses } from '@/components/ui/Page';
import { Notice } from '@/components/ui/States';
import { X } from 'lucide-react';
import { firestoreErrorMessage } from '@/lib/firebase/errors';

const message = (err: unknown) => (err instanceof ApiError ? err.message : firestoreErrorMessage(err, 'The change couldn’t be saved.'));

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-scrim backdrop-blur-[3px] animate-fade" />
      <section role="dialog" aria-modal="true" aria-label={title} className="relative w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-float animate-rise">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[18px] font-extrabold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function StatusSection({ active, kind, busy, onToggle }: { active: boolean; kind: 'academy' | 'branch'; busy: boolean; onToggle: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="mt-6 space-y-3 border-t border-line pt-4">
      <h3 className="text-sm font-bold text-ink">{active ? `Deactivate this ${kind}` : `Reactivate this ${kind}`}</h3>
      <p className="text-xs text-ink-3">
        {active
          ? `A deactivated ${kind} keeps all its people, batches and history, but no new accounts${kind === 'branch' ? ' or batches' : ''} can be added to it.`
          : `Reactivating allows new accounts${kind === 'branch' ? ' and batches' : ''} again.`}
      </p>
      {active && (
        <Field label="Reason (recorded in the audit log)" htmlFor={`${kind}-reason`}>
          <input id={`${kind}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={fieldClasses} />
        </Field>
      )}
      <Button variant={active ? 'danger' : 'secondary'} loading={busy} onClick={() => onToggle(reason.trim())}>{active ? 'Deactivate' : 'Reactivate'}</Button>
    </div>
  );
}

export function OrganizationEditDialog({ org, onClose, onSaved }: { org: Organization; onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState(org.name);
  const [website, setWebsite] = useState(org.website ?? '');
  const [timeZone, setTimeZone] = useState(org.settings?.defaultTimezone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved(done);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={`Edit ${org.name}`} onClose={onClose}>
      <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => changeAcademy({ action: 'update_org', orgId: org.id, fields: { name: name.trim(), website: website.trim(), ...(timeZone.trim() ? { defaultTimezone: timeZone.trim() } : {}) } }), 'Academy saved.'); }}>
        <Field label="Name" htmlFor="org-name" required>
          <input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={fieldClasses} />
        </Field>
        <Field label="Website" htmlFor="org-web" hint="Leave empty to remove.">
          <input id="org-web" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" className={fieldClasses} />
        </Field>
        <Field label="Time zone" htmlFor="org-tz" hint="IANA name, for example Asia/Kolkata.">
          <input id="org-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className={fieldClasses} />
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Save</Button>
        </div>
      </form>
      <StatusSection kind="academy" active={org.status === 'active'} busy={busy}
        onToggle={(reason) => run(() => changeAcademy({ action: 'set_org_status', orgId: org.id, status: org.status === 'active' ? 'suspended' : 'active', ...(reason ? { reason } : {}) }),
          org.status === 'active' ? 'Academy deactivated.' : 'Academy reactivated.')} />
    </Shell>
  );
}

export function BranchEditDialog({ branch, onClose, onSaved }: { branch: Branch; onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState(branch.name);
  const [code, setCode] = useState(branch.code ?? '');
  const [city, setCity] = useState(branch.location?.city ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved(done);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={`Edit ${branch.name}`} onClose={onClose}>
      <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => changeAcademy({ action: 'update_branch', branchId: branch.id, fields: { name: name.trim(), ...(code.trim() ? { code: code.trim() } : {}), city: city.trim() } }), 'Branch saved.'); }}>
        <Field label="Name" htmlFor="br-name" required>
          <input id="br-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={fieldClasses} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" htmlFor="br-code">
            <input id="br-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} className={fieldClasses} />
          </Field>
          <Field label="City" htmlFor="br-city">
            <input id="br-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} className={fieldClasses} />
          </Field>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Save</Button>
        </div>
      </form>
      <StatusSection kind="branch" active={branch.status === 'active'} busy={busy}
        onToggle={(reason) => run(() => changeAcademy({ action: 'set_branch_status', branchId: branch.id, status: branch.status === 'active' ? 'inactive' : 'active', ...(reason ? { reason } : {}) }),
          branch.status === 'active' ? 'Branch deactivated.' : 'Branch reactivated.')} />
    </Shell>
  );
}

'use client';

/**
 * Strynkix Live Books — correct an account (milestone G40): change role, move
 * to another branch, or fix the sign-in email. Each change is confirmed, then
 * authorized, validated and audited by POST /api/admin/account-profile; the
 * options offered here only mirror what the server allows.
 */

import React, { useState } from 'react';
import { correctAccount } from '@/lib/admin/service';
import { ACADEMY_WIDE_ROLES, ProvisionableRole, manageableRoles } from '@/lib/admin/account-authority';
import { ApiError } from '@/lib/api/authed';
import { ROLE_LABELS } from '@/components/dashboard/AppShell';
import { Branch, UserProfile, UserRole } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { Field, fieldClasses } from '@/components/ui/Page';
import { Notice } from '@/components/ui/States';
import { X } from 'lucide-react';

type Section = 'role' | 'branch' | 'email';

export function AccountEditDialog({ person, viewerRole, branches, onClose, onSaved }: {
  person: UserProfile;
  viewerRole: UserRole;
  /** Branches of the academy (academy admins); empty for Branch Managers. */
  branches: Branch[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const roles = manageableRoles({ role: viewerRole }).filter((r) => r !== person.role) as ProvisionableRole[];
  const activeBranches = branches.filter((b) => b.status === 'active');
  const [role, setRole] = useState<ProvisionableRole | ''>('');
  const [roleBranch, setRoleBranch] = useState(person.branchId ?? '');
  const [branch, setBranch] = useState('');
  const [email, setEmail] = useState(person.email);
  const [confirming, setConfirming] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const academyAdmin = viewerRole === 'super_admin' || viewerRole === 'university_admin';
  const hasBranch = !ACADEMY_WIDE_ROLES.includes(person.role);
  const needsBranchForRole = role !== '' && !ACADEMY_WIDE_ROLES.includes(role);
  const branchName = (id?: string) => branches.find((b) => b.id === id)?.name ?? id ?? '—';

  const summary: Record<Section, string> = {
    role: role ? `${ROLE_LABELS[person.role]} → ${ROLE_LABELS[role]}${needsBranchForRole && roleBranch !== person.branchId ? ` in ${branchName(roleBranch)}` : ''}` : '',
    branch: `${branchName(person.branchId)} → ${branchName(branch)}`,
    email: `${person.email} → ${email.trim().toLowerCase()}`,
  };

  const apply = async (section: Section) => {
    setBusy(true);
    setError(null);
    try {
      if (section === 'role' && role) {
        await correctAccount({ action: 'change_role', userId: person.id, role, ...(needsBranchForRole && roleBranch ? { branchId: roleBranch } : {}) });
        onSaved(`${person.displayName} is now ${ROLE_LABELS[role]}.`);
      } else if (section === 'branch') {
        await correctAccount({ action: 'move_branch', userId: person.id, branchId: branch });
        onSaved(`${person.displayName} moved to ${branchName(branch)}.`);
      } else if (section === 'email') {
        await correctAccount({ action: 'change_email', userId: person.id, email: email.trim() });
        onSaved(`Sign-in email updated for ${person.displayName}. They sign in with the new address from now on.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message || 'The change couldn’t be saved.');
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  const confirmBar = (section: Section, disabled: boolean) => confirming === section ? (
    <div className="space-y-2 rounded-xl border border-warning-line bg-warning-soft p-3">
      <p className="text-xs text-ink-2"><strong>Confirm:</strong> {summary[section]}. This is recorded in the audit log.</p>
      <div className="flex gap-2">
        <Button size="sm" loading={busy} onClick={() => apply(section)}>Confirm change</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>Back</Button>
      </div>
    </div>
  ) : (
    <Button size="sm" variant="secondary" disabled={disabled || busy} onClick={() => setConfirming(section)}>Review change</Button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20 backdrop-blur-[3px] animate-fade" />
      <section role="dialog" aria-modal="true" aria-label={`Edit account of ${person.displayName}`} className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-float animate-rise">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-extrabold text-ink">Edit account</h2>
            <p className="text-sm text-ink-3">{person.displayName} · {ROLE_LABELS[person.role]}{person.branchId ? ` · ${branchName(person.branchId)}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {error && <div className="mt-4"><Notice kind="error">{error}</Notice></div>}

        <div className="mt-5 space-y-6">
          <fieldset className="space-y-3">
            <legend className="text-sm font-bold text-ink">Role</legend>
            <Field label="New role" htmlFor="ae-role">
              <select id="ae-role" value={role} onChange={(e) => { setRole(e.target.value as ProvisionableRole | ''); setConfirming(null); }} className={fieldClasses}>
                <option value="">Keep {ROLE_LABELS[person.role]}</option>
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
            {needsBranchForRole && academyAdmin && (!hasBranch || !person.branchId) && (
              <Field label="Branch for the new role" htmlFor="ae-role-branch">
                <select id="ae-role-branch" value={roleBranch} onChange={(e) => setRoleBranch(e.target.value)} className={fieldClasses}>
                  <option value="">Choose a branch</option>
                  {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            <p className="text-xs text-ink-3">Students must be withdrawn from active batches and instructors removed from running batches first. Course Design members must lose membership before a role outside Course Design.</p>
            {confirmBar('role', !role || (needsBranchForRole && !roleBranch))}
          </fieldset>

          {academyAdmin && hasBranch && (
            <fieldset className="space-y-3 border-t border-line pt-5">
              <legend className="text-sm font-bold text-ink">Branch</legend>
              <Field label="Move to branch" htmlFor="ae-branch">
                <select id="ae-branch" value={branch} onChange={(e) => { setBranch(e.target.value); setConfirming(null); }} className={fieldClasses}>
                  <option value="">Keep {branchName(person.branchId)}</option>
                  {activeBranches.filter((b) => b.id !== person.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              {confirmBar('branch', !branch)}
            </fieldset>
          )}

          {academyAdmin && (
            <fieldset className="space-y-3 border-t border-line pt-5">
              <legend className="text-sm font-bold text-ink">Sign-in email</legend>
              <Field label="Email address" htmlFor="ae-email" hint="Corrects the address they sign in with. They keep their password.">
                <input id="ae-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setConfirming(null); }} className={fieldClasses} />
              </Field>
              {confirmBar('email', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().toLowerCase() === person.email)}
            </fieldset>
          )}
        </div>
      </section>
    </div>
  );
}

'use client';

/**
 * Academy / branch / date-range picker for finance pages. Branch Managers are
 * fixed to their branch; University Admins choose a branch of their academy;
 * the Super Admin also chooses the academy (or all academies where allowed).
 * The server enforces the same scope whatever is chosen here.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getBranches, getOrganizations } from '@/lib/admin/service';
import type { Branch, Organization } from '@/types/domain';
import { Field, fieldClasses } from '@/components/ui/Page';

export interface FinanceScope { orgId: string; branchId: string; from: string; to: string }

export function useFinanceScope(defaults: Partial<FinanceScope> = {}) {
  const { tenant } = useAuth();
  const [scope, setScope] = useState<FinanceScope>({ orgId: defaults.orgId ?? '', branchId: defaults.branchId ?? '', from: defaults.from ?? '', to: defaults.to ?? '' });
  const orgId = scope.orgId || tenant?.orgId || '';
  return { scope: { ...scope, orgId }, setScope, ready: Boolean(tenant) };
}

/** Request fields for the API: '' values are left out so the server applies its defaults. */
export function scopeParams(s: FinanceScope, opts: { dates?: boolean } = {}): Record<string, string> {
  return Object.fromEntries(Object.entries({ orgId: s.orgId, branchId: s.branchId, ...(opts.dates ? { from: s.from, to: s.to } : {}) }).filter(([, v]) => v));
}

export function ScopePicker({ scope, onChange, allowAll = false, dates = false }: { scope: FinanceScope; onChange: (s: FinanceScope) => void; allowAll?: boolean; dates?: boolean }) {
  const { tenant } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const isSuper = tenant?.role === 'super_admin';
  const fixedBranch = tenant?.role === 'branch_admin';

  useEffect(() => { if (isSuper) getOrganizations().then(setOrgs).catch(() => undefined); }, [isSuper]);
  useEffect(() => {
    if (fixedBranch || !scope.orgId || scope.orgId === '*') return;
    let live = true;
    getBranches(scope.orgId).then((b) => live && setBranches(b)).catch(() => live && setBranches([]));
    return () => { live = false; };
  }, [scope.orgId, fixedBranch]);

  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      {isSuper && (
        <Field label="Academy" htmlFor="sc-org">
          <select id="sc-org" value={scope.orgId} onChange={(e) => onChange({ ...scope, orgId: e.target.value, branchId: '' })} className={`${fieldClasses} min-w-[200px]`}>
            {allowAll && <option value="*">All academies</option>}
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
      )}
      {!fixedBranch && scope.orgId !== '*' && (
        <Field label="Branch" htmlFor="sc-branch">
          <select id="sc-branch" value={scope.branchId} onChange={(e) => onChange({ ...scope, branchId: e.target.value })} className={`${fieldClasses} min-w-[180px]`}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      )}
      {dates && (
        <>
          <Field label="From" htmlFor="sc-from"><input id="sc-from" type="date" value={scope.from} onChange={(e) => onChange({ ...scope, from: e.target.value })} className={fieldClasses} /></Field>
          <Field label="To" htmlFor="sc-to"><input id="sc-to" type="date" value={scope.to} onChange={(e) => onChange({ ...scope, to: e.target.value })} className={fieldClasses} /></Field>
        </>
      )}
    </div>
  );
}

'use client';

/**
 * Strynkix LMS — Branch & Campus Management
 * Provides branch overview and creation for Super Admins and University Admins.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { getBranches, getOrganizations, createBranch } from '@/lib/admin/service';
import { Branch, Organization } from '@/types/domain';
import {
  GitBranch,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  MapPin,
  Building2,
  Laptop,
} from 'lucide-react';

export default function BranchesPage() {
  const { tenant } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form State
  const [branchId, setBranchId] = useState('');
  const [targetOrgId, setTargetOrgId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [country, setCountry] = useState('India');
  const [isRemote, setIsRemote] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isSuperAdmin = tenant?.role === 'super_admin';

  useEffect(() => {
    let isMounted = true;

    async function fetchBranches() {
      try {
        if (isSuperAdmin) {
          const [loadedOrgs, loadedBranches] = await Promise.all([
            getOrganizations(),
            getBranches(selectedOrgFilter === 'all' ? undefined : selectedOrgFilter),
          ]);
          if (isMounted) {
            setOrganizations(loadedOrgs);
            setBranches(loadedBranches);
            if (!targetOrgId && loadedOrgs.length > 0) {
              setTargetOrgId(loadedOrgs[0].id);
            }
            setIsLoading(false);
          }
        } else if (tenant?.orgId) {
          const loadedBranches = await getBranches(tenant.orgId);
          if (isMounted) {
            setBranches(loadedBranches);
            setTargetOrgId(tenant.orgId);
            setIsLoading(false);
          }
        } else {
          if (isMounted) {
            setIsLoading(false);
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          console.error('Failed to load branches:', err);
          setError('Unable to load branches. Please verify your administrative permissions.');
          setIsLoading(false);
        }
      }
    }

    fetchBranches();
    return () => {
      isMounted = false;
    };
  }, [isSuperAdmin, selectedOrgFilter, targetOrgId, tenant?.orgId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    setSuccessMsg(null);

    const effectiveOrgId = isSuperAdmin ? targetOrgId : (tenant?.orgId || '');
    if (!effectiveOrgId) {
      setFormError('Organization is required.');
      setIsSubmitting(false);
      return;
    }

    try {
      await createBranch({
        id: branchId.trim().toLowerCase(),
        orgId: effectiveOrgId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
        city: city.trim() ? city.trim() : undefined,
        state: stateName.trim() ? stateName.trim() : undefined,
        country: country.trim(),
        isRemote,
      });

      setSuccessMsg(`Branch "${name}" (${code.toUpperCase()}) created successfully!`);
      // Reset form
      setBranchId('');
      setName('');
      setCode('');
      setCity('');
      setStateName('');
      setIsRemote(false);
      setShowCreateModal(false);

      // Refresh list
      setIsLoading(true);
      if (isSuperAdmin) {
        const loadedBranches = await getBranches(selectedOrgFilter === 'all' ? undefined : selectedOrgFilter);
        setBranches(loadedBranches);
      } else if (tenant?.orgId) {
        const loadedBranches = await getBranches(tenant.orgId);
        setBranches(loadedBranches);
      }
      setIsLoading(false);
    } catch (err: unknown) {
      const e = err as Error;
      setFormError(e.message || 'Failed to create branch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin']}>
      <AppShell pageTitle="Branch & Campus Hubs">
        <div className="space-y-6">
          {/* Action Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
            <div>
              <p className="text-xs text-slate-400">
                Manage physical campus locations and remote cohort learning hubs.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Organization Filter for Super Admin */}
              {isSuperAdmin && organizations.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-mono">Filter Org:</span>
                  <select
                    value={selectedOrgFilter}
                    onChange={(e) => setSelectedOrgFilter(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="all">All Organizations</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({org.id})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  if (tenant?.orgId && !isSuperAdmin) {
                    setTargetOrgId(tenant.orgId);
                  }
                  setShowCreateModal(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create Branch</span>
              </button>
            </div>
          </div>

          {/* Success Banner */}
          {successMsg && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 flex items-center gap-2.5 text-emerald-300 text-xs">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 flex items-center gap-2.5 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Loading Indicator */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
              <span className="text-xs text-slate-400 font-mono">Loading branches...</span>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && branches.length === 0 && (
            <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
              <GitBranch className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-300">No Branches Configured</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No branches found for the selected tenant filter. Click &quot;Create Branch&quot; to provision a campus location.
              </p>
            </div>
          )}

          {/* Branches Grid */}
          {!isLoading && branches.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {branches.map((b) => (
                <div
                  key={b.id}
                  className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition space-y-4 shadow-xl"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="h-10 w-10 rounded-xl bg-indigo-950/80 border border-indigo-800/80 flex items-center justify-center text-indigo-400">
                      {b.location?.isRemote ? <Laptop className="w-5 h-5" /> : <MapPin className="w-5 h-5" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                        {b.code}
                      </span>
                      <span
                        className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                          b.status === 'active'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : 'bg-rose-950 text-rose-300 border-rose-800'
                        }`}
                      >
                        {b.status}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-white tracking-tight">{b.name}</h3>
                    <div className="text-xs font-mono text-indigo-400 mt-0.5">ID: {b.id}</div>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 space-y-1.5 text-xs text-slate-400">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Organization:</span>
                      <span className="font-mono text-slate-300">{b.orgId}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Location:</span>
                      <span className="text-slate-300">
                        {b.location?.isRemote
                          ? 'Remote Online'
                          : [b.location?.city, b.location?.state, b.location?.country].filter(Boolean).join(', ')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Assigned Admins:</span>
                      <span className="font-mono text-slate-300">
                        {b.branchAdminUserIds?.length || 0} manager(s)
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create Branch Modal */}
          {showCreateModal && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                    <Building2 className="w-5 h-5" />
                    <span>Create Branch Campus</span>
                  </div>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="text-slate-400 hover:text-white text-xs font-mono"
                  >
                    Cancel
                  </button>
                </div>

                {formError && (
                  <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <form onSubmit={handleCreate} className="space-y-4">
                  {/* Organization Selector */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      Organization Tenant <span className="text-rose-400">*</span>
                    </label>
                    {isSuperAdmin ? (
                      <select
                        value={targetOrgId}
                        onChange={(e) => setTargetOrgId(e.target.value)}
                        required
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                      >
                        {organizations.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name} ({org.id})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={tenant?.orgId || ''}
                        disabled
                        className="w-full px-3 py-2 rounded-lg bg-slate-950/50 border border-slate-800 text-xs text-slate-400 font-mono"
                      />
                    )}
                  </div>

                  {/* Branch ID */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      Branch ID <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={branchId}
                      onChange={(e) => setBranchId(e.target.value)}
                      placeholder="e.g. branch_mumbai, branch_blr"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                    />
                  </div>

                  {/* Branch Name & Code */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1">
                      <label className="text-xs font-semibold text-slate-300">
                        Branch Name <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Mumbai Campus"
                        required
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">
                        Code <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="MUM-01"
                        required
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono uppercase"
                      />
                    </div>
                  </div>

                  {/* Location Fields */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">City</label>
                      <input
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="e.g. Mumbai"
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">State / Region</label>
                      <input
                        type="text"
                        value={stateName}
                        onChange={(e) => setStateName(e.target.value)}
                        placeholder="e.g. Maharashtra"
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">
                        Country <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        placeholder="India"
                        required
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="pt-5">
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isRemote}
                          onChange={(e) => setIsRemote(e.target.checked)}
                          className="rounded border-slate-800 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>Remote Virtual Campus</span>
                      </label>
                    </div>
                  </div>

                  <div className="pt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold"
                    >
                      {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{isSubmitting ? 'Creating...' : 'Create Branch'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </RequireRole>
  );
}

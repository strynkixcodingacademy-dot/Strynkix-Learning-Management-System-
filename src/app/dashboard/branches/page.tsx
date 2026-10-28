'use client';

/**
 * Strynkix LMS — Branch & Campus Management
 * Provides branch overview and creation for Super Admins and University Admins.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import {
  getBranches,
  getOrganizations,
  createBranch,
  createBranchManager,
  getBranchManagers,
} from '@/lib/admin/service';
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
  UserPlus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';

export default function BranchesPage() {
  const { tenant } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Managers Map (UID -> profile)
  const [managersMap, setManagersMap] = useState<Record<string, { id: string; displayName: string; email: string }>>({});

  // Add Manager Modal State
  const [showAddManagerModal, setShowAddManagerModal] = useState(false);
  const [selectedBranchForManager, setSelectedBranchForManager] = useState<Branch | null>(null);
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [isSubmittingManager, setIsSubmittingManager] = useState(false);
  const [managerFormError, setManagerFormError] = useState<string | null>(null);

  // Credentials Share Modal State
  const [createdCredentials, setCreatedCredentials] = useState<{
    name: string;
    email: string;
    password: string;
    branchName: string;
    branchCode: string;
    loginUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

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

  // Fetch manager profiles for all branches
  const loadManagerProfiles = async (branchList: Branch[]) => {
    const allManagerUids = Array.from(new Set(branchList.flatMap((b) => b.branchAdminUserIds || [])));
    if (allManagerUids.length > 0) {
      try {
        const profiles = await getBranchManagers(allManagerUids);
        const map: Record<string, { id: string; displayName: string; email: string }> = {};
        for (const p of profiles) {
          map[p.id] = p;
        }
        setManagersMap(map);
      } catch (err) {
        console.warn('Could not load manager profiles:', err);
      }
    }
  };

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
            loadManagerProfiles(loadedBranches);
            if (!targetOrgId && loadedOrgs.length > 0) {
              setTargetOrgId(loadedOrgs[0].id);
            }
            setIsLoading(false);
          }
        } else if (tenant?.orgId) {
          const loadedBranches = await getBranches(tenant.orgId);
          if (isMounted) {
            setBranches(loadedBranches);
            loadManagerProfiles(loadedBranches);
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

  const handleOpenAddManager = (branch: Branch) => {
    setSelectedBranchForManager(branch);
    setManagerName('');
    setManagerEmail('');
    setManagerPassword('');
    setManagerFormError(null);
    setShowAddManagerModal(true);
  };

  const handleGeneratePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let pass = '';
    for (let i = 0; i < 10; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setManagerPassword(`Strynkix@${pass}`);
  };

  const handleCreateManager = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranchForManager) return;

    setIsSubmittingManager(true);
    setManagerFormError(null);

    try {
      const result = await createBranchManager({
        email: managerEmail,
        password: managerPassword,
        displayName: managerName,
        orgId: selectedBranchForManager.orgId,
        branchId: selectedBranchForManager.id,
      });

      // Update local state
      setManagersMap((prev) => ({
        ...prev,
        [result.uid]: {
          id: result.uid,
          displayName: result.displayName,
          email: result.email,
        },
      }));

      setBranches((prev) =>
        prev.map((b) =>
          b.id === selectedBranchForManager.id
            ? { ...b, branchAdminUserIds: [...(b.branchAdminUserIds || []), result.uid] }
            : b
        )
      );

      // Open Credentials Modal
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setCreatedCredentials({
        name: result.displayName,
        email: result.email,
        password: managerPassword,
        branchName: selectedBranchForManager.name,
        branchCode: selectedBranchForManager.code,
        loginUrl: `${origin}/login`,
      });

      setShowAddManagerModal(false);
      setSuccessMsg(`Branch Manager "${result.displayName}" provisioned successfully!`);
    } catch (err: unknown) {
      const e = err as Error;
      setManagerFormError(e.message || 'Failed to create branch manager.');
    } finally {
      setIsSubmittingManager(false);
    }
  };

  const handleCopyCredentials = () => {
    if (!createdCredentials) return;
    const shareText = `🎓 Welcome to Strynkix Coding Academy!

Here are your Branch Manager login credentials:
• Campus: ${createdCredentials.branchName} (${createdCredentials.branchCode})
• Role: Branch Manager
• Login URL: ${createdCredentials.loginUrl}
• Email: ${createdCredentials.email}
• Temporary Password: ${createdCredentials.password}

Please sign in and set up your batches and instructors!`;

    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-line">
            <div>
              <p className="text-xs text-ink-3">
                Manage physical campus locations and remote cohort learning hubs.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Organization Filter for Super Admin */}
              {isSuperAdmin && organizations.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-3 font-mono">Filter Org:</span>
                  <select
                    value={selectedOrgFilter}
                    onChange={(e) => setSelectedOrgFilter(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-surface border border-line text-xs text-ink font-mono focus:outline-none focus:ring-1 focus:ring-brand"
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
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold shadow-card transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create Branch</span>
              </button>
            </div>
          </div>

          {/* Success Banner */}
          {successMsg && (
            <div className="p-4 rounded-xl bg-success-soft border border-success-line flex items-center gap-2.5 text-success-ink text-xs">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-success-ink" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-4 rounded-xl bg-danger-soft border border-danger-line flex items-center gap-2.5 text-danger-ink text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink" />
              <span>{error}</span>
            </div>
          )}

          {/* Loading Indicator */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="w-7 h-7 text-brand-ink animate-spin" />
              <span className="text-xs text-ink-3 font-mono">Loading branches...</span>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && branches.length === 0 && (
            <div className="p-12 text-center rounded-2xl bg-surface border border-line space-y-3">
              <GitBranch className="w-10 h-10 text-ink-4 mx-auto" />
              <h3 className="text-sm font-semibold text-ink-2">No Branches Configured</h3>
              <p className="text-xs text-ink-3 max-w-sm mx-auto">
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
                  className="p-5 rounded-2xl bg-surface border border-line hover:border-line-strong transition space-y-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="h-10 w-10 rounded-xl bg-brand-soft border border-brand-line flex items-center justify-center text-brand-ink">
                      {b.location?.isRemote ? <Laptop className="w-5 h-5" /> : <MapPin className="w-5 h-5" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-muted border border-line text-ink-2">
                        {b.code}
                      </span>
                      <span
                        className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
 b.status === 'active'
 ? 'bg-success-soft text-success-ink border-success-line'
 : 'bg-danger-soft text-danger-ink border-danger-line'
 }`}
                      >
                        {b.status}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-ink tracking-tight">{b.name}</h3>
                    <div className="text-xs font-mono text-brand-ink mt-0.5">ID: {b.id}</div>
                  </div>

                  <div className="pt-2 border-t border-line space-y-1.5 text-xs text-ink-3">
                    <div className="flex items-center justify-between">
                      <span className="text-ink-3">Organization:</span>
                      <span className="font-mono text-ink-2">{b.orgId}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-3">Location:</span>
                      <span className="text-ink-2">
                        {b.location?.isRemote
                          ? 'Remote Online'
                          : [b.location?.city, b.location?.state, b.location?.country].filter(Boolean).join(', ')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-3">Assigned Admins:</span>
                      <span className="font-mono text-ink-2">
                        {b.branchAdminUserIds?.length || 0} manager(s)
                      </span>
                    </div>

                    {/* Assigned Managers List */}
                    {b.branchAdminUserIds && b.branchAdminUserIds.length > 0 && (
                      <div className="pt-2 border-t border-line space-y-1.5">
                        <div className="text-[11px] font-semibold text-ink-2">Active Managers:</div>
                        <div className="space-y-1">
                          {b.branchAdminUserIds.map((uid) => {
                            const mgr = managersMap[uid];
                            return (
                              <div
                                key={uid}
                                className="flex items-center justify-between p-2 rounded-xl bg-surface-muted border border-line text-xs"
                              >
                                <div className="min-w-0 pr-2">
                                  <div className="font-semibold text-ink truncate">
                                    {mgr?.displayName || 'Branch Manager'}
                                  </div>
                                  <div className="text-[11px] text-ink-3 font-mono truncate">
                                    {mgr?.email || uid}
                                  </div>
                                </div>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-success-soft text-success-ink border border-success-line shrink-0">
                                  Active
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Add Manager Action Button */}
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => handleOpenAddManager(b)}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-surface-muted hover:bg-brand-soft hover:text-brand-ink border border-line hover:border-brand-line text-xs font-semibold text-ink transition"
                      >
                        <UserPlus className="w-3.5 h-3.5 text-brand-ink" />
                        <span>Add Branch Manager</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create Branch Modal */}
          {showCreateModal && (
            <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
              <div className="max-w-md w-full rounded-2xl bg-surface border border-line shadow-lift p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div className="flex items-center gap-2 text-brand-ink font-bold text-sm">
                    <Building2 className="w-5 h-5" />
                    <span>Create Branch Campus</span>
                  </div>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="text-ink-3 hover:text-ink text-xs font-mono"
                  >
                    Cancel
                  </button>
                </div>

                {formError && (
                  <div className="p-3 rounded-lg bg-danger-soft border border-danger-line text-xs text-danger-ink flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <form onSubmit={handleCreate} className="space-y-4">
                  {/* Organization Selector */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      Organization Tenant <span className="text-danger-ink">*</span>
                    </label>
                    {isSuperAdmin ? (
                      <select
                        value={targetOrgId}
                        onChange={(e) => setTargetOrgId(e.target.value)}
                        required
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand font-mono"
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
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink-3 font-mono"
                      />
                    )}
                  </div>

                  {/* Branch ID */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      Branch ID <span className="text-danger-ink">*</span>
                    </label>
                    <input
                      type="text"
                      value={branchId}
                      onChange={(e) => setBranchId(e.target.value)}
                      placeholder="e.g. branch_mumbai, branch_blr"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand font-mono"
                    />
                  </div>

                  {/* Branch Name & Code */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1">
                      <label className="text-xs font-semibold text-ink-2">
                        Branch Name <span className="text-danger-ink">*</span>
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Mumbai Campus"
                        required
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
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
                        placeholder="MUM-01"
                        required
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand font-mono uppercase"
                      />
                    </div>
                  </div>

                  {/* Location Fields */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-ink-2">City</label>
                      <input
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="e.g. Mumbai"
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-ink-2">State / Region</label>
                      <input
                        type="text"
                        value={stateName}
                        onChange={(e) => setStateName(e.target.value)}
                        placeholder="e.g. Maharashtra"
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-ink-2">
                        Country <span className="text-danger-ink">*</span>
                      </label>
                      <input
                        type="text"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        placeholder="India"
                        required
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                    </div>
                    <div className="pt-5">
                      <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isRemote}
                          onChange={(e) => setIsRemote(e.target.checked)}
                          className="rounded border-line text-brand-ink focus:ring-brand"
                        />
                        <span>Remote Virtual Campus</span>
                      </label>
                    </div>
                  </div>

                  <div className="pt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="px-4 py-2 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink-2 text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold"
                    >
                      {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{isSubmitting ? 'Creating...' : 'Create Branch'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Add Manager Modal */}
          {showAddManagerModal && selectedBranchForManager && (
            <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
              <div className="max-w-md w-full rounded-2xl bg-surface border border-line shadow-lift p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div className="flex items-center gap-2 text-brand-ink font-bold text-sm">
                    <UserPlus className="w-5 h-5" />
                    <span>Add Branch Manager</span>
                  </div>
                  <button
                    onClick={() => setShowAddManagerModal(false)}
                    className="text-ink-3 hover:text-ink text-xs font-mono"
                  >
                    Cancel
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-surface-muted border border-line text-xs space-y-1">
                  <div className="font-semibold text-ink">
                    Assigning to: {selectedBranchForManager.name} ({selectedBranchForManager.code})
                  </div>
                  <div className="text-ink-3 font-mono text-[11px]">
                    Branch ID: {selectedBranchForManager.id} • Org: {selectedBranchForManager.orgId}
                  </div>
                </div>

                {managerFormError && (
                  <div className="p-3 rounded-lg bg-danger-soft border border-danger-line text-xs text-danger-ink flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink mt-0.5" />
                    <span>{managerFormError}</span>
                  </div>
                )}

                <form onSubmit={handleCreateManager} className="space-y-4">
                  {/* Full Name */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      Manager Full Name <span className="text-danger-ink">*</span>
                    </label>
                    <input
                      type="text"
                      value={managerName}
                      onChange={(e) => setManagerName(e.target.value)}
                      placeholder="e.g. Priya Sharma"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      Email Address <span className="text-danger-ink">*</span>
                    </label>
                    <input
                      type="email"
                      value={managerEmail}
                      onChange={(e) => setManagerEmail(e.target.value)}
                      placeholder="manager@strynkix.com"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand font-mono"
                    />
                  </div>

                  {/* Password with generator */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-ink-2">
                        Password <span className="text-danger-ink">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleGeneratePassword}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-ink hover:underline"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Generate Strong Password</span>
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPasswordText ? 'text' : 'password'}
                        value={managerPassword}
                        onChange={(e) => setManagerPassword(e.target.value)}
                        placeholder="••••••••••••"
                        required
                        className="w-full pr-10 pl-3 py-2 rounded-lg bg-surface border border-line text-xs text-ink placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-brand font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswordText(!showPasswordText)}
                        className="absolute right-2.5 top-2.5 text-ink-3 hover:text-ink"
                        title={showPasswordText ? 'Hide password' : 'Show password'}
                      >
                        {showPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="pt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddManagerModal(false)}
                      className="px-4 py-2 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink-2 text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingManager}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand-strong disabled:opacity-50 text-white text-xs font-semibold shadow-card"
                    >
                      {isSubmittingManager && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{isSubmittingManager ? 'Creating Manager...' : 'Create Manager & Generate Credentials'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Credentials Share Modal */}
          {createdCredentials && (
            <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
              <div className="max-w-md w-full rounded-2xl bg-surface border border-success-line shadow-lift p-6 space-y-5 animate-in fade-in-50 zoom-in-95">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-success-soft border border-success-line flex items-center justify-center text-success-ink">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-ink">Manager Account Created!</h3>
                    <p className="text-xs text-ink-3">Share these credentials directly with your branch manager.</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-surface-muted border border-line space-y-2.5 font-mono text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-line text-[11px] text-ink-3">
                    <span>Role:</span>
                    <span className="font-semibold text-brand-ink">Branch Manager</span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b border-line text-[11px] text-ink-3">
                    <span>Campus:</span>
                    <span className="text-ink font-semibold">{createdCredentials.branchName}</span>
                  </div>
                  <div className="space-y-1 pt-1">
                    <span className="text-[11px] text-ink-3">Login URL:</span>
                    <div className="p-2 rounded bg-surface border border-line text-ink break-all select-all text-[11px]">
                      {createdCredentials.loginUrl}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-ink-3">Email:</span>
                    <div className="p-2 rounded bg-surface border border-line text-ink select-all">
                      {createdCredentials.email}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-ink-3">Temporary Password:</span>
                    <div className="p-2 rounded bg-surface border border-line text-ink font-bold select-all flex items-center justify-between">
                      <span>{createdCredentials.password}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyCredentials}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold shadow-card transition"
                  >
                    {copied ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? 'Credentials Copied to Clipboard!' : 'Copy Credentials to Share'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCreatedCredentials(null)}
                    className="w-full py-2 px-4 rounded-xl bg-surface-muted hover:bg-surface-sunken text-ink-2 text-xs font-semibold"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </RequireRole>
  );
}

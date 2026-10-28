'use client';

/**
 * Strynkix LMS — Branch & Campus Management
 * Provides branch overview and creation for Super Admins and University Admins.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, fieldClasses } from '@/components/ui/Page';
import { buttonClasses } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import {
  getBranches,
  getOrganizations,
  createBranch,
  createBranchManager,
  getBranchManagers,
  getManagersByBranch,
  generateTempPassword,
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
  ArrowRight,
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
  const [managersByBranch, setManagersByBranch] = useState<Record<string, { id: string; displayName: string; email: string }[]>>({});

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
            getManagersByBranch().then(setManagersByBranch).catch((err) => console.warn('Could not load branch managers:', err));
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
            getManagersByBranch(tenant.orgId).then(setManagersByBranch).catch((err) => console.warn('Could not load branch managers:', err));
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
    setManagerPassword(generateTempPassword());
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
      <AppShell>
        <div className="space-y-6">
          <PageHeader
            eyebrow="Academy network"
            title="Branches"
            description="Your academy’s campuses and franchises. Open a branch to see its batches, people and performance."
            actions={<>
              {isSuperAdmin && organizations.length > 1 && (
                <>
                  <label htmlFor="org-filter" className="sr-only">Filter by organization</label>
                  <select id="org-filter" value={selectedOrgFilter} onChange={(e) => setSelectedOrgFilter(e.target.value)} className={`${fieldClasses} w-56`}>
                    <option value="all">All organizations</option>
                    {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  if (tenant?.orgId && !isSuperAdmin) {
                    setTargetOrgId(tenant.orgId);
                  }
                  setShowCreateModal(true);
                }}
                className={buttonClasses('primary')}
              >
                <Plus className="w-4 h-4" /> Create Branch
              </button>
            </>}
          />

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
              <span className="text-xs text-ink-3">Loading branches...</span>
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
              {branches.map((b) => {
                const place = b.location?.isRemote
                  ? 'Remote virtual campus'
                  : [b.location?.city, b.location?.state, b.location?.country].filter(Boolean).join(', ') || 'Location not set';
                const linked = (b.branchAdminUserIds ?? []).map((uid) => managersMap[uid]).filter(Boolean);
                const managers = managersByBranch[b.id]?.length ? managersByBranch[b.id] : linked;
                return (
                  <article key={b.id} className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-silver hover:shadow-lift">
                    <span aria-hidden="true" className="h-1 bg-gradient-to-r from-brand via-teal to-highlight" />
                    <div className="flex flex-1 flex-col gap-4 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-line bg-brand-soft text-brand-ink">
                          {b.location?.isRemote ? <Laptop className="w-5 h-5" /> : <MapPin className="w-5 h-5" />}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {b.code && <span className="rounded-md border border-line bg-surface-muted px-2 py-0.5 text-[11px] font-bold text-ink-2">{b.code}</span>}
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold capitalize ${b.status === 'active' ? 'border-success-line bg-success-soft text-success-ink' : 'border-danger-line bg-danger-soft text-danger-ink'}`}>{b.status}</span>
                        </div>
                      </div>
                      <div>
                        <h3 className="text-[17px] font-extrabold tracking-tight text-ink">
                          <Link href={`/dashboard/branches/${b.id}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">{b.name}</Link>
                        </h3>
                        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-3"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{place}</p>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-4">Branch managers</div>
                          <div className="truncate text-sm font-semibold text-ink-2">
                            {managers.length ? managers.map((m) => m!.displayName).join(', ') : 'None assigned yet'}
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-brand-ink">Open <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenAddManager(b)}
                        className="relative z-10 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-surface-muted px-3 py-2 text-[13px] font-bold text-ink transition hover:border-brand-line hover:bg-brand-soft hover:text-brand-ink"
                      >
                        <UserPlus className="w-4 h-4 text-brand-ink" />
                        Add Branch Manager
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Create Branch Modal */}
          {showCreateModal && (
            <div className="fixed inset-0 z-50 bg-ink/20 backdrop-blur-[3px] animate-fade flex items-center justify-center p-4">
              <div className="max-w-md w-full rounded-2xl bg-surface border border-line shadow-lift p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div className="flex items-center gap-2 text-brand-ink font-bold text-sm">
                    <Building2 className="w-5 h-5" />
                    <span>Create Branch Campus</span>
                  </div>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="text-ink-3 hover:text-ink text-xs"
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
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono"
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
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink-3 font-mono"
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
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono"
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
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
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
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono uppercase"
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
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-ink-2">State / Region</label>
                      <input
                        type="text"
                        value={stateName}
                        onChange={(e) => setStateName(e.target.value)}
                        placeholder="e.g. Maharashtra"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
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
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
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
            <div className="fixed inset-0 z-50 bg-ink/20 backdrop-blur-[3px] animate-fade flex items-center justify-center p-4">
              <div className="max-w-md w-full rounded-2xl bg-surface border border-line shadow-lift p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div className="flex items-center gap-2 text-brand-ink font-bold text-sm">
                    <UserPlus className="w-5 h-5" />
                    <span>Add Branch Manager</span>
                  </div>
                  <button
                    onClick={() => setShowAddManagerModal(false)}
                    className="text-ink-3 hover:text-ink text-xs"
                  >
                    Cancel
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-surface-muted border border-line text-xs space-y-1">
                  <div className="font-semibold text-ink">
                    Assigning to: {selectedBranchForManager.name} ({selectedBranchForManager.code})
                  </div>
                  <div className="text-ink-3 text-[11px]">
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
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
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
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono"
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
                        className="w-full pr-10 pl-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono"
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
            <div className="fixed inset-0 z-50 bg-ink/20 backdrop-blur-[3px] animate-fade flex items-center justify-center p-4">
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

                <div className="p-4 rounded-xl bg-surface-muted border border-line space-y-2.5 text-xs">
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

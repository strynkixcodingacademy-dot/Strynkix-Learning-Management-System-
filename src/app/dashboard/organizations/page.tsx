'use client';

/**
 * Strynkix LMS — Super Admin Organization Management
 * Lists multi-tenant academies and provides validated creation slice for Super Admins.
 */

import React, { useEffect, useState } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { getOrganizations, createOrganization } from '@/lib/admin/service';
import { Organization } from '@/types/domain';
import {
  Building2,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Globe,
} from 'lucide-react';

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form State
  const [orgId, setOrgId] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [website, setWebsite] = useState('');
  const [allowedDomains, setAllowedDomains] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchOrgs() {
      try {
        const loaded = await getOrganizations();
        if (isMounted) {
          setOrganizations(loaded);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (isMounted) {
          console.error('Failed to load organizations:', err);
          setError('Unable to load organizations. Please verify your super_admin permissions.');
          setIsLoading(false);
        }
      }
    }

    fetchOrgs();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    setSuccessMsg(null);

    try {
      const parsedDomains = allowedDomains
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);

      await createOrganization({
        id: orgId.trim().toLowerCase(),
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        website: website.trim() ? website.trim() : undefined,
        allowedEmailDomains: parsedDomains,
      });

      setSuccessMsg(`Organization "${name}" created successfully!`);
      // Reset form
      setOrgId('');
      setName('');
      setSlug('');
      setWebsite('');
      setAllowedDomains('');
      setShowCreateModal(false);

      // Refresh list
      setIsLoading(true);
      const loaded = await getOrganizations();
      setOrganizations(loaded);
      setIsLoading(false);
    } catch (err: unknown) {
      const e = err as Error;
      setFormError(e.message || 'Failed to create organization.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RequireRole allowedRoles={['super_admin']}>
      <AppShell pageTitle="Organization Management">
        <div className="space-y-6">
          {/* Action Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
            <div>
              <p className="text-xs text-slate-400">
                Manage root multi-tenant organizations and institutional academy boundaries.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Create Organization</span>
            </button>
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
              <Loader2 className="w-7 h-7 text-purple-500 animate-spin" />
              <span className="text-xs text-slate-400 font-mono">Loading organizations...</span>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && organizations.length === 0 && (
            <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
              <Building2 className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-300">No Organizations Found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No organization profiles exist in Firestore. Click &quot;Create Organization&quot; to seed your first tenant.
              </p>
            </div>
          )}

          {/* Organizations Grid */}
          {!isLoading && organizations.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {organizations.map((org) => (
                <div
                  key={org.id}
                  className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition space-y-4 shadow-xl"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="h-10 w-10 rounded-xl bg-purple-950/80 border border-purple-800/80 flex items-center justify-center text-purple-400 font-bold text-base">
                      {org.name.charAt(0).toUpperCase()}
                    </div>
                    <span
                      className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                        org.status === 'active'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : 'bg-rose-950 text-rose-300 border-rose-800'
                      }`}
                    >
                      {org.status}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-white tracking-tight">{org.name}</h3>
                    <div className="text-xs font-mono text-purple-400 mt-0.5">ID: {org.id}</div>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 space-y-1.5 text-xs text-slate-400">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Slug:</span>
                      <span className="font-mono text-slate-300">{org.slug}</span>
                    </div>
                    {org.website && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Website:</span>
                        <a
                          href={org.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-purple-400 hover:underline inline-flex items-center gap-1 font-mono text-[11px] truncate max-w-[180px]"
                        >
                          <Globe className="w-3 h-3" />
                          <span>{org.website.replace(/^https?:\/\//, '')}</span>
                        </a>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Live Books:</span>
                      <span className="text-emerald-400 font-mono text-[11px]">
                        {org.settings?.features?.liveBooksEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create Organization Modal */}
          {showCreateModal && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2 text-purple-400 font-bold text-sm">
                    <Building2 className="w-5 h-5" />
                    <span>Create Organization Tenant</span>
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
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      Organization ID (Tenant Key) <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={orgId}
                      onChange={(e) => setOrgId(e.target.value)}
                      placeholder="e.g. strynkix, tech_academy"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                    />
                    <p className="text-[10px] text-slate-500">
                      Lowercase alphanumeric and underscores. Used in all tenant queries.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      Organization Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Strynkix Coding Academy"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      URL Slug <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="e.g. strynkix-coding-academy"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Website URL (optional)</label>
                    <input
                      type="url"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://strynkix.com"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      Allowed Email Domains (optional)
                    </label>
                    <input
                      type="text"
                      value={allowedDomains}
                      onChange={(e) => setAllowedDomains(e.target.value)}
                      placeholder="strynkix.com, edu.org (comma separated)"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono text-[11px]"
                    />
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
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold"
                    >
                      {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{isSubmitting ? 'Creating...' : 'Create Organization'}</span>
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

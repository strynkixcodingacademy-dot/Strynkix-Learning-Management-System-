'use client';

/**
 * Strynkix LMS — Super Admin Organization Management
 * Lists multi-tenant academies and provides validated creation slice for Super Admins.
 */

import React, { useEffect, useState } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { useAuth } from '@/context/AuthContext';
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
  const { tenant } = useAuth();
  const isSuperAdmin = tenant?.role === 'super_admin';
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
  const [timeZone, setTimeZone] = useState('Asia/Kolkata');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchOrgs() {
      // RequireRole hides the page, but this effect still runs; skip the query
      // for other roles instead of letting the rules reject it.
      if (!isSuperAdmin) return;
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
  }, [isSuperAdmin]);

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
        defaultTimezone: timeZone,
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
      <AppShell pageTitle="Organizations">
        <div className="space-y-6">
          {/* Action Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-line">
            <div>
              <p className="text-xs text-ink-3">
                Manage root multi-tenant organizations and institutional academy boundaries.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-lavender hover:bg-lavender text-white text-xs font-semibold shadow-card transition self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Create Organization</span>
            </button>
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
              <Loader2 className="w-7 h-7 text-lavender-ink animate-spin" />
              <span className="text-xs text-ink-3">Loading organizations...</span>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && organizations.length === 0 && (
            <div className="p-12 text-center rounded-2xl bg-surface border border-line space-y-3">
              <Building2 className="w-10 h-10 text-ink-4 mx-auto" />
              <h3 className="text-sm font-semibold text-ink-2">No Organizations Found</h3>
              <p className="text-xs text-ink-3 max-w-sm mx-auto">
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
                  className="p-5 rounded-2xl bg-surface border border-line hover:border-line-strong transition space-y-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="h-10 w-10 rounded-xl bg-lavender-soft border border-lavender-line flex items-center justify-center text-lavender-ink font-bold text-base">
                      {org.name.charAt(0).toUpperCase()}
                    </div>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full border ${
 org.status === 'active'
 ? 'bg-success-soft text-success-ink border-success-line'
 : 'bg-danger-soft text-danger-ink border-danger-line'
 }`}
                    >
                      {org.status}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-ink tracking-tight">{org.name}</h3>
                    <div className="text-xs text-lavender-ink mt-0.5">ID: {org.id}</div>
                  </div>

                  <div className="pt-2 border-t border-line space-y-1.5 text-xs text-ink-3">
                    <div className="flex items-center justify-between">
                      <span className="text-ink-3">Slug:</span>
                      <span className="text-ink-2">{org.slug}</span>
                    </div>
                    {org.website && (
                      <div className="flex items-center justify-between">
                        <span className="text-ink-3">Website:</span>
                        <a
                          href={org.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-lavender-ink hover:underline inline-flex items-center gap-1 text-[11px] truncate max-w-[180px]"
                        >
                          <Globe className="w-3 h-3" />
                          <span>{org.website.replace(/^https?:\/\//, '')}</span>
                        </a>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-ink-3">Time zone:</span>
                      <span className="text-ink-2">{org.settings?.defaultTimezone || 'Device time'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-3">Live Books:</span>
                      <span className="text-success-ink text-[11px]">
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
            <div className="fixed inset-0 z-50 bg-ink/20 backdrop-blur-[3px] animate-fade flex items-center justify-center p-4">
              <div className="max-w-md w-full rounded-2xl bg-surface border border-line shadow-lift p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div className="flex items-center gap-2 text-lavender-ink font-bold text-sm">
                    <Building2 className="w-5 h-5" />
                    <span>Create Organization Tenant</span>
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
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      Organization ID (Tenant Key) <span className="text-danger-ink">*</span>
                    </label>
                    <input
                      type="text"
                      value={orgId}
                      onChange={(e) => setOrgId(e.target.value)}
                      placeholder="e.g. strynkix, tech_academy"
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono"
                    />
                    <p className="text-[10px] text-ink-3">
                      Lowercase alphanumeric and underscores. Used in all tenant queries.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      Organization Name <span className="text-danger-ink">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Strynkix Coding Academy"
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      URL Slug <span className="text-danger-ink">*</span>
                    </label>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="e.g. strynkix-coding-academy"
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">Website URL (optional)</label>
                    <input
                      type="url"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://strynkix.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-2">
                      Allowed Email Domains (optional)
                    </label>
                    <input
                      type="text"
                      value={allowedDomains}
                      onChange={(e) => setAllowedDomains(e.target.value)}
                      placeholder="strynkix.com, edu.org (comma separated)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono text-[11px]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="org-timezone" className="text-xs font-semibold text-ink-2">Academy time zone</label>
                    <select id="org-timezone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15">
                      {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                    <p className="text-[11px] text-ink-3">Decides what “today” means for daily plans, deadlines and analytics in every branch.</p>
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
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-lavender hover:bg-lavender disabled:opacity-50 text-white text-xs font-semibold"
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

'use client';

/**
 * Strynkix Live Books — My Profile.
 * Shows the account's role, scope and status, lets the user edit the fields the
 * rules allow (display name, phone), and sends a password-reset email.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/context/AuthContext';
import { AppShell, ROLE_LABELS } from '@/components/dashboard/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Avatar } from '@/components/ui/DataViz';
import { sendOwnPasswordReset, updateOwnProfile, validateOwnProfile } from '@/lib/account/service';
import { BadgeCheck, Building2, KeyRound, LifeBuoy, Mail, MapPin, Save, ShieldCheck } from 'lucide-react';

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-ink-3"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-4">{label}</div>
        <div className="truncate text-sm font-semibold text-ink">{value}</div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, profile, tenant, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [phoneNumber, setPhoneNumber] = useState(profile?.phoneNumber ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [resetState, setResetState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [scope, setScope] = useState<{ org?: string; branch?: string }>({});
  const [synced, setSynced] = useState(profile?.updatedAt);

  // Re-seed the form when the stored profile changes (e.g. after refresh).
  if (profile && profile.updatedAt !== synced) {
    setSynced(profile.updatedAt);
    setDisplayName(profile.displayName ?? '');
    setPhoneNumber(profile.phoneNumber ?? '');
  }

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!tenant) return;
      const [org, branch] = await Promise.all([
        getDoc(doc(db, 'organizations', tenant.orgId)).catch(() => null),
        tenant.branchId ? getDoc(doc(db, 'branches', tenant.branchId)).catch(() => null) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setScope({
        org: org?.exists() ? (org.data().name as string) : undefined,
        branch: branch?.exists() ? (branch.data().name as string) : undefined,
      });
    }
    load();
    return () => {
      alive = false;
    };
  }, [tenant]);

  if (!profile || !tenant || !user) return <AppShell><div /></AppShell>;

  const dirty = displayName.trim() !== (profile.displayName ?? '') || phoneNumber.trim() !== (profile.phoneNumber ?? '');
  const nameError = validateOwnProfile({ displayName, phoneNumber: '' });
  const phoneError = validateOwnProfile({ displayName: 'ok', phoneNumber });
  const validation = nameError || phoneError;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      await updateOwnProfile(user.uid, { displayName, phoneNumber });
      await refreshProfile();
      setMessage({ kind: 'success', text: 'Profile saved.' });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message || 'Your profile couldn’t be saved. Try again.' });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setResetState('sending');
    try {
      await sendOwnPasswordReset(profile.email);
      setResetState('sent');
    } catch {
      setResetState('error');
    }
  };

  return (
    <AppShell>
      <div className="space-y-8">
        <PageHeader eyebrow="Account" title="My Profile" description="Your details, your access, and your password." />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <Card className="overflow-hidden">
              <div className="relative h-24 bg-gradient-to-r from-brand-soft via-silver-soft to-highlight-soft">
                <div aria-hidden="true" className="paper-dots absolute inset-0" />
              </div>
              <div className="-mt-10 flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:px-6">
                <span className="rounded-full bg-surface p-1 shadow-card"><Avatar name={profile.displayName || profile.email} size={76} /></span>
                <div className="min-w-0 flex-1 pb-1">
                  <h2 className="truncate font-display text-[24px] font-extrabold text-ink">{profile.displayName}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusPill tone="brand" icon={ShieldCheck} size="sm">{ROLE_LABELS[tenant.role]}</StatusPill>
                    <StatusPill tone={profile.status === 'active' ? 'success' : 'warning'} icon={BadgeCheck} size="sm">
                      {profile.status === 'active' ? 'Active account' : profile.status.replace('_', ' ')}
                    </StatusPill>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-5 sm:p-6">
              <h2 className="text-[16px] font-extrabold text-ink">Personal details</h2>
              <p className="mt-1 text-sm text-ink-3">This name appears on rosters, submissions and feedback.</p>
              <form onSubmit={save} className="mt-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Display name" htmlFor="displayName" required error={dirty ? nameError : null}>
                    <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} autoComplete="name" className={fieldClasses} />
                  </Field>
                  <Field label="Phone number" htmlFor="phoneNumber" hint="Optional. Visible to your administrators." error={dirty ? phoneError : null}>
                    <input id="phoneNumber" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" className={fieldClasses} />
                  </Field>
                </div>
                <Field label="Email address" htmlFor="email" hint="Your sign-in email is managed by your administrator.">
                  <input id="email" value={profile.email} disabled className={fieldClasses} />
                </Field>
                {message && <Notice kind={message.kind}>{message.text}</Notice>}
                <div className="flex justify-end">
                  <Button type="submit" loading={saving} disabled={!dirty || !!validation} icon={<Save className="h-4 w-4" />}>Save changes</Button>
                </div>
              </form>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-5">
              <h2 className="text-[15px] font-extrabold text-ink">Access</h2>
              <div className="mt-1 divide-y divide-line">
                <InfoRow icon={Mail} label="Email" value={profile.email} />
                <InfoRow icon={ShieldCheck} label="Role" value={ROLE_LABELS[tenant.role]} />
                <InfoRow icon={Building2} label="Organization" value={scope.org ?? tenant.orgId} />
                {tenant.branchId && <InfoRow icon={MapPin} label="Branch" value={scope.branch ?? tenant.branchId} />}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-[15px] font-extrabold text-ink"><KeyRound className="h-4 w-4 text-brand" /> Password</h2>
              <p className="mt-1 text-sm text-ink-3">We’ll email a secure link to {profile.email} so you can choose a new password.</p>
              <div className="mt-4">
                {resetState === 'sent' ? (
                  <Notice kind="success">Reset link sent. Check your inbox (and spam folder).</Notice>
                ) : resetState === 'error' ? (
                  <Notice kind="error" action={<button type="button" onClick={reset} className="text-xs font-bold text-danger-ink underline">Try again</button>}>We couldn’t send the email right now.</Notice>
                ) : (
                  <Button variant="secondary" loading={resetState === 'sending'} onClick={reset} icon={<KeyRound className="h-4 w-4" />}>Email me a reset link</Button>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-[15px] font-extrabold text-ink"><LifeBuoy className="h-4 w-4 text-brand" /> Need a change?</h2>
              <p className="mt-1 text-sm text-ink-3">Your role, branch and email are set by your administrators. Ask your branch manager or the academy’s Super Admin.</p>
              <Link href="/dashboard/guide#profile" className="mt-3 inline-block text-sm font-bold text-brand-ink hover:underline">Read the profile guide</Link>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

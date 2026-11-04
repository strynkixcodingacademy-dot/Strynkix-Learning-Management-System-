'use client';

/**
 * Strynkix Live Books — My Profile, the one place for the user's own settings:
 * personal details, sign-in & security, notifications and appearance. Role and
 * scope are shown but only administrators can change them.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/context/AuthContext';
import { AppShell, ROLE_LABELS } from '@/components/dashboard/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Avatar } from '@/components/ui/DataViz';
import { sendOwnPasswordReset, updateOwnProfile, validateOwnProfile } from '@/lib/account/service';
import { ChangeEmailForm, ChangePasswordForm } from '@/components/account/SecurityForms';
import { NotificationPreferences } from '@/components/account/NotificationPreferences';
import { AppearanceSettings } from '@/components/account/AppearanceSettings';
import { BadgeCheck, Bell, Building2, KeyRound, Mail, MapPin, Palette, Save, ShieldCheck, UserRound } from 'lucide-react';

const SECTIONS = [
  { id: 'details', label: 'Personal details', icon: UserRound },
  { id: 'security', label: 'Sign-in & security', icon: KeyRound },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: Palette },
] as const;

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <Card className="p-5 sm:p-6">
        <h2 id={`${id}-title`} className="text-[17px] font-extrabold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-ink-3">{description}</p>
        <div className="mt-5">{children}</div>
      </Card>
    </section>
  );
}

function SubHeading({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Icon className="h-4 w-4 text-brand-ink" /> {children}</h3>;
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

  if (!profile || !tenant || !user) return <AppShell><LoadingState label="Loading your profile…" /></AppShell>;

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
        <PageHeader eyebrow="Account" title="My Profile" description="Your details, sign-in, notifications and how the app looks." />

        <div className="grid gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
          <nav aria-label="Profile sections" className="hidden lg:block">
            <ul className="sticky top-24 space-y-1">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <a href={`#${id}`} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-semibold text-ink-3 transition-colors hover:bg-surface-muted hover:text-ink">
                    <Icon className="h-4 w-4" /> {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 max-w-3xl space-y-6">
            <Card className="overflow-hidden">
              <div aria-hidden="true" className="relative h-24 bg-linear-to-r from-brand-soft via-lavender-soft to-spark-soft">
                <div className="paper-dots absolute inset-0" />
              </div>
              <div className="relative -mt-10 px-5 pb-5 sm:px-6">
                <span className="inline-block rounded-full bg-surface p-1 shadow-card"><Avatar name={profile.displayName || profile.email} size={76} /></span>
                <div className="mt-3 min-w-0">
                  <h2 className="break-words text-[24px] font-extrabold leading-tight text-ink">{profile.displayName || profile.email}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusPill tone="brand" icon={ShieldCheck} size="sm">{ROLE_LABELS[tenant.role]}</StatusPill>
                    <StatusPill tone={profile.status === 'active' ? 'success' : 'warning'} icon={BadgeCheck} size="sm">
                      {profile.status === 'active' ? 'Active account' : profile.status.replace('_', ' ')}
                    </StatusPill>
                  </div>
                  <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-3">
                    <li className="flex min-w-0 items-center gap-1.5"><Mail className="h-4 w-4 shrink-0" /> <span className="truncate">{profile.email}</span></li>
                    {scope.org && <li className="flex items-center gap-1.5"><Building2 className="h-4 w-4 shrink-0" /> {scope.org}</li>}
                    {scope.branch && <li className="flex items-center gap-1.5"><MapPin className="h-4 w-4 shrink-0" /> {scope.branch}</li>}
                  </ul>
                  <p className="mt-3 text-[12.5px] text-ink-4">
                    Your role and branch are set by your administrators. <Link href="/dashboard/guide#profile" className="font-semibold text-brand-ink hover:underline">How profiles work</Link>
                  </p>
                </div>
              </div>
            </Card>

            <Section id="details" title="Personal details" description="Your name appears on rosters, submissions and feedback.">
              <form onSubmit={save} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Display name" htmlFor="displayName" required error={dirty ? nameError : null}>
                    <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} autoComplete="name" className={fieldClasses} />
                  </Field>
                  <Field label="Phone number" htmlFor="phoneNumber" hint="Optional. Visible to your administrators." error={dirty ? phoneError : null}>
                    <input id="phoneNumber" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" className={fieldClasses} />
                  </Field>
                </div>
                {message && <Notice kind={message.kind}>{message.text}</Notice>}
                <div className="flex justify-end">
                  <Button type="submit" loading={saving} disabled={!dirty || !!validation} icon={<Save className="h-4 w-4" />}>Save changes</Button>
                </div>
              </form>
            </Section>

            <Section id="security" title="Sign-in & security" description="Change your password or the email you sign in with.">
              <div className="space-y-6">
                <div>
                  <SubHeading icon={KeyRound}>Password</SubHeading>
                  <div className="max-w-md">
                    <ChangePasswordForm />
                  </div>
                  <div className="mt-4 flex flex-col gap-3 rounded-xl bg-surface-muted p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[13px] text-ink-3">Forgot your current password? We’ll email a secure reset link to {profile.email}.</p>
                    {resetState === 'sent' ? (
                      <Notice kind="success" className="sm:max-w-xs">Reset link sent. Check your inbox (and spam folder).</Notice>
                    ) : resetState === 'error' ? (
                      <Notice kind="error" className="sm:max-w-xs" action={<button type="button" onClick={reset} className="text-xs font-bold text-danger-ink underline">Try again</button>}>We couldn’t send the email right now.</Notice>
                    ) : (
                      <Button variant="secondary" size="sm" className="shrink-0" loading={resetState === 'sending'} onClick={reset} icon={<Mail className="h-4 w-4" />}>Email me a reset link</Button>
                    )}
                  </div>
                </div>
                <div className="border-t border-line pt-6">
                  <SubHeading icon={Mail}>Sign-in email</SubHeading>
                  <p className="mt-1 text-[13px] text-ink-3">You sign in with <strong className="font-semibold text-ink-2">{profile.email}</strong>. We confirm a new address by email before switching.</p>
                  <div className="max-w-md">
                    <ChangeEmailForm currentEmail={profile.email} />
                  </div>
                </div>
              </div>
            </Section>

            <Section id="notifications" title="Notifications" description="Choose which optional reminders you get. Notifications are in-app only.">
              <NotificationPreferences />
            </Section>

            <Section id="appearance" title="Appearance" description="How Live Books looks on this device.">
              <AppearanceSettings />
            </Section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

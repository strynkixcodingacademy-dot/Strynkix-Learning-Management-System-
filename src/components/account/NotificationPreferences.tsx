'use client';

/**
 * In-app notification preferences (Stage 10). Reminders, achievements,
 * attendance alerts and activity reminders can be turned off; account,
 * grading, doubt replies and announcements always arrive. No email, SMS or
 * WhatsApp is sent.
 */

import React, { useState } from 'react';
import { engagementApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/States';

const LABELS: Record<string, string> = { reminders: 'Due-date reminders for activities and exams', achievements: 'New achievements', attendance: 'Low-attendance alerts', activities: 'Reminders for events I registered for' };

export function NotificationPreferences() {
  const { data } = useApiData('prefs', () => engagementApi<{ muted: string[]; categories: string[] }>({ action: 'preferences' }));
  const [draft, setDraft] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  if (!data) return <p className="text-sm text-ink-3">Loading…</p>;
  const muted = draft ?? data.muted;
  return (
    <div className="space-y-3">
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {data.categories.map((c) => (
        <label key={c} className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm font-medium text-ink-2 hover:bg-surface-muted"><input type="checkbox" className="h-4 w-4 shrink-0" checked={!muted.includes(c)} onChange={(e) => setDraft(e.target.checked ? muted.filter((x) => x !== c) : [...muted, c])} /> {LABELS[c] ?? c}</label>
      ))}
      </div>
      <p className="text-xs text-ink-3">Grades, feedback replies, doubt answers, account messages and announcements always appear.</p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="flex justify-end">
      <Button size="sm" variant="secondary" disabled={!draft} onClick={async () => { try { await engagementApi({ action: 'set_preferences', muted }); setMsg({ kind: 'success', text: 'Preferences saved.' }); setDraft(null); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } }}>Save preferences</Button>
      </div>
    </div>
  );
}

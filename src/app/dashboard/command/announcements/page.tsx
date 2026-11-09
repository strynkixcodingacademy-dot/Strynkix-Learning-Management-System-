'use client';

/**
 * Strynkix LMS — Announcements (Super Admin): publish a message to everyone,
 * an academy, a branch, chosen roles, or students of a course or batch, with
 * an optional publish time and expiry. People see it in their notification
 * bell. Withdrawing needs a reason; both actions are audited. No email or
 * WhatsApp is sent (no provider is configured).
 */

import React, { useState } from 'react';
import { AppShell, ROLE_LABELS } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { commandApi } from '@/lib/academy/api';
import { usePaged } from '@/lib/hooks/usePaged';
import type { UserRole } from '@/types/domain';
import { CommandNav } from '@/components/command/CommandNav';
import { useCommandFilters } from '@/components/command/Shared';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { useConfirm } from '@/components/ui/ConfirmDialog';

interface Row { id: string; title: string; message: string; audience: { scope: string; orgId: string | null; branchId: string | null; roles: string[]; courseId: string | null; batchId: string | null }; publishAt: string; expiresAt: string | null; status: string; createdByName: string; createdAt: string; withdrawnReason?: string }
const TARGET_ROLES: UserRole[] = ['university_admin', 'branch_admin', 'instructor', 'content_lead', 'content_designer', 'student'];
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

function Composer({ onDone }: { onDone: () => void }) {
  const f = useCommandFilters();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [courseId, setCourseId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [publishAt, setPublishAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { confirm, dialog } = useConfirm();
  const scope = f.branchId ? 'branch' : f.orgId ? 'academy' : 'all';
  const who = `${roles.length ? roles.map((r) => ROLE_LABELS[r]).join(', ') : 'everyone'} in ${scope === 'all' ? 'all academies' : scope === 'academy' ? (f.orgs.find((o) => o.id === f.orgId)?.name ?? 'the academy') : (f.branches.find((b) => b.id === f.branchId)?.name ?? 'the branch')}${courseId ? ` · course ${courseId}` : ''}${batchId ? ` · batch ${batchId}` : ''}`;
  return (
    <Card className="space-y-4 p-5">
      {dialog}
      <h2 className="font-sans tracking-normal text-sm font-semibold text-ink">New announcement</h2>
      <Field label="Title" htmlFor="an-title" required><input id="an-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={fieldClasses} /></Field>
      <Field label="Message" htmlFor="an-msg" required><textarea id="an-msg" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} className={fieldClasses} /></Field>
      <div className="space-y-2"><div className="text-sm font-semibold text-ink-2">Audience</div>{f.controls({ dates: false })}</div>
      <fieldset className="space-y-1"><legend className="text-sm font-semibold text-ink-2">Roles (none ticked = everyone)</legend>
        <div className="flex flex-wrap gap-3">{TARGET_ROLES.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles((x) => (e.target.checked ? [...x, r] : x.filter((y) => y !== r)))} /> {ROLE_LABELS[r]}</label>)}</div>
      </fieldset>
      {scope !== 'all' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Only students of course (ID, optional)" htmlFor="an-course"><input id="an-course" value={courseId} onChange={(e) => setCourseId(e.target.value.trim())} className={fieldClasses} /></Field>
          <Field label="Only students of batch (ID, optional)" htmlFor="an-batch"><input id="an-batch" value={batchId} onChange={(e) => setBatchId(e.target.value.trim())} className={fieldClasses} /></Field>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Publish at (empty = now)" htmlFor="an-pub"><input id="an-pub" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className={fieldClasses} /></Field>
        <Field label="Expires at (optional)" htmlFor="an-exp"><input id="an-exp" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={fieldClasses} /></Field>
      </div>
      <p className="text-xs text-ink-3">Shown in the notification bell of: {who}. No email or WhatsApp is sent.</p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Button loading={busy} disabled={title.trim().length < 3 || message.trim().length < 5} onClick={async () => {
        if (!(await confirm({ title: 'Publish this announcement?', body: `It will be shown to ${who}.`, confirmLabel: 'Publish' }))) return;
        setBusy(true);
        setMsg(null);
        try {
          await commandApi({ action: 'create_announcement', title: title.trim(), message: message.trim(), audience: JSON.parse(JSON.stringify({ scope, orgId: f.orgId || undefined, branchId: f.branchId || undefined, roles: courseId || batchId ? ['student'] : roles, courseId: courseId || undefined, batchId: batchId || undefined })), ...(toIso(publishAt) ? { publishAt: toIso(publishAt) } : {}), ...(toIso(expiresAt) ? { expiresAt: toIso(expiresAt) } : {}) });
          setMsg({ kind: 'success', text: 'Announcement published.' });
          setTitle(''); setMessage(''); setCourseId(''); setBatchId(''); setPublishAt(''); setExpiresAt('');
          onDone();
        } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
      }}>Publish announcement</Button>
    </Card>
  );
}

function Announcements() {
  const [version, setVersion] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const { prompt, dialog } = useConfirm();
  const p = usePaged<Row>(`ann|${version}`, async (cursor) => {
    const r = await commandApi<{ announcements: Row[]; cursor: string | null }>({ action: 'announcements', ...(cursor ? { cursor } : {}) });
    return { rows: r.announcements, cursor: r.cursor };
  });
  const now = new Date().toISOString();
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: 'Command Centre', href: '/dashboard/command' }, { label: 'Announcements' }]} title="Announcements" description="Messages to academies, branches, roles, courses or batches, shown in people’s notification bell." />
      <CommandNav />
      {dialog}
      <Composer onDone={() => setVersion((v) => v + 1)} />
      <h2 className="type-section text-ink">Published</h2>
      {failure && <Notice kind="error">{failure}</Notice>}
      {p.error ? <ErrorState onRetry={p.reload}>{p.error}</ErrorState> : p.loading && !p.rows.length ? <LoadingState label="Loading announcements…" /> : !p.rows.length ? <EmptyState title="No announcements yet">Publish one above.</EmptyState> : (
        <ul className="space-y-2">
          {p.rows.map((a) => {
            const state = a.status === 'withdrawn' ? 'Withdrawn' : a.publishAt > now ? 'Scheduled' : a.expiresAt && a.expiresAt <= now ? 'Expired' : 'Live';
            return (
              <li key={a.id}><Card className="space-y-1 p-4">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{a.title}</span><StatusPill size="sm" tone={state === 'Live' ? 'success' : state === 'Scheduled' ? 'brand' : 'neutral'}>{state}</StatusPill>
                  <span className="ml-auto text-xs text-ink-3">{a.createdByName} · {formatWhen(a.publishAt)}{a.expiresAt ? ` → ${formatWhen(a.expiresAt)}` : ''}</span></div>
                <p className="whitespace-pre-wrap text-sm text-ink-2">{a.message}</p>
                <p className="text-xs text-ink-3">Audience: {a.audience.scope === 'all' ? 'all academies' : a.audience.scope === 'academy' ? `academy ${a.audience.orgId}` : `branch ${a.audience.branchId}`}{a.audience.roles.length ? ` · ${a.audience.roles.map((r) => ROLE_LABELS[r as UserRole]).join(', ')}` : ' · everyone'}{a.audience.courseId ? ` · course ${a.audience.courseId}` : ''}{a.audience.batchId ? ` · batch ${a.audience.batchId}` : ''}</p>
                {a.status === 'withdrawn' ? <p className="text-xs text-ink-3">Withdrawn: {a.withdrawnReason}</p> : (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    const reason = await prompt({ title: `Withdraw “${a.title}”?`, body: 'It stops showing in people’s notification bell.', label: 'Why are you withdrawing it?', confirmLabel: 'Withdraw', tone: 'danger' });
                    if (!reason) return;
                    setFailure(null);
                    try { await commandApi({ action: 'withdraw_announcement', announcementId: a.id, reason }); setVersion((v) => v + 1); } catch (e) { setFailure((e as Error).message); }
                  }}>Withdraw</Button>
                )}
              </Card></li>
            );
          })}
        </ul>
      )}
      {p.cursor && <Button variant="secondary" loading={p.loading} onClick={p.more}>Load more</Button>}
    </div>
  );
}

export default function AnnouncementsPage() {
  return <RequireRole allowedRoles={['super_admin']}><AppShell><Announcements /></AppShell></RequireRole>;
}

'use client';

/**
 * Strynkix LMS — Academy activities: workshops, guest lectures, competitions,
 * hackathons, exhibitions, mock interviews, career and placement sessions.
 * Students browse what they are eligible for, register (seats are checked on
 * the server) and see their history. Staff create activities for their scope,
 * see registrations, mark attendance, and cancel or complete them.
 */

import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireAuth } from '@/components/auth/RouteGuards';
import { activitiesApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs } from '@/components/ui/Tabs';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const TYPE_LABEL: Record<string, string> = { workshop: 'Workshop', guest_lecture: 'Guest lecture', coding_competition: 'Coding competition', hackathon: 'Hackathon', project_exhibition: 'Project exhibition', mock_interview: 'Mock interview', career_guidance: 'Career guidance', placement_preparation: 'Placement preparation', special_class: 'Special class' };
interface Activity { id: string; type: string; title: string; description: string; startsAt: string; endsAt: string; registrationDeadline: string; capacity: number | null; registeredCount: number; organizerName: string; location: string; mode: string; meetingUrl: string | null; status: string; branchId: string | null; cancelReason?: string; canManage?: boolean }
interface StudentActivity extends Activity { registration: { status: string } | null; seatsLeft: number | null; canRegister: boolean }

function StudentActivities() {
  const { data, error, reload } = useApiData('acts', () => activitiesApi<{ upcoming: StudentActivity[]; history: { activityId: string; activityTitle: string; startsAt: string; status: string }[] }>({ action: 'list' }));
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { confirm, dialog } = useConfirm();
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading activities…" />;
  const act = async (body: Record<string, unknown>, ok: string) => { setMsg(null); try { await activitiesApi(body); setMsg({ kind: 'success', text: ok }); reload(); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } };
  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader title="Activities & events" description="Workshops, guest lectures, competitions and career sessions you can join." />
      <Tabs idPrefix="sa" label="Activities" value={tab} onChange={setTab} items={[{ id: 'upcoming', label: 'Upcoming', count: data.upcoming.length }, { id: 'history', label: 'My participation' }]} />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {tab === 'upcoming' ? (data.upcoming.length === 0 ? <EmptyState title="Nothing scheduled">New workshops and events for you will appear here.</EmptyState> : (
        <ul className="grid gap-3 md:grid-cols-2">{data.upcoming.map((a) => {
          const registered = a.registration?.status === 'registered';
          return (
            <li key={a.id}><Card className="flex h-full flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2"><StatusPill size="sm" tone="info">{TYPE_LABEL[a.type]}</StatusPill>{registered && <StatusPill size="sm" tone="success">Registered</StatusPill>}</div>
              <div className="text-lg font-semibold text-ink">{a.title}</div>
              <div className="text-sm text-ink-3">{formatWhen(a.startsAt)} – {formatWhen(a.endsAt)} · {a.mode === 'online' ? 'Online' : a.location || 'In person'} · by {a.organizerName}</div>
              {a.description && <p className="whitespace-pre-wrap text-sm text-ink-2">{a.description}</p>}
              <div className="text-xs text-ink-3">{a.seatsLeft === null ? 'Open to all eligible students' : `${a.seatsLeft} of ${a.capacity} seats left`} · registration closes {formatWhen(a.registrationDeadline)}</div>
              {registered && a.mode === 'online' && a.meetingUrl && <a href={a.meetingUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-ink underline">Meeting link</a>}
              <div className="mt-auto">
                {!a.canRegister ? <span className="text-xs text-ink-3">Registration has closed.</span>
                  : registered ? <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Cancel your registration for “${a.title}”?`, body: 'Your seat becomes available to others.', confirmLabel: 'Cancel registration', tone: 'danger' })) act({ action: 'cancel_registration', activityId: a.id }, 'Registration cancelled.'); }}>Cancel registration</Button>
                    : <Button size="sm" disabled={a.seatsLeft === 0} onClick={() => act({ action: 'register', activityId: a.id }, `You’re registered for “${a.title}”.`)}>{a.seatsLeft === 0 ? 'Full' : 'Register'}</Button>}
              </div>
            </Card></li>
          );
        })}</ul>
      )) : (data.history.length === 0 ? <EmptyState title="No participation yet">Activities you register for appear here.</EmptyState> : (
        <Card className="divide-y divide-line">{data.history.map((h) => <div key={h.activityId} className="flex justify-between gap-3 p-3 text-sm"><span>{h.activityTitle} <span className="text-ink-3">· {formatWhen(h.startsAt)}</span></span><StatusPill size="sm" tone={h.status === 'attended' ? 'success' : h.status === 'cancelled' ? 'neutral' : h.status === 'absent' ? 'warning' : 'brand'}>{h.status}</StatusPill></div>)}</Card>
      ))}
    </div>
  );
}

const toLocal = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '');

function ActivityForm({ initial, branchId, onDone }: { initial?: Activity; branchId: string | null; onDone: () => void }) {
  const { tenant } = useAuth();
  const [f, setF] = useState({ type: initial?.type ?? 'workshop', title: initial?.title ?? '', description: initial?.description ?? '', startsAt: toLocal(initial?.startsAt), endsAt: toLocal(initial?.endsAt), registrationDeadline: toLocal(initial?.registrationDeadline), capacity: initial?.capacity ? String(initial.capacity) : '', organizerName: initial?.organizerName ?? '', location: initial?.location ?? '', mode: initial?.mode ?? 'in_person', meetingUrl: initial?.meetingUrl ?? '', academyWide: initial ? initial.branchId === null : false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAcademyWide = tenant && ['super_admin', 'university_admin'].includes(tenant.role);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Card className="space-y-3 p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Type" htmlFor="af-type"><select id="af-type" value={f.type} onChange={set('type')} className={fieldClasses}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <div className="sm:col-span-2"><Field label="Title" htmlFor="af-title" required><input id="af-title" value={f.title} onChange={set('title')} className={fieldClasses} /></Field></div>
      </div>
      <Field label="Description and eligibility notes" htmlFor="af-desc"><textarea id="af-desc" rows={3} value={f.description} onChange={set('description')} className={fieldClasses} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Starts" htmlFor="af-start" required><input id="af-start" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} className={fieldClasses} /></Field>
        <Field label="Ends" htmlFor="af-end" required><input id="af-end" type="datetime-local" value={f.endsAt} onChange={set('endsAt')} className={fieldClasses} /></Field>
        <Field label="Registration closes" htmlFor="af-dl" required><input id="af-dl" type="datetime-local" value={f.registrationDeadline} onChange={set('registrationDeadline')} className={fieldClasses} /></Field>
        <Field label="Capacity (empty = no limit)" htmlFor="af-cap"><input id="af-cap" inputMode="numeric" value={f.capacity} onChange={set('capacity')} className={fieldClasses} /></Field>
        <Field label="Organizer / speaker" htmlFor="af-org" required><input id="af-org" value={f.organizerName} onChange={set('organizerName')} className={fieldClasses} /></Field>
        <Field label="Mode" htmlFor="af-mode"><select id="af-mode" value={f.mode} onChange={set('mode')} className={fieldClasses}><option value="in_person">In person</option><option value="online">Online</option></select></Field>
      </div>
      {f.mode === 'online' ? <Field label="Meeting link (https)" htmlFor="af-url"><input id="af-url" value={f.meetingUrl} onChange={set('meetingUrl')} className={fieldClasses} /></Field> : <Field label="Location" htmlFor="af-loc"><input id="af-loc" value={f.location} onChange={set('location')} className={fieldClasses} /></Field>}
      {canAcademyWide && !initial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.academyWide} onChange={(e) => setF((x) => ({ ...x, academyWide: e.target.checked }))} /> Open to every branch of the academy</label>}
      {error && <Notice kind="error">{error}</Notice>}
      <Button loading={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          await activitiesApi({ action: 'save', ...(initial ? { activityId: initial.id } : {}), activity: { branchId: f.academyWide ? null : initial ? initial.branchId : branchId, type: f.type, title: f.title, description: f.description, startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt), registrationDeadline: fromLocal(f.registrationDeadline), capacity: f.capacity ? Number(f.capacity) : null, organizerName: f.organizerName, location: f.location, mode: f.mode, meetingUrl: f.mode === 'online' ? f.meetingUrl || null : null } });
          onDone();
        } catch (e) { setError((e as Error).message); setBusy(false); }
      }}>{initial ? 'Save changes' : 'Create activity'}</Button>
    </Card>
  );
}

function Registrations({ activity, onChanged }: { activity: Activity; onChanged: () => void }) {
  const { data, error, reload } = useApiData(`regs|${activity.id}`, () => activitiesApi<{ registrations: { id: string; studentId: string; studentName: string; status: string }[] }>({ action: 'registrations', activityId: activity.id }));
  const [msg, setMsg] = useState<string | null>(null);
  const [now] = useState(() => new Date().toISOString());
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading registrations…" />;
  const started = now >= activity.startsAt;
  return (
    <div className="space-y-2 border-t border-line pt-3">
      {msg && <Notice kind="error">{msg}</Notice>}
      {data.registrations.length === 0 ? <p className="text-sm text-ink-3">No registrations yet.</p> : (
        <ul className="divide-y divide-line text-sm">{data.registrations.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-2"><span className="flex-1">{r.studentName}</span><StatusPill size="sm" tone={r.status === 'attended' ? 'success' : r.status === 'cancelled' ? 'neutral' : 'brand'}>{r.status}</StatusPill>
            {started && r.status !== 'cancelled' && (['attended', 'absent'] as const).map((st) => <Button key={st} size="sm" variant="ghost" onClick={async () => { try { await activitiesApi({ action: 'mark_attendance', activityId: activity.id, records: { [r.studentId]: st } }); reload(); onChanged(); } catch (e) { setMsg((e as Error).message); } }}>{st === 'attended' ? 'Attended' : 'Absent'}</Button>)}
          </li>
        ))}</ul>
      )}
      {!started && <p className="text-xs text-ink-3">Attendance can be marked once the activity starts.</p>}
    </div>
  );
}

function StaffActivities() {
  const { data, error, reload } = useApiData('staff-acts', () => activitiesApi<{ activities: Activity[]; branchId: string | null }>({ action: 'list' }));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { prompt, dialog } = useConfirm();
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading activities…" />;
  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader title="Activities & events" description="Plan workshops, guest lectures, competitions, mock interviews and career sessions for your students." actions={!creating ? <Button onClick={() => setCreating(true)}>New activity</Button> : undefined} />
      {creating && <ActivityForm branchId={data.branchId} onDone={() => { setCreating(false); setMsg({ kind: 'success', text: 'Activity created.' }); reload(); }} />}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {data.activities.length === 0 ? <EmptyState title="No activities yet">Create the first one with “New activity”.</EmptyState> : (
        <ul className="space-y-3">{data.activities.map((a) => (
          <li key={a.id}><Card className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{a.title}</span><StatusPill size="sm" tone="info">{TYPE_LABEL[a.type]}</StatusPill><StatusPill size="sm" tone={a.status === 'scheduled' ? 'brand' : a.status === 'completed' ? 'success' : 'neutral'}>{a.status}</StatusPill><span className="ml-auto text-xs text-ink-3">{formatWhen(a.startsAt)} · {a.branchId ? 'Branch' : 'Academy-wide'} · {a.registeredCount}{a.capacity ? ` / ${a.capacity}` : ''} registered</span></div>
            {a.cancelReason && <p className="text-xs text-ink-3">Cancelled: {a.cancelReason}</p>}
            {a.canManage && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide registrations' : 'Registrations & attendance'}</Button>
                {a.status === 'scheduled' && <>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === a.id ? null : a.id)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { try { await activitiesApi({ action: 'set_status', activityId: a.id, status: 'completed' }); reload(); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } }}>Mark completed</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { const reason = await prompt({ title: `Cancel “${a.title}”?`, body: `${a.registeredCount} registered student${a.registeredCount === 1 ? '' : 's'} will be told.`, label: 'Why is it cancelled?', confirmLabel: 'Cancel activity', tone: 'danger' }); if (!reason) return; try { const r = await activitiesApi<{ notified: number }>({ action: 'set_status', activityId: a.id, status: 'cancelled', reason }); setMsg({ kind: 'success', text: `Cancelled; ${r.notified} students notified.` }); reload(); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } }}>Cancel</Button>
                </>}
              </div>
            )}
            {editing === a.id && <ActivityForm initial={a} branchId={data.branchId} onDone={() => { setEditing(null); reload(); }} />}
            {open === a.id && <Registrations activity={a} onChanged={reload} />}
          </Card></li>
        ))}</ul>
      )}
    </div>
  );
}

export default function ActivitiesPage() {
  const { tenant } = useAuth();
  return (
    <RequireAuth>
      <AppShell>
        {!tenant ? <LoadingState label="Loading…" /> : tenant.role === 'student' ? <StudentActivities /> : ['super_admin', 'university_admin', 'branch_admin', 'instructor'].includes(tenant.role) ? <StaffActivities /> : <EmptyState title="Not available">Activities are run by academy staff for students.</EmptyState>}
      </AppShell>
    </RequireAuth>
  );
}

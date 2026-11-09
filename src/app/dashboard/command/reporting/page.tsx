'use client';

/**
 * Strynkix LMS — Reporting infrastructure (Super Admin): snapshot status,
 * jobs, reconciliation reviews, pending recalculations, snapshot details with
 * version history, and the audited actions to run, retry, recalculate and
 * reconcile. The fee ledger stays the source of truth; nothing here changes it.
 */

import React, { useState } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { reportingApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import { usePaged } from '@/lib/hooks/usePaged';
import { formatMoney } from '@/lib/academy/format';
import { previousPeriod } from '@/lib/reporting/periods';
import { todayLocal } from '@/lib/academy/format';
import { CommandNav } from '@/components/command/CommandNav';
import { Metric } from '@/components/command/Shared';
import { formatWhen } from '@/components/assessments/AttemptStatusPill';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, Section, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs } from '@/components/ui/Tabs';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import type { Tone } from '@/components/ui/tones';

type Tab = 'snapshots' | 'reviews' | 'pending' | 'jobs';
const STATUS_TONE: Record<string, Tone> = { reconciled: 'success', generated: 'brand', mismatched: 'danger', stale: 'warning', failed: 'danger', succeeded: 'success', running: 'brand', skipped: 'neutral', open: 'danger', resolved: 'success' };
const pill = (s: string) => <StatusPill size="sm" tone={STATUS_TONE[s] ?? 'neutral'}>{s}</StatusPill>;
const th = 'p-2.5 text-left text-xs font-semibold text-ink-3';
const td = 'p-2.5';
const METRIC_LABELS: Record<string, string> = { collected: 'Collected', payments: 'Payments', paymentReversals: 'Payment reversals', refunds: 'Refunds (net)', charges: 'Extra charges', waivers: 'Waivers', discounts: 'Discounts', expenses: 'Expenses', net: 'Net (collected − expenses)', expectedAtEnd: 'Fees expected at period end', collectedToEnd: 'Collected to period end', outstandingAtEnd: 'Outstanding at period end' };

interface Status {
  latest: Record<'daily' | 'monthly' | 'yearly', { id: string; periodKey: string; version: number; reconciledAt: string | null; collected: number; outstandingAtEnd: number } | null>;
  counts: Record<string, number>; openReviews: number; pendingInvalidations: number; failedJobs: number;
  lastJob: { id: string; status: string; kind: string; startedAt: string; trigger: string } | null; lastReconciledAt: string | null; cronConfigured: boolean;
}

function Actions({ onDone }: { onDone: (msg: { kind: 'success' | 'error'; text: string }) => void }) {
  const [type, setType] = useState<'daily' | 'monthly' | 'yearly'>('monthly');
  const [key, setKey] = useState(previousPeriod('monthly', todayLocal()));
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    try {
      const r = await reportingApi<{ status: string; results?: Record<string, number>; markedStale?: number }>(body);
      onDone({ kind: r.status === 'failed' ? 'error' : 'success', text: r.results ? `${label}: ${r.status}. ${Object.entries(r.results).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing to do'}.` : `${label}: ${r.markedStale ?? 0} snapshots marked for recalculation.` });
    } catch (e) { onDone({ kind: 'error', text: (e as Error).message }); } finally { setBusy(null); }
  };
  return (
    <Card className="flex flex-wrap items-end gap-3 p-4">
      <Field label="Period type" htmlFor="rp-type"><select id="rp-type" value={type} onChange={(e) => { const t = e.target.value as typeof type; setType(t); setKey(previousPeriod(t, todayLocal())); }} className={fieldClasses}><option value="daily">Daily</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></Field>
      <Field label="Period" htmlFor="rp-key" hint={type === 'daily' ? 'YYYY-MM-DD' : type === 'monthly' ? 'YYYY-MM' : 'YYYY'}><input id="rp-key" value={key} onChange={(e) => setKey(e.target.value.trim())} className={`${fieldClasses} w-36`} /></Field>
      <Button loading={busy === 'Generate'} onClick={() => run('Generate', { action: 'run', periodType: type, periodKey: key })}>Generate snapshots</Button>
      <Button variant="secondary" loading={busy === 'Scheduled run'} onClick={() => run('Scheduled run', { action: 'run_scheduled' })}>Run the scheduled job now</Button>
      <Button variant="ghost" loading={busy === 'Apply changes'} onClick={() => run('Apply changes', { action: 'apply_invalidations' })}>Apply pending changes</Button>
    </Card>
  );
}

interface SnapRow { id: string; level: string; scopeId: string; periodType: string; periodKey: string; status: string; version: number; generatedAt: string; collected: number; outstandingAtEnd: number; differences: number; staleReasons: string[] }

function SnapshotDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { data, error, reload } = useApiData(id, () => reportingApi<{ snapshot: Record<string, unknown> & { finance: Record<string, number>; academic: Record<string, number | null>; reconciliation?: { status: string; checkedAt: string; differences: { metric: string; snapshot: number | null; source: number; difference: number }[]; inconsistentAccounts: number; inconsistentAccountIds: string[] }; watermark: Record<string, unknown>; staleReasons?: string[]; recalcReason?: string | null; version: number; status: string; from: string; to: string; calcVersion: string; jobId: string; generatedAt: string }; versions: { id: string; finance: Record<string, number>; archivedAt: string; recalcReason?: string | null; generatedAt: string }[]; reviews: { id: string; status: string; openedAt: string; resolutionNote?: string }[]; jobs: { id: string; kind: string; status: string; startedAt: string; reason?: string }[] }>({ action: 'snapshot', snapshotId: id }));
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { confirm, prompt, dialog } = useConfirm();
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading snapshot…" />;
  const s = data.snapshot;
  const act = async (body: Record<string, unknown>, ok: string) => {
    try { const r = await reportingApi<{ status: string }>(body); setMsg({ kind: r.status === 'failed' ? 'error' : 'success', text: `${ok} (${r.status}).` }); reload(); onChanged(); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <Card className="space-y-4 p-5">
      {dialog}
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-ink">{id}</h3>{pill(s.status)}<span className="text-xs text-ink-3">v{s.version} · {s.from} – {s.to} · {s.calcVersion} · generated {formatWhen(s.generatedAt)} by {s.jobId}</span></div>
      {s.staleReasons && s.staleReasons.length > 0 && <Notice kind="warning">Needs recalculation: {s.staleReasons.join('; ')}</Notice>}
      {s.recalcReason && <p className="text-xs text-ink-3">Last recalculated because: {s.recalcReason}</p>}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={async () => {
          const reason = await prompt({ title: 'Recalculate this snapshot?', body: 'It is rebuilt from the ledger as a new version; the old version is kept.', label: 'Why recalculate it?', confirmLabel: 'Recalculate' });
          if (reason) act({ action: 'recalculate', snapshotId: id, reason }, 'Recalculated');
        }}>Recalculate from the ledger</Button>
        <Button size="sm" variant="secondary" onClick={async () => { if (await confirm({ title: 'Reconcile this snapshot now?', body: 'It is compared with figures recomputed from the ledger. Nothing financial is changed.', confirmLabel: 'Reconcile' })) act({ action: 'reconcile', snapshotId: id }, 'Reconciled'); }}>Reconcile now</Button>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b border-line"><th className={th}>Metric</th><th className={th}>Snapshot</th>{s.reconciliation?.differences.length ? <><th className={th}>Ledger now</th><th className={th}>Difference</th></> : null}</tr></thead>
        <tbody>{Object.keys(METRIC_LABELS).map((m) => { const d = s.reconciliation?.differences.find((x) => x.metric === m); return <tr key={m} className="border-b border-line last:border-0"><td className={td}>{METRIC_LABELS[m]}</td><td className={`${td} tabular-nums`}>{formatMoney(s.finance[m])}</td>{s.reconciliation?.differences.length ? <><td className={`${td} tabular-nums`}>{d ? formatMoney(d.source) : '='}</td><td className={`${td} tabular-nums ${d ? 'font-semibold text-danger-ink' : ''}`}>{d ? formatMoney(d.difference) : ''}</td></> : null}</tr>; })}</tbody></table></div>
      {s.reconciliation && <p className="text-xs text-ink-3">Reconciliation {s.reconciliation.status} at {formatWhen(s.reconciliation.checkedAt)}.{s.reconciliation.inconsistentAccounts ? ` ${s.reconciliation.inconsistentAccounts} fee accounts have stored totals that don’t match their ledger: ${s.reconciliation.inconsistentAccountIds.join(', ')}.` : ''}</p>}
      <p className="text-xs text-ink-3">Academic: {Object.entries(s.academic).map(([k, v]) => `${k} ${v ?? '—'}`).join(' · ')}</p>
      <p className="text-xs text-ink-3">Source watermark: {Object.entries(s.watermark).map(([k, v]) => `${k} ${v ?? '—'}`).join(' · ')}</p>
      {data.versions.length > 0 && (
        <div><h4 className="mb-1 text-sm font-semibold text-ink">Previous versions</h4>
          <ul className="space-y-1 text-xs text-ink-2">{data.versions.map((v) => <li key={v.id}>v{v.id} · generated {formatWhen(v.generatedAt)} · superseded {formatWhen(v.archivedAt)} · collected {formatMoney(v.finance.collected)} · outstanding {formatMoney(v.finance.outstandingAtEnd)}{v.recalcReason ? ` · ${v.recalcReason}` : ''}</li>)}</ul>
        </div>
      )}
      {data.jobs.length > 0 && <div><h4 className="mb-1 text-sm font-semibold text-ink">Recalculation and reconciliation runs</h4><ul className="space-y-1 text-xs text-ink-2">{data.jobs.map((j) => <li key={j.id}>{formatWhen(j.startedAt)} · {j.kind} · {j.status}{j.reason ? ` · ${j.reason}` : ''}</li>)}</ul></div>}
    </Card>
  );
}

function Snapshots({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [status, setStatus] = useState('');
  const [periodType, setPeriodType] = useState('');
  const [level, setLevel] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const params = JSON.parse(JSON.stringify({ status: status || undefined, periodType: periodType || undefined, level: level || undefined }));
  const p = usePaged<SnapRow>(`${JSON.stringify(params)}|${version}`, async (cursor) => {
    const r = await reportingApi<{ snapshots: SnapRow[]; cursor: string | null }>({ action: 'snapshots', ...params, ...(cursor ? { cursor } : {}) });
    return { rows: r.snapshots, cursor: r.cursor };
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Status" htmlFor="sf-st"><select id="sf-st" value={status} onChange={(e) => setStatus(e.target.value)} className={fieldClasses}><option value="">All</option>{['reconciled', 'generated', 'mismatched', 'stale', 'failed'].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Period" htmlFor="sf-pt"><select id="sf-pt" value={periodType} onChange={(e) => setPeriodType(e.target.value)} className={fieldClasses}><option value="">All</option><option value="daily">Daily</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></Field>
        <Field label="Level" htmlFor="sf-lv"><select id="sf-lv" value={level} onChange={(e) => setLevel(e.target.value)} className={fieldClasses}><option value="">All</option><option value="organization">Organization</option><option value="academy">Academy</option><option value="branch">Branch</option></select></Field>
      </div>
      {p.error ? <ErrorState onRetry={p.reload}>{p.error}</ErrorState> : p.loading && !p.rows.length ? <LoadingState label="Loading snapshots…" /> : !p.rows.length ? <EmptyState title="No snapshots">Generate a completed period above, or wait for the scheduled job.</EmptyState> : (
        <Card className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr className="border-b border-line">{['Snapshot', 'Period', 'Status', 'Version', 'Collected', 'Outstanding at end', 'Generated', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{p.rows.map((s) => (
            <tr key={s.id} className="border-b border-line align-top last:border-0">
              <td className={td}><span className="font-semibold text-ink">{s.level}</span> · {s.scopeId}{s.staleReasons.length ? <div className="text-xs text-warning-ink">{s.staleReasons.join('; ')}</div> : null}</td>
              <td className={td}>{s.periodType} {s.periodKey}</td><td className={td}>{pill(s.status)}{s.differences ? <div className="text-xs text-danger-ink">{s.differences} metric(s) differ</div> : null}</td>
              <td className={td}>v{s.version}</td><td className={`${td} tabular-nums`}>{formatMoney(s.collected)}</td><td className={`${td} tabular-nums`}>{formatMoney(s.outstandingAtEnd)}</td><td className={td}>{formatWhen(s.generatedAt)}</td>
              <td className={td}><Button size="sm" variant="ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Close' : 'Details'}</Button></td>
            </tr>
          ))}</tbody></table></Card>
      )}
      {open && <SnapshotDetail key={`${open}-${version}`} id={open} onChanged={onChanged} />}
      {p.cursor && <Button variant="secondary" loading={p.loading} onClick={p.more}>Load more</Button>}
    </div>
  );
}

function Reviews({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [failure, setFailure] = useState<string | null>(null);
  const { prompt, dialog } = useConfirm();
  const { data, error, reload } = useApiData(`${status}|${version}`, () => reportingApi<{ reviews: { id: string; snapshotId: string; level: string; scopeId: string; periodType: string; periodKey: string; differences: { metric: string; snapshot: number | null; source: number; difference: number }[]; inconsistentAccounts: number; inconsistentAccountIds: string[]; status: string; openedAt: string; resolutionNote?: string }[] }>({ action: 'reviews', status }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  return (
    <div className="space-y-3">
      {dialog}
      {failure && <Notice kind="error">{failure}</Notice>}
      <Tabs<'open' | 'resolved'> idPrefix="rv" label="Review status" value={status} onChange={setStatus} items={[{ id: 'open', label: 'Open' }, { id: 'resolved', label: 'Resolved' }]} />
      <p className="text-sm text-ink-3">A review opens when a snapshot disagrees with figures recomputed from the ledger, or when fee accounts’ stored totals don’t match their ledger. Investigate the source records; recalculate the snapshot or correct the records through the normal audited actions, then resolve with a note. Nothing is corrected automatically.</p>
      {!data ? <LoadingState label="Loading reviews…" /> : !data.reviews.length ? <EmptyState title={status === 'open' ? 'Nothing to review' : 'No resolved reviews'}>{status === 'open' ? 'Every reconciled snapshot matches the ledger.' : 'Resolved reviews appear here.'}</EmptyState> : data.reviews.map((r) => (
        <Card key={r.id} className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{r.level} · {r.scopeId} · {r.periodType} {r.periodKey}</span>{pill(r.status)}<span className="ml-auto text-xs text-ink-3">opened {formatWhen(r.openedAt)}</span></div>
          {r.differences.length > 0 && <ul className="text-sm">{r.differences.map((d) => <li key={d.metric}>{METRIC_LABELS[d.metric] ?? d.metric}: snapshot {formatMoney(d.snapshot ?? 0)} · ledger {formatMoney(d.source)} · difference <strong>{formatMoney(d.difference)}</strong></li>)}</ul>}
          {r.inconsistentAccounts > 0 && <p className="text-sm">{r.inconsistentAccounts} fee account(s) with stored totals that don’t match the ledger: {r.inconsistentAccountIds.map((id) => <a key={id} className="mr-2 text-brand-ink underline" href={`/dashboard/finance/accounts/${id}`}>{id}</a>)}</p>}
          {r.status === 'open' ? (
            <Button size="sm" variant="secondary" onClick={async () => {
              const note = await prompt({ title: 'Mark this review resolved?', label: 'How was it resolved?', confirmLabel: 'Mark resolved' });
              if (!note) return;
              setFailure(null);
              try { await reportingApi({ action: 'resolve_review', reviewId: r.id, note }); reload(); onChanged(); } catch (e) { setFailure((e as Error).message); }
            }}>Mark resolved</Button>
          ) : <p className="text-xs text-ink-3">Resolved: {r.resolutionNote}</p>}
        </Card>
      ))}
    </div>
  );
}

function Pending({ version }: { version: number }) {
  const { data, error, reload } = useApiData(`pending|${version}`, () => reportingApi<{ invalidations: { id: string; orgId: string; branchId: string | null; fromDate: string; toDate: string | null; reason: string; sourceType: string; sourceId: string; createdAt: string }[] }>({ action: 'invalidations' }));
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading pending changes…" />;
  if (!data.invalidations.length) return <EmptyState title="No pending changes">No recent change affects a closed reporting period.</EmptyState>;
  return (
    <Card className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b border-line">{['Change', 'Academy · branch', 'Affects', 'Source', 'Recorded'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody>{data.invalidations.map((i) => <tr key={i.id} className="border-b border-line last:border-0"><td className={td}>{i.reason}</td><td className={td}>{i.orgId}{i.branchId ? ` · ${i.branchId}` : ''}</td><td className={td}>{i.fromDate}{i.toDate === null ? ' onward' : i.toDate !== i.fromDate ? ` – ${i.toDate}` : ''}</td><td className={td}>{i.sourceType} {i.sourceId}</td><td className={td}>{formatWhen(i.createdAt)}</td></tr>)}</tbody></table></Card>
  );
}

interface JobRow { id: string; kind: string; status: string; trigger: string; periodType?: string; periodKey?: string; snapshotId?: string; startedAt: string; finishedAt?: string; results?: Record<string, number>; errors?: { scope: string; message: string }[]; retryOf?: string; retriedBy?: string; message?: string }
function Jobs({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const p = usePaged<JobRow>(`${status}|${version}`, async (cursor) => {
    const r = await reportingApi<{ jobs: JobRow[]; cursor: string | null }>({ action: 'jobs', ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) });
    return { rows: r.jobs, cursor: r.cursor };
  });
  return (
    <div className="space-y-3">
      {failure && <Notice kind="error">{failure}</Notice>}
      <Field label="Status" htmlFor="jf-st"><select id="jf-st" value={status} onChange={(e) => setStatus(e.target.value)} className={`${fieldClasses} max-w-xs`}><option value="">All</option>{['failed', 'succeeded', 'skipped', 'running'].map((x) => <option key={x}>{x}</option>)}</select></Field>
      {p.error ? <ErrorState onRetry={p.reload}>{p.error}</ErrorState> : p.loading && !p.rows.length ? <LoadingState label="Loading jobs…" /> : !p.rows.length ? <EmptyState title="No jobs yet">Runs appear here.</EmptyState> : (
        <ul className="space-y-2">{p.rows.map((j) => (
          <li key={j.id}><Card className="space-y-1 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{j.kind}{j.periodType ? ` · ${j.periodType} ${j.periodKey}` : ''}{j.snapshotId ? ` · ${j.snapshotId}` : ''}</span>{pill(j.status)}<span className="text-xs text-ink-3">{j.trigger}{j.retryOf ? ` (retry of ${j.retryOf})` : ''}</span><span className="ml-auto text-xs text-ink-3">{formatWhen(j.startedAt)}{j.finishedAt ? ` → ${formatWhen(j.finishedAt)}` : ''}</span></div>
            {j.results && <p className="text-xs text-ink-3">{Object.entries(j.results).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'No changes'}</p>}
            {j.message && <p className="text-xs text-ink-3">{j.message}</p>}
            {j.errors && j.errors.length > 0 && <ul className="text-xs text-danger-ink">{j.errors.slice(0, 5).map((e, i) => <li key={i}>{e.scope}: {e.message}</li>)}</ul>}
            {j.status === 'failed' && !j.retriedBy && <Button size="sm" variant="secondary" onClick={async () => { setFailure(null); try { await reportingApi({ action: 'retry', jobId: j.id }); onChanged(); } catch (e) { setFailure((e as Error).message); } }}>Retry</Button>}
            {j.retriedBy && <p className="text-xs text-ink-3">Retried as {j.retriedBy}</p>}
          </Card></li>
        ))}</ul>
      )}
      {p.cursor && <Button variant="secondary" loading={p.loading} onClick={p.more}>Load more</Button>}
    </div>
  );
}

function Reporting() {
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const { data, error, reload } = useApiData(`status|${version}`, () => reportingApi<Status>({ action: 'status' }));
  const [tab, setTab] = useState<Tab>('snapshots');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: 'Command Centre', href: '/dashboard/command' }, { label: 'Reporting & reconciliation' }]} title="Reporting & reconciliation"
        description="Historical snapshots of completed days, months and years, checked against the fee ledger. The ledger remains the source of truth; snapshots never change it." />
      <CommandNav />
      {error ? <ErrorState onRetry={reload}>{error}</ErrorState> : !data ? <LoadingState label="Loading status…" /> : (
        <>
          {!data.cronConfigured && <Notice kind="info">The daily schedule isn’t switched on in this environment (its cron secret isn’t set). Use “Run the scheduled job now”, or see STAGING_READINESS §25 to enable it.</Notice>}
          <Section title="Status">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {(['daily', 'monthly', 'yearly'] as const).map((t) => <Metric key={t} label={`Latest reconciled ${t}`} value={data.latest[t]?.periodKey ?? '—'} hint={data.latest[t] ? `collected ${formatMoney(data.latest[t]!.collected)}` : 'None yet'} />)}
              <Metric label="Reconciled" value={data.counts.reconciled} />
              <Metric label="Awaiting reconciliation" value={data.counts.generated} />
              <Metric label="Need recalculation" value={data.counts.stale} hint={`${data.pendingInvalidations} changes not yet applied`} />
              <Metric label="Mismatched" value={data.counts.mismatched} hint={`${data.openReviews} open reviews`} />
              <Metric label="Failed jobs" value={data.failedJobs} />
              <Metric label="Last reconciliation" value={data.lastReconciledAt ? formatWhen(data.lastReconciledAt) : '—'} />
              <Metric label="Last job" value={data.lastJob ? data.lastJob.status : '—'} hint={data.lastJob ? `${data.lastJob.kind} · ${data.lastJob.trigger} · ${formatWhen(data.lastJob.startedAt)}` : undefined} />
            </div>
          </Section>
          <Actions onDone={(m) => { setMsg(m); bump(); }} />
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <Tabs<Tab> idPrefix="rpt" label="Reporting" value={tab} onChange={setTab} items={[{ id: 'snapshots', label: 'Snapshots' }, { id: 'reviews', label: 'Reconciliation reviews', count: data.openReviews }, { id: 'pending', label: 'Pending changes', count: data.pendingInvalidations }, { id: 'jobs', label: 'Job history', count: data.failedJobs }]} />
          {tab === 'snapshots' && <Snapshots version={version} onChanged={bump} />}
          {tab === 'reviews' && <Reviews version={version} onChanged={bump} />}
          {tab === 'pending' && <Pending version={version} />}
          {tab === 'jobs' && <Jobs version={version} onChanged={bump} />}
        </>
      )}
    </div>
  );
}

export default function ReportingPage() {
  return <RequireRole allowedRoles={['super_admin']}><AppShell><Reporting /></AppShell></RequireRole>;
}

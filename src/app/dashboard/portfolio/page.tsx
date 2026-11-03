'use client';

/**
 * Strynkix LMS — My Portfolio: projects the student shows employers. Evaluated
 * practical work can be added in one click; instructors may recommend
 * entries. "Print / Save as PDF" gives a clean portfolio document.
 */

import React, { useState } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { careerApi, studentApi } from '@/lib/academy/api';
import { ProjectReview } from '@/components/career/ProjectReview';
import { useApiData } from '@/lib/hooks/useApiData';
import { formatDate } from '@/lib/academy/format';
import type { PortfolioEntry } from '@/types/academy';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Award, Code2, ExternalLink } from 'lucide-react';

interface Work { attemptId: string; courseId: string; courseTitle: string; title: string; repoUrl: string | null; liveUrl: string | null; description: string; completedOn: string }
type Draft = { title: string; description: string; skills: string; technologies: string; repoUrl: string; liveUrl: string; imageUrl: string; completedOn: string; courseId?: string; attemptId?: string; visible: boolean };
const blank: Draft = { title: '', description: '', skills: '', technologies: '', repoUrl: '', liveUrl: '', imageUrl: '', completedOn: '', visible: true };
const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function Editor({ initial, entryId, onSaved, onCancel }: { initial: Draft; entryId?: string; onSaved: () => void; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Card className="space-y-3 p-5 print:hidden">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Project title" htmlFor="pf-title" required><input id="pf-title" value={d.title} onChange={set('title')} className={fieldClasses} /></Field>
        <Field label="Completed on" htmlFor="pf-date"><input id="pf-date" type="date" value={d.completedOn} onChange={set('completedOn')} className={fieldClasses} /></Field>
      </div>
      <Field label="What it does and what you did" htmlFor="pf-desc" required><textarea id="pf-desc" rows={4} value={d.description} onChange={set('description')} className={fieldClasses} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Skills (comma separated)" htmlFor="pf-skills"><input id="pf-skills" value={d.skills} onChange={set('skills')} className={fieldClasses} /></Field>
        <Field label="Technologies (comma separated)" htmlFor="pf-tech"><input id="pf-tech" value={d.technologies} onChange={set('technologies')} className={fieldClasses} /></Field>
        <Field label="GitHub repository" htmlFor="pf-repo"><input id="pf-repo" value={d.repoUrl} placeholder="https://github.com/…" onChange={set('repoUrl')} className={fieldClasses} /></Field>
        <Field label="Live project" htmlFor="pf-live"><input id="pf-live" value={d.liveUrl} placeholder="https://…" onChange={set('liveUrl')} className={fieldClasses} /></Field>
        <Field label="Screenshot link (optional)" htmlFor="pf-img" hint="Image upload isn’t available yet; paste an https image link."><input id="pf-img" value={d.imageUrl} onChange={set('imageUrl')} className={fieldClasses} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.visible} onChange={(e) => setD((x) => ({ ...x, visible: e.target.checked }))} /> Show in my portfolio (instructors can see visible entries)</label>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button loading={busy} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await careerApi({ action: 'save_entry', ...(entryId ? { entryId } : {}), entry: JSON.parse(JSON.stringify({ title: d.title, description: d.description, skills: split(d.skills), technologies: split(d.technologies), repoUrl: d.repoUrl || undefined, liveUrl: d.liveUrl || undefined, imageUrl: d.imageUrl || undefined, completedOn: d.completedOn || undefined, courseId: d.courseId, attemptId: d.attemptId, visible: d.visible })) });
            onSaved();
          } catch (e) { setError((e as Error).message); setBusy(false); }
        }}>Save project</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function Portfolio() {
  const courses = useApiData('pf-courses', () => studentApi<{ courses: { courseId: string; title: string; enrollmentStatus: string }[] }>({ action: 'courses' }));
  const { data, error, reload } = useApiData('pf', () => careerApi<{ entries: PortfolioEntry[]; verifiedWork: Work[] }>({ action: 'portfolio' }));
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  const { confirm, dialog } = useConfirm();
  if (error) return <ErrorState onRetry={reload}>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading your portfolio…" />;
  const used = new Set(data.entries.map((e) => e.attemptId).filter(Boolean));
  const suggestions = data.verifiedWork.filter((w) => !used.has(w.attemptId));
  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader title="My Portfolio" description="Show the projects you built. Use it when applying for internships and jobs."
        actions={<div className="flex gap-2 print:hidden"><Button onClick={() => setEditing({ draft: blank })}>Add project</Button><Button variant="secondary" onClick={() => window.print()}>Print / Save as PDF</Button></div>} />
      {editing && <Editor initial={editing.draft} entryId={editing.id} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {suggestions.length > 0 && !editing && (
        <Card className="space-y-2 p-4 print:hidden">
          <h2 className="text-sm font-bold text-ink">Add your evaluated course work</h2>
          {suggestions.map((w) => (
            <div key={w.attemptId} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="min-w-0 flex-1"><strong>{w.title}</strong> · {w.courseTitle}</span>
              <Button size="sm" variant="secondary" onClick={() => setEditing({ draft: { ...blank, title: w.title, description: w.description.length >= 10 ? w.description : `Practical assignment for ${w.courseTitle}.`, repoUrl: w.repoUrl ?? '', liveUrl: w.liveUrl ?? '', completedOn: w.completedOn, courseId: w.courseId, attemptId: w.attemptId } })}>Add to portfolio</Button>
            </div>
          ))}
        </Card>
      )}
      {data.entries.length === 0 ? <EmptyState title="No projects yet">Add a project you built, or add evaluated course work above.</EmptyState> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.entries.map((e) => (
            <Card key={e.id} className="flex flex-col gap-3 p-5 print:break-inside-avoid print:shadow-none">
              {e.imageUrl && /^https:\/\//.test(e.imageUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.imageUrl} alt={`Screenshot of ${e.title}`} className="aspect-video w-full rounded-lg border border-line object-cover" loading="lazy" referrerPolicy="no-referrer" />
              )}
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg font-extrabold text-ink">{e.title}</h3>
                {!e.visible && <StatusPill size="sm">Hidden</StatusPill>}
              </div>
              <p className="whitespace-pre-wrap text-sm text-ink-2">{e.description}</p>
              {(e.technologies.length > 0 || e.skills.length > 0) && <div className="flex flex-wrap gap-1.5">{[...e.technologies, ...e.skills].map((x) => <span key={x} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-2">{x}</span>)}</div>}
              <div className="flex flex-wrap gap-3 text-sm">
                {e.repoUrl && <a href={e.repoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-ink underline"><Code2 className="h-4 w-4" /> Code</a>}
                {e.liveUrl && <a href={e.liveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-ink underline"><ExternalLink className="h-4 w-4" /> Live</a>}
                {e.completedOn && <span className="text-ink-3">{formatDate(e.completedOn)}</span>}
                {e.attemptId && <span className="text-xs font-semibold text-success-ink">Evaluated course work</span>}
              </div>
              {e.recommendation && <p className="flex items-start gap-2 rounded-lg bg-success-soft p-2 text-xs text-success-ink"><Award className="h-4 w-4 shrink-0" /> Recommended by {e.recommendation.byName}{e.recommendation.note ? `: “${e.recommendation.note}”` : ''}</p>}
              {e.verified && <p className="hidden text-xs font-semibold print:block">Verified by {e.verifiedByName ?? 'an instructor'}</p>}
              <ProjectReview entry={e} courses={courses.data?.courses.filter((c) => c.enrollmentStatus !== 'dropped') ?? []} onChanged={reload} />
              <div className="mt-auto flex gap-2 print:hidden">
                <Button size="sm" variant="ghost" onClick={() => setEditing({ id: e.id, draft: { title: e.title, description: e.description, skills: e.skills.join(', '), technologies: e.technologies.join(', '), repoUrl: e.repoUrl ?? '', liveUrl: e.liveUrl ?? '', imageUrl: e.imageUrl ?? '', completedOn: e.completedOn ?? '', courseId: e.courseId, attemptId: e.attemptId, visible: e.visible } })}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Delete “${e.title}”?`, confirmLabel: 'Delete', tone: 'danger' })) { await careerApi({ action: 'delete_entry', entryId: e.id }); reload(); } }}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PortfolioPage() {
  return <RequireRole allowedRoles={['student']}><AppShell><Portfolio /></AppShell></RequireRole>;
}

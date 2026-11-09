'use client';

/**
 * Strynkix LMS — Resume Builder. Guided sections, three templates, a live
 * preview, several saved versions, and Print / Save as PDF. Suggestions come
 * only from the student's own verified records (portfolio projects, issued
 * certificates, admission details); nothing is added without the student
 * choosing it.
 */

import React, { useState } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { careerApi } from '@/lib/academy/api';
import { useApiData } from '@/lib/hooks/useApiData';
import type { Resume, ResumeData } from '@/types/academy';
import { ResumePreview } from '@/components/career/ResumePreview';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Plus, Trash2 } from 'lucide-react';

interface Suggestions {
  basics: { fullName: string; email: string; phone: string; location: string };
  education: { institution: string; qualification: string }[];
  projects: { portfolioEntryId: string; title: string; description: string; technologies: string; url: string }[];
  certificates: { certificateId: string; name: string; issuer: string; date: string }[];
  courses: { title: string; status: string }[];
}

const empty = (s?: Suggestions): ResumeData => ({
  fullName: s?.basics.fullName ?? '', email: s?.basics.email ?? '', phone: s?.basics.phone ?? '', location: s?.basics.location ?? '',
  headline: '', summary: '', links: {}, education: s?.education ?? [], skills: [], projects: [], experience: [], certifications: [], achievements: [],
});
const STEPS = ['Contact', 'Summary and skills', 'Projects', 'Experience', 'Education', 'Certifications and achievements'] as const;

function Builder({ initial, suggestions, onSaved, onClose }: { initial: Resume | null; suggestions: Suggestions; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? 'My resume');
  const [template, setTemplate] = useState<Resume['template']>(initial?.template ?? 'modern');
  const [d, setD] = useState<ResumeData>(initial?.data ?? empty(suggestions));
  const [id, setId] = useState(initial?.id);
  const [step, setStep] = useState(0);
  const [skills, setSkills] = useState((initial?.data.skills ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const set = (patch: Partial<ResumeData>) => setD((x) => ({ ...x, ...patch }));
  const I = (label: string, value: string | undefined, on: (v: string) => void, id2: string, opts: { area?: boolean; placeholder?: string } = {}) => (
    <Field label={label} htmlFor={id2}>{opts.area ? <textarea id={id2} rows={3} value={value ?? ''} placeholder={opts.placeholder} onChange={(e) => on(e.target.value)} className={fieldClasses} /> : <input id={id2} value={value ?? ''} placeholder={opts.placeholder} onChange={(e) => on(e.target.value)} className={fieldClasses} />}</Field>
  );
  const arr = <K extends 'education' | 'projects' | 'experience' | 'certifications'>(k: K, i: number, patch: Partial<ResumeData[K][number]>) => set({ [k]: (d[k] as unknown[]).map((x, j) => (j === i ? { ...(x as object), ...patch } : x)) } as Partial<ResumeData>);
  const remove = (k: 'education' | 'projects' | 'experience' | 'certifications' | 'achievements', i: number) => set({ [k]: (d[k] as unknown[]).filter((_, j) => j !== i) } as Partial<ResumeData>);
  const removeBtn = (k: Parameters<typeof remove>[0], i: number) => <button type="button" aria-label="Remove" onClick={() => remove(k, i)} className="self-start rounded p-1 text-danger-ink hover:bg-danger-soft"><Trash2 className="h-4 w-4" /></button>;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const data: ResumeData = { ...d, skills: skills.split(',').map((s) => s.trim()).filter(Boolean), links: Object.fromEntries(Object.entries(d.links).filter(([, v]) => v)) };
      const r = await careerApi<{ resumeId: string }>({ action: 'save_resume', ...(id ? { resumeId: id } : {}), name, template, data: JSON.parse(JSON.stringify(data)) });
      setId(r.resumeId);
      setMsg({ kind: 'success', text: 'Saved. You can come back and continue any time.' });
      onSaved();
    } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4 print:hidden">
        <Card className="grid gap-3 p-4 sm:grid-cols-2">
          {I('Version name', name, setName, 'rs-name', { placeholder: 'e.g. Frontend internships' })}
          <Field label="Template" htmlFor="rs-tpl"><select id="rs-tpl" value={template} onChange={(e) => setTemplate(e.target.value as Resume['template'])} className={fieldClasses}><option value="modern">Modern</option><option value="classic">Classic</option><option value="compact">Compact (one page)</option></select></Field>
        </Card>
        <ol className="flex flex-wrap gap-1.5" aria-label="Resume sections">{STEPS.map((s, i) => <li key={s}><button type="button" aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', i === step ? 'border-brand bg-brand text-white' : 'border-line text-ink-2')}>{s}</button></li>)}</ol>
        <Card className="space-y-3 p-4">
          {step === 0 && <div className="grid gap-3 sm:grid-cols-2">
            {I('Full name', d.fullName, (v) => set({ fullName: v }), 'rs-fn')}{I('Headline', d.headline, (v) => set({ headline: v }), 'rs-hl', { placeholder: 'Full-stack developer (React, Node.js)' })}
            {I('Email', d.email, (v) => set({ email: v }), 'rs-em')}{I('Phone', d.phone, (v) => set({ phone: v }), 'rs-ph')}{I('Location', d.location, (v) => set({ location: v }), 'rs-loc')}
            {I('GitHub profile', d.links.github, (v) => set({ links: { ...d.links, github: v } }), 'rs-gh', { placeholder: 'https://github.com/…' })}
            {I('LinkedIn profile', d.links.linkedin, (v) => set({ links: { ...d.links, linkedin: v } }), 'rs-li', { placeholder: 'https://linkedin.com/in/…' })}
            {I('Portfolio website', d.links.portfolio, (v) => set({ links: { ...d.links, portfolio: v } }), 'rs-pf', { placeholder: 'https://…' })}
          </div>}
          {step === 1 && <>
            {I('Professional summary', d.summary, (v) => set({ summary: v }), 'rs-sum', { area: true, placeholder: 'Two or three sentences about what you build and what you are looking for.' })}
            {I('Technical skills (comma separated)', skills, setSkills, 'rs-sk', { placeholder: 'JavaScript, React, Node.js, SQL, Git' })}
            {suggestions.courses.length > 0 && <p className="text-xs text-ink-3">Courses on record: {suggestions.courses.map((c) => `${c.title} (${c.status})`).join(', ')}. List only skills you actually have.</p>}
          </>}
          {step === 2 && <>
            {d.projects.map((p, i) => <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-line p-3"><div className="space-y-2">
              {I('Project', p.title, (v) => arr('projects', i, { title: v }), `rs-pt-${i}`)}{I('Description', p.description, (v) => arr('projects', i, { description: v }), `rs-pd-${i}`, { area: true })}
              <div className="grid gap-2 sm:grid-cols-2">{I('Technologies', p.technologies, (v) => arr('projects', i, { technologies: v }), `rs-ptech-${i}`)}{I('Link', p.url, (v) => arr('projects', i, { url: v }), `rs-pu-${i}`)}</div>
            </div>{removeBtn('projects', i)}</div>)}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set({ projects: [...d.projects, { title: '', description: '' }] })}>Add project</Button>
              {suggestions.projects.filter((p) => !d.projects.some((x) => x.portfolioEntryId === p.portfolioEntryId)).map((p) => <Button key={p.portfolioEntryId} size="sm" variant="ghost" onClick={() => set({ projects: [...d.projects, { ...p, url: p.url || undefined }] })}>+ From portfolio: {p.title}</Button>)}
            </div>
          </>}
          {step === 3 && <>
            {d.experience.map((x, i) => <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-line p-3"><div className="grid gap-2 sm:grid-cols-2">
              {I('Organization', x.organization, (v) => arr('experience', i, { organization: v }), `rs-xo-${i}`)}{I('Role', x.role, (v) => arr('experience', i, { role: v }), `rs-xr-${i}`)}
              {I('From', x.start, (v) => arr('experience', i, { start: v }), `rs-xs-${i}`, { placeholder: 'Jun 2025' })}{I('To', x.end, (v) => arr('experience', i, { end: v }), `rs-xe-${i}`, { placeholder: 'Present' })}
              <div className="sm:col-span-2">{I('What you did', x.description, (v) => arr('experience', i, { description: v }), `rs-xd-${i}`, { area: true })}</div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(x.internship)} onChange={(e) => arr('experience', i, { internship: e.target.checked })} /> Internship</label>
            </div>{removeBtn('experience', i)}</div>)}
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set({ experience: [...d.experience, { organization: '', role: '' }] })}>Add experience or internship</Button>
          </>}
          {step === 4 && <>
            {d.education.map((e, i) => <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-line p-3"><div className="grid gap-2 sm:grid-cols-2">
              {I('Qualification', e.qualification, (v) => arr('education', i, { qualification: v }), `rs-eq-${i}`)}{I('Institution', e.institution, (v) => arr('education', i, { institution: v }), `rs-ei-${i}`)}
              {I('From', e.start, (v) => arr('education', i, { start: v }), `rs-es-${i}`)}{I('To', e.end, (v) => arr('education', i, { end: v }), `rs-ee-${i}`)}{I('Score / grade', e.score, (v) => arr('education', i, { score: v }), `rs-eg-${i}`)}
            </div>{removeBtn('education', i)}</div>)}
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set({ education: [...d.education, { institution: '', qualification: '' }] })}>Add education</Button>
          </>}
          {step === 5 && <>
            {d.certifications.map((c, i) => <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-line p-3">
              {c.certificateId ? <p className="text-sm"><strong>{c.name}</strong> — {c.issuer} <span className="text-xs font-semibold text-success-ink">Verified certificate</span></p> : (
                <div className="grid gap-2 sm:grid-cols-3">{I('Certification', c.name, (v) => arr('certifications', i, { name: v }), `rs-cn-${i}`)}{I('Issuer', c.issuer, (v) => arr('certifications', i, { issuer: v }), `rs-ci-${i}`)}{I('Date', c.date, (v) => arr('certifications', i, { date: v }), `rs-cd-${i}`)}</div>
              )}{removeBtn('certifications', i)}</div>)}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set({ certifications: [...d.certifications, { name: '', issuer: '' }] })}>Add other certification</Button>
              {suggestions.certificates.filter((c) => !d.certifications.some((x) => x.certificateId === c.certificateId)).map((c) => <Button key={c.certificateId} size="sm" variant="ghost" onClick={() => set({ certifications: [...d.certifications, c] })}>+ Verified: {c.name}</Button>)}
            </div>
            <h3 className="pt-2 text-sm font-semibold text-ink">Achievements</h3>
            {d.achievements.map((a, i) => <div key={i} className="grid grid-cols-[1fr_auto] gap-2"><input aria-label={`Achievement ${i + 1}`} value={a} onChange={(e) => set({ achievements: d.achievements.map((x, j) => (j === i ? e.target.value : x)) })} className={fieldClasses} />{removeBtn('achievements', i)}</div>)}
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set({ achievements: [...d.achievements, ''] })}>Add achievement</Button>
          </>}
          <div className="flex justify-between pt-2">
            <Button size="sm" variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
            <Button size="sm" variant="ghost" disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>Next section</Button>
          </div>
        </Card>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <div className="flex flex-wrap gap-2"><Button onClick={save} loading={busy}>Save</Button><Button variant="secondary" onClick={() => window.print()}>Print / Save as PDF</Button><Button variant="ghost" onClick={onClose}>Close</Button></div>
      </div>
      <div className="xl:sticky xl:top-6 xl:self-start">
        <p className="mb-2 text-xs font-semibold text-ink-3 print:hidden">Live preview</p>
        <div className="rounded-xl border border-line bg-white p-8 shadow-card print:border-0 print:p-0 print:shadow-none">
          <ResumePreview data={{ ...d, skills: skills.split(',').map((s) => s.trim()).filter(Boolean) }} template={template} />
        </div>
      </div>
    </div>
  );
}

function ResumeBuilder() {
  const list = useApiData('resumes', () => careerApi<{ resumes: Resume[] }>({ action: 'resumes' }));
  const sugg = useApiData('sugg', () => careerApi<Suggestions>({ action: 'suggestions' }));
  const [open, setOpen] = useState<Resume | 'new' | null>(null);
  const { confirm, dialog } = useConfirm();
  if (list.error || sugg.error) return <ErrorState onRetry={() => { list.reload(); sugg.reload(); }}>{list.error ?? sugg.error}</ErrorState>;
  if (!list.data || !sugg.data) return <LoadingState label="Loading your resumes…" />;
  if (open) return (
    <div className="space-y-4">
      <style>{'@page { size: A4; margin: 14mm; }'}</style>
      <div className="print:hidden"><PageHeader breadcrumbs={[{ label: 'Resume', href: '/dashboard/resume' }, { label: open === 'new' ? 'New resume' : open.name }]} title="Resume Builder" /></div>
      <Builder initial={open === 'new' ? null : open} suggestions={sugg.data} onSaved={list.reload} onClose={() => setOpen(null)} />
    </div>
  );
  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader title="Resume Builder" description="Build a professional resume step by step. Keep different versions for different applications." actions={<Button onClick={() => setOpen('new')} disabled={list.data.resumes.length >= 10}>New resume</Button>} />
      {list.data.resumes.length === 0 ? <EmptyState title="No resumes yet">Start one — your name, contact, education, portfolio projects and verified certificates can be added for you.</EmptyState> : (
        <div className="grid gap-3 md:grid-cols-2">{list.data.resumes.map((r) => (
          <Card key={r.id} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1"><div className="font-semibold text-ink">{r.name}</div><div className="text-xs text-ink-3">{r.template} template · updated {new Date(r.updatedAt).toLocaleDateString('en-IN')}</div></div>
            <Button size="sm" onClick={() => setOpen(r)}>Open</Button>
            <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Delete “${r.name}”?`, confirmLabel: 'Delete', tone: 'danger' })) { await careerApi({ action: 'delete_resume', resumeId: r.id }); list.reload(); } }}>Delete</Button>
          </Card>
        ))}</div>
      )}
    </div>
  );
}

export default function ResumePage() {
  return <RequireRole allowedRoles={['student']}><AppShell><ResumeBuilder /></AppShell></RequireRole>;
}

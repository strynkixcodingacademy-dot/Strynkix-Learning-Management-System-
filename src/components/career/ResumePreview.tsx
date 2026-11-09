'use client';

/** Strynkix LMS — resume rendering for the three templates (screen preview and print). */

import React from 'react';
import type { Resume, ResumeData } from '@/types/academy';
import { cx } from '@/components/ui/tones';

const host = (u?: string) => (u ? u.replace(/^https:\/\//, '').replace(/\/$/, '') : '');

export function ResumePreview({ data, template }: { data: ResumeData; template: Resume['template'] }) {
  const accent = template === 'modern' ? 'text-[#0b57d0]' : 'text-ink';
  const H = (children: React.ReactNode) => (
    <h2 className={cx('mb-1.5 mt-4 text-xs font-semibold ', accent, template === 'classic' && 'border-b border-ink pb-0.5', template === 'modern' && 'border-l-4 border-line pl-2')}>{children}</h2>
  );
  const contact = [data.email, data.phone, data.location, host(data.links.github), host(data.links.linkedin), host(data.links.portfolio)].filter(Boolean);
  return (
    <div className={cx('bg-white text-ink', template === 'compact' ? 'text-xs leading-snug' : 'text-xs leading-relaxed', template === 'classic' && 'font-display')}>
      <header className={cx(template === 'classic' ? 'text-center' : '', template === 'modern' && 'rounded bg-[#eef3fd] p-3')}>
        <h1 className={cx('font-semibold', template === 'compact' ? 'text-xl' : 'text-2xl', accent)}>{data.fullName || 'Your name'}</h1>
        {data.headline && <p className="font-semibold">{data.headline}</p>}
        {contact.length > 0 && <p className="text-ink-3">{contact.join(' · ')}</p>}
      </header>
      {data.summary && <>{H('Summary')}<p>{data.summary}</p></>}
      {data.skills.length > 0 && <>{H('Technical skills')}<p>{data.skills.join(' · ')}</p></>}
      {data.projects.length > 0 && <>{H('Projects')}{data.projects.map((p, i) => (
        <div key={i} className="mb-2"><p className="font-semibold">{p.title}{p.technologies ? <span className="font-normal text-ink-3"> — {p.technologies}</span> : null}</p><p>{p.description}</p>{p.url && <p className="text-ink-3">{host(p.url)}</p>}</div>
      ))}</>}
      {data.experience.length > 0 && <>{H('Experience')}{data.experience.map((x, i) => (
        <div key={i} className="mb-2"><p className="flex justify-between gap-2 font-semibold"><span>{x.role}, {x.organization}{x.internship ? ' (Internship)' : ''}</span><span className="font-normal text-ink-3">{[x.start, x.end].filter(Boolean).join(' – ')}</span></p>{x.description && <p>{x.description}</p>}</div>
      ))}</>}
      {data.education.length > 0 && <>{H('Education')}{data.education.map((e, i) => (
        <p key={i} className="flex justify-between gap-2"><span><strong>{e.qualification}</strong>, {e.institution}{e.score ? ` — ${e.score}` : ''}</span><span className="text-ink-3">{[e.start, e.end].filter(Boolean).join(' – ')}</span></p>
      ))}</>}
      {data.certifications.length > 0 && <>{H('Certifications')}{data.certifications.map((c, i) => (
        <p key={i}>{c.name} — {c.issuer}{c.date ? ` (${c.date})` : ''}{c.verifyUrl ? <span className="text-ink-3"> · verify: {typeof window !== 'undefined' ? window.location.origin : ''}{c.verifyUrl}</span> : null}</p>
      ))}</>}
      {data.achievements.length > 0 && <>{H('Achievements')}<ul className="list-disc pl-5">{data.achievements.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
    </div>
  );
}

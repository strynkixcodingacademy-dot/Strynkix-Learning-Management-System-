'use client';

/**
 * Strynkix LMS — the Block Studio's form for one lesson block: the fields that
 * belong to its type (text, code, callout, quiz, media, references, tasks).
 * The page owns the block list; this only reports field changes.
 */

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { LessonBlock } from '@/types/domain';

export function BlockFields({ block, onField }: { block: LessonBlock; onField: (field: string, value: unknown) => void }) {
  return (
    <>
      {block.type === 'text' && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-ink-3">Narrative Content</label>
          <textarea
            rows={4}
            value={block.content}
            onChange={(e) => onField('content', e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-sans"
          />
        </div>
      )}

      {block.type === 'code_example' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-3">Language</label>
              <input
                type="text"
                value={block.language}
                onChange={(e) => onField('language', e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-3">Caption</label>
              <input
                type="text"
                value={block.caption || ''}
                onChange={(e) => onField('caption', e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-3">Code Snippet</label>
            <textarea
              rows={6}
              value={block.code}
              onChange={(e) => onField('code', e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-success-ink font-mono focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
            />
          </div>
        </div>
      )}

      {block.type === 'callout' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-3">Variant</label>
              <select
                value={block.variant}
                onChange={(e) => onField('variant', e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
              >
                <option value="info">Info</option>
                <option value="tip">Tip</option>
                <option value="warning">Warning</option>
                <option value="danger">Danger</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-3">Title</label>
              <input
                type="text"
                value={block.title || ''}
                onChange={(e) => onField('title', e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-3">Callout Message</label>
            <textarea
              rows={2}
              value={block.content}
              onChange={(e) => onField('content', e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
            />
          </div>
        </div>
      )}

      {block.type === 'quiz' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-3">Question</label>
            <input
              type="text"
              value={block.question}
              onChange={(e) => onField('question', e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-3">Options & Correct Answer</label>
            {block.options.map((opt, optIdx) => (
              <div key={opt.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`quiz_${block.id}`}
                  checked={block.correctOptionId === opt.id}
                  onChange={() => onField('correctOptionId', opt.id)}
                  className="text-success-ink focus:ring-brand"
                  title="Mark as correct answer"
                />
                <input
                  type="text"
                  value={opt.text}
                  onChange={(e) => {
                    const newOpts = [...block.options];
                    newOpts[optIdx] = { ...newOpts[optIdx], text: e.target.value };
                    onField('options', newOpts);
                  }}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-surface border border-line text-xs text-ink"
                />
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-3">Explanation</label>
            <textarea
              rows={2}
              value={block.explanation ?? ''}
              onChange={(e) => onField('explanation', e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
            />
            <p className="text-xs text-ink-3">The correct answer and explanation are stored privately; students see them only after passing the quiz.</p>
          </div>
        </div>
      )}

      {block.type === 'heading' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
          <div className="space-y-1">
            <label htmlFor={`lvl-${block.id}`} className="text-xs font-medium text-ink-3">Level</label>
            <select id={`lvl-${block.id}`} value={block.level}
              onChange={(e) => onField('level', Number(e.target.value))} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15">
              <option value={1}>Section</option>
              <option value={2}>Subsection</option>
              <option value={3}>Minor heading</option>
              <option value={4}>Small heading</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor={`hd-${block.id}`} className="text-xs font-medium text-ink-3">Heading text</label>
            <input id={`hd-${block.id}`} type="text" value={block.text} maxLength={200}
              onChange={(e) => onField('text', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
          </div>
        </div>
      )}

      {block.type === 'image' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={`img-${block.id}`} className="text-xs font-medium text-ink-3">Image URL</label>
            <input id={`img-${block.id}`} type="url" value={block.url} maxLength={1000}
              onChange={(e) => onField('url', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono" />
            <p className="text-[11px] text-ink-3">Use an https:// address or a site path such as /images/diagram.png. File upload is not available yet.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`alt-${block.id}`} className="text-xs font-medium text-ink-3">Alt text (required)</label>
              <input id={`alt-${block.id}`} type="text" value={block.altText} maxLength={300}
                onChange={(e) => onField('altText', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`cap-${block.id}`} className="text-xs font-medium text-ink-3">Caption</label>
              <input id={`cap-${block.id}`} type="text" value={block.caption || ''} maxLength={300}
                onChange={(e) => onField('caption', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
            </div>
          </div>
        </div>
      )}

      {block.type === 'video' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={`vid-${block.id}`} className="text-xs font-medium text-ink-3">YouTube link</label>
            <input id={`vid-${block.id}`} type="url" value={block.url} maxLength={500}
              onChange={(e) => onField('url', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono" />
            <p className="text-[11px] text-ink-3">Paste a youtube.com or youtu.be link. Add ?t=90 to start at 1:30. Videos play from YouTube&apos;s privacy-enhanced player.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`vt-${block.id}`} className="text-xs font-medium text-ink-3">Video title (required)</label>
              <input id={`vt-${block.id}`} type="text" value={block.title} maxLength={160}
                onChange={(e) => onField('title', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`vc-${block.id}`} className="text-xs font-medium text-ink-3">Caption</label>
              <input id={`vc-${block.id}`} type="text" value={block.caption || ''} maxLength={300}
                onChange={(e) => onField('caption', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
            </div>
          </div>
        </div>
      )}

      {block.type === 'document' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={`doc-${block.id}`} className="text-xs font-medium text-ink-3">Document link (https)</label>
            <input id={`doc-${block.id}`} type="url" value={block.url} maxLength={1000}
              onChange={(e) => onField('url', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono" />
            <p className="text-[11px] text-ink-3">Paste a public link to the file (for example a shared Google Drive PDF or your website). PDFs are shown inside the lesson.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor={`dt-${block.id}`} className="text-xs font-medium text-ink-3">Title (required)</label>
              <input id={`dt-${block.id}`} type="text" value={block.title} maxLength={160}
                onChange={(e) => onField('title', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`dk-${block.id}`} className="text-xs font-medium text-ink-3">Type</label>
              <select id={`dk-${block.id}`} value={block.kind} onChange={(e) => onField('kind', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink">
                <option value="pdf">PDF</option><option value="slides">Slides</option><option value="document">Document</option><option value="other">Other file</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor={`dd-${block.id}`} className="text-xs font-medium text-ink-3">Short description</label>
            <input id={`dd-${block.id}`} type="text" value={block.description || ''} maxLength={400}
              onChange={(e) => onField('description', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={block.allowDownload} onChange={(e) => onField('allowDownload', e.target.checked)} /> Show a Download button to students
          </label>
        </div>
      )}

      {block.type === 'references' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={`rt-${block.id}`} className="text-xs font-medium text-ink-3">Section title</label>
            <input id={`rt-${block.id}`} type="text" value={block.title || ''} maxLength={100}
              onChange={(e) => onField('title', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
          </div>
          {block.links.map((link, li) => {
            const setLink = (patch: Partial<typeof link>) =>
              onField('links', block.links.map((l, j) => (j === li ? { ...l, ...patch } : l)));
            return (
              <div key={li} className="grid grid-cols-1 gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1.4fr_auto]">
                <input aria-label={`Link ${li + 1} title`} type="text" value={link.label} maxLength={160} placeholder="Link title"
                  onChange={(e) => setLink({ label: e.target.value })} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
                <input aria-label={`Link ${li + 1} URL`} type="url" value={link.url} maxLength={1000} placeholder="https://"
                  onChange={(e) => setLink({ url: e.target.value })} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono" />
                <button type="button" onClick={() => onField('links', block.links.filter((_, j) => j !== li))}
                  disabled={block.links.length === 1} className="inline-flex h-10 items-center justify-center rounded-lg px-2 text-ink-3 hover:bg-danger-soft hover:text-danger-ink disabled:opacity-40" aria-label={`Remove link ${li + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
                <input aria-label={`Link ${li + 1} description`} type="text" value={link.description || ''} maxLength={400} placeholder="Why it's worth reading (optional)"
                  onChange={(e) => setLink({ description: e.target.value })} className={`${'w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15'} sm:col-span-3`} />
              </div>
            );
          })}
          <button type="button" onClick={() => onField('links', [...block.links, { label: '', url: 'https://', description: '' }])}
            disabled={block.links.length >= 20} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-ink hover:underline disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Add link
          </button>
        </div>
      )}

      {block.type === 'practice_task' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={`pt-${block.id}`} className="text-xs font-medium text-ink-3">Task title</label>
            <input id={`pt-${block.id}`} type="text" value={block.title} maxLength={160}
              onChange={(e) => onField('title', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
          </div>
          <div className="space-y-1">
            <label htmlFor={`pi-${block.id}`} className="text-xs font-medium text-ink-3">Instructions</label>
            <textarea id={`pi-${block.id}`} rows={3} value={block.instructions}
              onChange={(e) => onField('instructions', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
            <div className="space-y-1">
              <label htmlFor={`pl-${block.id}`} className="text-xs font-medium text-ink-3">Language</label>
              <input id={`pl-${block.id}`} type="text" value={block.language || ''} maxLength={30}
                onChange={(e) => onField('language', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`ps-${block.id}`} className="text-xs font-medium text-ink-3">Starter code (optional)</label>
              <textarea id={`ps-${block.id}`} rows={4} value={block.starterCode || ''} spellCheck={false}
                onChange={(e) => onField('starterCode', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono" />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor={`ph-${block.id}`} className="text-xs font-medium text-ink-3">Hints (one per line, up to 10)</label>
            <textarea id={`ph-${block.id}`} rows={2} value={(block.hints || []).join('\n')}
              onChange={(e) => onField('hints', e.target.value.split('\n').slice(0, 10))} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
          </div>
          <div className="space-y-1">
            <label htmlFor={`po-${block.id}`} className="text-xs font-medium text-ink-3">You&apos;re done when (expected outcome)</label>
            <textarea id={`po-${block.id}`} rows={2} value={block.expectedOutcome}
              onChange={(e) => onField('expectedOutcome', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
          </div>
        </div>
      )}

      {block.type === 'worked_example' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-3">Example Title</label>
            <input
              type="text"
              value={block.title}
              onChange={(e) => onField('title', e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-3">Problem Statement</label>
            <textarea
              rows={2}
              value={block.problem}
              onChange={(e) => onField('problem', e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-3">Solution Code</label>
            <textarea
              rows={3}
              value={block.solutionCode || ''}
              onChange={(e) => onField('solutionCode', e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-success-ink font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-3">Explanation</label>
            <textarea
              rows={2}
              value={block.explanation}
              onChange={(e) => onField('explanation', e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
            />
          </div>
        </div>
      )}
    </>
  );
}

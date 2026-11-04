'use client';

/**
 * Strynkix Live Books — global search. A search field in the top bar (and
 * ⌘K / Ctrl+K / "/" anywhere) opens one dialog that finds features by name or
 * everyday words, and the Live Books, lessons and batches the user can open.
 */

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { categoriesFor, CATEGORIES, searchFeatures } from '@/lib/navigation/catalog';
import { loadContentIndex, searchContent, type ContentEntry, type ContentKind } from '@/lib/search/content';
import { cx, TONE_CLASSES, type Tone } from '@/components/ui/tones';
import { BookOpen, CornerDownLeft, FileText, Loader2, Search, Users, X, type LucideIcon } from 'lucide-react';

interface Result {
  key: string;
  title: string;
  context: string;
  href: string;
  icon: LucideIcon;
  tone: Tone;
  group: string;
}

const KIND: Record<ContentKind, { group: string; icon: LucideIcon }> = {
  course: { group: 'Live Books', icon: BookOpen },
  lesson: { group: 'Lessons', icon: FileText },
  batch: { group: 'Batches', icon: Users },
};

const OPEN_EVENT = 'strynkix:open-search';

export function openGlobalSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** The search field shown in the top bar; it opens the dialog. */
const noSubscribe = () => () => {};

export function SearchTrigger({ className }: { className?: string }) {
  // Server render says "Ctrl"; the browser shows ⌘ on Apple devices.
  const mac = useSyncExternalStore(noSubscribe, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);
  return (
    <button
      type="button"
      onClick={openGlobalSearch}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
      className={cx('group flex h-10 w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-left text-[13.5px] text-ink-3 shadow-card transition-colors hover:border-silver hover:text-ink-2', className)}
    >
      <Search className="h-4 w-4 shrink-0 text-ink-4 group-hover:text-brand" />
      <span className="min-w-0 flex-1 truncate">Search features, Live Books, lessons…</span>
      <kbd className="hidden shrink-0 rounded-md border border-line bg-surface-muted px-1.5 py-0.5 font-sans text-[11px] font-semibold text-ink-3 sm:inline">{mac ? '⌘' : 'Ctrl'} K</kbd>
    </button>
  );
}

export function GlobalSearch() {
  const { tenant, user, profile } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [entries, setEntries] = useState<ContentEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const role = tenant?.role;

  useEffect(() => {
    // Every opening starts from an empty query.
    const show = () => {
      setQ('');
      setActive(0);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => {
          if (!o) {
            setQ('');
            setActive(0);
          }
          return !o;
        });
      } else if (e.key === '/' && !isTyping(e.target)) {
        e.preventDefault();
        show();
      }
    };
    const onOpen = show;
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Load what the user can find the first time the dialog opens.
  useEffect(() => {
    if (!open || !tenant || !user) return;
    let alive = true;
    loadContentIndex(tenant, user.uid, profile ?? null)
      .then((list) => { if (alive) { setEntries(list); setLoadFailed(false); } })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => {
      alive = false;
    };
  }, [open, tenant, user, profile]);

  const results: Result[] = useMemo(() => {
    if (!q.trim()) {
      return categoriesFor(role).map(({ category, href }) => ({ key: `cat-${category.id}`, title: category.name, context: category.description, href, icon: category.icon, tone: category.tone, group: 'Go to' }));
    }
    const features = searchFeatures(q, role).map((f) => ({
      key: `f-${f.href}`,
      title: f.name,
      context: f.category ? `${CATEGORIES.find((c) => c.id === f.category)?.name} · ${f.description}` : f.description,
      href: f.href,
      icon: f.icon,
      tone: CATEGORIES.find((c) => c.id === f.category)?.tone ?? 'neutral',
      group: 'Features',
    }));
    const content = searchContent(entries ?? [], q).map((e) => ({ key: `${e.kind}-${e.href}`, title: e.title, context: e.context, href: e.href, icon: KIND[e.kind].icon, tone: 'neutral' as Tone, group: KIND[e.kind].group }));
    return [...features, ...content];
  }, [q, role, entries]);

  if (!open) return null;

  const go = (r: Result | undefined) => {
    if (!r) return;
    setOpen(false);
    router.push(r.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const groups = [...new Set(results.map((r) => r.group))];
  const indexOf = (r: Result) => results.indexOf(r);
  const loadingContent = !!q.trim() && entries === null && !loadFailed;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[10vh] print:hidden">
      <button type="button" aria-label="Close search" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/25 backdrop-blur-[3px] animate-fade" />
      <div role="dialog" aria-modal="true" aria-label="Search" className="relative flex max-h-[75vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-float animate-rise">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-5 w-5 shrink-0 text-brand" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-activedescendant={results[active] ? `sr-${results[active].key}` : undefined}
            aria-label="Search features, Live Books, lessons and batches"
            placeholder="Search features, Live Books, lessons…"
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-4"
          />
          {loadingContent && <Loader2 className="h-4 w-4 animate-spin text-ink-4" aria-label="Loading" />}
          <button type="button" onClick={() => setOpen(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted" aria-label="Close search">
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul id="search-results" role="listbox" aria-label="Results" className="flex-1 overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-3 py-10 text-center text-sm text-ink-3">
              {loadingContent ? 'Searching…' : <>Nothing matches “{q.trim()}”. Try a feature name such as “fees”, “attendance” or “lesson”.</>}
            </li>
          ) : groups.map((group) => (
            <li key={group} role="presentation">
              <div className="px-3 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-4">{group}</div>
              <ul role="presentation">
                {results.filter((r) => r.group === group).map((r) => {
                  const i = indexOf(r);
                  const Icon = r.icon;
                  const selected = i === active;
                  const tone = TONE_CLASSES[r.tone];
                  return (
                    <li
                      key={r.key}
                      id={`sr-${r.key}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(r)}
                      className={cx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5', selected ? 'bg-brand-soft' : 'hover:bg-canvas')}
                    >
                      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone.soft, tone.ink)}><Icon className="h-[18px] w-[18px]" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-ink">{r.title}</span>
                        <span className="block truncate text-[12px] text-ink-3">{r.context}</span>
                      </span>
                      {selected && <CornerDownLeft className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-4 border-t border-line bg-canvas px-4 py-2 text-[11.5px] text-ink-3 sm:flex">
          <span><kbd className="font-sans font-semibold">↑ ↓</kbd> move</span>
          <span><kbd className="font-sans font-semibold">Enter</kbd> open</span>
          <span><kbd className="font-sans font-semibold">Esc</kbd> close</span>
          {loadFailed && <span className="ml-auto text-coral-ink">Courses and lessons couldn’t load; features still work.</span>}
        </div>
      </div>
    </div>
  );
}

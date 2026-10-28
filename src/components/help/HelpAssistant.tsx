'use client';

/**
 * Strynkix Live Books — in-app help assistant.
 * A floating "how do I…" helper that answers from the User Guide only
 * (src/lib/help). Runs entirely in the browser; nothing typed is sent anywhere.
 */

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { answer, AssistantAnswer } from '@/lib/help/assistant';
import { GuideTopic } from '@/lib/help/guide';
import { cx } from '@/components/ui/tones';
import { ArrowRight, ArrowUp, BookOpen, Info, MessageCircleQuestion, Sparkles, X } from 'lucide-react';

const OPEN_EVENT = 'strynkix:open-help';

/** Opens the assistant from anywhere (e.g. a "Ask for help" button). */
export function openHelpAssistant() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Message {
  id: number;
  from: 'user' | 'bot';
  text?: string;
  reply?: AssistantAnswer;
}

function TopicAnswer({ topic, onNavigate }: { topic: GuideTopic; onNavigate: () => void }) {
  return (
    <div className="mt-2 space-y-2.5">
      <ol className="space-y-1.5">
        {topic.steps.map((step, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand-ink">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {topic.tips?.map((tip) => (
        <p key={tip} className="flex gap-1.5 rounded-lg bg-highlight-soft px-2.5 py-1.5 text-[12px] leading-relaxed text-ink-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-ink" aria-hidden="true" /> {tip}
        </p>
      ))}
      <div className="flex flex-wrap gap-2 pt-0.5">
        {topic.link && (
          <Link href={topic.link.href} onClick={onNavigate} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-brand-strong">
            Go to {topic.link.label} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
        <Link href={`/dashboard/guide#${topic.id}`} onClick={onNavigate} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-bold text-ink-2 hover:border-silver">
          <BookOpen className="h-3.5 w-3.5" /> Open in guide
        </Link>
      </div>
    </div>
  );
}

export function HelpAssistant() {
  const { tenant } = useAuth();
  const role = tenant?.role;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question) return;
    setMessages((m) => [
      ...m,
      { id: nextId.current++, from: 'user', text: question },
      { id: nextId.current++, from: 'bot', reply: answer(question, role) },
    ]);
    setInput('');
    inputRef.current?.focus();
  };

  // The greeting is derived (not stored) so it always matches the current role.
  const thread: Message[] = [{ id: 0, from: 'bot', reply: answer('hello', role) }, ...messages];
  const last = [...thread].reverse().find((m) => m.reply)?.reply;
  const chips = last?.kind === 'answer' && last.related.length
    ? last.related.map((t) => t.title)
    : last?.suggestions ?? [];

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex h-13 w-13 items-center justify-center rounded-full bg-brand text-white shadow-float ring-4 ring-surface transition-transform hover:-translate-y-0.5 print:hidden"
          aria-label="Open help assistant"
          title="Help assistant"
        >
          <MessageCircleQuestion className="h-6 w-6" />
          <span aria-hidden="true" className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-highlight ring-2 ring-brand" />
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Help assistant"
          className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(640px,calc(100vh-1.5rem))] flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-float animate-rise sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[400px]"
        >
          <header className="relative flex items-center gap-3 border-b border-line bg-gradient-to-br from-brand-soft via-surface to-highlight-soft px-4 py-3.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand text-white shadow-card">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-extrabold text-ink">Live Books Assistant</h2>
              <p className="text-[11.5px] font-semibold text-ink-3">Answers from the User Guide · works offline</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface hover:text-ink" aria-label="Close help assistant">
              <X className="h-5 w-5" />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-canvas px-4 py-4" aria-live="polite">
            {thread.map((m) =>
              m.from === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-[13px] font-medium text-white">{m.text}</p>
                </div>
              ) : (
                <div key={m.id} className="max-w-[94%] rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-3 shadow-card">
                  {m.reply?.topic && <h3 className="mb-1 text-[13.5px] font-extrabold text-ink">{m.reply.topic.title}</h3>}
                  <p className="text-[13px] leading-relaxed text-ink-2">{m.reply?.text}</p>
                  {m.reply?.otherRoleNote && (
                    <p className="mt-2 rounded-lg bg-lavender-soft px-2.5 py-1.5 text-[12px] font-semibold text-lavender-ink">{m.reply.otherRoleNote}</p>
                  )}
                  {m.reply?.topic && !m.reply.otherRoleNote && <TopicAnswer topic={m.reply.topic} onNavigate={() => setOpen(false)} />}
                  {m.reply?.kind === 'fallback' && m.reply.related.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {m.reply.related.map((t) => (
                        <li key={t.id}>
                          <button type="button" onClick={() => ask(t.title)} className="text-left text-[12.5px] font-bold text-brand-ink hover:underline">{t.title}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            )}
          </div>

          {chips.length > 0 && (
            <div className="flex gap-2 overflow-x-auto border-t border-line bg-surface px-3 pt-3 pb-1">
              {chips.map((c) => (
                <button key={c} type="button" onClick={() => ask(c)} className="shrink-0 rounded-full border border-brand-line bg-brand-soft px-3 py-1.5 text-[12px] font-bold text-brand-ink hover:bg-surface">
                  {c}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2 bg-surface p-3"
          >
            <label htmlFor="help-input" className="sr-only">Ask a question</label>
            <input
              id="help-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="How do I…"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-canvas px-3.5 text-sm text-ink placeholder-ink-4 focus:border-brand focus:bg-surface focus:outline-none focus:ring-3 focus:ring-brand/15"
            />
            <button type="submit" disabled={!input.trim()} className={cx('inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white transition-opacity hover:bg-brand-strong disabled:opacity-40')} aria-label="Send question">
              <ArrowUp className="h-5 w-5" />
            </button>
          </form>
        </section>
      )}
    </>
  );
}

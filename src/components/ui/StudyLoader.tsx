'use client';

/**
 * Strynkix Live Books — the full-page loader: "Strix", a coder owl that bobs
 * and blinks over a laptop while code glyphs float up, with a rotating coding
 * tip underneath. Pure SVG + CSS (no download); still under "reduce motion".
 */

import React, { useEffect, useState } from 'react';

const TIPS = [
  '`const` stops reassignment — but an object it holds can still change.',
  'Read error messages from the top: the first line usually names the problem.',
  'Name things for what they mean, not what they are: `total`, not `num2`.',
  '`===` compares value and type; `==` converts types first. Prefer `===`.',
  'Stuck? Explain the code out loud, line by line. It works surprisingly often.',
  'Small commits with clear messages make it easy to undo one mistake.',
  'Arrays start at index 0, so the last item is at `length - 1`.',
  'A function should do one thing. If its name needs “and”, split it.',
];

function Tip({ text }: { text: string }) {
  // `code` spans in the tip text render as inline code.
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 ? <code key={i} className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.92em] text-brand-ink">{part}</code> : part
      )}
    </>
  );
}

export function StrixMascot({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true" className="overflow-visible">
      <ellipse cx="60" cy="112" rx="30" ry="4" className="fill-ink/10 strix-shadow" />
      <g className="strix-glyph" style={{ animationDelay: '0s' }}><text x="14" y="40" className="fill-spark font-mono text-[14px] font-bold">{'</>'}</text></g>
      <g className="strix-glyph" style={{ animationDelay: '1.1s' }}><text x="92" y="34" className="fill-lavender font-mono text-[14px] font-bold">{'{ }'}</text></g>
      <g className="strix-glyph" style={{ animationDelay: '2.2s' }}><text x="98" y="70" className="fill-teal font-mono text-[12px] font-bold">;</text></g>
      <g className="strix-bob">
        <path d="M30 34 L38 14 L48 30 Z" className="fill-brand-strong" />
        <path d="M90 34 L82 14 L72 30 Z" className="fill-brand-strong" />
        <ellipse cx="60" cy="62" rx="34" ry="36" className="fill-brand" />
        <ellipse cx="60" cy="74" rx="22" ry="20" className="fill-brand-soft" />
        <g className="strix-blink">
          <circle cx="46" cy="54" r="11" fill="#fff" />
          <circle cx="74" cy="54" r="11" fill="#fff" />
          <circle cx="48" cy="55" r="5" fill="#0f1126" />
          <circle cx="76" cy="55" r="5" fill="#0f1126" />
          <circle cx="50" cy="53" r="1.6" fill="#fff" />
          <circle cx="78" cy="53" r="1.6" fill="#fff" />
        </g>
        <path d="M56 64 L64 64 L60 70 Z" className="fill-spark" />
        <rect x="36" y="76" width="48" height="22" rx="3" className="fill-surface stroke-line-strong" strokeWidth="1.5" />
        <text x="60" y="91" textAnchor="middle" className="fill-brand font-mono text-[10px] font-bold">{'>_'}</text>
        <rect x="30" y="97" width="60" height="5" rx="2.5" className="fill-ink-3" />
      </g>
    </svg>
  );
}

export function StudyLoader({ label = 'Loading…' }: { label?: string }) {
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 3800);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex flex-col items-center gap-5 px-6 text-center">
      <StrixMascot size={148} />
      <div className="space-y-2">
        <p role="status" aria-live="polite" className="text-[15px] font-bold text-ink">{label}</p>
        <p key={tip} className="mx-auto max-w-sm text-[13px] leading-relaxed text-ink-3 animate-rise">
          <span aria-hidden="true">💡 </span><Tip text={TIPS[tip]} />
        </p>
      </div>
    </div>
  );
}

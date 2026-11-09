'use client';

/**
 * Modal on the native <dialog> element: focus trap, Esc and an inert background
 * come from the platform. Long content scrolls inside; on phones it opens as a
 * sheet from the bottom so the actions stay in thumb reach.
 */

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { cx } from './tones';

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = React.useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cx(
        'mx-auto mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-surface p-0 text-ink shadow-float open:flex open:flex-col open:animate-rise sm:m-auto sm:rounded-2xl',
        { sm: 'sm:w-[min(92vw,26rem)]', md: 'sm:w-[min(92vw,34rem)]', lg: 'sm:w-[min(92vw,46rem)]' }[size]
      )}
    >
      <header className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="type-section text-ink">{title}</h2>
          {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
        </div>
        <IconButton label="Close" size="sm" onClick={onClose} className="-mr-1.5 -mt-0.5"><X className="h-4 w-4" /></IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-canvas px-5 py-3 sm:px-6">{footer}</footer>}
    </dialog>
  );
}

/**
 * Native modal behaviour (focus trap, inert page, top layer) for a form that
 * draws its own panel. Without `onClose`, Esc does nothing: use that when the
 * content must be acknowledged, such as credentials shown only once.
 */
export function ModalFrame({ onClose, children }: { onClose?: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onClose?.(); }}
      className="m-0 h-dvh max-h-none w-screen max-w-none items-center justify-center bg-transparent p-3 text-ink open:flex sm:p-4 [&>*:not(button)]:max-h-[92dvh] [&>*:not(button)]:overflow-y-auto [&>*:not(button)]:animate-rise"
    >
      {children}
    </dialog>
  );
}

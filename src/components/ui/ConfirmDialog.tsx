'use client';

/**
 * Promise-based confirmation dialog on the native <dialog> element
 * (focus trap, Esc to cancel and inert background come from the platform).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './Button';

interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
}

export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (options && dialog && !dialog.open) dialog.showModal();
  }, [options]);

  const close = (ok: boolean) => {
    dialogRef.current?.close();
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  const dialog = (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        close(false);
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(92vw,26rem)] rounded-card border border-line bg-surface p-0 text-ink shadow-lift backdrop:bg-ink/20 backdrop:backdrop-blur-[3px] open:animate-rise"
    >
      {options && (
        <div className="p-6 space-y-4">
          <h2 id="confirm-title" className="text-lg font-bold">{options.title}</h2>
          {options.body && <div className="text-sm text-ink-2">{options.body}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => close(false)} autoFocus>Cancel</Button>
            <Button variant={options.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
              {options.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );

  return { confirm, dialog };
}

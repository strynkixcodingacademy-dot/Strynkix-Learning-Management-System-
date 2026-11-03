'use client';

/**
 * Promise-based confirmation dialog on the native <dialog> element
 * (focus trap, Esc to cancel and inert background come from the platform).
 * `prompt` reuses the same dialog to ask for a short text (or a choice),
 * validated in place instead of with window.prompt.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './Button';

interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
}

interface PromptOptions extends ConfirmOptions {
  label: string;
  defaultValue?: string;
  /** Minimum trimmed length; 0 makes the answer optional. Default 5. */
  minLength?: number;
  /** Shows a select instead of a text area. */
  choices?: { value: string; label: string }[];
}

export function useConfirm() {
  const [options, setOptions] = useState<(ConfirmOptions & Partial<PromptOptions>) | null>(null);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const resolver = useRef<((answer: string | null) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = (answer) => resolve(answer !== null);
    });
  }, []);

  /** Resolves with the trimmed answer, or null when cancelled. */
  const prompt = useCallback((opts: PromptOptions) => {
    setOptions(opts);
    setValue(opts.defaultValue ?? opts.choices?.[0]?.value ?? '');
    setTouched(false);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (options && dialog && !dialog.open) dialog.showModal();
  }, [options]);

  const isPrompt = !!options?.label;
  const minLength = options?.choices ? 0 : options?.minLength ?? 5;
  const invalid = isPrompt && value.trim().length < minLength;

  const close = (ok: boolean) => {
    if (ok && invalid) {
      setTouched(true);
      return;
    }
    dialogRef.current?.close();
    resolver.current?.(ok ? (isPrompt ? value.trim() : '') : null);
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
          {isPrompt && (
            <label className="block space-y-1.5 text-sm">
              <span className="font-semibold">{options.label}</span>
              {options.choices ? (
                <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-3 py-2">
                  {options.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              ) : (
                <textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onBlur={() => setTouched(true)}
                  rows={3}
                  autoFocus
                  aria-invalid={touched && invalid}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2"
                />
              )}
              {touched && invalid && <span role="alert" className="block text-xs text-danger-ink">Please write at least {minLength} characters.</span>}
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => close(false)} autoFocus={!isPrompt}>Cancel</Button>
            <Button variant={options.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
              {options.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );

  return { confirm, prompt, dialog };
}

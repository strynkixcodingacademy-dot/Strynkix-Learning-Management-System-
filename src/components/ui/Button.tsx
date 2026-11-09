import React from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from './tones';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong active:bg-brand-strong',
  secondary: 'bg-surface text-ink border border-line-strong hover:border-silver hover:bg-surface-muted/60',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-muted hover:text-ink',
  danger: 'bg-surface text-danger-ink border border-danger-line hover:bg-danger-soft',
  success: 'bg-success-strong text-white hover:bg-success-ink',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-5 text-body gap-2 rounded-lg',
};

/** Class string for buttons and button-styled links. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cx(
    'inline-flex items-center justify-center font-semibold whitespace-nowrap transition-[background-color,color,border-color,transform] duration-150 ease-out active:translate-y-px disabled:opacity-50 disabled:pointer-events-none select-none',
    VARIANTS[variant],
    SIZES[size],
    extra
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({ variant = 'primary', size = 'md', loading = false, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

/** Class string for icon-only buttons and links. Pair with an aria-label. */
export function iconButtonClasses(size: 'sm' | 'md' = 'md', extra?: string): string {
  return cx(
    'inline-flex shrink-0 items-center justify-center text-ink-3 transition-colors duration-150 hover:bg-surface-muted hover:text-ink disabled:opacity-50 disabled:pointer-events-none',
    size === 'sm' ? 'h-8 w-8 rounded-md' : 'h-10 w-10 rounded-lg',
    extra
  );
}

/** Icon-only button. The label is its accessible name and its tooltip. */
export function IconButton({ label, size = 'md', className, children, type = 'button', ...rest }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { label: string; size?: 'sm' | 'md' }) {
  return (
    <button type={type} aria-label={label} title={label} className={iconButtonClasses(size, className)} {...rest}>
      {children}
    </button>
  );
}

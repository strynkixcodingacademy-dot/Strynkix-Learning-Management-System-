import React from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from './tones';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong active:translate-y-px shadow-card',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-muted active:translate-y-px',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-muted hover:text-ink',
  danger: 'bg-surface text-danger-ink border border-danger-line hover:bg-danger-soft active:translate-y-px',
  success: 'bg-success text-white hover:brightness-95 active:translate-y-px shadow-card',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
};

/** Class string for buttons and button-styled links. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cx(
    'inline-flex items-center justify-center font-semibold whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 disabled:opacity-50 disabled:pointer-events-none select-none',
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

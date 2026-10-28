import React from 'react';
import { AlertCircle, CheckCircle2, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { Illustration, IllustrationName } from './Illustrations';
import { Button } from './Button';
import { TONE_CLASSES, cx } from './tones';

export function EmptyState({
  illustration = 'book',
  title,
  children,
  action,
  compact = false,
}: {
  illustration?: IllustrationName;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('flex flex-col items-center text-center rounded-card border border-dashed border-line-strong bg-surface', compact ? 'px-6 py-8 gap-2' : 'px-6 py-12 gap-3')}>
      <Illustration name={illustration} size={compact ? 84 : 120} />
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {children && <div className="text-sm text-ink-3 max-w-md">{children}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', children, onRetry }: { title?: string; children?: React.ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center text-center gap-3 rounded-card border border-danger-line bg-danger-soft px-6 py-10">
      <AlertCircle className="w-8 h-8 text-danger-ink" aria-hidden="true" />
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {children && <div className="text-sm text-ink-2 max-w-md">{children}</div>}
      {onRetry && (
        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Skeleton lines/blocks that mirror the layout that is loading (no layout shift). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden="true" />;
}

export function LoadingState({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-1/3" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}

const NOTICE = {
  success: { tone: 'success' as const, Icon: CheckCircle2 },
  error: { tone: 'danger' as const, Icon: AlertCircle },
  warning: { tone: 'warning' as const, Icon: TriangleAlert },
  info: { tone: 'brand' as const, Icon: Info },
};

/** Inline feedback (success / error / warning / info). Errors are announced assertively. */
export function Notice({
  kind,
  children,
  action,
  className,
}: {
  kind: keyof typeof NOTICE;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const { tone, Icon } = NOTICE[kind];
  const t = TONE_CLASSES[tone];
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cx('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm animate-rise', t.soft, t.line, 'text-ink-2', className)}
    >
      <Icon className={cx('w-4 h-4 mt-0.5 shrink-0', t.ink)} aria-hidden="true" />
      <div className="flex-1 min-w-0">{children}</div>
      {action}
    </div>
  );
}

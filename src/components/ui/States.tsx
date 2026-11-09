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
    <div className={cx('flex flex-col items-center rounded-card bg-surface-muted/60 text-center', compact ? 'gap-1.5 px-6 py-7' : 'gap-2 px-6 py-12')}>
      <Illustration name={illustration} size={compact ? 24 : 32} className="mb-1 text-ink-4" />
      <h3 className={cx('font-semibold text-ink', compact ? 'text-body' : 'text-lg')}>{title}</h3>
      {children && <div className="max-w-md text-sm text-ink-3">{children}</div>}
      {action && <div className="pt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', children, onRetry }: { title?: string; children?: React.ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-card border border-danger-line bg-danger-soft px-6 py-10 text-center">
      <AlertCircle className="mb-1 h-7 w-7 text-danger-ink" aria-hidden="true" />
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {children && <div className="max-w-md text-sm text-ink-2">{children}</div>}
      {onRetry && (
        <div className="pt-3">
          <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRetry}>
            Try again
          </Button>
        </div>
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
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">{label}</span>
      <div className="space-y-3 border-b border-line pb-6">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        {Array.from({ length: Math.min(rows, 4) }, (_, i) => (
          <div key={i} className="space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-8 w-16" /></div>
        ))}
      </div>
      <Skeleton className="h-56" />
    </div>
  );
}

const NOTICE = {
  success: { tone: 'success' as const, Icon: CheckCircle2 },
  error: { tone: 'danger' as const, Icon: AlertCircle },
  warning: { tone: 'warning' as const, Icon: TriangleAlert },
  info: { tone: 'info' as const, Icon: Info },
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
      className={cx('flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm text-ink-2', t.soft, t.line, className)}
    >
      <Icon className={cx('w-4 h-4 mt-0.5 shrink-0', t.ink)} aria-hidden="true" />
      <div className="flex-1 min-w-0">{children}</div>
      {action}
    </div>
  );
}

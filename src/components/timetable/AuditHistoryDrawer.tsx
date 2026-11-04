'use client';

/**
 * Strynkix LMS — Timetable Audit History Drawer
 * Displays an append-only, immutable timeline of all timetable transitions,
 * actor roles, timestamps, and correction comments.
 */

import React from 'react';
import { TimetableAuditLog } from '@/types/domain';
import { STATUS_LABELS } from '@/lib/learning/timetable';
import { Clock, History, Shield, User, X } from 'lucide-react';

interface AuditHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  logs: TimetableAuditLog[];
  isLoading?: boolean;
}

export function AuditHistoryDrawer({
  isOpen,
  onClose,
  logs,
  isLoading = false,
}: AuditHistoryDrawerProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-title"
    >
      <div className="w-full max-w-md h-full bg-surface border-l border-line shadow-2xl flex flex-col animate-slide-left">
        <header className="flex items-center justify-between p-5 border-b border-line bg-canvas">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-brand-ink" />
            <h2 id="audit-title" className="text-base font-bold text-ink">
              Approval & Revision History
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-surface transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-ink-3">
              Loading audit timeline...
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-xs text-ink-3">
              No audit records logged yet.
            </div>
          ) : (
            <ol className="relative border-l border-line ml-3 space-y-6">
              {logs.map((log) => {
                const date = new Date(log.timestamp);
                const formattedTime = Number.isNaN(date.getTime())
                  ? log.timestamp
                  : date.toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                return (
                  <li key={log.id} className="ml-5 relative">
                    <span className="absolute -left-[27px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-surface bg-brand" />
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-ink uppercase tracking-wide">
                          {log.action.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] text-ink-4 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {formattedTime}
                        </span>
                      </div>

                      <div className="text-xs text-ink-2">
                        Transitioned from{' '}
                        <span className="font-semibold">{STATUS_LABELS[log.fromStatus] || log.fromStatus}</span> to{' '}
                        <span className="font-semibold text-brand-ink">{STATUS_LABELS[log.toStatus] || log.toStatus}</span>
                      </div>

                      <div className="text-[11px] text-ink-3 flex items-center gap-1.5 pt-0.5">
                        <Shield className="w-3 h-3 text-ink-4" />
                        <span>Role: {log.actorRole}</span>
                        <span>·</span>
                        <User className="w-3 h-3 text-ink-4" />
                        <span className="font-mono text-[10px]">{log.actorUid.slice(0, 8)}...</span>
                      </div>

                      {log.comment && (
                        <div className="mt-2 p-2.5 rounded-lg bg-surface-muted border border-line text-xs text-ink whitespace-pre-line">
                          <span className="font-bold text-[10px] uppercase tracking-wider text-ink-3 block mb-0.5">
                            Feedback / Comment:
                          </span>
                          {log.comment}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}


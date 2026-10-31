'use client';

/**
 * Strynkix Live Books — in-app notifications (milestone G46): bell with the
 * unread count, a panel with the latest notifications, mark one or all read.
 * Live: new notifications appear without a reload. Only the signed-in user's
 * own notifications are readable (firestore.rules).
 */

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppNotification } from '@/types/domain';
import { listenToNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/notifications/service';
import { cx } from '@/components/ui/tones';
import { Bell, CheckCheck, X } from 'lucide-react';

function when(n: AppNotification): string {
  const t = (n.createdAt as { toDate?: () => Date } | null)?.toDate?.();
  if (!t) return 'just now';
  const minutes = Math.round((Date.now() - t.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** `align`: where the panel opens — below and to the left (header) or to the right (desktop rail). */
export function NotificationBell({ align = 'header' }: { align?: 'header' | 'rail' }) {
  const { user, tenant } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const orgId = tenant?.orgId;
  const uid = user?.uid;

  useEffect(() => {
    if (!orgId || !uid) return;
    return listenToNotifications({ orgId, userId: uid }, (list) => { setItems(list); setFailed(false); }, () => setFailed(true));
  }, [orgId, uid]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!orgId || !uid) return null;
  const unread = items.filter((n) => !n.read);
  const label = unread.length ? `Notifications, ${unread.length} unread` : 'Notifications';

  return (
    <div className="relative" ref={panelRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={label} aria-expanded={open} aria-haspopup="dialog"
        className={cx('relative inline-flex items-center justify-center text-ink-3 hover:text-ink', align === 'rail' ? 'h-11 w-11 rounded-xl hover:bg-surface-muted' : 'h-9 w-9 rounded-full hover:bg-surface')}>
        <Bell className="h-[18px] w-[18px]" />
        {unread.length > 0 && (
          <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-coral px-1 text-[10px] font-extrabold text-white">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>
      {open && (
        <section role="dialog" aria-label="Notifications"
          className={cx('absolute z-50 w-[min(92vw,380px)] overflow-hidden rounded-card border border-line bg-surface shadow-float animate-rise', align === 'rail' ? 'bottom-0 left-full ml-3' : 'right-0 mt-2')}>
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-sm font-extrabold text-ink">Notifications</h2>
            <div className="flex items-center gap-1">
              {unread.length > 0 && (
                <button type="button" onClick={() => markAllNotificationsRead(unread.map((n) => n.id)).catch(() => setFailed(true))}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-ink hover:bg-brand-soft">
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all as read
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close notifications" className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted"><X className="h-4 w-4" /></button>
            </div>
          </header>
          {failed && <p className="px-4 py-2 text-xs text-danger-ink">Notifications couldn’t be updated. Check your connection.</p>}
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-3">You’re all caught up. Reviews, grades and account updates will appear here.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {items.map((n) => {
                const body = (
                  <>
                    <span className="flex items-start gap-2">
                      {!n.read && <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
                      <span className={cx('text-sm', n.read ? 'text-ink-2' : 'font-bold text-ink')}>{n.title}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-3">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-ink-4">{when(n)}{!n.read && <span className="sr-only"> · unread</span>}</span>
                  </>
                );
                const markRead = () => { if (!n.read) markNotificationRead(n.id).catch(() => setFailed(true)); };
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link href={n.link} onClick={() => { markRead(); setOpen(false); }} className="block px-4 py-3 hover:bg-surface-muted">{body}</Link>
                    ) : (
                      <button type="button" onClick={markRead} className="block w-full px-4 py-3 text-left hover:bg-surface-muted">{body}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

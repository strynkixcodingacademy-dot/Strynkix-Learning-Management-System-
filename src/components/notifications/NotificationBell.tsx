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
import { announcementsApi } from '@/lib/academy/api';
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

export function NotificationBell() {
  const { user, tenant } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const orgId = tenant?.orgId;
  const uid = user?.uid;
  // Announcements (Stage 8): fetched from the server for this user; dismissals are kept in this browser only.
  const [announcements, setAnnouncements] = useState<{ id: string; title: string; message: string; publishAt: string; from: string }[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const dismissKey = uid ? `lb-ann-dismissed:${uid}` : null;
  useEffect(() => {
    if (!uid || !dismissKey) return;
    let live = true;
    try { const raw = window.localStorage.getItem(dismissKey); if (raw) Promise.resolve(JSON.parse(raw) as string[]).then((d) => live && setDismissed(d)); } catch { /* storage unavailable */ }
    announcementsApi<{ announcements: typeof announcements }>({ action: 'mine' }).then((r) => live && setAnnouncements(r.announcements)).catch(() => undefined);
    return () => { live = false; };
  }, [uid, dismissKey]);
  const visibleAnnouncements = announcements.filter((a) => !dismissed.includes(a.id));
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try { if (dismissKey) window.localStorage.setItem(dismissKey, JSON.stringify(next.slice(-200))); } catch { /* storage unavailable */ }
  };

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
  const badge = unread.length + visibleAnnouncements.length;
  const label = badge ? `Notifications, ${badge} unread` : 'Notifications';

  return (
    <div className="relative" ref={panelRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={label} aria-expanded={open} aria-haspopup="dialog"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-muted hover:text-ink">
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
        {badge > 0 && (
          <span aria-hidden="true" className="absolute right-0.5 top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-coral-ink px-1 text-[0.6875rem] font-semibold leading-none text-white">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
      {open && (
        <section role="dialog" aria-label="Notifications"
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-card border border-line bg-surface shadow-float animate-rise sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[380px]">
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="type-section text-ink">Notifications</h2>
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
          {visibleAnnouncements.length > 0 && (
            <ul aria-label="Announcements" className="divide-y divide-line border-b border-line bg-surface-muted/50">
              {visibleAnnouncements.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{a.title}</span>
                    <button type="button" onClick={() => dismiss(a.id)} className="shrink-0 text-xs font-semibold text-ink-3 hover:text-ink">Dismiss</button>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-2">{a.message}</p>
                  <span className="mt-1 block text-xs text-ink-4">Announcement from {a.from}</span>
                </li>
              ))}
            </ul>
          )}
          {items.length === 0 && visibleAnnouncements.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-3">You’re all caught up. Reviews, grades and account updates will appear here.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {items.map((n) => {
                const body = (
                  <>
                    <span className="flex items-start gap-2">
                      {!n.read && <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
                      <span className={cx('text-sm', n.read ? 'text-ink-2' : 'font-medium text-ink')}>{n.title}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-3">{n.body}</span>
                    <span className="mt-1 block text-xs text-ink-4">{when(n)}{!n.read && <span className="sr-only"> · unread</span>}</span>
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

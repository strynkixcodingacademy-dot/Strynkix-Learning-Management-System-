'use client';

/**
 * Strynkix Live Books — Audit log (milestone G44). A read-only, paginated view
 * of the academy's audit entries: accounts, Course Design membership, review
 * and publishing, content and assessment changes, academy and branch changes.
 * Entries are written only by trusted server routes and can't be edited.
 * Super Admin (any academy) and the academy's University Admin.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc, type DocumentSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/context/AuthContext';
import { AppShell, ROLE_LABELS } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { getOrganizations } from '@/lib/admin/service';
import { AUDIT_ACTION_LABELS, AUDIT_CATEGORIES, AuditCategory, AuditRow, getAuditPage } from '@/lib/admin/audit';
import { Organization, UserRole } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader, fieldClasses } from '@/components/ui/Page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';

/** One-line description of what changed, from the entry's own fields (no personal data is stored there). */
function details(r: AuditRow): string {
  const d = r.data;
  const parts: string[] = [];
  if (d.fromRole || d.toRole) parts.push(`${d.fromRole ? ROLE_LABELS[d.fromRole as UserRole] ?? d.fromRole : ''}${d.fromRole ? ' → ' : ''}${ROLE_LABELS[d.toRole as UserRole] ?? d.toRole ?? ''}`);
  if (d.fromStatus || d.toStatus) parts.push(`${d.fromStatus ?? ''} → ${d.toStatus ?? ''}`);
  if (d.fromReview && d.toReview && d.fromReview !== d.toReview) parts.push(`review ${d.fromReview} → ${d.toReview}`);
  if (Array.isArray(d.fields)) parts.push(`fields: ${(d.fields as string[]).join(', ')}`);
  if (d.version) parts.push(`version ${d.version}`);
  if (d.override) parts.push('override');
  if (d.orgWide) parts.push('every course');
  if (d.membershipRevoked) parts.push('membership revoked');
  if (typeof d.comment === 'string') parts.push(`“${d.comment}”`);
  if (typeof d.reason === 'string') parts.push(`reason: ${d.reason}`);
  return parts.join(' · ');
}

function targetLink(r: AuditRow): string | null {
  if (r.targetType === 'lesson' && r.courseId && r.targetId) return `/dashboard/courses/${r.courseId}/lessons/${r.targetId}`;
  if ((r.targetType === 'course' || r.targetType === 'module') && r.courseId) return `/dashboard/courses/${r.courseId}`;
  if (r.targetType === 'branch' && r.targetId) return `/dashboard/branches/${r.targetId}`;
  return null;
}

export default function AuditLogPage() {
  const { tenant } = useAuth();
  const [orgOverride, setOrgId] = useState<string | null>(null);
  const orgId = orgOverride ?? tenant?.orgId ?? null;
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [category, setCategory] = useState<AuditCategory>('all');
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // The request whose results are on screen; anything else means "loading".
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (tenant?.role === 'super_admin') getOrganizations().then(setOrgs).catch(() => setOrgs([]));
  }, [tenant]);

  // Resolve names of the people involved (users the viewer may read).
  const resolveNames = useCallback(async (list: AuditRow[]) => {
    const ids = [...new Set(list.flatMap((r) => [r.actorId, r.targetType === 'user' ? r.targetId : undefined]).filter((x): x is string => Boolean(x) && !x!.startsWith('migration:')))];
    const missing = ids.filter((id) => !(id in names));
    if (!missing.length) return;
    const found = await Promise.all(missing.map(async (id) => {
      const snap = await getDoc(doc(db, 'users', id)).catch(() => null);
      return [id, snap?.exists() ? ((snap.data().displayName as string) || (snap.data().email as string) || id) : id] as const;
    }));
    setNames((n) => ({ ...n, ...Object.fromEntries(found) }));
  }, [names]);

  const requestKey = `${orgId}|${category}|${reloadKey}`;
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    let alive = true;
    if (!orgId) return;
    getAuditPage(orgId, category, null)
      .then((page) => {
        if (!alive) return;
        setRows(page.rows);
        setCursor(page.cursor);
        setHasMore(page.hasMore);
        setError(null);
        resolveNames(page.rows);
      })
      .catch((err) => {
        console.error('Failed to load audit log', err);
        if (alive) setError('The audit log couldn’t be loaded. Check your connection and try again.');
      })
      .finally(() => alive && setLoadedKey(requestKey));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const loadMore = async () => {
    if (!orgId || !cursor) return;
    setLoadingMore(true);
    try {
      const page = await getAuditPage(orgId, category, cursor);
      setRows((r) => [...r, ...page.rows]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
      resolveNames(page.rows);
    } catch {
      setError('More entries couldn’t be loaded. Try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  const name = (id?: string) => (!id ? '—' : id.startsWith('migration:') ? 'Migration run' : names[id] ?? id);

  return (
    <AppShell>
      <RequireRole allowedRoles={['super_admin', 'university_admin']}>
        <div className="space-y-6">
          <PageHeader eyebrow="Academy administration" title="Audit log"
            description="Every account, membership, review, publishing, content and academy change, with who made it and when. Entries can’t be edited or deleted." />
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
              <div role="tablist" aria-label="Filter by category" className="flex gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1">
                {(['all', ...Object.keys(AUDIT_CATEGORIES)] as AuditCategory[]).map((c) => (
                  <button key={c} type="button" role="tab" aria-selected={category === c} onClick={() => setCategory(c)}
                    className={cx('shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-bold transition-colors', category === c ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}>
                    {c === 'all' ? 'Everything' : AUDIT_CATEGORIES[c as Exclude<AuditCategory, 'all'>].label}
                  </button>
                ))}
              </div>
              {tenant?.role === 'super_admin' && orgs.length > 1 && (
                <div className="lg:ml-auto">
                  <label htmlFor="audit-org" className="sr-only">Academy</label>
                  <select id="audit-org" value={orgId ?? ''} onChange={(e) => setOrgId(e.target.value)} className={cx(fieldClasses, 'h-9 py-1 text-sm')}>
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            {error && !loading ? (
              <div className="p-4"><ErrorState onRetry={() => setReloadKey((k) => k + 1)}>{error}</ErrorState></div>
            ) : loading ? (
              <div className="p-4"><LoadingState label="Loading audit entries…" rows={4} /></div>
            ) : rows.length === 0 ? (
              <div className="p-6"><EmptyState compact illustration="inbox" title="No entries">Nothing has been recorded in this category yet.</EmptyState></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3">
                    <tr className="border-b border-line">
                      <th scope="col" className="px-4 py-2.5">When</th>
                      <th scope="col" className="px-2 py-2.5">What</th>
                      <th scope="col" className="px-2 py-2.5">Who</th>
                      <th scope="col" className="px-2 py-2.5">Target</th>
                      <th scope="col" className="px-2 py-2.5 pr-4">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const link = targetLink(r);
                      const target = r.targetType === 'user' ? name(r.targetId) : `${r.targetType ?? ''} ${r.targetId ?? ''}`.trim();
                      return (
                        <tr key={r.id} className="border-b border-line align-top">
                          <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-3">{r.at ? r.at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                          <td className="px-2 py-2.5 font-semibold text-ink">{AUDIT_ACTION_LABELS[r.action] ?? r.action}</td>
                          <td className="px-2 py-2.5 text-ink-2">{name(r.actorId)}{r.actorRole && r.actorRole !== 'system' ? <span className="block text-[11px] text-ink-4">{ROLE_LABELS[r.actorRole as UserRole] ?? r.actorRole}</span> : null}</td>
                          <td className="px-2 py-2.5 text-ink-2">{link ? <Link href={link} className="text-brand-ink hover:underline">{target}</Link> : target}</td>
                          <td className="px-2 py-2.5 pr-4 text-xs text-ink-3">{details(r)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {hasMore && !loading && (
              <div className="flex justify-center border-t border-line p-3">
                <Button variant="secondary" size="sm" loading={loadingMore} onClick={loadMore}>Load older entries</Button>
              </div>
            )}
          </Card>
        </div>
      </RequireRole>
    </AppShell>
  );
}

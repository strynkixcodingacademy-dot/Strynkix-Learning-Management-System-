'use client';

/**
 * Cursor pagination for server lists ("Load more"). A new `key` starts over;
 * `more()` appends the next page; `reload()` refetches the first page. Results
 * of an outdated request are ignored.
 */

import { useEffect, useRef, useState } from 'react';

export function usePaged<T>(key: string, load: (cursor?: string) => Promise<{ rows: T[]; cursor: string | null }>) {
  const loader = useRef(load);
  useEffect(() => { loader.current = load; });
  const [request, setRequest] = useState<{ key: string; n: number; cursor?: string }>({ key, n: 0 });
  const req = request.key === key ? request : { key, n: 0 };
  const tag = `${req.key}#${req.n}`;
  const [pages, setPages] = useState<{ tag: string; rows: T[]; cursor: string | null; error: string | null }>({ tag: '', rows: [], cursor: null, error: null });

  useEffect(() => {
    let live = true;
    loader.current(req.cursor)
      .then((r) => live && setPages((p) => ({ tag, rows: req.cursor && p.tag.startsWith(`${req.key}#`) ? [...p.rows, ...r.rows] : r.rows, cursor: r.cursor, error: null })))
      .catch((e) => live && setPages((p) => ({ ...p, tag, error: (e as Error).message || 'Something went wrong.' })));
    return () => { live = false; };
  }, [tag, req.key, req.cursor]);

  const loading = pages.tag !== tag;
  const sameKey = pages.tag.startsWith(`${key}#`);
  return {
    rows: sameKey ? pages.rows : [],
    cursor: sameKey && !loading ? pages.cursor : null,
    loading,
    error: loading ? null : pages.error,
    more: () => { if (pages.cursor) setRequest({ key, n: req.n + 1, cursor: pages.cursor }); },
    reload: () => setRequest({ key, n: req.n + 1 }),
  };
}

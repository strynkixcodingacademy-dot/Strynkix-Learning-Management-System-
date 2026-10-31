'use client';

/**
 * Loads data for a page from a trusted route. `key` identifies the request
 * (null = not ready yet); a new key reloads, and `reload()` refetches.
 * Results of an outdated request are ignored.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useApiData<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const loader = useRef(load);
  useEffect(() => { loader.current = load; });

  useEffect(() => {
    if (key === null) return;
    let live = true;
    const tag = `${key}#${version}`;
    loader.current()
      .then((data) => live && setState({ key: tag, data }))
      .catch((e) => live && setState({ key: tag, error: (e as Error).message || 'Something went wrong.' }));
    return () => { live = false; };
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const current = state && key !== null && state.key === `${key}#${version}` ? state : null;
  // While reloading the same request, keep showing its previous data; a different request
  // (another branch, academy or date range) shows loading instead of the old figures.
  const sameRequest = state !== null && key !== null && state.key.startsWith(`${key}#`);
  const data = current?.data ?? (sameRequest && !state.error ? state.data : undefined);
  return { data, error: current?.error ?? null, loading: !current, reload };
}

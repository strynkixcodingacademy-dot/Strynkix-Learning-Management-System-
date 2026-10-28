/**
 * Strynkix Live Books — YouTube helpers for video blocks.
 * Only YouTube links are accepted, and videos are embedded from the
 * privacy-enhanced youtube-nocookie.com domain.
 */

const ID = /^[A-Za-z0-9_-]{11}$/;

/** Extracts the 11-character video id from a YouTube URL, or null if it isn't one. */
export function youtubeId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
      id = m ? m[2] : null;
    }
  }
  return id && ID.test(id) ? id : null;
}

/** Start offset in seconds from a `t` / `start` parameter (e.g. "90", "1m30s"). */
export function youtubeStart(raw: string): number {
  try {
    const url = new URL(raw.trim());
    const t = url.searchParams.get('t') ?? url.searchParams.get('start');
    if (!t) return 0;
    if (/^\d+$/.test(t)) return Number(t);
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
  } catch {
    return 0;
  }
}

export function youtubeEmbedUrl(raw: string): string | null {
  const id = youtubeId(raw);
  if (!id) return null;
  const start = youtubeStart(raw);
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0${start ? `&start=${start}` : ''}`;
}

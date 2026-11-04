/**
 * Strynkix Live Books — colour theme preference (Light / Dark / System).
 * The choice is kept in this browser; THEME_SCRIPT applies it to
 * <html data-theme> before first paint so pages never flash the wrong theme.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

const KEY = 'strynkix-theme';
const EVENT = 'strynkix:theme';

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function setThemePreference(pref: ThemePreference) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Storage blocked: the choice still applies until the page reloads.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pref }));
}

export function subscribeThemePreference(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/**
 * Inline in <head>. Light is the default; printable documents (receipts,
 * certificates, statements, admission forms) and printing are always light.
 */
export const THEME_SCRIPT = `(function(){try{
var k='${KEY}',root=document.documentElement,mq=window.matchMedia('(prefers-color-scheme: dark)'),pref=null;
function read(){try{pref=localStorage.getItem(k)}catch(e){pref=null}}
function apply(){var paper=/^\\/(receipts|certificates|statements)\\/|^\\/admissions\\/[^/]+\\/print/.test(location.pathname);
root.dataset.theme=!paper&&(pref==='dark'||(pref==='system'&&mq.matches))?'dark':'light'}
read();apply();
mq.addEventListener('change',apply);
window.addEventListener('${EVENT}',function(e){pref=e.detail;apply()});
window.addEventListener('beforeprint',function(){root.dataset.theme='light'});
window.addEventListener('afterprint',apply);
}catch(e){}})();`;

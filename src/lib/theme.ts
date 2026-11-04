/**
 * Strynkix Live Books — colour theme preference (Light / Dark / Auto / System).
 * Auto follows the local clock: dark from 7 PM to 7 AM, light in the day.
 * The choice is kept in this browser; THEME_SCRIPT applies it to
 * <html data-theme> before first paint so pages never flash the wrong theme.
 */

export type ThemePreference = 'light' | 'dark' | 'auto' | 'system';

const KEY = 'strynkix-theme';
const EVENT = 'strynkix:theme';
/** Auto mode: dark from NIGHT_FROM:00 until DAY_FROM:00 local time. */
const NIGHT_FROM = 19;
const DAY_FROM = 7;

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'auto' || v === 'system' ? v : 'light';
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
var k='${KEY}',root=document.documentElement,mq=window.matchMedia('(prefers-color-scheme: dark)'),pref=null,timer=0;
function read(){try{pref=localStorage.getItem(k)}catch(e){pref=null}}
function night(){var h=new Date().getHours();return h>=${NIGHT_FROM}||h<${DAY_FROM}}
function schedule(){clearTimeout(timer);if(pref!=='auto')return;var n=new Date(),t=new Date(n);
t.setHours(night()?${DAY_FROM}:${NIGHT_FROM},0,5,0);if(t<=n)t.setDate(t.getDate()+1);timer=setTimeout(apply,t-n)}
function apply(){var paper=/^\\/(receipts|certificates|statements)\\/|^\\/admissions\\/[^/]+\\/print/.test(location.pathname);
root.dataset.theme=!paper&&(pref==='dark'||(pref==='auto'&&night())||(pref==='system'&&mq.matches))?'dark':'light';schedule()}
read();apply();
mq.addEventListener('change',apply);
document.addEventListener('visibilitychange',function(){if(!document.hidden)apply()});
window.addEventListener('${EVENT}',function(e){pref=e.detail;apply()});
window.addEventListener('beforeprint',function(){root.dataset.theme='light'});
window.addEventListener('afterprint',apply);
}catch(e){}})();`;

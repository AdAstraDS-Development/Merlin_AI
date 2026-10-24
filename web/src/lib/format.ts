// Formatting and browser helpers shared by the views.

export const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** Currency amount; whole units from 100 upwards. */
export function money(v: number | null | undefined, currency = 'EUR'): string {
  if (v == null || Number.isNaN(Number(v))) return '';
  const n = Number(v);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: n >= 100 || Number.isInteger(n) ? 0 : 2,
  }).format(n);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function ago(iso: string | null | undefined): string {
  const s = (Date.now() - new Date(iso ?? '').getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Only http(s) links are rendered as links. */
export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
  } catch {
    return null;
  }
}

/** Reads the screen reader announcer that the app shell renders. */
export function announce(message: string): void {
  const a = document.getElementById('announcer');
  if (!a) return;
  a.textContent = '';
  setTimeout(() => (a.textContent = message), 30);
}

/** One toast at a time; the app shell shows it. */
export function toast(message: string): void {
  document.dispatchEvent(
    new CustomEvent<string>('merlin:toast', { detail: message }),
  );
}

export function readStorage(
  storage: () => Storage,
  key: string,
): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(
  storage: () => Storage,
  key: string,
  value: string | null,
): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    /* storage blocked: the value lasts for this page only */
  }
}

export function randomSuffix(length = 4): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [...crypto.getRandomValues(new Uint8Array(length))]
    .map((x) => chars[x % chars.length])
    .join('');
}

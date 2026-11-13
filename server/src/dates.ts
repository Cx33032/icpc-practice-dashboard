import { getSetting } from './db.ts';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

export function tz(): string {
  return getSetting('timezone') || 'America/Toronto';
}

/** YYYY-MM-DD for a unix timestamp in the user's time zone (en-CA formats as ISO). */
export function dayKey(unixSec: number, zone = tz()): string {
  return fmt(zone).format(new Date(unixSec * 1000));
}

export function today(zone = tz()): string {
  return dayKey(Math.floor(Date.now() / 1000), zone);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

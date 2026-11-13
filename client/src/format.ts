// Canadian time zones, west to east.
export const CANADIAN_ZONES = [
  { id: 'America/Vancouver', label: 'Pacific — Vancouver' },
  { id: 'America/Edmonton', label: 'Mountain — Edmonton, Calgary' },
  { id: 'America/Regina', label: 'Saskatchewan — Regina (no DST)' },
  { id: 'America/Winnipeg', label: 'Central — Winnipeg' },
  { id: 'America/Toronto', label: 'Eastern — Toronto, Ottawa, Montréal' },
  { id: 'America/Halifax', label: 'Atlantic — Halifax, Fredericton' },
  { id: 'America/St_Johns', label: 'Newfoundland — St. John’s' },
];

let zone = 'America/Toronto';
export function setZone(z: string) {
  zone = z || 'America/Toronto';
}
export function getZone() {
  return zone;
}

const d = (unix: number) => new Date(unix * 1000);

export function fmtDateTime(unix: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d(unix));
}
export function fmtTime(unix: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(d(unix));
}
export function fmtDate(unix: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' }).format(d(unix));
}
export function fmtDay(day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) {
  return new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}
export function dayOf(unix: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d(unix));
}

export function ago(unix: number | null | undefined) {
  if (!unix) return 'never';
  const s = Math.floor(Date.now() / 1000) - unix;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(unix);
}

export function until(unix: number) {
  const s = unix - Math.floor(Date.now() / 1000);
  if (s <= 0) return 'now';
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (days > 0) return `in ${days}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

export function duration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Wall-clock "YYYY-MM-DDTHH:mm" in the chosen zone → unix seconds. */
export function zonedToUnix(local: string): number {
  const guess = Date.parse(`${local}:00Z`);
  // Find the zone's offset at that moment and correct for it.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.floor((guess - (asUtc - guess)) / 1000);
}

export function cfRankColor(rating: number | null | undefined): string {
  if (rating == null) return 'var(--ink-3)';
  if (rating < 1200) return '#808080';
  if (rating < 1400) return '#008000';
  if (rating < 1600) return '#03a89e';
  if (rating < 1900) return '#0000ff';
  if (rating < 2100) return '#aa00aa';
  if (rating < 2400) return '#ff8c00';
  return '#ff0000';
}

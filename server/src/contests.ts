import { all, getSetting } from './db.ts';
import { codeforcesUpcoming } from './adapters/codeforces.ts';
import { leetcodeUpcoming } from './adapters/leetcode.ts';
import { kattisContests } from './adapters/kattis.ts';

export interface Contest {
  platform: 'codeforces' | 'leetcode' | 'kattis' | 'custom';
  id: string;
  title: string;
  start: number;
  duration: number;
  url: string | null;
  note?: string | null;
}

interface CacheEntry {
  at: number;
  data: Contest[];
  error?: string;
}
const cache = new Map<string, CacheEntry>();
const TTL = 30 * 60_000;

async function cached(name: string, load: () => Promise<Contest[]>, force: boolean): Promise<CacheEntry> {
  const hit = cache.get(name);
  if (!force && hit && !hit.error && Date.now() - hit.at < TTL) return hit;
  try {
    const data = await load();
    const entry: CacheEntry = { at: Date.now(), data };
    cache.set(name, entry);
    return entry;
  } catch (e) {
    // Keep showing the last good list if a site is down.
    const entry = { at: Date.now(), data: hit?.data ?? [], error: e instanceof Error ? e.message : String(e) };
    cache.set(name, entry);
    return entry;
  }
}

export async function upcomingContests(force = false) {
  const [cf, lc, kt] = await Promise.all([
    cached('codeforces', codeforcesUpcoming, force),
    cached('leetcode', leetcodeUpcoming, force),
    cached('kattis', kattisContests, force),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const hideLong = getSetting('hideLongKattis') !== '0';
  const kattis = kt.data.filter(
    (c) => c.duration > 0 && c.start + c.duration > now && c.start < now + 365 * 86400 && (!hideLong || c.duration <= 24 * 3600),
  );
  const custom: Contest[] = all<any>('SELECT * FROM events ORDER BY start_ts').map((e) => ({
    platform: 'custom',
    id: `ev-${e.id}`,
    title: e.title,
    start: e.start_ts,
    duration: e.duration_s,
    url: e.url,
    note: e.note,
  }));
  const contests = [...cf.data, ...lc.data, ...kattis, ...custom.filter((c) => c.start + c.duration > now - 86400)].sort((a, b) => a.start - b.start);
  const errors: Record<string, string> = {};
  if (cf.error) errors.codeforces = cf.error;
  if (lc.error) errors.leetcode = lc.error;
  if (kt.error) errors.kattis = kt.error;
  return { contests, errors, past: custom.filter((c) => c.start + c.duration <= now - 86400).reverse() };
}

function icsDate(unix: number) {
  return new Date(unix * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function icsEscape(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function toIcs(list: Contest[]) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//icpc-practice//contests//EN', 'CALSCALE:GREGORIAN'];
  const stamp = icsDate(Math.floor(Date.now() / 1000));
  for (const c of list) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${c.id}@icpc-practice`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(c.start)}`,
      `DTEND:${icsDate(c.start + c.duration)}`,
      `SUMMARY:${icsEscape(c.title)}`,
      ...(c.url ? [`URL:${c.url}`, `DESCRIPTION:${icsEscape(c.url)}`] : []),
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(c.title)} starts in 30 minutes`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

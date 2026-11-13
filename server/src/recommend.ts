import { all, get, getSetting } from './db.ts';
import { today } from './dates.ts';
import { weakTags, workingLevel } from './stats.ts';
import { canonicalTags } from './tags.ts';
import type { Platform } from './store.ts';

export interface Pick {
  platform: Platform;
  key: string;
  title: string;
  url: string;
  rating: number | null;
  native: string | null;
  tags: string[];
  reason: string;
}

// Small deterministic PRNG so the day's picks stay put until you ask for new ones.
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

interface Candidate {
  platform: Platform;
  key: string;
  title: string;
  url: string;
  rating: number | null;
  native: string | null;
  tags: string;
  extra: string | null;
}

function candidates(platform: Platform, lo: number, hi: number): Candidate[] {
  return all<Candidate>(
    `SELECT p.platform, p.key, p.title, p.url, p.rating, p.native, p.tags, p.extra FROM problems p
     WHERE p.platform = ? AND p.rating BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM solves s WHERE s.platform = p.platform AND s.problem_key = p.key)
       AND NOT EXISTS (SELECT 1 FROM submissions x WHERE x.platform = p.platform AND x.problem_key = p.key)
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.platform = p.platform AND r.problem_key = p.key)`,
    platform, lo, hi,
  ).filter((c) => {
    const extra = c.extra ? JSON.parse(c.extra) : {};
    if (extra.paidOnly) return false;
    if (c.platform === 'codeforces' && extra.solvedCount != null && extra.solvedCount < 300) return false;
    return true;
  });
}

function toPick(c: Candidate, reason: string): Pick {
  return { platform: c.platform, key: c.key, title: c.title, url: c.url, rating: c.rating, native: c.native, tags: canonicalTags(JSON.parse(c.tags || '[]')), reason };
}

export function todayPlan(shuffle = 0) {
  const linked = new Set(all<{ platform: Platform }>('SELECT platform FROM accounts').map((r) => r.platform));
  const level = workingLevel();
  const weak = weakTags(4);
  const random = rng(`${today()}#${shuffle}`);
  const used = new Set<string>();
  const picks: Pick[] = [];
  const goal = Math.max(1, Math.min(10, Number(getSetting('dailyGoal')) || 3));

  const take = (pool: Candidate[], reason: string) => {
    const fresh = pool.filter((c) => !used.has(`${c.platform}:${c.key}`));
    if (!fresh.length) return false;
    const c = fresh[Math.floor(random() * fresh.length)];
    used.add(`${c.platform}:${c.key}`);
    picks.push(toPick(c, reason));
    return true;
  };

  const usePlatforms: Platform[] = (['codeforces', 'leetcode', 'kattis'] as Platform[]).filter((p) => linked.size === 0 || linked.has(p));
  const tagged = usePlatforms.filter((p) => p !== 'kattis'); // Kattis publishes no tags
  const pools = new Map<Platform, Candidate[]>();
  for (const p of tagged) {
    if (p === 'leetcode') {
      // LeetCode only has three tiers (1100 / 1600 / 2100), so pick the tier that fits.
      const [lo, hi] = level < 1300 ? [1100, 1100] : level < 1700 ? [1100, 1600] : level < 2000 ? [1600, 2100] : [2100, 2100];
      pools.set(p, candidates(p, lo, hi));
    } else pools.set(p, candidates(p, level - 100, level + 300));
  }

  // One problem per weak tag, alternating between platforms that carry tags.
  weak.forEach((tag, i) => {
    if (picks.length >= goal) return;
    const order = i % 2 === 0 ? tagged : [...tagged].reverse();
    for (const p of order) {
      const pool = (pools.get(p) ?? []).filter((c) => canonicalTags(JSON.parse(c.tags || '[]')).includes(tag));
      if (take(pool, `Weak spot: ${tag}`)) break;
    }
  });
  if (usePlatforms.includes('kattis')) take(candidates('kattis', level - 100, level + 300), 'Kattis practice near your level');
  if (usePlatforms.includes('codeforces')) take(candidates('codeforces', level + 300, level + 500), 'Stretch problem');
  // Top up with anything near your level.
  for (const p of tagged) while (picks.length < goal + 1 && take(pools.get(p) ?? [], 'Near your level'));

  const upsolve = all<{ platform: Platform; key: string; title: string; url: string; rating: number | null; native: string | null; tries: number; last: number }>(`
    SELECT p.platform, p.key, p.title, p.url, p.rating, p.native, COUNT(*) tries, MAX(x.created_at) last
    FROM submissions x JOIN problems p ON p.platform = x.platform AND p.key = x.problem_key
    WHERE NOT EXISTS (SELECT 1 FROM solves s WHERE s.platform = x.platform AND s.problem_key = x.problem_key)
      AND x.verdict != 'CE'
    GROUP BY x.platform, x.problem_key ORDER BY last DESC LIMIT 8`);

  const bankSize = get<{ n: number }>('SELECT COUNT(*) n FROM problems')!.n;
  return { level, weakTags: weak, picks, upsolve, bankSize, goal };
}

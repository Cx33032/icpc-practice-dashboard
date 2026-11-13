import { all, get } from './db.ts';
import { addDays, dayKey, today, weekStart } from './dates.ts';
import { BANDS, ratingBand } from './difficulty.ts';
import { canonicalTags, CORE_TAGS } from './tags.ts';
import type { Platform } from './store.ts';

interface SolveRow {
  platform: Platform;
  problem_key: string;
  solved_at: number | null;
  rating: number | null;
  tags: string | null;
  title: string | null;
  native: string | null;
}

function solvedRows(): SolveRow[] {
  return all<SolveRow>(`
    SELECT s.platform, s.problem_key, s.solved_at, p.rating, p.tags, p.title, p.native
    FROM solves s LEFT JOIN problems p ON p.platform = s.platform AND p.key = s.problem_key`);
}

export function summary() {
  const solves = solvedRows();
  const byPlatform: Record<string, number> = { codeforces: 0, leetcode: 0, kattis: 0 };
  for (const s of solves) byPlatform[s.platform] = (byPlatform[s.platform] ?? 0) + 1;

  const subs = all<{ platform: string; n: number; ac: number }>(`
    SELECT platform, COUNT(*) n, SUM(verdict = 'AC') ac FROM submissions GROUP BY platform`);

  // Heatmap: distinct problems first solved per day, past 53 weeks.
  const t = today();
  const from = addDays(weekStart(t), -52 * 7);
  const heat: Record<string, number> = {};
  for (const s of solves) {
    if (s.solved_at == null) continue;
    const d = dayKey(s.solved_at);
    if (d >= from) heat[d] = (heat[d] ?? 0) + 1;
  }
  // Also count re-solves (AC submissions on already-solved problems) so practice days show up.
  const acs = all<{ platform: string; problem_key: string; created_at: number }>(
    "SELECT platform, problem_key, created_at FROM submissions WHERE verdict = 'AC' AND created_at >= ?",
    Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 86400,
  );
  const seen = new Set<string>();
  const activity: Record<string, number> = {};
  for (const a of acs) {
    const d = dayKey(a.created_at);
    const k = `${d}|${a.platform}|${a.problem_key}`;
    if (d < from || seen.has(k)) continue;
    seen.add(k);
    activity[d] = (activity[d] ?? 0) + 1;
  }
  const heatmap: Record<string, number> = {};
  for (const d of new Set([...Object.keys(heat), ...Object.keys(activity)])) heatmap[d] = Math.max(heat[d] ?? 0, activity[d] ?? 0);

  // Streak of consecutive active days ending today (or yesterday, so it survives until you practise).
  let streak = 0;
  let cursor = heatmap[t] ? t : addDays(t, -1);
  while (heatmap[cursor]) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  // Difficulty distribution of solved problems.
  const bands: Record<string, Record<string, number>> = Object.fromEntries(BANDS.map((b) => [b, { codeforces: 0, leetcode: 0, kattis: 0 }]));
  for (const s of solves) bands[ratingBand(s.rating)][s.platform]++;

  // 12-week trend.
  const weeks: { week: string; solved: number; avgRating: number | null }[] = [];
  const thisWeek = weekStart(t);
  for (let i = 11; i >= 0; i--) weeks.push({ week: addDays(thisWeek, -7 * i), solved: 0, avgRating: null });
  const ratingSums = new Map<string, [number, number]>();
  for (const s of solves) {
    if (s.solved_at == null) continue;
    const w = weekStart(dayKey(s.solved_at));
    const row = weeks.find((x) => x.week === w);
    if (!row) continue;
    row.solved++;
    if (s.rating) {
      const acc = ratingSums.get(w) ?? [0, 0];
      ratingSums.set(w, [acc[0] + s.rating, acc[1] + 1]);
    }
  }
  for (const w of weeks) {
    const acc = ratingSums.get(w.week);
    w.avgRating = acc ? Math.round(acc[0] / acc[1]) : null;
  }

  const recent = solves
    .filter((s) => s.solved_at != null)
    .sort((a, b) => b.solved_at! - a.solved_at!)
    .slice(0, 12)
    .map((s) => ({ platform: s.platform, key: s.problem_key, title: s.title ?? s.problem_key, rating: s.rating, native: s.native, solvedAt: s.solved_at }));

  return {
    totals: {
      solved: solves.length,
      byPlatform,
      submissions: subs.reduce((a, s) => a + s.n, 0),
      acRate: (() => {
        const n = subs.reduce((a, s) => a + s.n, 0);
        return n ? Math.round((subs.reduce((a, s) => a + s.ac, 0) / n) * 100) : null;
      })(),
      solvedThisWeek: weeks[weeks.length - 1].solved,
      streak,
      activeDays: Object.keys(heatmap).length,
    },
    heatmap: { from, to: t, days: heatmap },
    bands: BANDS.map((b) => ({ band: b, ...bands[b] })),
    weeks,
    recent,
    level: workingLevel(solves),
  };
}

/** Rough current level on the CF scale: median of your 20 hardest recent rated solves. */
export function estimateLevel(solves = solvedRows()): number | null {
  const rated = solves.filter((s) => s.rating != null && s.platform !== 'leetcode');
  const pool = rated.length >= 5 ? rated : solves.filter((s) => s.rating != null);
  if (!pool.length) return null;
  const recent = [...pool].sort((a, b) => (b.solved_at ?? 0) - (a.solved_at ?? 0)).slice(0, 60);
  const top = recent.map((s) => s.rating!).sort((a, b) => b - a).slice(0, 20);
  return top[Math.floor(top.length / 2)];
}

/** The level used for picks: solve history blended with the live Codeforces rating when there is one. */
export function workingLevel(solves = solvedRows()): number {
  const cf = get<{ profile: string | null }>("SELECT profile FROM accounts WHERE platform = 'codeforces'");
  const cfRating: number | null = cf?.profile ? JSON.parse(cf.profile).rating ?? null : null;
  const est = estimateLevel(solves);
  if (est && cfRating) return Math.round((est + cfRating) / 200) * 100;
  return est ?? (cfRating ? Math.round(cfRating / 100) * 100 : 1200);
}

export interface TagStat {
  tag: string;
  attempted: number;
  solved: number;
  rate: number;
  avgSolvedRating: number | null;
  ceiling: number | null;
  score: number;
}

/**
 * Weakness per tag: problems you tried but did not solve weigh against a tag, and so does a low
 * solved difficulty compared to your overall level. Tags from the core syllabus with no attempts
 * are reported separately.
 */
export function tagStats() {
  const attempted = all<{ platform: string; key: string; tags: string; rating: number | null; solved: number }>(`
    SELECT p.platform, p.key, p.tags, p.rating,
      EXISTS(SELECT 1 FROM solves s WHERE s.platform = p.platform AND s.problem_key = p.key) solved
    FROM problems p
    WHERE EXISTS(SELECT 1 FROM submissions x WHERE x.platform = p.platform AND x.problem_key = p.key)
       OR EXISTS(SELECT 1 FROM solves s WHERE s.platform = p.platform AND s.problem_key = p.key)`);

  const per = new Map<string, { attempted: number; solved: number; ratingSum: number; ratingN: number; ratings: number[] }>();
  let totalAttempted = 0;
  let totalSolved = 0;
  for (const p of attempted) {
    const tags = canonicalTags(JSON.parse(p.tags || '[]'));
    if (!tags.length) continue;
    totalAttempted++;
    if (p.solved) totalSolved++;
    for (const t of tags) {
      const acc = per.get(t) ?? { attempted: 0, solved: 0, ratingSum: 0, ratingN: 0, ratings: [] };
      acc.attempted++;
      if (p.solved) {
        acc.solved++;
        if (p.rating) {
          acc.ratingSum += p.rating;
          acc.ratingN++;
          acc.ratings.push(p.rating);
        }
      }
      per.set(t, acc);
    }
  }
  const baseRate = totalAttempted ? totalSolved / totalAttempted : 0;
  const level = workingLevel();
  const stats: TagStat[] = [...per.entries()].map(([tag, a]) => {
    const rate = a.solved / a.attempted;
    const avg = a.ratingN ? Math.round(a.ratingSum / a.ratingN) : null;
    // Smooth toward the base rate so a 0/1 tag doesn't dominate.
    const smoothed = (a.solved + baseRate * 3) / (a.attempted + 3);
    // Ceiling = the hardest you've managed in this tag. A ceiling well below your level is a gap,
    // weighted by how much evidence there is.
    const top = [...a.ratings].sort((x, y) => y - x).slice(0, 3);
    const ceiling = top.length ? Math.round(top.reduce((s, r) => s + r, 0) / top.length) : null;
    const confidence = Math.min(1, a.ratings.length / 6);
    const gap = level && ceiling ? Math.max(0, level - 200 - ceiling) / 800 : 0;
    const score = Math.round(((baseRate - smoothed) + gap * 0.6 * confidence) * 100);
    return { tag, attempted: a.attempted, solved: a.solved, rate: Math.round(rate * 100), avgSolvedRating: avg, ceiling, score };
  });
  stats.sort((a, b) => b.score - a.score);
  const untouched = CORE_TAGS.filter((t) => !per.has(t));
  return { baseRate: Math.round(baseRate * 100), level, tags: stats, untouched };
}

export function weakTags(n = 4): string[] {
  const { tags, untouched } = tagStats();
  const weak = tags.filter((t) => t.attempted >= 2 && t.score > 0).slice(0, n).map((t) => t.tag);
  for (const t of untouched) if (weak.length < n) weak.push(t);
  return weak;
}

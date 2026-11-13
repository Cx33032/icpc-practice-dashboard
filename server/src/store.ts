import { db, get } from './db.ts';

export type Platform = 'codeforces' | 'leetcode' | 'kattis';
export const PLATFORMS: Platform[] = ['codeforces', 'leetcode', 'kattis'];
export type Verdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'OTHER';

export interface ProblemIn {
  platform: Platform;
  key: string;
  title: string;
  url: string;
  native?: string | null;
  rating?: number | null;
  tags?: string[];
  extra?: Record<string, unknown> | null;
}

const upsertProblemStmt = db.prepare(`
  INSERT INTO problems(platform, key, title, url, native, rating, tags, extra)
  VALUES ($platform, $key, $title, $url, $native, $rating, $tags, $extra)
  ON CONFLICT(platform, key) DO UPDATE SET
    title  = excluded.title,
    url    = excluded.url,
    native = COALESCE(excluded.native, problems.native),
    rating = COALESCE(excluded.rating, problems.rating),
    tags   = CASE WHEN excluded.tags = '[]' THEN problems.tags ELSE excluded.tags END,
    extra  = COALESCE(excluded.extra, problems.extra)
`);

export function upsertProblem(p: ProblemIn) {
  upsertProblemStmt.run({
    $platform: p.platform,
    $key: p.key,
    $title: p.title,
    $url: p.url,
    $native: p.native ?? null,
    $rating: p.rating ?? null,
    $tags: JSON.stringify(p.tags ?? []),
    $extra: p.extra ? JSON.stringify(p.extra) : null,
  });
}

const insertSubStmt = db.prepare(`
  INSERT OR IGNORE INTO submissions(platform, remote_id, problem_key, verdict, lang, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
/** Returns true if this submission was new. */
export function insertSubmission(platform: Platform, remoteId: string, problemKey: string, verdict: Verdict, lang: string | null, createdAt: number): boolean {
  const r = insertSubStmt.run(platform, remoteId, problemKey, verdict, lang, createdAt);
  if (verdict === 'AC') markSolved(platform, problemKey, createdAt, 'submission');
  return Number(r.changes) > 0;
}

const solveStmt = db.prepare(`
  INSERT INTO solves(platform, problem_key, solved_at, source) VALUES (?, ?, ?, ?)
  ON CONFLICT(platform, problem_key) DO UPDATE SET
    solved_at = CASE
      WHEN solves.solved_at IS NULL THEN excluded.solved_at
      WHEN excluded.solved_at IS NULL THEN solves.solved_at
      ELSE MIN(solves.solved_at, excluded.solved_at) END,
    source = CASE WHEN excluded.solved_at IS NOT NULL AND solves.solved_at IS NULL THEN excluded.source ELSE solves.source END
`);
export function markSolved(platform: Platform, problemKey: string, at: number | null, source: 'submission' | 'status' | 'manual') {
  solveStmt.run(platform, problemKey, at, source);
}

export function hasSubmission(platform: Platform, remoteId: string): boolean {
  return !!get('SELECT 1 FROM submissions WHERE platform = ? AND remote_id = ?', platform, remoteId);
}

export function problemUrl(platform: Platform, key: string): string {
  if (platform === 'leetcode') return `https://leetcode.com/problems/${key}/`;
  if (platform === 'kattis') return `https://open.kattis.com/problems/${key}`;
  const m = key.match(/^(\d+)([A-Za-z]\d*)$/);
  if (!m) return `https://codeforces.com/problemset`;
  const cid = Number(m[1]);
  return cid >= 100000
    ? `https://codeforces.com/gym/${cid}/problem/${m[2]}`
    : `https://codeforces.com/problemset/problem/${cid}/${m[2]}`;
}

/** Recognise a problem from a pasted URL or id. */
export function parseProblemRef(raw: string, hint?: Platform): { platform: Platform; key: string } | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/codeforces\.com\/(?:problemset\/problem|contest|gym)\/(\d+)\/(?:problem\/)?([A-Za-z]\d*)/i);
  if (m) return { platform: 'codeforces', key: `${m[1]}${m[2].toUpperCase()}` };
  m = s.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
  if (m) return { platform: 'leetcode', key: m[1].toLowerCase() };
  m = s.match(/kattis\.com\/(?:contests\/[^/]+\/)?problems\/([a-z0-9]+)/i);
  if (m) return { platform: 'kattis', key: m[1].toLowerCase() };
  m = s.match(/^(?:CF)?\s*(\d{1,6})\s*([A-Za-z]\d?)$/i);
  if (m && hint !== 'leetcode' && hint !== 'kattis') return { platform: 'codeforces', key: `${m[1]}${m[2].toUpperCase()}` };
  if (hint === 'leetcode' && /^[a-z0-9-]+$/i.test(s)) return { platform: 'leetcode', key: s.toLowerCase() };
  if (hint === 'kattis' && /^[a-z0-9]+$/i.test(s)) return { platform: 'kattis', key: s.toLowerCase() };
  return null;
}

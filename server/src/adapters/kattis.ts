import { all, getSetting, run, setSetting, tx } from '../db.ts';
import { getText, politeFetch } from '../http.ts';
import { kattisRating, parseKattisDifficulty } from '../difficulty.ts';
import { markSolved, problemUrl, upsertProblem } from '../store.ts';

const BASE = 'https://open.kattis.com';

export interface KattisSecret {
  token: string;
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Logs in the way the official Kattis CLI does: username + the API token from your .kattisrc. */
async function login(handle: string, secret: KattisSecret): Promise<string> {
  const res = await politeFetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user: handle, token: secret.token, script: 'true' }),
    redirect: 'manual',
  });
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  if (res.status >= 400 || !cookies.length) {
    throw new Error('Kattis rejected the login. Check the username and the token from your .kattisrc file.');
  }
  return cookies.join('; ');
}

interface ParsedRow {
  key: string;
  title: string;
  difficulty: number | null;
  label: string;
  solveRatio: string | null;
  solved: boolean;
}

function parseProblemRows(html: string): ParsedRow[] {
  const tableStart = html.indexOf('data-cy="problems-table"');
  const body = tableStart >= 0 ? html.slice(tableStart) : html;
  const rows: ParsedRow[] = [];
  for (const m of body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const attrs = m[1];
    const row = m[2];
    const link = row.match(/<a href="\/problems\/([a-z0-9]+)"\s*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const diff = row.match(/difficulty_number[^>]*>([\s\S]*?)<\/span>\s*([A-Za-z]+)?/);
    const ratio = row.match(/>(\d{1,3})%</);
    // Logged-in pages mark solved problems on the row; accept the common spellings.
    const solved = /\bsolved\b/i.test(attrs) && !/\bunsolved\b/i.test(attrs) || /status[-_]ac|fa-check-circle|icon-solved/i.test(row);
    rows.push({
      key: link[1],
      title: decode(link[2]),
      difficulty: diff ? parseKattisDifficulty(decode(diff[1])) : null,
      label: diff?.[2] ?? '',
      solveRatio: ratio ? `${ratio[1]}%` : null,
      solved,
    });
  }
  return rows;
}

function saveRow(r: ParsedRow) {
  upsertProblem({
    platform: 'kattis',
    key: r.key,
    title: r.title,
    url: problemUrl('kattis', r.key),
    native: r.difficulty != null ? `${r.difficulty.toFixed(1)}${r.label ? ` ${r.label}` : ''}` : null,
    rating: kattisRating(r.difficulty),
    extra: r.solveRatio ? { solveRatio: r.solveRatio } : null,
  });
}

/**
 * Walks every page of the problem list (≈66 pages). When a token is given we walk it logged in,
 * which is the only way Kattis exposes which problems you have solved.
 */
export async function crawlKattisProblems(cookie: string | null, report: (s: string) => void) {
  let page = 1;
  let total = 0;
  const solvedKeys: string[] = [];
  for (; page < 200; page++) {
    report(`Reading problem list page ${page}…`);
    const html = await getText(`${BASE}/problems?page=${page}`, cookie ? { headers: { Cookie: cookie } } : {});
    const rows = parseProblemRows(html);
    if (!rows.length) break;
    tx(() => rows.forEach(saveRow));
    for (const r of rows) if (r.solved) solvedKeys.push(r.key);
    total += rows.length;
  }
  return { total, solvedKeys };
}

export async function fetchKattisBank(report: (s: string) => void) {
  const { total } = await crawlKattisProblems(null, report);
  return `${total} problems in the bank`;
}

export async function syncKattis(handle: string, secret: KattisSecret | null, report: (s: string) => void) {
  report('Fetching profile…');
  const html = await getText(`${BASE}/users/${encodeURIComponent(handle)}`).catch((e) => {
    if (e?.status === 404) throw new Error('Kattis has no user with that username (use the name in your profile URL, e.g. open.kattis.com/users/your-name)');
    throw e;
  });
  const field = (label: string) => html.match(new RegExp(`info_label">${label}</span>\\s*<span[^>]*>([^<]+)<`))?.[1]?.trim() ?? null;
  const name = html.match(/image_info-text-main-header[^>]*>([^<]+)</)?.[1]?.trim() ?? handle;
  const country = html.match(/href="\/countries\/[A-Z]+"\s+title="([^"]+)"/)?.[1] ?? null;
  const subdivision = html.match(/href="\/countries\/[A-Z]+\/[^"]+"\s+title="([^"]+)"/)?.[1] ?? null;
  const university = html.match(/href="\/universities\/[^"]+"[^>]*title="([^"]+)"/)?.[1] ?? null;

  let message = 'Profile updated';
  let solvedCount: number | null = null;
  if (secret) {
    report('Logging in…');
    const cookie = await login(handle, secret);
    const { solvedKeys } = await crawlKattisProblems(cookie, report);
    // The first crawl has no dates. After that, anything newly solved is dated to this sync.
    const baselineDone = getSetting('kattisBaseline') === handle;
    const known = new Set(all<{ problem_key: string }>("SELECT problem_key FROM solves WHERE platform = 'kattis'").map((r) => r.problem_key));
    const now = Math.floor(Date.now() / 1000);
    let fresh = 0;
    tx(() => {
      for (const k of solvedKeys) {
        if (!known.has(k)) fresh++;
        markSolved('kattis', k, baselineDone && !known.has(k) ? now : null, 'status');
      }
    });
    solvedCount = solvedKeys.length;
    if (solvedKeys.length) setSetting('kattisBaseline', handle);
    message = solvedKeys.length
      ? `${solvedKeys.length} solved problems found · ${fresh} new`
      : 'Logged in, but no solved markers were found on the problem list. Use “Paste solved problems” on the Accounts page instead.';
  }

  const profile = {
    handle,
    name,
    rank: field('Rank'),
    score: field('Score'),
    country,
    subdivision,
    university,
    solvedFromSite: solvedCount,
    hasToken: !!secret,
  };
  run('UPDATE accounts SET profile = ?, last_sync_at = ? WHERE platform = ?', JSON.stringify(profile), Math.floor(Date.now() / 1000), 'kattis');
  return message;
}

// Kattis prints times like "2026-11-06 06:00:00 CET".
const TZ_OFFSETS: Record<string, number> = {
  UTC: 0, GMT: 0, WET: 0, WEST: 1, CET: 1, CEST: 2, EET: 2, EEST: 3,
  NST: -3.5, NDT: -2.5, AST: -4, ADT: -3, EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7,
};
function parseKattisTime(s: string): number | null {
  const m = s.trim().match(/^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)(?::(\d\d))? ?([A-Z]+)?$/);
  if (!m) return null;
  const offset = TZ_OFFSETS[m[7] ?? 'UTC'] ?? 0;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) - offset * 3600_000;
  return Math.floor(utc / 1000);
}
function parseLength(s: string): number {
  const parts = s.trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  while (parts.length < 3) parts.unshift(0);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export async function kattisContests() {
  const html = await getText(`${BASE}/contests`);
  const out: { platform: 'kattis'; id: string; title: string; start: number; duration: number; url: string }[] = [];
  for (const m of html.matchAll(/<tr>\s*<td data-col="name">([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    const link = row.match(/href="\/contests\/([a-z0-9]+)">([\s\S]*?)<\/a>/);
    const start = row.match(/data-col="start">([\s\S]*?)<\/td>/);
    const len = row.match(/data-col="length">([\s\S]*?)<\/td>/);
    if (!link || !start || !len) continue;
    const ts = parseKattisTime(decode(start[1]));
    if (ts == null) continue;
    out.push({ platform: 'kattis', id: `kt-${link[1]}`, title: decode(link[2]), start: ts, duration: parseLength(decode(len[1])), url: `${BASE}/contests/${link[1]}` });
  }
  return out;
}

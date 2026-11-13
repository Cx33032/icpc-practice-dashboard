import { all, getSetting, run, setSetting, tx } from '../db.ts';
import { getText, HttpError } from '../http.ts';
import { kattisRating, parseKattisDifficulty } from '../difficulty.ts';
import { markSolved, problemUrl, upsertProblem } from '../store.ts';

const BASE = 'https://open.kattis.com';

/**
 * The browser session cookie. (Older versions stored a .kattisrc `token`, but Kattis scopes token
 * logins to submitting: every page read with one answers 403 "Access denied.")
 */
export interface KattisSecret {
  cookie?: string;
  token?: string;
}

/** Accepts the bare KattisSiteCookie value, "KattisSiteCookie=…", or a whole pasted Cookie header. */
export function parseKattisCookie(input: string): string | null {
  const s = input.trim().replace(/^cookie:\s*/i, '');
  if (!s) return null;
  if (!s.includes('=')) return `KattisSiteCookie=${s}`;
  const parts = s.split(/;\s*/).filter((p) => /^(KattisSiteCookie|EduSiteCookie)=/.test(p));
  return parts.length ? parts.join('; ') : null;
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

const COOKIE_HELP = 'Copy a fresh KattisSiteCookie from your browser (Accounts → Kattis → Session cookie).';

function isLoggedIn(html: string): boolean {
  return /href="\/logout"/.test(html) || !/>\s*Log in\s*</.test(html);
}

/** Classes on table rows and status-looking markup: what to look at when solved detection misses. */
function rowDiagnostics(html: string): string {
  const start = html.indexOf('data-cy="problems-table"');
  const body = start >= 0 ? html.slice(start, start + 200_000) : '';
  const trClasses = new Set([...body.matchAll(/<tr\s+class="([^"]*)"/g)].map((m) => m[1].trim() || '(empty)'));
  const statusy = new Set([...body.matchAll(/class="([^"]*(?:solv|accept|status|tried|check)[^"]*)"/gi)].map((m) => m[1].trim()));
  return `row classes: ${[...trClasses].slice(0, 6).join(' | ') || 'none'}; status-like classes: ${[...statusy].slice(0, 6).join(' | ') || 'none'}`;
}

/**
 * Walks every page of the problem list (≈66 pages). With your browser session cookie it walks
 * the list logged in, which is the only way Kattis exposes which problems you have solved.
 */
export async function crawlKattisProblems(cookie: string | null, report: (s: string) => void) {
  let page = 1;
  let total = 0;
  let diagnostics = '';
  const solvedKeys: string[] = [];
  for (; page < 200; page++) {
    report(`Reading problem list page ${page}…`);
    const html = await getText(`${BASE}/problems?page=${page}`, cookie ? { headers: { Cookie: cookie } } : {}).catch((e) => {
      if (cookie && e instanceof HttpError && (e.status === 401 || e.status === 403)) {
        throw new Error(`Kattis refused the session cookie (it may have expired, or you logged out). ${COOKIE_HELP}`);
      }
      throw e;
    });
    if (cookie && page === 1) {
      if (!isLoggedIn(html)) throw new Error(`Kattis treated the session cookie as logged out. ${COOKIE_HELP}`);
      diagnostics = rowDiagnostics(html);
    }
    const rows = parseProblemRows(html);
    if (!rows.length) break;
    tx(() => rows.forEach(saveRow));
    for (const r of rows) if (r.solved) solvedKeys.push(r.key);
    total += rows.length;
  }
  return { total, solvedKeys, diagnostics };
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
  if (secret?.token && !secret.cookie) {
    throw new Error(
      'Kattis API tokens (.kattisrc) can only submit solutions — Kattis answers “Access denied” to every page read with one. ' +
        'Replace it with your browser session cookie under Accounts → Kattis.',
    );
  }
  if (secret?.cookie) {
    const { solvedKeys, diagnostics } = await crawlKattisProblems(secret.cookie, report);
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
      : `Logged in, but no solved problems were recognised on the problem list (${diagnostics}). Use “Paste solved problems” for now.`;
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
    hasToken: !!secret?.cookie,
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

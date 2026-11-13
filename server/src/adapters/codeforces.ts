import { run, tx } from '../db.ts';
import { getJson } from '../http.ts';
import { clampRating } from '../difficulty.ts';
import { hasSubmission, insertSubmission, problemUrl, upsertProblem, type Verdict } from '../store.ts';

const API = 'https://codeforces.com/api';

async function cf<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const body = await getJson<{ status: string; comment?: string; result: T }>(`${API}/${method}?${qs}`).catch((e) => {
    if (e?.status === 400) throw new Error('Codeforces did not recognise that handle');
    throw e;
  });
  if (body.status !== 'OK') throw new Error(`Codeforces: ${body.comment ?? 'request failed'}`);
  return body.result;
}

const VERDICTS: Record<string, Verdict> = {
  OK: 'AC',
  WRONG_ANSWER: 'WA',
  TIME_LIMIT_EXCEEDED: 'TLE',
  MEMORY_LIMIT_EXCEEDED: 'MLE',
  RUNTIME_ERROR: 'RE',
  COMPILATION_ERROR: 'CE',
};

interface CfProblem {
  contestId?: number;
  index: string;
  name: string;
  rating?: number;
  tags: string[];
}

function saveProblem(p: CfProblem, solvedCount?: number) {
  if (!p.contestId) return null;
  const key = `${p.contestId}${p.index}`;
  upsertProblem({
    platform: 'codeforces',
    key,
    title: p.name,
    url: problemUrl('codeforces', key),
    native: p.rating ? String(p.rating) : null,
    rating: p.rating ? clampRating(p.rating) : null,
    tags: p.tags,
    extra: solvedCount != null ? { solvedCount } : null,
  });
  return key;
}

export async function syncCodeforces(handle: string, report: (s: string) => void) {
  report('Fetching profile…');
  const [info] = await cf<any[]>('user.info', { handles: handle });
  const history = await cf<any[]>('user.rating', { handle }).catch(() => []);

  let from = 1;
  const count = 1000;
  let added = 0;
  for (;;) {
    report(`Reading submissions ${from}–${from + count - 1}…`);
    const page = await cf<any[]>('user.status', { handle, from, count });
    if (!page.length) break;
    let known = 0;
    tx(() => {
      for (const s of page) {
        if (s.verdict === 'TESTING' || !s.verdict) continue;
        const remoteId = String(s.id);
        if (hasSubmission('codeforces', remoteId)) {
          known++;
          continue;
        }
        const key = saveProblem(s.problem);
        if (!key) continue;
        if (insertSubmission('codeforces', remoteId, key, VERDICTS[s.verdict] ?? 'OTHER', s.programmingLanguage ?? null, s.creationTimeSeconds)) added++;
      }
    });
    // Newest first: once a whole page is already stored, everything older is too.
    if (known === page.length || page.length < count) break;
    from += count;
  }

  const profile = {
    handle: info.handle,
    rating: info.rating ?? null,
    maxRating: info.maxRating ?? null,
    rank: info.rank ?? 'unrated',
    maxRank: info.maxRank ?? null,
    avatar: info.titlePhoto ?? null,
    country: info.country ?? null,
    contests: history.length,
    ratingHistory: history.map((h: any) => ({ t: h.ratingUpdateTimeSeconds, r: h.newRating, name: h.contestName })),
  };
  run('UPDATE accounts SET profile = ?, last_sync_at = ?, handle = ? WHERE platform = ?', JSON.stringify(profile), Math.floor(Date.now() / 1000), info.handle, 'codeforces');
  return `${added} new submission${added === 1 ? '' : 's'}`;
}

export async function fetchCodeforcesBank(report: (s: string) => void) {
  report('Downloading the Codeforces problemset…');
  const res = await cf<{ problems: CfProblem[]; problemStatistics: { contestId: number; index: string; solvedCount: number }[] }>('problemset.problems');
  const solved = new Map(res.problemStatistics.map((s) => [`${s.contestId}${s.index}`, s.solvedCount]));
  report(`Saving ${res.problems.length} problems…`);
  tx(() => {
    for (const p of res.problems) saveProblem(p, solved.get(`${p.contestId}${p.index}`));
  });
  return `${res.problems.length} problems in the bank`;
}

export async function codeforcesUpcoming() {
  const list = await cf<any[]>('contest.list', { gym: 'false' });
  return list
    .filter((c) => c.phase === 'BEFORE' || c.phase === 'CODING')
    .map((c) => ({
      platform: 'codeforces' as const,
      id: `cf-${c.id}`,
      title: c.name,
      start: c.startTimeSeconds as number,
      duration: c.durationSeconds as number,
      url: `https://codeforces.com/contests/${c.id}`,
    }));
}

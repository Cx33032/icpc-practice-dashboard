import { get, run, tx } from '../db.ts';
import { getJson } from '../http.ts';
import { leetcodeRating } from '../difficulty.ts';
import { hasSubmission, insertSubmission, markSolved, problemUrl, upsertProblem, type Verdict } from '../store.ts';

const GQL = 'https://leetcode.com/graphql';

export interface LeetCodeSecret {
  session: string;
  csrf: string;
}

/** Accepts either the two cookie values or a whole pasted Cookie header. */
export function parseLeetCodeCookie(input: { session?: string; csrf?: string; cookie?: string }): LeetCodeSecret | null {
  let session = input.session?.trim() ?? '';
  let csrf = input.csrf?.trim() ?? '';
  if (input.cookie) {
    session ||= input.cookie.match(/LEETCODE_SESSION=([^;\s]+)/)?.[1] ?? '';
    csrf ||= input.cookie.match(/csrftoken=([^;\s]+)/)?.[1] ?? '';
  }
  return session && csrf ? { session, csrf } : null;
}

async function gql<T = any>(query: string, variables: Record<string, unknown> = {}, secret?: LeetCodeSecret | null): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Referer: 'https://leetcode.com/',
    Origin: 'https://leetcode.com',
  };
  if (secret) {
    headers.Cookie = `LEETCODE_SESSION=${secret.session}; csrftoken=${secret.csrf}`;
    headers['x-csrftoken'] = secret.csrf;
  }
  const body = await getJson<{ data: T; errors?: { message: string }[] }>(GQL, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  if (body.errors?.length && !body.data) throw new Error(`LeetCode: ${body.errors[0].message}`);
  return body.data;
}

const VERDICTS: Record<string, Verdict> = {
  Accepted: 'AC',
  'Wrong Answer': 'WA',
  'Time Limit Exceeded': 'TLE',
  'Memory Limit Exceeded': 'MLE',
  'Runtime Error': 'RE',
  'Compile Error': 'CE',
};

interface LcQuestion {
  frontendQuestionId: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  acRate?: number;
  paidOnly?: boolean;
  status?: string | null;
  topicTags: { name: string }[];
}

function saveQuestion(q: LcQuestion) {
  upsertProblem({
    platform: 'leetcode',
    key: q.titleSlug,
    title: q.title,
    url: problemUrl('leetcode', q.titleSlug),
    native: q.difficulty,
    rating: leetcodeRating(q.difficulty),
    tags: q.topicTags.map((t) => t.name),
    extra: { id: q.frontendQuestionId, paidOnly: !!q.paidOnly, acRate: q.acRate ?? null },
  });
}

async function ensureQuestions(slugs: string[], secret: LeetCodeSecret | null, report: (s: string) => void) {
  const missing = slugs.filter((s) => !get("SELECT 1 FROM problems WHERE platform = 'leetcode' AND key = ? AND native IS NOT NULL", s));
  let i = 0;
  for (const slug of missing.slice(0, 60)) {
    report(`Looking up problem details ${++i}/${Math.min(missing.length, 60)}…`);
    const d = await gql<{ question: any }>(
      `query($s: String!) { question(titleSlug: $s) { frontendQuestionId: questionFrontendId title titleSlug difficulty paidOnly: isPaidOnly topicTags { name } } }`,
      { s: slug },
      secret,
    ).catch(() => null);
    if (d?.question) saveQuestion(d.question);
  }
}

export async function syncLeetCode(handle: string, secret: LeetCodeSecret | null, report: (s: string) => void) {
  report('Fetching profile…');
  const prof = await gql(
    `query($u: String!) {
      matchedUser(username: $u) {
        username
        profile { ranking realName countryName userAvatar }
        submitStatsGlobal { acSubmissionNum { difficulty count } }
      }
      userContestRanking(username: $u) { rating attendedContestsCount globalRanking topPercentage }
      allQuestionsCount { difficulty count }
    }`,
    { u: handle },
  );
  if (!prof.matchedUser) throw new Error('LeetCode did not recognise that username');

  let added = 0;
  const touched = new Set<string>();
  const pending: { id: string; slug: string; title: string; verdict: Verdict; lang: string | null; ts: number }[] = [];

  if (secret) {
    // Full history: only available to the logged-in owner of the account.
    let offset = 0;
    let lastKey: string | null = null;
    for (let page = 0; page < 300; page++) {
      report(`Reading submissions ${offset + 1}–${offset + 20}…`);
      const d: any = await gql(
        `query($o: Int!, $l: Int!, $k: String) { submissionList(offset: $o, limit: $l, lastKey: $k, questionSlug: "") {
          hasNext lastKey submissions { id title titleSlug statusDisplay timestamp lang } } }`,
        { o: offset, l: 20, k: lastKey },
        secret,
      );
      const list = d?.submissionList;
      if (!list?.submissions) {
        if (page === 0) throw new Error('LeetCode rejected the session cookie (it may have expired). Copy a fresh LEETCODE_SESSION and csrftoken.');
        break;
      }
      let known = 0;
      for (const s of list.submissions) {
        if (hasSubmission('leetcode', String(s.id))) {
          known++;
          continue;
        }
        pending.push({ id: String(s.id), slug: s.titleSlug, title: s.title, verdict: VERDICTS[s.statusDisplay] ?? 'OTHER', lang: s.lang ?? null, ts: Number(s.timestamp) });
      }
      if (known === list.submissions.length || !list.hasNext) break;
      offset += 20;
      lastKey = list.lastKey;
    }
  } else {
    report('Reading recent accepted submissions…');
    const d = await gql(
      `query($u: String!) { recentAcSubmissionList(username: $u, limit: 50) { id title titleSlug timestamp lang } }`,
      { u: handle },
    );
    for (const s of d.recentAcSubmissionList ?? []) {
      if (!hasSubmission('leetcode', String(s.id))) pending.push({ id: String(s.id), slug: s.titleSlug, title: s.title, verdict: 'AC', lang: s.lang ?? null, ts: Number(s.timestamp) });
    }
  }

  for (const p of pending) touched.add(p.slug);
  await ensureQuestions([...touched], secret, report);
  tx(() => {
    for (const p of pending) {
      upsertProblem({ platform: 'leetcode', key: p.slug, title: p.title, url: problemUrl('leetcode', p.slug) });
      if (insertSubmission('leetcode', p.id, p.slug, p.verdict, p.lang, p.ts)) added++;
    }
  });

  const u = prof.matchedUser;
  const solvedBy = Object.fromEntries(u.submitStatsGlobal.acSubmissionNum.map((x: any) => [x.difficulty, x.count]));
  const totals = Object.fromEntries((prof.allQuestionsCount ?? []).map((x: any) => [x.difficulty, x.count]));
  const profile = {
    handle: u.username,
    avatar: u.profile?.userAvatar ?? null,
    ranking: u.profile?.ranking ?? null,
    country: u.profile?.countryName ?? null,
    solved: { all: solvedBy.All ?? 0, easy: solvedBy.Easy ?? 0, medium: solvedBy.Medium ?? 0, hard: solvedBy.Hard ?? 0 },
    totals: { all: totals.All ?? 0, easy: totals.Easy ?? 0, medium: totals.Medium ?? 0, hard: totals.Hard ?? 0 },
    contestRating: prof.userContestRanking?.rating ? Math.round(prof.userContestRanking.rating) : null,
    contests: prof.userContestRanking?.attendedContestsCount ?? 0,
    topPercentage: prof.userContestRanking?.topPercentage ?? null,
    fullHistory: !!secret,
  };
  run('UPDATE accounts SET profile = ?, last_sync_at = ?, handle = ? WHERE platform = ?', JSON.stringify(profile), Math.floor(Date.now() / 1000), u.username, 'leetcode');
  const mode = secret ? 'full history' : 'recent accepted only (add a session cookie for full history)';
  return `${added} new submission${added === 1 ? '' : 's'} · ${mode}`;
}

/** Downloads the problem list. With a cookie, also marks every problem LeetCode reports as solved. */
export async function fetchLeetCodeBank(secret: LeetCodeSecret | null, report: (s: string) => void) {
  let skip = 0;
  let total = Infinity;
  let solved = 0;
  while (skip < total) {
    report(`Downloading problems ${skip + 1}–${Math.min(skip + 100, total === Infinity ? skip + 100 : total)}${total !== Infinity ? ` of ${total}` : ''}…`);
    const d = await gql(
      `query($s: Int, $l: Int) { questionList(categorySlug: "", limit: $l, skip: $s, filters: {}) {
        total: totalNum
        questions: data { frontendQuestionId: questionFrontendId title titleSlug difficulty acRate paidOnly: isPaidOnly status topicTags { name } } } }`,
      { s: skip, l: 100 },
      secret,
    );
    const ql = d.questionList;
    total = ql.total;
    if (!ql.questions.length) break;
    tx(() => {
      for (const q of ql.questions as LcQuestion[]) {
        saveQuestion(q);
        if (secret && q.status === 'ac') {
          markSolved('leetcode', q.titleSlug, null, 'status');
          solved++;
        }
      }
    });
    skip += ql.questions.length;
  }
  return `${skip} problems in the bank${secret ? ` · ${solved} marked solved from your account` : ''}`;
}

export async function leetcodeUpcoming() {
  const d = await gql(`{ upcomingContests { title titleSlug startTime duration } }`);
  return (d.upcomingContests ?? []).map((c: any) => ({
    platform: 'leetcode' as const,
    id: `lc-${c.titleSlug}`,
    title: c.title,
    start: Number(c.startTime),
    duration: Number(c.duration),
    url: `https://leetcode.com/contest/${c.titleSlug}/`,
  }));
}

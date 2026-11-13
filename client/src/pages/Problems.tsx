import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { post, del, PLATFORM_NAME, type Platform, type Problem } from '../api';
import { ago, fmtDate } from '../format';
import { Card, Difficulty, Empty, Icon, PlatformBadge, ProblemLink, useApi, useJobs } from '../ui';

const TAGS = [
  'Implementation', 'Greedy', 'Math', 'Sorting', 'Binary search', 'Dynamic programming', 'Graphs', 'DFS / BFS', 'Shortest paths',
  'Trees', 'Data structures', 'Strings', 'Hashing', 'Number theory', 'Combinatorics', 'Probability', 'Geometry', 'Union-find',
  'Two pointers', 'Prefix sums', 'Bit manipulation', 'Constructive', 'Brute force', 'Flows & matching', 'Game theory',
  'Divide and conquer', 'Matrices', 'Interactive',
];

interface BankStatus {
  platform: Platform;
  problems: number;
  fetchedAt: number | null;
}

export default function Problems() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') === 'bank' ? 'bank' : 'mine';
  const [q, setQ] = useState(params.get('q') ?? '');
  const { generation, refresh, jobs } = useJobs();

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => (q !== (params.get('q') ?? '') ? set('q', q || null) : undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = new URLSearchParams(params);
  query.set('scope', scope);
  if (!query.get('sort') && scope === 'bank') query.set('sort', 'rating');
  const { data, loading, reload } = useApi<{ total: number; page: number; size: number; items: Problem[] }>(`/problems?${query}`, [generation]);
  const bank = useApi<BankStatus[]>('/bank-status', [generation]);

  const fetchBank = async (p: Platform) => {
    await post(`/bank/${p}`);
    refresh();
  };
  const toggleReview = async (p: Problem) => {
    if (p.inReview) await del(`/reviews/${p.platform}/${encodeURIComponent(p.key)}`);
    else await post('/reviews', { platform: p.platform, key: p.key });
    reload();
  };
  const toggleSolved = async (p: Problem) => {
    await post('/solves', { platform: p.platform, key: p.key, solved: !p.solved });
    reload();
  };

  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Problems</h1>
          <p>{scope === 'mine' ? 'Everything you have submitted to or marked solved.' : 'The full problem sets, for finding your next problem.'}</p>
        </div>
        <div className="seg">
          <button className={scope === 'mine' ? 'on' : ''} onClick={() => set('scope', null)}>My problems</button>
          <button className={scope === 'bank' ? 'on' : ''} onClick={() => set('scope', 'bank')}>Problem bank</button>
        </div>
      </div>

      {scope === 'bank' && (
        <div className="grid g3" style={{ marginBottom: 16 }}>
          {(bank.data ?? []).map((b) => {
            const running = jobs.some((j) => j.id === `${b.platform}:bank` && j.state === 'running');
            return (
              <div className="card stat" key={b.platform}>
                <div className="spread">
                  <PlatformBadge platform={b.platform} />
                  <button className="btn sm" disabled={running} onClick={() => fetchBank(b.platform)}>
                    {Icon.sync}{running ? 'Fetching…' : b.fetchedAt ? 'Refresh' : 'Fetch'}
                  </button>
                </div>
                <div className="hint" style={{ marginTop: 6 }}>
                  <b className="num" style={{ color: 'var(--ink)' }}>{b.problems.toLocaleString('en-CA')}</b> problems · {b.fetchedAt ? `updated ${ago(b.fetchedAt)}` : 'not downloaded yet'}
                </div>
                {b.platform === 'kattis' && !b.fetchedAt && <div className="hint">About 70 pages; takes a couple of minutes.</div>}
              </div>
            );
          })}
        </div>
      )}

      <Card flush>
        <div className="row" style={{ padding: '6px 12px 12px', borderBottom: '1px solid var(--line)' }}>
          <input className="input" placeholder="Search title or id" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <select className="input" value={params.get('platform') ?? ''} onChange={(e) => set('platform', e.target.value || null)}>
            <option value="">All judges</option>
            {(['codeforces', 'leetcode', 'kattis'] as Platform[]).map((p) => <option key={p} value={p}>{PLATFORM_NAME[p]}</option>)}
          </select>
          <select className="input" value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value || null)}>
            <option value="">{scope === 'mine' ? 'Solved & attempted' : 'Any status'}</option>
            <option value="solved">Solved</option>
            <option value="unsolved">{scope === 'mine' ? 'Attempted, unsolved' : 'Unsolved'}</option>
          </select>
          <select className="input" value={params.get('tag') ?? ''} onChange={(e) => set('tag', e.target.value || null)}>
            <option value="">Any topic</option>
            {TAGS.map((t) => <option key={t}>{t}</option>)}
          </select>
          <span className="row" style={{ gap: 4 }}>
            <input className="input num" placeholder="min" inputMode="numeric" defaultValue={params.get('min') ?? ''} onBlur={(e) => set('min', e.target.value || null)} style={{ width: 70 }} />
            <span className="muted">–</span>
            <input className="input num" placeholder="max" inputMode="numeric" defaultValue={params.get('max') ?? ''} onBlur={(e) => set('max', e.target.value || null)} style={{ width: 70 }} />
          </span>
          <select className="input" value={query.get('sort') ?? ''} onChange={(e) => set('sort', e.target.value || null)} style={{ marginLeft: 'auto' }}>
            {scope === 'mine' && <option value="">Most recent</option>}
            <option value="rating">Easiest first</option>
            <option value="-rating">Hardest first</option>
            <option value="title">Title</option>
          </select>
        </div>

        {data?.items.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Problem</th>
                  <th>Judge</th>
                  <th className="right">Difficulty</th>
                  <th className="hide-sm">Topics</th>
                  {scope === 'mine' && <th className="right">Tries</th>}
                  {scope === 'mine' && <th className="right">Solved</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={`${p.platform}${p.key}`}>
                    <td>
                      <button className={`tick${p.solved ? ' on' : ''}`} onClick={() => toggleSolved(p)} disabled={p.solved && p.solveSource !== 'manual'}
                        title={p.solved ? (p.solveSource === 'manual' ? 'Marked solved by you; click to undo' : 'Accepted on the judge') : 'Mark as solved'}>
                        {p.solved ? Icon.check : null}
                      </button>
                    </td>
                    <td className="title-cell">
                      <ProblemLink title={p.title} url={p.url} paid={p.paidOnly} />
                      <div className="mono muted">{p.key}</div>
                    </td>
                    <td><PlatformBadge platform={p.platform} /></td>
                    <td className="right"><Difficulty platform={p.platform} rating={p.rating} native={p.native} /></td>
                    <td className="hide-sm" style={{ maxWidth: 260 }}>
                      <div className="row" style={{ gap: 4 }}>{p.tags.slice(0, 3).map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                    </td>
                    {scope === 'mine' && <td className="right num">{p.tries || '—'}</td>}
                    {scope === 'mine' && <td className="right small muted num" style={{ whiteSpace: 'nowrap' }}>{p.solvedAt ? fmtDate(p.solvedAt) : p.solved ? 'undated' : '—'}</td>}
                    <td className="right">
                      <button className={`btn sm ${p.inReview ? '' : 'ghost'}`} onClick={() => toggleReview(p)} title="Spaced-repetition review queue">
                        {p.inReview ? 'In review' : 'Review'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div style={{ height: 160 }} />
        ) : (
          <Empty title={scope === 'mine' ? 'No problems match' : 'No problems in the bank match'}>
            {scope === 'mine' ? 'Sync an account, or loosen the filters.' : 'Fetch a problem bank above, or loosen the filters.'}
          </Empty>
        )}

        {data && data.total > data.size && (
          <div className="spread" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
            <span className="small muted num">{data.total.toLocaleString('en-CA')} problems · page {page} of {pages}</span>
            <div className="row">
              <button className="btn sm" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>Previous</button>
              <button className="btn sm" disabled={page >= pages} onClick={() => set('page', String(page + 1))}>Next</button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

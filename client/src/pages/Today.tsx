import { useState } from 'react';
import { Link } from 'react-router-dom';
import { patch, post, type Pick, type Platform, type Review, type Task } from '../api';
import { ago, fmtDay, dayOf } from '../format';
import { Card, Difficulty, Empty, Icon, PlatformBadge, ProblemLink, useApi, useJobs } from '../ui';

interface TodayData {
  level: number;
  weakTags: string[];
  picks: Pick[];
  upsolve: { platform: Platform; key: string; title: string; url: string; rating: number | null; native: string | null; tries: number; last: number }[];
  bankSize: number;
  goal: number;
  reviews: Review[];
  tasks: Task[];
}

export function GradeButtons({ r, onDone }: { r: { platform: Platform; key: string }; onDone: () => void }) {
  const grade = async (g: string) => {
    await post(`/reviews/${r.platform}/${encodeURIComponent(r.key)}/grade`, { grade: g });
    onDone();
  };
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="btn sm" onClick={() => grade('again')} title="Couldn't solve it again: see it tomorrow">Forgot</button>
      <button className="btn sm" onClick={() => grade('hard')} title="Solved with difficulty: shorter interval">Hard</button>
      <button className="btn sm" onClick={() => grade('good')} title="Solved: next interval">Good</button>
      <button className="btn sm" onClick={() => grade('easy')} title="Trivial now: skip ahead">Easy</button>
    </div>
  );
}

export default function Today() {
  const [shuffle, setShuffle] = useState(0);
  const { generation, refresh } = useJobs();
  const { data, reload } = useApi<TodayData>(`/today?shuffle=${shuffle}`, [generation]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const today = dayOf(Math.floor(Date.now() / 1000));

  const addToPlan = async (p: { platform: Platform; key: string }) => {
    await post('/tasks', { date: today, platform: p.platform, key: p.key });
    setAdded(new Set(added).add(`${p.platform}:${p.key}`));
    reload();
  };
  const addReview = async (p: { platform: Platform; key: string }) => {
    await post('/reviews', { platform: p.platform, key: p.key });
    reload();
  };
  const toggleTask = async (t: Task) => {
    await patch(`/tasks/${t.id}`, { done: !t.done });
    reload();
  };
  const syncPlatform = async (p: Platform) => {
    await post(`/sync/${p}`);
    refresh();
  };
  const fetchBank = async (p: Platform) => {
    await post(`/bank/${p}`);
    refresh();
  };

  const tasksDone = data?.tasks.filter((t) => t.done).length ?? 0;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{fmtDay(today)}</h1>
          <p>
            {data ? <>Picks target ≈{data.level}{data.weakTags.length ? <> and lean on {data.weakTags.slice(0, 3).join(', ')}</> : null}.</> : 'Loading…'}
          </p>
        </div>
        <button className="btn" onClick={() => setShuffle(shuffle + 1)}>{Icon.sync}New picks</button>
      </div>

      {data && data.bankSize < 1000 && (
        <div className="notice" style={{ marginBottom: 16 }}>
          Recommendations draw from the problem banks, and those haven’t been downloaded yet.{' '}
          <span className="row" style={{ display: 'inline-flex', marginLeft: 6 }}>
            <button className="btn sm" onClick={() => fetchBank('codeforces')}>Fetch Codeforces</button>
            <button className="btn sm" onClick={() => fetchBank('leetcode')}>Fetch LeetCode</button>
            <button className="btn sm" onClick={() => fetchBank('kattis')}>Fetch Kattis</button>
          </span>
        </div>
      )}

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card title="Today’s picks" sub="unsolved, near your level" flush>
            {data?.picks.length ? (
              <div className="list">
                {data.picks.map((p) => {
                  const k = `${p.platform}:${p.key}`;
                  return (
                    <div className="list-item" key={k}>
                      <div className="grow">
                        <div className="t"><ProblemLink title={p.title} url={p.url} /></div>
                        <div className="s">
                          <PlatformBadge platform={p.platform} />
                          <span className="mono">{p.platform === 'leetcode' ? '' : p.key}</span>
                          <span>{p.reason}</span>
                        </div>
                        {p.tags.length > 0 && (
                          <div className="row" style={{ gap: 4, marginTop: 5 }}>{p.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}</div>
                        )}
                      </div>
                      <Difficulty platform={p.platform} rating={p.rating} native={p.native} />
                      <div className="row" style={{ gap: 4, flexDirection: 'column', alignItems: 'stretch' }}>
                        <button className="btn sm" disabled={added.has(k)} onClick={() => addToPlan(p)}>{added.has(k) ? 'In plan' : 'Add to plan'}</button>
                        <button className="btn sm ghost" onClick={() => addReview(p)} title="Queue for spaced review">Review later</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty title="No picks yet">Link an account and fetch a problem bank so there is something to choose from.</Empty>
            )}
          </Card>

          <Card title="Unfinished" sub="attempted, never accepted" flush>
            {data?.upsolve.length ? (
              <div className="list">
                {data.upsolve.map((p) => (
                  <div className="list-item" key={`${p.platform}${p.key}`}>
                    <div className="grow">
                      <div className="t"><ProblemLink title={p.title} url={p.url} /></div>
                      <div className="s"><PlatformBadge platform={p.platform} /><span>{p.tries} {p.tries === 1 ? 'try' : 'tries'} · last {ago(p.last)}</span></div>
                    </div>
                    <Difficulty platform={p.platform} rating={p.rating} native={p.native} />
                    <button className="btn sm" onClick={() => addToPlan(p)}>Add to plan</button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="Nothing left hanging">Problems you tried but never got accepted show up here.</Empty>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Plan for today" sub={data?.tasks.length ? `${tasksDone}/${data.tasks.length} done` : ''} action={<Link to="/calendar" className="btn sm">Calendar</Link>} flush>
            {data?.tasks.length ? (
              <div className="list">
                {data.tasks.map((t) => (
                  <div className="list-item" key={t.id}>
                    <button className={`tick${t.done ? ' on' : ''}`} onClick={() => toggleTask(t)} aria-label={t.done ? 'Mark not done' : 'Mark done'}>{t.done ? Icon.check : null}</button>
                    <div className="grow">
                      <div className="t" style={{ textDecoration: t.done ? 'line-through' : undefined, color: t.done ? 'var(--ink-3)' : undefined }}>
                        {t.url ? <ProblemLink title={t.title} url={t.url} /> : t.title}
                      </div>
                      {t.platform && (
                        <div className="s">
                          <PlatformBadge platform={t.platform} />
                          {t.solved ? <span className="pill ok">Accepted on judge</span> : <button className="btn ghost sm" onClick={() => syncPlatform(t.platform!)}>Check judge</button>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No plan for today">Add picks with “Add to plan”, or plan days ahead on the calendar.</Empty>
            )}
          </Card>

          <Card title="Due for review" sub={data?.reviews.length ? `${data.reviews.length} due` : ''} action={<Link to="/reviews" className="btn sm">All reviews</Link>} flush>
            {data?.reviews.length ? (
              <div className="list">
                {data.reviews.map((r) => (
                  <div className="list-item" key={`${r.platform}${r.key}`} style={{ flexWrap: 'wrap' }}>
                    <div className="grow">
                      <div className="t"><ProblemLink title={r.title} url={r.url} /></div>
                      <div className="s">
                        <PlatformBadge platform={r.platform} />
                        {r.dueDate < today ? <span className="pill red">overdue since {fmtDay(r.dueDate, { month: 'short', day: 'numeric' })}</span> : <span>step {r.stage + 1} of 8</span>}
                      </div>
                    </div>
                    <GradeButtons r={r} onDone={reload} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="All caught up">Problems queued for review come back on a 1 → 3 → 7 → 14 → 30-day schedule.</Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

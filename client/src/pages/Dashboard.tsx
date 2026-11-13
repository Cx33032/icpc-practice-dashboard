import { Link } from 'react-router-dom';
import { post, PLATFORM_NAME, type Account, type Platform } from '../api';
import { BandBars, Heatmap, RatingLine, WeeklyTrend } from '../charts';
import { ago, cfRankColor, fmtDate } from '../format';
import { Card, Difficulty, Empty, Icon, PlatformBadge, useApi, useJobs } from '../ui';

interface Summary {
  totals: { solved: number; byPlatform: Record<Platform, number>; submissions: number; acRate: number | null; solvedThisWeek: number; streak: number; activeDays: number };
  heatmap: { from: string; to: string; days: Record<string, number> };
  bands: { band: string; codeforces: number; leetcode: number; kattis: number }[];
  weeks: { week: string; solved: number; avgRating: number | null }[];
  recent: { platform: Platform; key: string; title: string; rating: number | null; native: string | null; solvedAt: number }[];
  level: number | null;
}
interface TagStats {
  baseRate: number;
  level: number | null;
  tags: { tag: string; attempted: number; solved: number; rate: number; ceiling: number | null; score: number }[];
  untouched: string[];
}

function PlatformCard({ platform, account, solved }: { platform: Platform; account?: Account; solved: number }) {
  const p = account?.profile;
  if (!account) {
    return (
      <div className="card stat">
        <PlatformBadge platform={platform} />
        <div className="hint" style={{ marginTop: 10 }}>Not linked yet.</div>
        <Link to="/accounts" className="btn sm" style={{ marginTop: 10 }}>Link {PLATFORM_NAME[platform]}</Link>
      </div>
    );
  }
  return (
    <div className="card stat">
      <div className="spread">
        <PlatformBadge platform={platform} />
        <span className="small muted">synced {ago(account.lastSyncAt)}</span>
      </div>
      <div className="mono muted" style={{ marginTop: 4 }}>{account.handle}</div>
      {platform === 'codeforces' && (
        <>
          <div className="value" style={{ color: cfRankColor(p?.rating) }}>{p?.rating ?? 'Unrated'}</div>
          <div className="hint">
            {p?.rank ?? '—'}{p?.maxRating ? ` · max ${p.maxRating}` : ''} · {p?.contests ?? 0} contests
          </div>
          {p?.ratingHistory && <RatingLine points={p.ratingHistory} />}
        </>
      )}
      {platform === 'leetcode' && (
        <>
          <div className="value">{p?.solved?.all ?? solved}<span className="small muted" style={{ fontWeight: 400 }}> solved on site</span></div>
          <div className="hint">
            <span style={{ color: 'var(--ok)' }}>{p?.solved?.easy ?? 0} easy</span> · <span style={{ color: 'var(--warn)' }}>{p?.solved?.medium ?? 0} medium</span> · <span style={{ color: 'var(--bad)' }}>{p?.solved?.hard ?? 0} hard</span>
          </div>
          <div className="hint">{p?.contestRating ? `Contest rating ${p.contestRating} · ${p.contests} contests` : 'No rated contests'}</div>
          {!p?.fullHistory && <div className="hint">Tracking {solved} here · <Link className="link" to="/accounts">add cookie for full history</Link></div>}
        </>
      )}
      {platform === 'kattis' && (
        <>
          <div className="value">{p?.score ?? '—'}<span className="small muted" style={{ fontWeight: 400 }}> score</span></div>
          <div className="hint">{p?.rank ? `Global rank ${Number(p.rank).toLocaleString('en-CA')}` : 'Unranked'}</div>
          <div className="hint">{[p?.subdivision, p?.country].filter(Boolean).join(', ') || '—'}{p?.university ? ` · ${p.university}` : ''}</div>
          <div className="hint">{solved} solved tracked here{!p?.hasToken && <> · <Link className="link" to="/accounts">add session cookie</Link></>}</div>
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { generation, refresh, jobs } = useJobs();
  const summary = useApi<Summary>('/summary', [generation]);
  const tags = useApi<TagStats>('/tags', [generation]);
  const accounts = useApi<Account[]>('/accounts', [generation]);
  const syncing = jobs.some((j) => j.state === 'running' && j.kind === 'account');

  const s = summary.data;
  const accs = accounts.data ?? [];
  const byPlatform = new Map(accs.map((a) => [a.platform, a]));

  const syncAll = async () => {
    await post('/sync');
    refresh();
  };

  if (accounts.data && !accs.length) {
    return (
      <>
        <div className="page-head"><div><h1>Welcome</h1><p>Your ICPC training log for Codeforces, LeetCode and Kattis.</p></div></div>
        <Card>
          <Empty title="Link an account to get started">
            <p style={{ maxWidth: 460, margin: '6px auto 14px' }}>
              Add your Codeforces handle, LeetCode username or Kattis username. Your submissions are pulled into a local
              database on this computer, and the dashboard, daily picks and weakness analysis are built from them.
            </p>
            <Link to="/accounts" className="btn primary">Link accounts</Link>
          </Empty>
        </Card>
      </>
    );
  }

  const weak = (tags.data?.tags ?? []).filter((t) => t.attempted >= 2);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>{s?.level ? `Working level ≈ ${s.level} on the Codeforces scale` : 'Sync your accounts to build your profile'}</p>
        </div>
        <button className="btn primary" onClick={syncAll} disabled={syncing}>{Icon.sync}{syncing ? 'Syncing…' : 'Sync all'}</button>
      </div>

      <div className="stack">
        <div className="grid g4">
          <div className="card stat">
            <div className="label">Problems solved</div>
            <div className="value">{s?.totals.solved ?? '—'}</div>
            <div className="hint">
              {s ? (['codeforces', 'leetcode', 'kattis'] as Platform[]).filter((p) => s.totals.byPlatform[p]).map((p) => `${s.totals.byPlatform[p]} ${PLATFORM_NAME[p]}`).join(' · ') || 'none yet' : ''}
            </div>
          </div>
          <div className="card stat">
            <div className="label">This week</div>
            <div className="value">{s?.totals.solvedThisWeek ?? '—'}</div>
            <div className="hint">new problems since Monday</div>
          </div>
          <div className="card stat">
            <div className="label">Practice streak</div>
            <div className="value" style={{ color: s?.totals.streak ? 'var(--accent)' : undefined }}>{s?.totals.streak ?? '—'}<span className="small muted" style={{ fontWeight: 400 }}> days</span></div>
            <div className="hint">{s?.totals.activeDays ?? 0} active days this year</div>
          </div>
          <div className="card stat">
            <div className="label">Acceptance rate</div>
            <div className="value">{s?.totals.acRate != null ? `${s.totals.acRate}%` : '—'}</div>
            <div className="hint">{s?.totals.submissions.toLocaleString('en-CA') ?? 0} submissions synced</div>
          </div>
        </div>

        <div className="grid g3">
          {(['codeforces', 'leetcode', 'kattis'] as Platform[]).map((p) => (
            <PlatformCard key={p} platform={p} account={byPlatform.get(p)} solved={s?.totals.byPlatform[p] ?? 0} />
          ))}
        </div>

        <Card title="Activity" sub="past 12 months">
          {s ? <Heatmap {...s.heatmap} /> : <div style={{ height: 120 }} />}
        </Card>

        <div className="grid g2">
          <Card title="Solved by difficulty" sub="Codeforces scale · LeetCode & Kattis mapped">
            {s && <BandBars rows={s.bands} />}
          </Card>
          <Card title="Last 12 weeks" sub="bars: solved · line: avg difficulty">
            {s && <WeeklyTrend weeks={s.weeks} />}
          </Card>
        </div>

        <div className="grid g2">
          <Card title="Weak spots" sub={tags.data ? `vs your ${tags.data.baseRate}% overall solve rate` : ''} action={<Link to="/today" className="btn sm">Practise these</Link>} flush>
            {weak.length ? (
              <table className="table">
                <thead><tr><th>Topic</th><th className="right">Solved</th><th style={{ width: '32%' }}>Solve rate</th><th className="right">Hardest</th></tr></thead>
                <tbody>
                  {weak.slice(0, 8).map((t) => (
                    <tr key={t.tag}>
                      <td><Link className="link" to={`/problems?tag=${encodeURIComponent(t.tag)}`}>{t.tag}</Link></td>
                      <td className="right num">{t.solved}/{t.attempted}</td>
                      <td>
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${t.rate}%`, background: t.rate < (tags.data?.baseRate ?? 0) ? 'var(--accent)' : 'var(--ink-2)' }} /></div>
                      </td>
                      <td className="right num" style={{ color: cfRankColor(t.ceiling) }}>{t.ceiling ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="Not enough data yet">Topics show up once you have tagged attempts from Codeforces or LeetCode.</Empty>
            )}
            {tags.data && tags.data.untouched.length > 0 && (
              <div style={{ padding: '10px 16px 8px' }} className="small">
                <span className="muted">Untouched ICPC topics: </span>
                {tags.data.untouched.map((t) => <span key={t} className="tag" style={{ margin: '2px 4px 2px 0' }}>{t}</span>)}
              </div>
            )}
          </Card>

          <Card title="Recently solved" flush>
            {s?.recent.length ? (
              <div className="list">
                {s.recent.map((r) => (
                  <div className="list-item" key={`${r.platform}${r.key}`}>
                    <div className="grow">
                      <div className="t">{r.title}</div>
                      <div className="s"><PlatformBadge platform={r.platform} /><span className="mono">{r.key}</span></div>
                    </div>
                    <Difficulty platform={r.platform} rating={r.rating} native={r.native} />
                    <span className="small muted num" style={{ width: 92, textAlign: 'right' }}>{fmtDate(r.solvedAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="Nothing yet">Solved problems with a date appear here.</Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { del, patch, post, type Review } from '../api';
import { fmtDay } from '../format';
import { Card, Difficulty, Empty, PlatformBadge, ProblemLink, useApi } from '../ui';
import { GradeButtons } from './Today';

function parseRef(s: string): { platform: string; key: string } | null {
  let m = s.match(/codeforces\.com\/(?:problemset\/problem|contest|gym)\/(\d+)\/(?:problem\/)?([A-Za-z]\d*)/i);
  if (m) return { platform: 'codeforces', key: `${m[1]}${m[2].toUpperCase()}` };
  m = s.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
  if (m) return { platform: 'leetcode', key: m[1].toLowerCase() };
  m = s.match(/kattis\.com\/(?:contests\/[^/]+\/)?problems\/([a-z0-9]+)/i);
  if (m) return { platform: 'kattis', key: m[1].toLowerCase() };
  return null;
}

function Note({ r, onSaved }: { r: Review; onSaved: () => void }) {
  const [v, setV] = useState(r.note ?? '');
  useEffect(() => setV(r.note ?? ''), [r.note]);
  return (
    <input className="input small" style={{ width: '100%', height: 28, marginTop: 6 }} placeholder="Key idea, so future you remembers…" value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={async () => { if (v !== (r.note ?? '')) { await patch(`/reviews/${r.platform}/${encodeURIComponent(r.key)}`, { note: v }); onSaved(); } }} />
  );
}

export default function Reviews() {
  const { data, reload } = useApi<{ today: string; items: Review[] }>('/reviews');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const today = data?.today ?? '';
  const due = (data?.items ?? []).filter((r) => r.dueDate <= today);
  const later = (data?.items ?? []).filter((r) => r.dueDate > today);
  useEffect(() => {
    if (data) window.dispatchEvent(new CustomEvent('reviews-due', { detail: due.length }));
  }, [data, due.length]);

  const add = async () => {
    const ref = parseRef(link);
    if (!ref) return setError('Paste a Codeforces, LeetCode or Kattis problem link');
    await post('/reviews', ref);
    setLink('');
    setError(null);
    reload();
  };
  const remove = async (r: Review) => {
    await del(`/reviews/${r.platform}/${encodeURIComponent(r.key)}`);
    reload();
  };

  const Item = ({ r, gradeable }: { r: Review; gradeable: boolean }) => (
    <div className="list-item" style={{ alignItems: 'flex-start' }}>
      <div className="grow">
        <div className="spread">
          <div className="t"><ProblemLink title={r.title} url={r.url} /></div>
          <Difficulty platform={r.platform} rating={r.rating} native={r.native} />
        </div>
        <div className="s">
          <PlatformBadge platform={r.platform} />
          <span>step {r.stage + 1}/8 · {r.interval}-day interval</span>
          {r.dueDate < today ? <span className="pill red">overdue · {fmtDay(r.dueDate, { month: 'short', day: 'numeric' })}</span>
            : r.dueDate === today ? <span className="pill warn">due today</span>
            : <span>next {fmtDay(r.dueDate, { weekday: 'short', month: 'short', day: 'numeric' })}</span>}
        </div>
        <Note r={r} onSaved={reload} />
        <div className="spread" style={{ marginTop: 8 }}>
          {gradeable ? <GradeButtons r={r} onDone={reload} /> : <span />}
          <button className="btn ghost sm danger" onClick={() => remove(r)}>Remove</button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reviews</h1>
          <p>Re-solve problems on a widening schedule (1, 3, 7, 14, 30, 60, 120, 240 days) so techniques stick for contest day.</p>
        </div>
        <div className="row">
          <input className="input" style={{ width: 300 }} placeholder="Paste a problem link to queue it" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn primary" onClick={add}>Add</button>
        </div>
      </div>
      {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Card title="Due now" sub={due.length ? String(due.length) : undefined} flush>
          {due.length ? <div className="list">{due.map((r) => <Item key={`${r.platform}${r.key}`} r={r} gradeable />)}</div>
            : <Empty title="Nothing due">Re-solve without looking at your old code, then grade how it went.</Empty>}
        </Card>
        <Card title="Coming up" sub={later.length ? String(later.length) : undefined} flush>
          {later.length ? <div className="list">{later.map((r) => <Item key={`${r.platform}${r.key}`} r={r} gradeable={false} />)}</div>
            : <Empty title="Queue is empty">Use “Review” on any problem, or “Review later” on a daily pick.</Empty>}
        </Card>
      </div>
    </>
  );
}

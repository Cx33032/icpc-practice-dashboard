import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, post, type Platform } from '../api';
import { fmtDate } from '../format';
import { Card, Difficulty, Empty, Icon, Modal, PlatformBadge, ProblemLink, useApi, useJobs } from '../ui';

interface ListSummary {
  id: number;
  name: string;
  created_at: number;
  total: number;
  solved: number | null;
}
interface ListDetail {
  id: number;
  name: string;
  items: { platform: Platform; key: string; title: string | null; url: string; rating: number | null; native: string | null; solved: boolean; tried: boolean }[];
}

function NewList({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    try {
      const r = await post<{ id: number }>('/lists', { name, text });
      nav(`/lists/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="New problem list" onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        <label className="field">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Graphs week, Team practice #3, Kattis 3.0–4.0" /></label>
        <label className="field">Problems <span className="help">links or ids, one per line (CF ids like 1900A)</span>
          <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'https://codeforces.com/contest/1900/problem/A\nhttps://leetcode.com/problems/two-sum/\nhttps://open.kattis.com/problems/hello'} />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={create} disabled={!name.trim()}>Create list</button>
        </div>
      </div>
    </Modal>
  );
}

function ListView({ id }: { id: string }) {
  const nav = useNavigate();
  const { generation } = useJobs();
  const { data, reload } = useApi<ListDetail>(`/lists/${id}`, [generation]);
  const [text, setText] = useState('');
  if (!data) return null;
  const solved = data.items.filter((i) => i.solved).length;
  const add = async () => {
    await post(`/lists/${id}/items`, { text });
    setText('');
    reload();
  };
  const removeItem = async (p: Platform, key: string) => {
    await del(`/lists/${id}/items/${p}/${encodeURIComponent(key)}`);
    reload();
  };
  const removeList = async () => {
    if (!confirm(`Delete the list “${data.name}”? The problems themselves stay.`)) return;
    await del(`/lists/${id}`);
    nav('/lists');
  };
  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/lists" className="small muted">← All lists</Link>
          <h1 style={{ marginTop: 4 }}>{data.name}</h1>
          <p>{solved} of {data.items.length} solved</p>
        </div>
        <button className="btn danger" onClick={removeList}>Delete list</button>
      </div>
      <Card flush>
        {data.items.length ? (
          <table className="table">
            <thead><tr><th style={{ width: 40 }}>#</th><th>Problem</th><th>Judge</th><th className="right">Difficulty</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.items.map((i, n) => (
                <tr key={`${i.platform}${i.key}`}>
                  <td className="muted num">{n + 1}</td>
                  <td className="title-cell"><ProblemLink title={i.title ?? i.key} url={i.url} /><div className="mono muted">{i.key}</div></td>
                  <td><PlatformBadge platform={i.platform} /></td>
                  <td className="right"><Difficulty platform={i.platform} rating={i.rating} native={i.native} /></td>
                  <td>{i.solved ? <span className="pill ok">Solved</span> : i.tried ? <span className="pill warn">Attempted</span> : <span className="pill grey">Not started</span>}</td>
                  <td className="right"><button className="btn ghost sm" onClick={() => removeItem(i.platform, i.key)} aria-label="Remove from list">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="Empty list" />}
        <div className="row" style={{ padding: 12, borderTop: '1px solid var(--line)', alignItems: 'flex-start' }}>
          <textarea className="input" rows={2} style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste more problem links to add" />
          <button className="btn" onClick={add} disabled={!text.trim()}>{Icon.plus}Add</button>
        </div>
      </Card>
      <p className="small muted" style={{ marginTop: 10 }}>Status updates when you sync your accounts.</p>
    </>
  );
}

export default function Lists() {
  const { id } = useParams();
  const [creating, setCreating] = useState(false);
  const { data } = useApi<ListSummary[]>(id ? null : '/lists', [id]);
  if (id) return <ListView id={id} />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Problem lists</h1>
          <p>Paste a set of problems — a team practice, a topic week, a past regional — and track it to the end.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>{Icon.plus}New list</button>
      </div>
      {data?.length ? (
        <div className="grid g3">
          {data.map((l) => {
            const pct = l.total ? Math.round(((l.solved ?? 0) / l.total) * 100) : 0;
            return (
              <Link to={`/lists/${l.id}`} key={l.id} className="card stat" style={{ display: 'block' }}>
                <h2>{l.name}</h2>
                <div className="hint">{l.solved ?? 0}/{l.total} solved · created {fmtDate(l.created_at)}</div>
                <div className="bar-track" style={{ marginTop: 10 }}><div className="bar-fill" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--ok)' : 'var(--ink-2)' }} /></div>
              </Link>
            );
          })}
        </div>
      ) : data ? (
        <Card><Empty title="No lists yet">Create one from links to Codeforces, LeetCode or Kattis problems.</Empty></Card>
      ) : null}
      {creating && <NewList onClose={() => setCreating(false)} />}
    </>
  );
}

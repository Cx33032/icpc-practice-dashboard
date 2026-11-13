import { useState } from 'react';
import { del, patch, post, type Contest, type Task } from '../api';
import { dayOf, fmtDay, fmtTime } from '../format';
import { Card, Empty, Icon, PlatformBadge, ProblemLink, useApi, useJobs } from '../ui';

interface MonthData {
  month: string;
  today: string;
  tasks: Task[];
  streak: number;
  reviewsDue: Record<string, number>;
  overdue: number;
}

function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default function Calendar() {
  const todayKey = dayOf(Math.floor(Date.now() / 1000));
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  const [selected, setSelected] = useState(todayKey);
  const [text, setText] = useState('');
  const { generation } = useJobs();
  const { data, reload } = useApi<MonthData>(`/tasks?month=${month}`, [generation]);
  const contests = useApi<{ contests: Contest[] }>('/contests');

  // Monday-first grid covering the month.
  const first = new Date(`${month}-01T12:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - lead);
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + i);
    cells.push(d.toISOString().slice(0, 10));
  }
  const rows = cells.slice(35).every((c) => c.slice(0, 7) !== month) ? cells.slice(0, 35) : cells;

  const tasksBy = new Map<string, Task[]>();
  for (const t of data?.tasks ?? []) tasksBy.set(t.date, [...(tasksBy.get(t.date) ?? []), t]);
  const contestsBy = new Map<string, Contest[]>();
  for (const c of contests.data?.contests ?? []) {
    if (c.platform === 'kattis') continue; // too many to be useful on a month grid
    const d = dayOf(c.start);
    contestsBy.set(d, [...(contestsBy.get(d) ?? []), c]);
  }

  const dayTasks = tasksBy.get(selected) ?? [];
  const add = async () => {
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    await post('/tasks', { date: selected, items: lines.map((title) => ({ title })) });
    setText('');
    reload();
  };
  const toggle = async (t: Task) => {
    await patch(`/tasks/${t.id}`, { done: !t.done });
    reload();
  };
  const remove = async (t: Task) => {
    await del(`/tasks/${t.id}`);
    reload();
  };
  const moveToTomorrow = async (t: Task) => {
    const d = new Date(`${t.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    await patch(`/tasks/${t.id}`, { date: d.toISOString().slice(0, 10) });
    reload();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{fmtDay(`${month}-15`, { month: 'long', year: 'numeric' })}</h1>
          <p>
            {data?.streak ? <>Plan streak: <b style={{ color: 'var(--accent)' }}>{data.streak} day{data.streak === 1 ? '' : 's'}</b> with every task done.</> : 'Plan your training days and tick them off.'}
            {data?.overdue ? <> · <span style={{ color: 'var(--accent)' }}>{data.overdue} overdue review{data.overdue === 1 ? '' : 's'}</span></> : null}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹</button>
          <button className="btn" onClick={() => { setMonth(todayKey.slice(0, 7)); setSelected(todayKey); }}>Today</button>
          <button className="btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">›</button>
        </div>
      </div>

      <div className="grid cal-layout">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="cal">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="dow">{d}</div>)}
            {rows.map((day) => {
              const ts = tasksBy.get(day) ?? [];
              const done = ts.filter((t) => t.done).length;
              const rev = data?.reviewsDue[day] ?? 0;
              const cs = contestsBy.get(day) ?? [];
              return (
                <div
                  key={day}
                  className={`day${day.slice(0, 7) !== month ? ' out' : ''}${day === todayKey ? ' today' : ''}${day === selected ? ' sel' : ''}`}
                  onClick={() => setSelected(day)}
                >
                  <span className="d">{Number(day.slice(8))}</span>
                  {ts.length > 0 && <span className={`chip ${done === ts.length ? 'done' : 'task'}`}>{done}/{ts.length}<span className="hide-sm"> tasks</span></span>}
                  {rev > 0 && <span className="chip rev">{rev}<span className="hide-sm"> review{rev === 1 ? '' : 's'}</span></span>}
                  {cs.slice(0, 2).map((c) => <span key={c.id} className={`chip ${c.platform === 'custom' ? 'event' : 'contest'}`} title={c.title}>{c.title}</span>)}
                  {cs.length > 2 && <span className="small muted">+{cs.length - 2} more</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="stack">
          <Card title={fmtDay(selected)} sub={dayTasks.length ? `${dayTasks.filter((t) => t.done).length}/${dayTasks.length} done` : undefined} flush>
            {dayTasks.length ? (
              <div className="list">
                {dayTasks.map((t) => (
                  <div className="list-item" key={t.id}>
                    <button className={`tick${t.done ? ' on' : ''}`} onClick={() => toggle(t)} aria-label="Toggle done">{t.done ? Icon.check : null}</button>
                    <div className="grow">
                      <div className="t" style={{ textDecoration: t.done ? 'line-through' : undefined, color: t.done ? 'var(--ink-3)' : undefined }}>
                        {t.url ? <ProblemLink title={t.title} url={t.url} /> : t.title}
                      </div>
                      {t.platform && <div className="s"><PlatformBadge platform={t.platform} />{t.solved ? <span className="pill ok">Accepted</span> : null}</div>}
                    </div>
                    {!t.done && <button className="btn ghost sm" onClick={() => moveToTomorrow(t)} title="Move to the next day">→</button>}
                    <button className="btn ghost sm" onClick={() => remove(t)} aria-label="Delete task">✕</button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="Nothing planned" />
            )}
            <div style={{ padding: '10px 16px 12px', borderTop: '1px solid var(--line)' }}>
              <textarea className="input" rows={2} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={'A task, or paste problem links (one per line)'}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); }} />
              <div className="spread" style={{ marginTop: 6 }}>
                <span className="small muted">Links to Codeforces, LeetCode and Kattis become problem tasks.</span>
                <button className="btn sm primary" onClick={add}>Add</button>
              </div>
            </div>
          </Card>

          {(contestsBy.get(selected)?.length ?? 0) > 0 && (
            <Card title="Contests" flush>
              <div className="list">
                {contestsBy.get(selected)!.map((c) => (
                  <div className="list-item" key={c.id}>
                    <div className="grow">
                      <div className="t">{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : c.title}</div>
                      <div className="s"><PlatformBadge platform={c.platform} />{fmtTime(c.start)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

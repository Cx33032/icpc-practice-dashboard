import { useState } from 'react';
import { useSettings } from '../App';
import { del, post, PLATFORM_NAME, type Contest } from '../api';
import { dayOf, duration, fmtDay, fmtDateTime, fmtTime, getZone, until, zonedToUnix } from '../format';
import { Card, Empty, Icon, Modal, PlatformBadge, useApi } from '../ui';

type Source = Contest['platform'];
const SOURCES: Source[] = ['codeforces', 'leetcode', 'kattis', 'custom'];

function EventForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { settings } = useSettings();
  const [title, setTitle] = useState(settings.regional ? `ICPC ${settings.regional}` : '');
  const [start, setStart] = useState('');
  const [hours, setHours] = useState('5');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!title || !start) return setError('Title and start time are required');
    try {
      await post('/events', { title, start: zonedToUnix(start), duration: Math.round(Number(hours) * 3600), url, note });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="Add a contest or event" onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="small muted" style={{ margin: 0 }}>
          For contests the judges don’t list: your ICPC regional, the North America Championship, a university qualifier or a team practice.
        </p>
        <label className="field">Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ICPC regional, team practice" /></label>
        <div className="grid g2" style={{ gap: 12 }}>
          <label className="field">Starts <span className="help">({getZone().replace('America/', '').replace('_', ' ')} time)</span>
            <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">Length (hours)<input className="input" type="number" min="0.5" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        </div>
        <label className="field">Link <span className="help">(optional)</span><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>
        <label className="field">Note <span className="help">(optional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Room, team, registration deadline…" /></label>
        {error && <div className="error-text">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save event</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Contests() {
  const { settings, save } = useSettings();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, reload } = useApi<{ contests: Contest[]; errors: Record<string, string>; past: Contest[] }>(`/contests${refreshKey ? '?refresh=1' : ''}`, [refreshKey]);
  const [hidden, setHidden] = useState<Set<Source>>(new Set());
  const [adding, setAdding] = useState(false);
  const now = Math.floor(Date.now() / 1000);

  const shown = (data?.contests ?? []).filter((c) => !hidden.has(c.platform));
  const live = shown.filter((c) => c.start <= now && c.start + c.duration > now);
  const upcoming = shown.filter((c) => c.start > now);
  const byDay = new Map<string, Contest[]>();
  for (const c of upcoming) {
    const d = dayOf(c.start);
    byDay.set(d, [...(byDay.get(d) ?? []), c]);
  }

  const toggle = (s: Source) => {
    const next = new Set(hidden);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setHidden(next);
  };
  const remove = async (c: Contest) => {
    await del(`/events/${c.id.replace('ev-', '')}`);
    reload();
  };
  const ics = (ids?: string[]) => `/api/contests.ics${ids ? `?id=${ids.join(',')}` : ''}`;

  const Row = ({ c }: { c: Contest }) => (
    <div className="list-item">
      <div style={{ width: 92 }} className="num">
        <div style={{ fontWeight: 600 }}>{fmtTime(c.start)}</div>
        <div className="small muted">{duration(c.duration)}</div>
      </div>
      <div className="grow">
        <div className="t">{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : c.title}</div>
        <div className="s">
          <PlatformBadge platform={c.platform} />
          <span>{c.start > now ? until(c.start) : `ends ${until(c.start + c.duration)}`}</span>
          {c.note && <span>· {c.note}</span>}
        </div>
      </div>
      <a className="btn sm ghost" href={ics([c.id])} title="Download an .ics file for your calendar app">.ics</a>
      {c.platform === 'custom' && <button className="btn sm ghost danger" onClick={() => remove(c)}>Delete</button>}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contests</h1>
          <p>Upcoming rounds from all three judges, shown in {getZone().replace('America/', '').replace('_', ' ')} time.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setRefreshKey(refreshKey + 1)} disabled={loading}>{Icon.sync}Refresh</button>
          <a className="btn" href={ics()}>Export all (.ics)</a>
          <button className="btn primary" onClick={() => setAdding(true)}>{Icon.plus}Add event</button>
        </div>
      </div>

      <div className="spread" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="row">
          {SOURCES.map((s) => (
            <button key={s} className={`btn sm ${hidden.has(s) ? 'ghost' : ''}`} onClick={() => toggle(s)} style={{ opacity: hidden.has(s) ? 0.5 : 1 }}>
              <span className={`pf ${s}`}>{s === 'custom' ? 'My events' : PLATFORM_NAME[s]}</span>
            </button>
          ))}
        </div>
        <label className="check small">
          <input type="checkbox" checked={settings.hideLongKattis !== '0'} onChange={(e) => save({ hideLongKattis: e.target.checked ? '1' : '0' }).then(reload)} />
          Hide Kattis contests longer than 24 h (course homework)
        </label>
      </div>

      {data && Object.keys(data.errors).length > 0 && (
        <div className="notice" style={{ marginBottom: 14 }}>
          Couldn’t reach {Object.keys(data.errors).map((k) => PLATFORM_NAME[k]).join(', ')}; showing what was cached. ({Object.values(data.errors)[0]})
        </div>
      )}

      <div className="stack">
        {live.length > 0 && (
          <Card title={<span style={{ color: 'var(--accent)' }}>Live now</span>} flush>
            <div className="list">{live.map((c) => <Row key={c.id} c={c} />)}</div>
          </Card>
        )}
        {[...byDay.entries()].map(([day, list]) => (
          <Card key={day} title={fmtDay(day)} sub={day === dayOf(now) ? 'today' : undefined} flush>
            <div className="list">{list.map((c) => <Row key={c.id} c={c} />)}</div>
          </Card>
        ))}
        {data && !live.length && !upcoming.length && (
          <Card><Empty title="No upcoming contests">Nothing scheduled from the selected sources.</Empty></Card>
        )}
        {data && data.past.length > 0 && (
          <Card title="Past events" flush>
            <div className="list">
              {data.past.slice(0, 10).map((c) => (
                <div className="list-item" key={c.id}>
                  <div className="grow"><div className="t">{c.title}</div><div className="s">{fmtDateTime(c.start)}</div></div>
                  <button className="btn sm ghost danger" onClick={() => remove(c)}>Delete</button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
      {adding && <EventForm onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  );
}

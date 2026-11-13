import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, PLATFORM_NAME, type Job, type Platform } from './api';
import { cfRankColor } from './format';

// ---------- data hook ----------
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    const load = (retry: boolean): Promise<void> =>
      api<T>(path)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => {
          // The local server restarts briefly during development; try once more.
          if (retry) return new Promise<void>((r) => setTimeout(r, 1500)).then(() => load(false));
          setError(e.message);
        });
    load(true).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}

// ---------- background jobs ----------
interface JobsCtx {
  jobs: Job[];
  refresh: () => void;
  /** Bumps whenever a job finishes, so pages can reload their data. */
  generation: number;
}
const JobsContext = createContext<JobsCtx>({ jobs: [], refresh: () => {}, generation: 0 });
export const useJobs = () => useContext(JobsContext);

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [generation, setGeneration] = useState(0);
  const running = useRef(new Set<string>());
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    api<Job[]>('/jobs')
      .then((list) => {
        setJobs(list);
        const now = new Set(list.filter((j) => j.state === 'running').map((j) => j.id));
        if ([...running.current].some((id) => !now.has(id))) setGeneration((g) => g + 1);
        running.current = now;
        if (now.size) timer.current = window.setTimeout(refresh, 1200);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    return () => window.clearTimeout(timer.current);
  }, [refresh]);

  return (
    <JobsContext.Provider value={{ jobs, refresh, generation }}>
      {children}
      <JobToasts jobs={jobs} />
    </JobsContext.Provider>
  );
}

function JobToasts({ jobs }: { jobs: Job[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = jobs.filter((j) => j.state === 'running' || (!hidden.has(`${j.id}${j.finishedAt}`) && Date.now() - (j.finishedAt ?? 0) < 20_000));
  if (!visible.length) return null;
  return (
    <div className="jobs" aria-live="polite">
      {visible.map((j) => (
        <div className="job" key={j.id}>
          <div className="spread">
            <span className={`pf ${j.platform}`}>
              {PLATFORM_NAME[j.platform]} · {j.kind === 'bank' ? 'problem bank' : 'account sync'}
            </span>
            {j.state !== 'running' && (
              <button className="btn ghost sm" onClick={() => setHidden(new Set(hidden).add(`${j.id}${j.finishedAt}`))} aria-label="Dismiss">
                ✕
              </button>
            )}
          </div>
          <div style={{ marginTop: 4, color: j.state === 'failed' ? 'var(--bad)' : 'var(--ink-2)' }}>
            {j.state === 'running' ? j.progress : j.state === 'done' ? `Done · ${j.message}` : j.message}
          </div>
          {j.state === 'running' && <div className="bar" />}
        </div>
      ))}
    </div>
  );
}

// ---------- small pieces ----------
export function PlatformBadge({ platform }: { platform: Platform | 'custom' }) {
  return <span className={`pf ${platform}`}>{PLATFORM_NAME[platform]}</span>;
}

export function Difficulty({ platform, rating, native }: { platform: Platform; rating: number | null; native: string | null }) {
  if (platform === 'codeforces') return rating ? <span className="diff" style={{ color: cfRankColor(rating) }}>{rating}</span> : <span className="muted">—</span>;
  if (platform === 'leetcode') {
    const c = native === 'Easy' ? 'var(--ok)' : native === 'Medium' ? 'var(--warn)' : native === 'Hard' ? 'var(--bad)' : 'var(--ink-3)';
    return <span className="diff" style={{ color: c }}>{native ?? '—'}</span>;
  }
  if (!native) return <span className="muted">—</span>;
  const [n, label] = native.split(' ');
  const c = label === 'Easy' ? 'var(--ok)' : label === 'Medium' ? 'var(--warn)' : label === 'Hard' ? 'var(--bad)' : 'var(--ink-2)';
  return <span className="diff" style={{ color: c }}>{n}</span>;
}

export function Card({ title, sub, action, children, flush }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card-head">
          <h2>
            {title} {sub && <span className="sub">{sub}</span>}
          </h2>
          {action}
        </div>
      )}
      <div className={`card-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-label={title}>
        <div className="card-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="card-body">{children}</div>
      </div>
    </div>
  );
}

export const Icon = {
  check: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>,
  ext: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5v3a.5.5 0 0 1-.5.5H3.5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3" /></svg>,
  sync: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 8a5.5 5.5 0 0 1-9.6 3.7M2.5 8a5.5 5.5 0 0 1 9.6-3.7M12.5 1.8v2.7H9.8M3.5 14.2v-2.7h2.7" /></svg>,
  plus: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>,
};

export function ProblemLink({ title, url, paid }: { title: string; url: string; paid?: boolean }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Open on the judge">
      {title}
      {paid && <span className="pill grey" style={{ marginLeft: 6 }}>Premium</span>}
    </a>
  );
}

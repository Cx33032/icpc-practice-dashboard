import { useEffect, useState, type ReactNode } from 'react';
import { useSettings } from '../App';
import { api, del, post, put, PLATFORM_NAME, type Account, type Platform } from '../api';
import { ago, CANADIAN_ZONES } from '../format';
import { Card, Icon, PlatformBadge, useApi, useJobs } from '../ui';

const HELP: Record<Platform, { handle: string; placeholder: string; note: ReactNode }> = {
  codeforces: {
    handle: 'Handle',
    placeholder: 'your-handle',
    note: 'Uses the public Codeforces API. Your full submission history, rating and contest history sync without logging in.',
  },
  leetcode: {
    handle: 'Username',
    placeholder: 'from leetcode.com/u/…',
    note: (
      <>
        Without a cookie, LeetCode only shares your <b>20 most recent accepted</b> submissions, which still adds up if you sync regularly.
        For your complete history, add your session cookie below.
      </>
    ),
  },
  kattis: {
    handle: 'Username',
    placeholder: 'from open.kattis.com/users/…',
    note: (
      <>
        Kattis publicly shows only your score and rank. To pull your solved problems, add the session cookie from a browser where
        you are logged in to Kattis, or paste a list of solved problems.
      </>
    ),
  },
};

function AccountCard({ platform, account, onChange }: { platform: Platform; account?: Account; onChange: () => void }) {
  const { jobs, refresh } = useJobs();
  const [handle, setHandle] = useState(account?.handle ?? '');
  const [secretOpen, setSecretOpen] = useState(false);
  const [session, setSession] = useState('');
  const [csrf, setCsrf] = useState('');
  const [kattisCookie, setKattisCookie] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setHandle(account?.handle ?? ''), [account?.handle]);
  const job = jobs.find((j) => j.id === `${platform}:account`);
  const running = job?.state === 'running';
  const h = HELP[platform];

  const save = async (andSync = true) => {
    setMsg(null);
    if (account && handle.trim().toLowerCase() !== account.handle.toLowerCase()) {
      if (!confirm(`Switch from ${account.handle} to ${handle.trim()}? Synced ${PLATFORM_NAME[platform]} submissions for the old account will be removed.`)) return;
    }
    try {
      const body: Record<string, unknown> = { handle };
      if (platform === 'leetcode' && (session || csrf)) Object.assign(body, session.includes('=') ? { cookie: session } : { session, csrf });
      if (platform === 'kattis' && kattisCookie) body.cookie = kattisCookie;
      await put(`/accounts/${platform}`, body);
      setSession('');
      setCsrf('');
      setKattisCookie('');
      setSecretOpen(false);
      onChange();
      if (andSync) {
        await post(`/sync/${platform}`);
        refresh();
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const clearSecret = async () => {
    await put(`/accounts/${platform}`, { handle: account!.handle, clearSecret: true });
    onChange();
  };
  const unlink = async () => {
    const purge = confirm(`Unlink ${PLATFORM_NAME[platform]}?\n\nOK = also delete its synced submissions\nCancel = keep the history, just unlink`);
    await del(`/accounts/${platform}${purge ? '?purge=1' : ''}`);
    setHandle('');
    onChange();
  };
  const importSolved = async () => {
    try {
      const r = await post<{ imported: number }>('/solves/import', { platform, text: paste });
      setMsg({ ok: true, text: `Marked ${r.imported} problems as solved.` });
      setPaste('');
      setPasteOpen(false);
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <PlatformBadge platform={platform} />
        {account && <span className="small muted">last synced {ago(account.lastSyncAt)}</span>}
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <p className="small muted" style={{ margin: 0 }}>{h.note}</p>
        <label className="field">
          {h.handle}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input mono" style={{ flex: 1 }} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={h.placeholder} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <button className="btn primary" onClick={() => save()} disabled={!handle.trim() || running}>{Icon.sync}{account ? (running ? 'Syncing…' : 'Save & sync') : 'Link'}</button>
          </div>
        </label>

        {job && job.state !== 'running' && (
          <div className="small" style={{ color: job.state === 'failed' ? 'var(--bad)' : 'var(--ok)' }}>{job.state === 'failed' ? job.message : `Last sync: ${job.message}`}</div>
        )}
        {running && <div className="small muted">{job?.progress}</div>}
        {msg && <div className="small" style={{ color: msg.ok ? 'var(--ok)' : 'var(--bad)' }}>{msg.text}</div>}

        {platform !== 'codeforces' && account && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="spread">
              <span className="small">
                Session cookie:{' '}
                {account.secretOutdated ? <span className="pill red">old token, replace</span>
                  : account.hasSecret ? <span className="pill ok">saved</span> : <span className="pill grey">not set</span>}
              </span>
              <div className="row" style={{ gap: 4 }}>
                {account.hasSecret && <button className="btn ghost sm" onClick={clearSecret}>Remove</button>}
                <button className="btn sm" onClick={() => setSecretOpen(!secretOpen)}>{account.hasSecret ? 'Replace' : 'Add'}</button>
              </div>
            </div>
            {secretOpen && platform === 'leetcode' && (
              <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                  <li>Log in at leetcode.com in your browser.</li>
                  <li>Open developer tools → Application → Cookies → https://leetcode.com.</li>
                  <li>Copy the values of <code>LEETCODE_SESSION</code> and <code>csrftoken</code>.</li>
                </ol>
                <input className="input mono" placeholder="LEETCODE_SESSION value (or paste the whole Cookie header)" value={session} onChange={(e) => setSession(e.target.value)} />
                <input className="input mono" placeholder="csrftoken value" value={csrf} onChange={(e) => setCsrf(e.target.value)} disabled={session.includes('=')} />
                <span className="small muted">Stored only in the local database on this computer. It expires after a few weeks; replace it when sync says so.</span>
                <button className="btn primary sm" style={{ alignSelf: 'flex-start' }} onClick={() => save()} disabled={!session}>Save cookie & sync</button>
              </div>
            )}
            {secretOpen && platform === 'kattis' && (
              <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                  <li>Log in at open.kattis.com in your browser.</li>
                  <li>Open developer tools → Application → Cookies → https://open.kattis.com.</li>
                  <li>Copy the value of <code>KattisSiteCookie</code>.</li>
                </ol>
                <input className="input mono" placeholder="KattisSiteCookie value (or paste the whole Cookie header)" value={kattisCookie} onChange={(e) => setKattisCookie(e.target.value)} />
                <span className="small muted">
                  The <code>.kattisrc</code> token won’t work here: Kattis only lets it submit solutions. The cookie is used only to read the problem
                  list as you, is stored in the local database, and stops working if you log out of Kattis in that browser. A full scan reads about 70 pages
                  and takes a couple of minutes.
                </span>
                <button className="btn primary sm" style={{ alignSelf: 'flex-start' }} onClick={() => save()} disabled={!kattisCookie}>Save cookie & sync</button>
              </div>
            )}
          </div>
        )}

        {platform !== 'codeforces' && account && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="spread">
              <span className="small">Paste solved problems</span>
              <button className="btn sm" onClick={() => setPasteOpen(!pasteOpen)}>{pasteOpen ? 'Close' : 'Open'}</button>
            </div>
            {pasteOpen && (
              <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                <textarea className="input" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)}
                  placeholder={platform === 'kattis' ? 'hello\ncarrots\nhttps://open.kattis.com/problems/r2' : 'two-sum\nhttps://leetcode.com/problems/add-two-numbers/'} />
                <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={importSolved} disabled={!paste.trim()}>Mark as solved</button>
              </div>
            )}
          </div>
        )}

        {account && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <button className="btn ghost sm danger" onClick={unlink}>Unlink account</button>
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsCard() {
  const { settings, save } = useSettings();
  const [regional, setRegional] = useState(settings.regional ?? '');
  const [saved, setSaved] = useState(false);
  const update = async (patch: Record<string, string>) => {
    await save(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <Card title="Preferences" action={saved ? <span className="small" style={{ color: 'var(--ok)' }}>Saved</span> : null}>
      <div className="stack" style={{ gap: 14 }}>
        <label className="field">
          Time zone <span className="help">Contest times, the heatmap and “today” use this zone.</span>
          <select className="input" value={settings.timezone} onChange={(e) => update({ timezone: e.target.value })}>
            {CANADIAN_ZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
            {!CANADIAN_ZONES.some((z) => z.id === settings.timezone) && <option value={settings.timezone}>{settings.timezone}</option>}
          </select>
        </label>
        <label className="field">
          University / ICPC regional <span className="help">Shown in the sidebar and used to prefill events.</span>
          <input className="input" value={regional} onChange={(e) => setRegional(e.target.value)} onBlur={() => regional !== settings.regional && update({ regional })} placeholder="e.g. University of Waterloo · ECNA" />
        </label>
        <label className="field">
          Daily picks <span className="help">How many problems “Today” suggests.</span>
          <input className="input num" type="number" min={1} max={10} value={settings.dailyGoal} onChange={(e) => update({ dailyGoal: e.target.value })} style={{ width: 90 }} />
        </label>
      </div>
    </Card>
  );
}

function BackupCard() {
  const [status, setStatus] = useState<string | null>(null);
  const restore = async (file: File) => {
    if (!confirm('Restore this backup? Your current history, plans, lists and reviews will be replaced by the file’s contents.')) return;
    try {
      const json = JSON.parse(await file.text());
      await api('/restore', { method: 'POST', json });
      setStatus('Restored. Reloading…');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      setStatus(`Restore failed: ${(e as Error).message}`);
    }
  };
  return (
    <Card title="Backup">
      <p className="small muted" style={{ marginTop: 0 }}>
        Everything lives in <code>data/workbench.db</code> inside the project folder. Export a JSON copy to move machines or keep a snapshot. Cookies and tokens are never included.
      </p>
      <div className="row">
        <a className="btn" href="/api/backup">Download backup</a>
        <a className="btn ghost" href="/api/backup?bank=1">Include problem banks</a>
        <label className="btn ghost">
          Restore…
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
        </label>
      </div>
      {status && <div className="small" style={{ marginTop: 8 }}>{status}</div>}
    </Card>
  );
}

function SyncLog() {
  const { generation } = useJobs();
  const { data } = useApi<{ id: number; platform: Platform; kind: string; started_at: number; finished_at: number | null; ok: number | null; message: string | null }[]>('/sync-log', [generation]);
  if (!data?.length) return null;
  return (
    <Card title="Sync history" flush>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>When</th><th>Judge</th><th>What</th><th>Result</th></tr></thead>
          <tbody>
            {data.slice(0, 15).map((r) => (
              <tr key={r.id}>
                <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(r.started_at)}</td>
                <td><PlatformBadge platform={r.platform} /></td>
                <td className="small">{r.kind === 'bank' ? 'Problem bank' : 'Account'}</td>
                <td className="small" style={{ color: r.ok === 0 ? 'var(--bad)' : undefined }}>{r.finished_at ? r.message : 'running…'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Accounts() {
  const { generation } = useJobs();
  const { data, reload } = useApi<Account[]>('/accounts', [generation]);
  const byPlatform = new Map((data ?? []).map((a) => [a.platform, a]));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts & settings</h1>
          <p>Link your judges. Everything is stored locally; the app only talks to Codeforces, LeetCode and Kattis.</p>
        </div>
      </div>
      <div className="stack">
        {data && (
          <div className="grid g3" style={{ alignItems: 'start' }}>
            {(['codeforces', 'leetcode', 'kattis'] as Platform[]).map((p) => <AccountCard key={p} platform={p} account={byPlatform.get(p)} onChange={reload} />)}
          </div>
        )}
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <SettingsCard />
          <BackupCard />
        </div>
        <SyncLog />
      </div>
    </>
  );
}

import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, allSettings, db, get, run, setSetting, tx } from './db.ts';
import { addDays, today } from './dates.ts';
import { listJobs, startJob } from './jobs.ts';
import { fetchCodeforcesBank, syncCodeforces } from './adapters/codeforces.ts';
import { fetchLeetCodeBank, parseLeetCodeCookie, syncLeetCode, type LeetCodeSecret } from './adapters/leetcode.ts';
import { fetchKattisBank, syncKattis, type KattisSecret } from './adapters/kattis.ts';
import { summary, tagStats } from './stats.ts';
import { todayPlan } from './recommend.ts';
import { toIcs, upcomingContests } from './contests.ts';
import { canonicalTags } from './tags.ts';
import { markSolved, parseProblemRef, PLATFORMS, problemUrl, upsertProblem, type Platform } from './store.ts';

const app = express();
app.use(express.json({ limit: '50mb' }));

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};
const now = () => Math.floor(Date.now() / 1000);
function platformParam(req: Request): Platform {
  const p = req.params.platform as Platform;
  if (!PLATFORMS.includes(p)) throw Object.assign(new Error('Unknown platform'), { status: 400 });
  return p;
}
function bad(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

// ---------- settings ----------
app.get('/api/settings', (_req, res) => res.json(allSettings()));
app.put('/api/settings', (req, res) => {
  const allowed = ['timezone', 'regional', 'dailyGoal', 'hideLongKattis'];
  for (const [k, v] of Object.entries(req.body ?? {})) if (allowed.includes(k)) setSetting(k, String(v));
  res.json(allSettings());
});

// ---------- accounts ----------
function accountView(r: any) {
  return {
    platform: r.platform,
    handle: r.handle,
    hasSecret: !!r.secret,
    profile: r.profile ? JSON.parse(r.profile) : null,
    lastSyncAt: r.last_sync_at,
  };
}
app.get('/api/accounts', (_req, res) => res.json(all('SELECT * FROM accounts').map(accountView)));

app.put('/api/accounts/:platform', wrap((req, res) => {
  const platform = platformParam(req);
  const handle = String(req.body?.handle ?? '').trim();
  if (!handle) bad('Enter a username');
  const prev = get<any>('SELECT * FROM accounts WHERE platform = ?', platform);
  let secret: string | null | undefined; // undefined = keep what is stored
  if (req.body?.clearSecret) secret = null;
  else if (platform === 'leetcode' && (req.body?.session || req.body?.csrf || req.body?.cookie)) {
    const s = parseLeetCodeCookie(req.body);
    if (!s) bad('Need both LEETCODE_SESSION and csrftoken');
    secret = JSON.stringify(s);
  } else if (platform === 'kattis' && req.body?.token) {
    secret = JSON.stringify({ token: String(req.body.token).trim() } satisfies KattisSecret);
  }
  const switched = prev && prev.handle.toLowerCase() !== handle.toLowerCase();
  tx(() => {
    if (switched) {
      // A different person's history shouldn't mix with yours.
      run('DELETE FROM submissions WHERE platform = ?', platform);
      run("DELETE FROM solves WHERE platform = ? AND source != 'manual'", platform);
    }
    run(
      `INSERT INTO accounts(platform, handle, secret) VALUES (?, ?, ?)
       ON CONFLICT(platform) DO UPDATE SET handle = excluded.handle,
         secret = CASE WHEN ? THEN excluded.secret ELSE accounts.secret END,
         profile = CASE WHEN ? THEN NULL ELSE accounts.profile END`,
      platform, handle, secret ?? null, secret !== undefined ? 1 : 0, switched ? 1 : 0,
    );
  });
  res.json(accountView(get('SELECT * FROM accounts WHERE platform = ?', platform)));
}));

app.delete('/api/accounts/:platform', wrap((req, res) => {
  const platform = platformParam(req);
  tx(() => {
    run('DELETE FROM accounts WHERE platform = ?', platform);
    if (req.query.purge === '1') {
      run('DELETE FROM submissions WHERE platform = ?', platform);
      run('DELETE FROM solves WHERE platform = ?', platform);
    }
  });
  res.json({ ok: true });
}));

// ---------- syncing ----------
function account(platform: Platform) {
  const a = get<any>('SELECT * FROM accounts WHERE platform = ?', platform);
  if (!a) bad(`Link your ${platform} account first`);
  return { handle: a.handle as string, secret: a.secret ? JSON.parse(a.secret) : null };
}

function startAccountSync(platform: Platform) {
  const { handle, secret } = account(platform);
  return startJob(platform, 'account', (report) => {
    if (platform === 'codeforces') return syncCodeforces(handle, report);
    if (platform === 'leetcode') return syncLeetCode(handle, secret as LeetCodeSecret | null, report);
    return syncKattis(handle, secret as KattisSecret | null, report);
  });
}

app.post('/api/sync/:platform', wrap((req, res) => res.json(startAccountSync(platformParam(req)))));
app.post('/api/sync', wrap((_req, res) => {
  const jobs = all<{ platform: Platform }>('SELECT platform FROM accounts').map((a) => startAccountSync(a.platform));
  res.json(jobs);
}));

app.post('/api/bank/:platform', wrap((req, res) => {
  const platform = platformParam(req);
  const a = get<any>('SELECT secret FROM accounts WHERE platform = ?', platform);
  const job = startJob(platform, 'bank', (report) => {
    if (platform === 'codeforces') return fetchCodeforcesBank(report);
    if (platform === 'leetcode') return fetchLeetCodeBank(a?.secret ? JSON.parse(a.secret) : null, report);
    return fetchKattisBank(report);
  });
  res.json(job);
}));

app.get('/api/jobs', (_req, res) => res.json(listJobs()));
app.get('/api/sync-log', (_req, res) => res.json(all('SELECT * FROM sync_log ORDER BY id DESC LIMIT 40')));

app.get('/api/bank-status', (_req, res) => {
  const counts = all<{ platform: string; n: number }>('SELECT platform, COUNT(*) n FROM problems GROUP BY platform');
  const last = all<{ platform: string; at: number }>("SELECT platform, MAX(finished_at) at FROM sync_log WHERE kind = 'bank' AND ok = 1 GROUP BY platform");
  res.json(PLATFORMS.map((p) => ({ platform: p, problems: counts.find((c) => c.platform === p)?.n ?? 0, fetchedAt: last.find((l) => l.platform === p)?.at ?? null })));
});

// ---------- manual solves ----------
function ensureProblem(platform: Platform, key: string) {
  if (!get('SELECT 1 FROM problems WHERE platform = ? AND key = ?', platform, key)) {
    upsertProblem({ platform, key, title: key, url: problemUrl(platform, key) });
  }
}
app.post('/api/solves/import', wrap((req, res) => {
  const hint = req.body?.platform as Platform | undefined;
  const text = String(req.body?.text ?? '');
  const refs = text.split(/[\s,]+/).map((s) => parseProblemRef(s, hint)).filter((r): r is NonNullable<typeof r> => !!r);
  if (!refs.length) bad('No problems recognised. Paste problem links or ids, one per line.');
  tx(() => {
    for (const r of refs) {
      ensureProblem(r.platform, r.key);
      markSolved(r.platform, r.key, null, 'manual');
    }
  });
  res.json({ imported: refs.length });
}));
app.post('/api/solves', wrap((req, res) => {
  const platform = req.body?.platform as Platform;
  const key = String(req.body?.key ?? '');
  if (!PLATFORMS.includes(platform) || !key) bad('platform and key required');
  ensureProblem(platform, key);
  if (req.body.solved) markSolved(platform, key, now(), 'manual');
  else run("DELETE FROM solves WHERE platform = ? AND problem_key = ? AND source = 'manual'", platform, key);
  res.json({ ok: true });
}));

// ---------- stats ----------
app.get('/api/summary', (_req, res) => res.json(summary()));
app.get('/api/tags', (_req, res) => res.json(tagStats()));
app.get('/api/today', (req, res) => {
  const plan = todayPlan(Number(req.query.shuffle) || 0);
  res.json({ ...plan, reviews: dueReviews(), tasks: tasksFor(today()) });
});

// ---------- problems ----------
app.get('/api/problems', wrap((req, res) => {
  const q = req.query as Record<string, string>;
  const where: string[] = [];
  const params: any[] = [];
  const scope = q.scope === 'bank' ? 'bank' : 'mine';
  if (scope === 'mine') {
    where.push(`(s.problem_key IS NOT NULL OR EXISTS(SELECT 1 FROM submissions x WHERE x.platform = p.platform AND x.problem_key = p.key))`);
  }
  if (q.platform && PLATFORMS.includes(q.platform as Platform)) {
    where.push('p.platform = ?');
    params.push(q.platform);
  }
  if (q.status === 'solved') where.push('s.problem_key IS NOT NULL');
  if (q.status === 'unsolved') where.push('s.problem_key IS NULL');
  if (q.min) {
    where.push('p.rating >= ?');
    params.push(Number(q.min));
  }
  if (q.max) {
    where.push('p.rating <= ?');
    params.push(Number(q.max));
  }
  if (q.q) {
    where.push('(p.title LIKE ? OR p.key LIKE ?)');
    params.push(`%${q.q}%`, `%${q.q}%`);
  }
  const order =
    q.sort === 'rating' ? 'p.rating IS NULL, p.rating ASC, p.native ASC'
    : q.sort === '-rating' ? 'p.rating IS NULL, p.rating DESC, p.native DESC'
    : q.sort === 'title' ? 'p.title COLLATE NOCASE'
    : scope === 'mine' ? 'COALESCE(s.solved_at, last_at, 0) DESC'
    : 'p.platform, p.rating IS NULL, p.rating';
  const rows = all<any>(
    `SELECT p.platform, p.key, p.title, p.url, p.native, p.rating, p.tags, p.extra,
       s.solved_at, s.source AS solve_source, (s.problem_key IS NOT NULL) solved,
       (SELECT COUNT(*) FROM submissions x WHERE x.platform = p.platform AND x.problem_key = p.key) tries,
       (SELECT MAX(created_at) FROM submissions x WHERE x.platform = p.platform AND x.problem_key = p.key) last_at,
       EXISTS(SELECT 1 FROM reviews r WHERE r.platform = p.platform AND r.problem_key = p.key) in_review
     FROM problems p LEFT JOIN solves s ON s.platform = p.platform AND s.problem_key = p.key
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${order}`,
    ...params,
  );
  let list = rows.map((r) => ({
    platform: r.platform,
    key: r.key,
    title: r.title,
    url: r.url,
    native: r.native,
    rating: r.rating,
    tags: canonicalTags(JSON.parse(r.tags || '[]')),
    rawTags: JSON.parse(r.tags || '[]') as string[],
    solved: !!r.solved,
    solvedAt: r.solved_at,
    solveSource: r.solve_source,
    tries: r.tries,
    lastAt: r.last_at,
    inReview: !!r.in_review,
    paidOnly: r.extra ? !!JSON.parse(r.extra).paidOnly : false,
  }));
  if (q.tag) list = list.filter((p) => p.tags.includes(q.tag));
  const page = Math.max(1, Number(q.page) || 1);
  const size = Math.min(200, Math.max(10, Number(q.size) || 50));
  res.json({ total: list.length, page, size, items: list.slice((page - 1) * size, page * size) });
}));

app.get('/api/problems/:platform/:key/submissions', wrap((req, res) => {
  res.json(all('SELECT * FROM submissions WHERE platform = ? AND problem_key = ? ORDER BY created_at DESC', platformParam(req), req.params.key));
}));

// ---------- reviews (spaced repetition) ----------
const INTERVALS = [1, 3, 7, 14, 30, 60, 120, 240];
function reviewRows(whereSql = '', ...params: any[]) {
  return all<any>(
    `SELECT r.*, p.title, p.url, p.rating, p.native FROM reviews r
     LEFT JOIN problems p ON p.platform = r.platform AND p.key = r.problem_key ${whereSql} ORDER BY r.due_date, r.created_at`,
    ...params,
  ).map((r) => ({
    platform: r.platform, key: r.problem_key, title: r.title ?? r.problem_key, url: r.url ?? problemUrl(r.platform, r.problem_key),
    rating: r.rating, native: r.native, stage: r.stage, interval: INTERVALS[Math.min(r.stage, INTERVALS.length - 1)],
    dueDate: r.due_date, note: r.note, createdAt: r.created_at, lastAt: r.last_at,
  }));
}
function dueReviews() {
  return reviewRows('WHERE r.due_date <= ?', today());
}
app.get('/api/reviews', (_req, res) => res.json({ today: today(), items: reviewRows() }));
app.post('/api/reviews', wrap((req, res) => {
  const platform = req.body?.platform as Platform;
  const key = String(req.body?.key ?? '');
  if (!PLATFORMS.includes(platform) || !key) bad('platform and key required');
  ensureProblem(platform, key);
  run(
    `INSERT INTO reviews(platform, problem_key, stage, due_date, note, created_at) VALUES (?, ?, 0, ?, ?, ?)
     ON CONFLICT(platform, problem_key) DO UPDATE SET note = COALESCE(excluded.note, reviews.note)`,
    platform, key, addDays(today(), INTERVALS[0]), req.body?.note ?? null, now(),
  );
  res.json({ ok: true });
}));
app.post('/api/reviews/:platform/:key/grade', wrap((req, res) => {
  const platform = platformParam(req);
  const r = get<any>('SELECT * FROM reviews WHERE platform = ? AND problem_key = ?', platform, req.params.key);
  if (!r) bad('Not in the review queue');
  const grade = String(req.body?.grade);
  const last = INTERVALS.length - 1;
  let stage = r.stage;
  let days: number;
  if (grade === 'again') {
    stage = Math.max(0, stage - 2);
    days = 1;
  } else if (grade === 'hard') {
    days = Math.max(1, Math.round(INTERVALS[Math.min(stage, last)] / 2));
  } else if (grade === 'easy') {
    stage = Math.min(last, stage + 2);
    days = INTERVALS[stage];
  } else {
    stage = Math.min(last, stage + 1);
    days = INTERVALS[stage];
  }
  run('UPDATE reviews SET stage = ?, due_date = ?, last_at = ? WHERE platform = ? AND problem_key = ?', stage, addDays(today(), days), now(), platform, req.params.key);
  res.json({ stage, dueDate: addDays(today(), days) });
}));
app.patch('/api/reviews/:platform/:key', wrap((req, res) => {
  run('UPDATE reviews SET note = ? WHERE platform = ? AND problem_key = ?', req.body?.note ?? null, platformParam(req), req.params.key);
  res.json({ ok: true });
}));
app.delete('/api/reviews/:platform/:key', wrap((req, res) => {
  run('DELETE FROM reviews WHERE platform = ? AND problem_key = ?', platformParam(req), req.params.key);
  res.json({ ok: true });
}));

// ---------- plan / calendar tasks ----------
function tasksFor(date: string) {
  return all('SELECT t.*, (SELECT 1 FROM solves s WHERE s.platform = t.platform AND s.problem_key = t.problem_key) solved FROM tasks t WHERE date = ? ORDER BY id', date);
}
app.get('/api/tasks', wrap((req, res) => {
  const month = String(req.query.month ?? today().slice(0, 7));
  const tasks = all<any>(
    `SELECT t.*, (SELECT 1 FROM solves s WHERE s.platform = t.platform AND s.problem_key = t.problem_key) solved
     FROM tasks t WHERE date LIKE ? ORDER BY date, id`,
    `${month}%`,
  );
  // Days with at least one task where every task is done.
  const days = all<{ date: string; total: number; done: number }>('SELECT date, COUNT(*) total, SUM(done) done FROM tasks GROUP BY date ORDER BY date');
  const complete = new Set(days.filter((d) => d.done === d.total).map((d) => d.date));
  let streak = 0;
  let cursor = complete.has(today()) ? today() : addDays(today(), -1);
  while (complete.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  const reviews = all<{ due_date: string; n: number }>('SELECT due_date, COUNT(*) n FROM reviews WHERE due_date LIKE ? GROUP BY due_date', `${month}%`);
  res.json({ month, today: today(), tasks, streak, reviewsDue: Object.fromEntries(reviews.map((r) => [r.due_date, r.n])), overdue: get<{ n: number }>('SELECT COUNT(*) n FROM reviews WHERE due_date < ?', today())!.n });
}));
app.post('/api/tasks', wrap((req, res) => {
  const date = String(req.body?.date ?? today());
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) bad('Bad date');
  const items: { title?: string; platform?: Platform; key?: string; url?: string }[] = Array.isArray(req.body?.items) ? req.body.items : [req.body];
  const ids: number[] = [];
  tx(() => {
    for (const it of items) {
      let { title, platform, key, url } = it;
      if (!platform && title) {
        const ref = parseProblemRef(title);
        if (ref) ({ platform, key } = ref);
      }
      if (platform && key) {
        ensureProblem(platform, key);
        const p = get<any>('SELECT title, url FROM problems WHERE platform = ? AND key = ?', platform, key);
        title = title && !parseProblemRef(title) ? title : p.title;
        url = url ?? p.url;
      }
      if (!title) continue;
      ids.push(Number(run('INSERT INTO tasks(date, title, platform, problem_key, url, created_at) VALUES (?, ?, ?, ?, ?, ?)', date, title, platform ?? null, key ?? null, url ?? null, now()).lastInsertRowid));
    }
  });
  res.json({ ids });
}));
app.patch('/api/tasks/:id', wrap((req, res) => {
  const t = get<any>('SELECT * FROM tasks WHERE id = ?', Number(req.params.id));
  if (!t) bad('No such task');
  run('UPDATE tasks SET done = ?, date = ?, title = ? WHERE id = ?', req.body?.done != null ? (req.body.done ? 1 : 0) : t.done, req.body?.date ?? t.date, req.body?.title ?? t.title, t.id);
  res.json({ ok: true });
}));
app.delete('/api/tasks/:id', wrap((req, res) => {
  run('DELETE FROM tasks WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
}));

// ---------- problem lists ----------
function addListItems(listId: number, text: string, hint?: Platform) {
  const refs = text.split(/[\s,]+/).map((s) => parseProblemRef(s, hint)).filter((r): r is NonNullable<typeof r> => !!r);
  let pos = get<{ m: number | null }>('SELECT MAX(pos) m FROM list_items WHERE list_id = ?', listId)?.m ?? 0;
  tx(() => {
    for (const r of refs) {
      ensureProblem(r.platform, r.key);
      run('INSERT OR IGNORE INTO list_items(list_id, pos, platform, problem_key) VALUES (?, ?, ?, ?)', listId, ++pos, r.platform, r.key);
    }
  });
  return refs.length;
}
app.get('/api/lists', (_req, res) => {
  res.json(all(`SELECT l.*, COUNT(i.problem_key) total,
      SUM(EXISTS(SELECT 1 FROM solves s WHERE s.platform = i.platform AND s.problem_key = i.problem_key)) solved
    FROM lists l LEFT JOIN list_items i ON i.list_id = l.id GROUP BY l.id ORDER BY l.created_at DESC`));
});
app.post('/api/lists', wrap((req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) bad('Give the list a name');
  const id = Number(run('INSERT INTO lists(name, created_at) VALUES (?, ?)', name, now()).lastInsertRowid);
  const added = addListItems(id, String(req.body?.text ?? ''));
  res.json({ id, added });
}));
app.get('/api/lists/:id', wrap((req, res) => {
  const list = get('SELECT * FROM lists WHERE id = ?', Number(req.params.id));
  if (!list) bad('No such list');
  const items = all<any>(
    `SELECT i.platform, i.problem_key AS key, i.pos, p.title, p.url, p.rating, p.native,
       (s.problem_key IS NOT NULL) solved,
       EXISTS(SELECT 1 FROM submissions x WHERE x.platform = i.platform AND x.problem_key = i.problem_key) tried
     FROM list_items i LEFT JOIN problems p ON p.platform = i.platform AND p.key = i.problem_key
     LEFT JOIN solves s ON s.platform = i.platform AND s.problem_key = i.problem_key
     WHERE i.list_id = ? ORDER BY i.pos`,
    Number(req.params.id),
  ).map((r) => ({ ...r, solved: !!r.solved, tried: !!r.tried }));
  res.json({ ...list, items });
}));
app.post('/api/lists/:id/items', wrap((req, res) => res.json({ added: addListItems(Number(req.params.id), String(req.body?.text ?? '')) })));
app.delete('/api/lists/:id/items/:platform/:key', wrap((req, res) => {
  run('DELETE FROM list_items WHERE list_id = ? AND platform = ? AND problem_key = ?', Number(req.params.id), platformParam(req), req.params.key);
  res.json({ ok: true });
}));
app.patch('/api/lists/:id', wrap((req, res) => {
  run('UPDATE lists SET name = ? WHERE id = ?', String(req.body?.name ?? ''), Number(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/lists/:id', wrap((req, res) => {
  run('DELETE FROM lists WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
}));

// ---------- contests & events ----------
app.get('/api/contests', wrap(async (req, res) => res.json(await upcomingContests(req.query.refresh === '1'))));
app.post('/api/events', wrap((req, res) => {
  const { title, start, duration, url, note } = req.body ?? {};
  if (!title || !Number.isFinite(Number(start))) bad('Title and start time required');
  const id = Number(run('INSERT INTO events(title, start_ts, duration_s, url, note) VALUES (?, ?, ?, ?, ?)', String(title), Number(start), Number(duration) || 5 * 3600, url || null, note || null).lastInsertRowid);
  res.json({ id });
}));
app.delete('/api/events/:id', wrap((req, res) => {
  run('DELETE FROM events WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
}));
app.get('/api/contests.ics', wrap(async (req, res) => {
  const { contests } = await upcomingContests();
  const ids = req.query.id ? String(req.query.id).split(',') : null;
  const list = ids ? contests.filter((c) => ids.includes(c.id)) : contests;
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${ids?.length === 1 ? 'contest' : 'contests'}.ics"`);
  res.send(toIcs(list));
}));

// ---------- backup ----------
const BACKUP_TABLES = ['problems', 'submissions', 'solves', 'reviews', 'tasks', 'lists', 'list_items', 'events', 'settings'];
app.get('/api/backup', (req, res) => {
  const includeBank = req.query.bank === '1';
  const data: Record<string, unknown[]> = {
    accounts: all('SELECT platform, handle, profile, last_sync_at FROM accounts'), // secrets stay on this machine
  };
  for (const t of BACKUP_TABLES) {
    data[t] = t === 'problems' && !includeBank
      ? all(`SELECT * FROM problems p WHERE EXISTS(SELECT 1 FROM submissions x WHERE x.platform = p.platform AND x.problem_key = p.key)
             OR EXISTS(SELECT 1 FROM solves s WHERE s.platform = p.platform AND s.problem_key = p.key)
             OR EXISTS(SELECT 1 FROM list_items i WHERE i.platform = p.platform AND i.problem_key = p.key)
             OR EXISTS(SELECT 1 FROM reviews r WHERE r.platform = p.platform AND r.problem_key = p.key)
             OR EXISTS(SELECT 1 FROM tasks k WHERE k.platform = p.platform AND k.problem_key = p.key)`)
      : all(`SELECT * FROM ${t}`);
  }
  res.setHeader('Content-Disposition', `attachment; filename="icpc-practice-backup-${today()}.json"`);
  res.json({ app: 'icpc-practice', version: 1, exportedAt: new Date().toISOString(), data });
});
app.post('/api/restore', wrap((req, res) => {
  const data = req.body?.data;
  if (req.body?.app !== 'icpc-practice' || !data) bad('That file is not an icpc-practice backup');
  tx(() => {
    for (const t of [...BACKUP_TABLES].reverse()) if (t !== 'problems') db.exec(`DELETE FROM ${t}`);
    for (const t of BACKUP_TABLES) {
      const rows = data[t] as Record<string, unknown>[] | undefined;
      if (!rows?.length) continue;
      const cols = Object.keys(rows[0]);
      const stmt = db.prepare(`INSERT OR REPLACE INTO ${t}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of rows) stmt.run(...cols.map((c) => r[c] as any));
    }
    for (const a of (data.accounts ?? []) as any[]) {
      run(
        `INSERT INTO accounts(platform, handle, profile, last_sync_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(platform) DO UPDATE SET handle = excluded.handle, profile = excluded.profile, last_sync_at = excluded.last_sync_at`,
        a.platform, a.handle, a.profile, a.last_sync_at,
      );
    }
  });
  res.json({ ok: true });
}));

// ---------- errors & static client ----------
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err?.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err?.message ?? 'Server error' });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`ICPC practice workbench → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});

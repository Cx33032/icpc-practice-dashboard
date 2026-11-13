import { run } from './db.ts';
import type { Platform } from './store.ts';

// Long-running syncs run in the background; the client polls /api/jobs.
export interface Job {
  id: string;
  platform: Platform;
  kind: 'account' | 'bank';
  state: 'running' | 'done' | 'failed';
  progress: string;
  message?: string;
  startedAt: number;
  finishedAt?: number;
}

const jobs = new Map<string, Job>();

// Jobs live in memory, so anything still "running" in the log was cut off by a restart.
run("UPDATE sync_log SET finished_at = started_at, ok = 0, message = 'Interrupted (the app was restarted); run it again' WHERE finished_at IS NULL");

export function listJobs(): Job[] {
  const cutoff = Date.now() - 10 * 60_000;
  return [...jobs.values()].filter((j) => j.state === 'running' || (j.finishedAt ?? 0) > cutoff);
}

export function startJob(platform: Platform, kind: Job['kind'], work: (report: (p: string) => void) => Promise<string>): Job {
  const id = `${platform}:${kind}`;
  const existing = jobs.get(id);
  if (existing?.state === 'running') return existing;
  const job: Job = { id, platform, kind, state: 'running', progress: 'Starting…', startedAt: Date.now() };
  jobs.set(id, job);
  const logId = Number(run('INSERT INTO sync_log(platform, kind, started_at) VALUES (?, ?, ?)', platform, kind, Math.floor(Date.now() / 1000)).lastInsertRowid);
  work((p) => (job.progress = p))
    .then((msg) => {
      job.state = 'done';
      job.message = msg;
    })
    .catch((err: unknown) => {
      job.state = 'failed';
      job.message = err instanceof Error ? err.message : String(err);
      console.error(`[${id}]`, err);
    })
    .finally(() => {
      job.finishedAt = Date.now();
      run('UPDATE sync_log SET finished_at = ?, ok = ?, message = ? WHERE id = ?', Math.floor(Date.now() / 1000), job.state === 'done' ? 1 : 0, job.message ?? '', logId);
    });
  return job;
}

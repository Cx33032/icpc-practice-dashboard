export type Platform = 'codeforces' | 'leetcode' | 'kattis';
export const PLATFORMS: Platform[] = ['codeforces', 'leetcode', 'kattis'];
export const PLATFORM_NAME: Record<string, string> = {
  codeforces: 'Codeforces',
  leetcode: 'LeetCode',
  kattis: 'Kattis',
  custom: 'Event',
};

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const post = <T = any>(path: string, json: unknown = {}) => api<T>(path, { method: 'POST', json });
export const put = <T = any>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const patch = <T = any>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export interface Account {
  platform: Platform;
  handle: string;
  hasSecret: boolean;
  profile: any;
  lastSyncAt: number | null;
}

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

export interface Problem {
  platform: Platform;
  key: string;
  title: string;
  url: string;
  native: string | null;
  rating: number | null;
  tags: string[];
  solved: boolean;
  solvedAt: number | null;
  solveSource?: string | null;
  tries: number;
  lastAt: number | null;
  inReview: boolean;
  paidOnly?: boolean;
}

export interface Pick {
  platform: Platform;
  key: string;
  title: string;
  url: string;
  rating: number | null;
  native: string | null;
  tags: string[];
  reason: string;
}

export interface Review {
  platform: Platform;
  key: string;
  title: string;
  url: string;
  rating: number | null;
  native: string | null;
  stage: number;
  interval: number;
  dueDate: string;
  note: string | null;
  lastAt: number | null;
}

export interface Task {
  id: number;
  date: string;
  title: string;
  platform: Platform | null;
  problem_key: string | null;
  url: string | null;
  done: number;
  solved: number | null;
}

export interface Contest {
  platform: Platform | 'custom';
  id: string;
  title: string;
  start: number;
  duration: number;
  url: string | null;
  note?: string | null;
}

export type Settings = Record<string, string>;

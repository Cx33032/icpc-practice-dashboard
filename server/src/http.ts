// Polite HTTP: one request at a time per host, with a minimum gap between them.
const MIN_GAP_MS: Record<string, number> = {
  'codeforces.com': 2100, // CF API asks for at most one call every 2 seconds
  'leetcode.com': 900,
  'open.kattis.com': 1500,
};
const nextSlot = new Map<string, number>();

async function waitTurn(host: string) {
  const gap = MIN_GAP_MS[host] ?? 1000;
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function politeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const host = new URL(url).host;
  await waitTurn(host);
  const headers = new Headers(init.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', UA);
  const res = await fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(25_000) });
  return res;
}

export async function getJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await politeFetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, `${new URL(url).host} answered HTTP ${res.status}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${new URL(url).host} returned something that is not JSON (possibly a bot check page)`);
  }
}

export async function getText(url: string, init: RequestInit = {}): Promise<string> {
  const res = await politeFetch(url, init);
  if (!res.ok) throw new HttpError(res.status, `${new URL(url).host} answered HTTP ${res.status}`);
  return res.text();
}

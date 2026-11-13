import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(here, '../../data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, 'workbench.db');

export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  platform     TEXT PRIMARY KEY,
  handle       TEXT NOT NULL,
  secret       TEXT,               -- LeetCode cookie / Kattis token (JSON). Never sent to the client.
  profile      TEXT,               -- JSON snapshot from the last sync
  last_sync_at INTEGER
);

CREATE TABLE IF NOT EXISTS problems (
  platform   TEXT NOT NULL,
  key        TEXT NOT NULL,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  native     TEXT,                -- platform's own difficulty label: "1700", "Medium", "3.2 Medium"
  rating     INTEGER,             -- approximate Codeforces-scale difficulty
  tags       TEXT NOT NULL DEFAULT '[]',
  extra      TEXT,
  PRIMARY KEY (platform, key)
);
CREATE INDEX IF NOT EXISTS problems_rating ON problems(platform, rating);

CREATE TABLE IF NOT EXISTS submissions (
  platform    TEXT NOT NULL,
  remote_id   TEXT NOT NULL,
  problem_key TEXT NOT NULL,
  verdict     TEXT NOT NULL,      -- AC WA TLE MLE RE CE OTHER
  lang        TEXT,
  created_at  INTEGER NOT NULL,   -- unix seconds
  PRIMARY KEY (platform, remote_id)
);
CREATE INDEX IF NOT EXISTS submissions_problem ON submissions(platform, problem_key);
CREATE INDEX IF NOT EXISTS submissions_time ON submissions(created_at);

-- One row per solved problem. solved_at is NULL when the platform only tells us "solved" without a date.
CREATE TABLE IF NOT EXISTS solves (
  platform    TEXT NOT NULL,
  problem_key TEXT NOT NULL,
  solved_at   INTEGER,
  source      TEXT NOT NULL,      -- submission | status | manual
  PRIMARY KEY (platform, problem_key)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  platform    TEXT NOT NULL,
  kind        TEXT NOT NULL,      -- account | bank
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  ok          INTEGER,
  message     TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  platform    TEXT NOT NULL,
  problem_key TEXT NOT NULL,
  stage       INTEGER NOT NULL DEFAULT 0,
  due_date    TEXT NOT NULL,      -- YYYY-MM-DD in the user's time zone
  note        TEXT,
  created_at  INTEGER NOT NULL,
  last_at     INTEGER,
  PRIMARY KEY (platform, problem_key)
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,      -- YYYY-MM-DD
  title       TEXT NOT NULL,
  platform    TEXT,
  problem_key TEXT,
  url         TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_date ON tasks(date);

CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS list_items (
  list_id     INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  pos         INTEGER NOT NULL,
  platform    TEXT NOT NULL,
  problem_key TEXT NOT NULL,
  PRIMARY KEY (list_id, platform, problem_key)
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  start_ts    INTEGER NOT NULL,   -- unix seconds
  duration_s  INTEGER NOT NULL,
  url         TEXT,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export type Row = Record<string, any>;

export function all<T = Row>(sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T = Row>(sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const DEFAULT_SETTINGS: Record<string, string> = {
  timezone: 'America/Toronto',
  regional: '',
  dailyGoal: '3',
  hideLongKattis: '1',
};

export function getSetting(key: string): string {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? DEFAULT_SETTINGS[key] ?? '';
}
export function allSettings(): Record<string, string> {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of all<{ key: string; value: string }>('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}
export function setSetting(key: string, value: string) {
  run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

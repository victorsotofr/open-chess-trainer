import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type DB = Database.Database

/** App tables (Better Auth manages its own tables in the same file). */
export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      user_id     TEXT NOT NULL,
      attempt_id  TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      payload     TEXT NOT NULL,
      PRIMARY KEY (user_id, attempt_id)
    );
    CREATE TABLE IF NOT EXISTS sessions_checkpoint (
      user_id    TEXT NOT NULL,
      device_id  TEXT NOT NULL,
      device     TEXT,
      updated_at TEXT NOT NULL,
      record     TEXT NOT NULL,
      PRIMARY KEY (user_id, device_id)
    );
    CREATE TABLE IF NOT EXISTS games (
      user_id   TEXT NOT NULL,
      game_id   TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      server_ts TEXT NOT NULL,  -- write time on the server: cursor for incremental pulls
      payload   TEXT NOT NULL,
      PRIMARY KEY (user_id, game_id)
    );
    CREATE INDEX IF NOT EXISTS games_user_ts ON games (user_id, server_ts);
    CREATE TABLE IF NOT EXISTS feedback (
      id         TEXT PRIMARY KEY,          -- client UUID: retries are idempotent
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      user_id    TEXT,                      -- null for guests
      email      TEXT,
      name       TEXT,
      kind       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'new',
      message    TEXT NOT NULL,
      context    TEXT,                      -- JSON (FeedbackContext) or null
      reply      TEXT,                      -- shown to the reporter
      issue_url  TEXT
    );
    CREATE INDEX IF NOT EXISTS feedback_status ON feedback (status, created_at);
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
  `)
  return db
}

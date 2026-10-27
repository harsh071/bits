import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// One SQLite file holds everything that is not a human-editable file:
// conversations, messages (the turn journal), turns, approvals, routine state, search index.

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  summary_upto INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  parts TEXT NOT NULL,
  turn_id TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (conversation_id, seq)
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  steps INTEGER NOT NULL DEFAULT 0,
  -- last message seq the turn has "seen"; newer user messages are steering input
  seen_seq INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_by_status ON turns(status, conversation_id);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL UNIQUE,
  tool_name TEXT NOT NULL,
  input TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Durable, idempotent tool results keyed by tool call id. If the daemon crashes after a tool ran
-- but before the result message was written, the result is reused instead of running the tool twice.
CREATE TABLE IF NOT EXISTS tool_runs (
  tool_call_id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  output TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS routine_state (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Derived, rebuildable search index over memory files and conversation text.
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
  source UNINDEXED, ref UNINDEXED, ts UNINDEXED, body, tokenize = 'porter unicode61'
);
`;

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  // Columns added after the first release (ALTER fails harmlessly when the column is already there).
  for (const sql of ["ALTER TABLE routine_state ADD COLUMN schedule TEXT"]) {
    try {
      db.exec(sql);
    } catch {}
  }
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

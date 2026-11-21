-- Boba Bracket voting app: D1 schema.
-- Shop names are never stored here. The bagger's paper key maps cup numbers 1-12 to shops.
DROP TABLE IF EXISTS ballots;
DROP TABLE IF EXISTS cups;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS tasters;

CREATE TABLE tasters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  panel TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rounds (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' -- pending | open | closed
);
INSERT INTO rounds (id) VALUES (1), (2), (3);

CREATE TABLE cups (
  round_id INTEGER NOT NULL,
  table_no INTEGER NOT NULL,
  num INTEGER NOT NULL,      -- secret cup number 1-12 (bagger's key)
  letter TEXT NOT NULL,
  PRIMARY KEY (round_id, num),
  UNIQUE (letter)
);

CREATE TABLE ballots (
  round_id INTEGER NOT NULL,
  taster_id TEXT NOT NULL,
  table_no INTEGER NOT NULL,
  ranking TEXT NOT NULL,     -- JSON array of letters, best first
  notes TEXT NOT NULL DEFAULT '{}', -- JSON object letter -> note
  source TEXT NOT NULL DEFAULT 'app', -- app | paper
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (round_id, taster_id)
);

-- Boba Bracket voting app: D1 schema.
-- Shops are numbered 1-12 inside the app; the host only sees names and cup letters.
DROP TABLE IF EXISTS ballots;
DROP TABLE IF EXISTS cups;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS tasters;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS shops;

-- revealed = '1' once the host unlocks personal recaps. The Worker also creates this table on first use.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The line-up. grp = group 1-4 (redrawn by "Generate groups"); late = 1 while a drink is running late;
-- status = ordered | picked_up | arrived (drinks board). The Worker creates and seeds this table if it's missing.
CREATE TABLE shops (
  num INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  grp INTEGER NOT NULL,
  late INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ordered'
);
INSERT INTO shops (num, name, grp) VALUES
  (1, 'Bubble World', 1), (2, 'Sharetea', 1), (3, 'Happy Lemon', 1),
  (4, '101 Boba', 2), (5, 'CoCo', 2), (6, 'CHICHA San Chen', 2),
  (7, 'Chatime', 3), (8, 'Shiny Tea', 3), (9, 'Gong Cha', 3),
  (10, 'ChunFunHow', 4), (11, 'MACU Tea', 4), (12, 'SunTea', 4);

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
  num INTEGER NOT NULL,      -- shop number 1-12 (shops.num)
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

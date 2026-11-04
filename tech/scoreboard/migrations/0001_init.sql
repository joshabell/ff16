-- FF16 scoreboard schema. Totals are never stored: they are recomputed from results.

CREATE TABLE seasons (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  start_date  TEXT NOT NULL,          -- YYYY-MM-DD
  end_date    TEXT NOT NULL,
  is_current  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE racers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sail_number  TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE race_days (
  id          INTEGER PRIMARY KEY,
  season_id   INTEGER NOT NULL REFERENCES seasons(id),
  date        TEXT NOT NULL,          -- YYYY-MM-DD
  start_time  TEXT,                   -- HH:MM, 24h
  venue       TEXT CHECK (venue IN ('A', 'B', 'C')),
  status      TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'bye', 'cancelled')),
  notes       TEXT,
  UNIQUE (season_id, date)
);

CREATE TABLE races (
  id           INTEGER PRIMARY KEY,
  race_day_id  INTEGER NOT NULL REFERENCES race_days(id) ON DELETE CASCADE,
  race_number  INTEGER NOT NULL,
  notes        TEXT,
  updated_by   TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (race_day_id, race_number)
);

-- One row per boat that came to the start. No row = DNR (0 points).
CREATE TABLE results (
  race_id    INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  racer_id   INTEGER NOT NULL REFERENCES racers(id),
  place      INTEGER,                 -- finishing place, or NULL when a code applies
  code       TEXT CHECK (code IN ('DNF', 'DSQ', 'OCS', 'RET')),
  PRIMARY KEY (race_id, racer_id),
  CHECK ((place IS NULL) <> (code IS NULL))
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  user_email  TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT
);

CREATE INDEX idx_race_days_season ON race_days(season_id, date);
CREATE INDEX idx_results_racer ON results(racer_id);

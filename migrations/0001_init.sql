-- TRUBBL league manager — initial schema.
--
-- Division of truth: TourPlay owns participants, fixtures and results. Every
-- column prefixed tp_ is a mirror of what TourPlay said at the last sync and is
-- overwritten freely. Everything else is ours and TourPlay never sees it:
-- round windows, extensions, chase state, rulings, Discord links.

CREATE TABLE season (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT    NOT NULL,
  tourplay_slug          TEXT    NOT NULL UNIQUE,
  tourplay_tournament_id INTEGER,
  tourplay_phase_id      INTEGER,
  total_rounds           INTEGER NOT NULL DEFAULT 0,
  timezone               TEXT    NOT NULL DEFAULT 'Europe/London',
  is_active              INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  last_synced_at         TEXT,
  last_sync_error        TEXT,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A person. TourPlay identifies them by player id; Discord by snowflake; the
-- admin portal by the email on their Cloudflare Access token.
CREATE TABLE coach (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id          INTEGER NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  tourplay_player_id TEXT,
  display_name       TEXT    NOT NULL,
  naf_number         INTEGER,
  naf_verified       INTEGER NOT NULL DEFAULT 0 CHECK (naf_verified IN (0, 1)),
  discord_user_id    TEXT,
  discord_username   TEXT,
  email              TEXT,
  linked_at          TEXT,
  UNIQUE (season_id, tourplay_player_id)
);
CREATE INDEX idx_coach_discord ON coach(discord_user_id) WHERE discord_user_id IS NOT NULL;
CREATE INDEX idx_coach_season  ON coach(season_id);

-- A roster in a season. Fixtures reference teams, not coaches, because a coach
-- can in principle field more than one team across seasons.
CREATE TABLE team (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id           INTEGER NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  coach_id            INTEGER REFERENCES coach(id) ON DELETE SET NULL,
  name                TEXT    NOT NULL,
  race                TEXT    NOT NULL DEFAULT '',
  tourplay_roster_key TEXT,
  withdrawn           INTEGER NOT NULL DEFAULT 0 CHECK (withdrawn IN (0, 1)),
  withdrawn_at        TEXT,
  UNIQUE (season_id, tourplay_roster_key)
);
CREATE INDEX idx_team_season ON team(season_id);

-- A round, plus the window we impose on it. TourPlay has no concept of these
-- dates; they are the whole point of this app.
CREATE TABLE round (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id           INTEGER NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  number              INTEGER NOT NULL,
  opens_at            TEXT,
  closes_at           TEXT,
  status              TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'open', 'closed', 'settled')),
  opened_at           TEXT,
  closed_at           TEXT,
  settled_at          TEXT,
  notes               TEXT    NOT NULL DEFAULT '',
  UNIQUE (season_id, number)
);

CREATE TABLE fixture (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id          INTEGER NOT NULL REFERENCES round(id) ON DELETE CASCADE,
  tourplay_match_id TEXT,
  match_order       INTEGER NOT NULL DEFAULT 0,
  home_team_id      INTEGER REFERENCES team(id) ON DELETE SET NULL,
  away_team_id      INTEGER REFERENCES team(id) ON DELETE SET NULL,

  -- mirror of TourPlay, replaced on every sync
  tp_home_score     INTEGER,
  tp_away_score     INTEGER,
  tp_home_cas       INTEGER,
  tp_away_cas       INTEGER,
  tp_state          INTEGER,
  tp_played         INTEGER NOT NULL DEFAULT 0 CHECK (tp_played IN (0, 1)),

  -- ours
  status            TEXT    NOT NULL DEFAULT 'unplayed'
                            CHECK (status IN ('unplayed', 'scheduled', 'played',
                                              'forfeit', 'concession', 'double_forfeit', 'void')),
  scheduled_for     TEXT,
  scheduled_by      TEXT,
  chase_state       TEXT    NOT NULL DEFAULT 'none'
                            CHECK (chase_state IN ('none', 'nudged', 'chased', 'escalated')),
  last_chased_at    TEXT,
  UNIQUE (round_id, tourplay_match_id)
);
CREATE INDEX idx_fixture_round  ON fixture(round_id);
CREATE INDEX idx_fixture_status ON fixture(status);

CREATE TABLE extension (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id            INTEGER NOT NULL REFERENCES fixture(id) ON DELETE CASCADE,
  extends_to            TEXT    NOT NULL,
  reason                TEXT    NOT NULL DEFAULT '',
  requested_by_coach_id INTEGER REFERENCES coach(id) ON DELETE SET NULL,
  status                TEXT    NOT NULL DEFAULT 'requested'
                                CHECK (status IN ('requested', 'granted', 'refused')),
  decided_by            TEXT,
  decided_at            TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_extension_fixture ON extension(fixture_id);

-- A ruling overrides the TourPlay result for a fixture. Superseded rulings are
-- kept with reverted_at set, so the history of a contested game survives.
CREATE TABLE ruling (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id       INTEGER NOT NULL REFERENCES fixture(id) ON DELETE CASCADE,
  kind             TEXT    NOT NULL CHECK (kind IN ('forfeit', 'concession', 'double_forfeit', 'void')),
  at_fault_team_id INTEGER REFERENCES team(id) ON DELETE SET NULL,
  home_score       INTEGER NOT NULL DEFAULT 0,
  away_score       INTEGER NOT NULL DEFAULT 0,
  home_points      REAL,
  away_points      REAL,
  reason           TEXT    NOT NULL DEFAULT '',
  ruled_by         TEXT    NOT NULL,
  ruled_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  reverted_at      TEXT,
  reverted_by      TEXT
);
CREATE UNIQUE INDEX idx_ruling_live ON ruling(fixture_id) WHERE reverted_at IS NULL;

CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every Discord post is written here first under a dedupe key, so a retried
-- cron or a double-fired schedule cannot spam the channel.
CREATE TABLE announcement (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT    NOT NULL UNIQUE,
  kind       TEXT    NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  posted_at  TEXT,
  error      TEXT
);

CREATE TABLE audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  subject TEXT,
  detail  TEXT,
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_at ON audit(at);

-- Who may use the admin portal. Access authenticates; this authorises.
CREATE TABLE admin_user (
  email        TEXT PRIMARY KEY,
  display_name TEXT,
  is_owner     INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
  added_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO setting (key, value) VALUES
  ('points_win',            '3'),
  ('points_draw',           '1'),
  ('points_loss',           '0'),
  ('forfeit_score_winner',  '2'),
  ('forfeit_score_loser',   '0'),
  ('forfeit_points_winner', '3'),
  ('forfeit_points_loser',  '0'),
  ('double_forfeit_points', '0'),
  ('round_length_days',     '21'),
  ('nag_days_before_close', '7,3,1'),
  ('auto_forfeit_on_close', 'false'),
  ('chase_channel_id',      ''),
  ('announce_channel_id',   ''),
  ('admin_channel_id',      ''),
  ('discord_admin_role_id', ''),
  ('closing_soon_days',     '3'),
  ('league_name',           'TRUBBL');

-- Season VI rules, properly modelled: divisions (§3.3), the three unplayed-game
-- outcomes (§3.2) and §2.4 bonus points.
--
-- SQLite cannot widen a CHECK constraint in place, so fixture and ruling are
-- rebuilt. Both are mirrors of TourPlay plus our overlay, and the rebuild
-- preserves every row.

CREATE TABLE division (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id            INTEGER NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  name                 TEXT    NOT NULL,
  -- 1 = Premier, 2 = Second, 3 = Third. Orders the portal and decides
  -- promotion and relegation at season end.
  tier                 INTEGER NOT NULL DEFAULT 1,
  tourplay_category_id INTEGER,
  promote_count        INTEGER NOT NULL DEFAULT 2,
  relegate_count       INTEGER NOT NULL DEFAULT 2,
  UNIQUE (season_id, name)
);
CREATE INDEX idx_division_season ON division(season_id);

ALTER TABLE team ADD COLUMN division_id INTEGER REFERENCES division(id) ON DELETE SET NULL;

-- fixture: add division_id and is_friendly, widen the status CHECK.
CREATE TABLE fixture_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id          INTEGER NOT NULL REFERENCES round(id) ON DELETE CASCADE,
  division_id       INTEGER REFERENCES division(id) ON DELETE SET NULL,
  tourplay_match_id TEXT,
  match_order       INTEGER NOT NULL DEFAULT 0,
  home_team_id      INTEGER REFERENCES team(id) ON DELETE SET NULL,
  away_team_id      INTEGER REFERENCES team(id) ON DELETE SET NULL,
  tp_home_score     INTEGER,
  tp_away_score     INTEGER,
  tp_home_cas       INTEGER,
  tp_away_cas       INTEGER,
  tp_state          INTEGER,
  tp_played         INTEGER NOT NULL DEFAULT 0 CHECK (tp_played IN (0, 1)),
  status            TEXT    NOT NULL DEFAULT 'unplayed'
                            CHECK (status IN ('unplayed', 'scheduled', 'played',
                                              'concession', 'no_agreement', 'no_attempt',
                                              'forfeit', 'double_forfeit', 'void')),
  -- §3.3.2: a game between teams in different divisions scores nothing.
  is_friendly       INTEGER NOT NULL DEFAULT 0 CHECK (is_friendly IN (0, 1)),
  scheduled_for     TEXT,
  scheduled_by      TEXT,
  chase_state       TEXT    NOT NULL DEFAULT 'none'
                            CHECK (chase_state IN ('none', 'nudged', 'chased', 'escalated')),
  last_chased_at    TEXT,
  UNIQUE (round_id, tourplay_match_id)
);

INSERT INTO fixture_new (id, round_id, tourplay_match_id, match_order, home_team_id, away_team_id,
                         tp_home_score, tp_away_score, tp_home_cas, tp_away_cas, tp_state, tp_played,
                         status, scheduled_for, scheduled_by, chase_state, last_chased_at)
  SELECT id, round_id, tourplay_match_id, match_order, home_team_id, away_team_id,
         tp_home_score, tp_away_score, tp_home_cas, tp_away_cas, tp_state, tp_played,
         status, scheduled_for, scheduled_by, chase_state, last_chased_at
    FROM fixture;

DROP TABLE fixture;
ALTER TABLE fixture_new RENAME TO fixture;
CREATE INDEX idx_fixture_round    ON fixture(round_id);
CREATE INDEX idx_fixture_status   ON fixture(status);
CREATE INDEX idx_fixture_division ON fixture(division_id);

-- ruling: widen the kind CHECK for the §3.2 outcomes.
CREATE TABLE ruling_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id       INTEGER NOT NULL REFERENCES fixture(id) ON DELETE CASCADE,
  kind             TEXT    NOT NULL CHECK (kind IN ('concession', 'no_agreement', 'no_attempt',
                                                    'forfeit', 'double_forfeit', 'void')),
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

INSERT INTO ruling_new SELECT * FROM ruling;
DROP TABLE ruling;
ALTER TABLE ruling_new RENAME TO ruling;
CREATE UNIQUE INDEX idx_ruling_live ON ruling(fixture_id) WHERE reverted_at IS NULL;

-- §2.4 scoring, and the fortnight round from §3.2.
INSERT INTO setting (key, value) VALUES
  ('bonus_touchdown_threshold', '3'),
  ('bonus_touchdown_points',    '1'),
  ('bonus_shutout_points',      '1'),
  ('bonus_casualty_threshold',  '3'),
  ('bonus_casualty_points',     '1'),
  ('concession_score_winner',   '2'),
  ('concession_score_loser',    '0'),
  ('no_agreement_score',        '1')
ON CONFLICT (key) DO NOTHING;

UPDATE setting SET value = '14' WHERE key = 'round_length_days';

DELETE FROM setting WHERE key IN
  ('forfeit_score_winner', 'forfeit_score_loser', 'forfeit_points_winner',
   'forfeit_points_loser', 'double_forfeit_points');

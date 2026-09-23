-- TourPlay hides rosters until the organiser opens the season, so an import
-- run before that gets a two-letter short code where the team name should be
-- — and the codes are not even unique (two coaches both registered as "BB").
--
-- Remember which names are placeholders, so the bot can show the coach
-- instead until the real name arrives, and so a later hidden-roster import
-- cannot overwrite a name we already know.
ALTER TABLE team ADD COLUMN name_provisional INTEGER NOT NULL DEFAULT 0
  CHECK (name_provisional IN (0, 1));

-- Backfill. A placeholder has no race and a very short name; every team
-- imported from an open season carries a race.
UPDATE team
   SET name_provisional = 1
 WHERE COALESCE(race, '') = ''
   AND length(COALESCE(name, '')) <= 4;

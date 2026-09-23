-- Pre-season tracking: who has signed up, where, and how they answered.
--
-- Before a season starts the useful question is not "what is the table" but
-- "who is actually in, and what is still missing from them". That spans three
-- sources — the Discord poll, the TourPlay registrations, and last season's
-- promotions — and none of them alone is the answer.

ALTER TABLE coach ADD COLUMN poll_vote TEXT NOT NULL DEFAULT ''
  CHECK (poll_vote IN ('', 'yes', 'no'));

-- Free-text context, e.g. why someone is listed who has not signed up.
ALTER TABLE coach ADD COLUMN preseason_note TEXT NOT NULL DEFAULT '';

-- Where a coach came from last season, so a promotion that has not signed up
-- is visible rather than simply absent.
ALTER TABLE coach ADD COLUMN last_season_note TEXT NOT NULL DEFAULT '';

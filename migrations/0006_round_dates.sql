-- A longer first round, and a dedicated dates channel.
--
-- §3.2 rounds are a fortnight, but the opening round of a season needs longer:
-- teams are being drafted and nobody has a fixture history to work from.

INSERT INTO setting (key, value) VALUES
  ('first_round_length_days', '21'),
  ('dates_channel_id',        ''),
  -- How many days before a window closes to post the "who still owes a game"
  -- reminder in the dates channel. Separate from the per-division chase.
  ('dates_reminder_days',     '4')
ON CONFLICT (key) DO NOTHING;

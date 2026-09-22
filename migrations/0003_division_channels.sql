-- Per-division chase channels, and more than one admin role.
--
-- TRUBBL runs a games-setup channel per division, so chasing everyone in one
-- place means most of each nag is aimed at people who cannot act on it.

ALTER TABLE division ADD COLUMN chase_channel_id TEXT NOT NULL DEFAULT '';

-- The admin check now takes a comma-separated list. Carry the old single value
-- across rather than dropping whatever was configured.
INSERT INTO setting (key, value) VALUES ('discord_admin_role_ids', '')
  ON CONFLICT (key) DO NOTHING;

UPDATE setting
   SET value = COALESCE((SELECT value FROM setting WHERE key = 'discord_admin_role_id'), '')
 WHERE key = 'discord_admin_role_ids'
   AND value = '';

DELETE FROM setting WHERE key = 'discord_admin_role_id';

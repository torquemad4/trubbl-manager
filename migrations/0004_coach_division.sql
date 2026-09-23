-- A coach's division, assigned before the draw exists.
--
-- team.division_id is what TourPlay says, learned from the match groups in the
-- draw. But divisions get decided during signups, weeks before any draw, and
-- for coaches who have not even registered on TourPlay yet. That assignment
-- belongs to the coach, and the team's own division supersedes it once the
-- draw lands.
ALTER TABLE coach ADD COLUMN division_id INTEGER REFERENCES division(id) ON DELETE SET NULL;
CREATE INDEX idx_coach_division ON coach(division_id);

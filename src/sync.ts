// Import from TourPlay into our mirror.
//
// TourPlay is the source of truth for who is in the league and what the results
// were, so a sync overwrites every tp_ column without ceremony. It must never
// touch what we own: window dates, chase state, and above all a fixture whose
// status came from a ruling — a forfeit does not evaporate because TourPlay
// still shows the game as unplayed.

import { audit, nowIso, type SeasonRow } from './db.js';
import { fetchEntrants, fetchSchedule, fetchTournament } from './tourplay.js';
import type { Env } from './types.js';

/** Statuses that a sync is not allowed to overwrite. */
const RULED = new Set(['forfeit', 'concession', 'double_forfeit', 'void']);

export interface SyncReport {
  seasonId: number;
  coaches: number;
  teams: number;
  rounds: number;
  fixtures: number;
  newlyPlayed: number;
  pendingRegistrations: number;
  warnings: string[];
}

export async function syncSeason(env: Env, season: SeasonRow, actor = 'sync'): Promise<SyncReport> {
  const warnings: string[] = [];
  const slug = season.tourplay_slug;

  const tournament = await fetchTournament(slug);
  const entrants = await fetchEntrants(slug);
  const schedule = await fetchSchedule(slug, season.tourplay_phase_id);

  // --- coaches and teams ---------------------------------------------------
  let coaches = 0;
  let teams = 0;
  let pendingRegistrations = 0;

  for (const entrant of entrants) {
    if (!entrant.validated) pendingRegistrations += 1;

    await env.DB.prepare(
      `INSERT INTO coach (season_id, tourplay_player_id, display_name, naf_number, naf_verified)
         VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (season_id, tourplay_player_id) DO UPDATE SET
         display_name = excluded.display_name,
         naf_number   = COALESCE(excluded.naf_number, coach.naf_number),
         naf_verified = excluded.naf_verified`,
    )
      .bind(season.id, entrant.playerId, entrant.coachName, entrant.nafNumber, entrant.nafVerified ? 1 : 0)
      .run();
    coaches += 1;

    const coach = await env.DB.prepare(
      'SELECT id FROM coach WHERE season_id = ? AND tourplay_player_id = ?',
    )
      .bind(season.id, entrant.playerId)
      .first<{ id: number }>();

    await env.DB.prepare(
      `INSERT INTO team (season_id, coach_id, name, race, tourplay_roster_key)
         VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (season_id, tourplay_roster_key) DO UPDATE SET
         coach_id = excluded.coach_id,
         name     = excluded.name,
         race     = excluded.race`,
    )
      .bind(season.id, coach?.id ?? null, entrant.teamName, entrant.race, entrant.playerId)
      .run();
    teams += 1;
  }

  // --- rounds --------------------------------------------------------------
  const totalRounds = Math.max(schedule.totalRounds, season.total_rounds, 0);
  for (let number = 1; number <= totalRounds; number += 1) {
    // Windows live in the ON CONFLICT DO NOTHING gap on purpose: re-syncing a
    // season must never reset a round's dates or status.
    await env.DB.prepare(
      'INSERT INTO round (season_id, number) VALUES (?, ?) ON CONFLICT (season_id, number) DO NOTHING',
    )
      .bind(season.id, number)
      .run();
  }

  const { results: roundRows } = await env.DB.prepare(
    'SELECT id, number FROM round WHERE season_id = ?',
  )
    .bind(season.id)
    .all<{ id: number; number: number }>();
  const roundIdByNumber = new Map((roundRows ?? []).map((r) => [r.number, r.id]));

  const { results: teamRows } = await env.DB.prepare(
    'SELECT id, tourplay_roster_key FROM team WHERE season_id = ?',
  )
    .bind(season.id)
    .all<{ id: number; tourplay_roster_key: string | null }>();
  const teamIdByPlayer = new Map(
    (teamRows ?? [])
      .filter((t) => t.tourplay_roster_key)
      .map((t) => [t.tourplay_roster_key as string, t.id]),
  );

  // --- fixtures ------------------------------------------------------------
  let fixtures = 0;
  let newlyPlayed = 0;

  for (const match of schedule.matches) {
    if (!match.matchId) {
      warnings.push(`A round ${match.round} match has no TourPlay match id and was skipped`);
      continue;
    }
    const roundId = roundIdByNumber.get(match.round);
    if (!roundId) {
      warnings.push(`Match ${match.matchId} is in round ${match.round}, which the season does not have`);
      continue;
    }

    const homeTeamId = match.home.playerId ? teamIdByPlayer.get(match.home.playerId) ?? null : null;
    const awayTeamId = match.away.playerId ? teamIdByPlayer.get(match.away.playerId) ?? null : null;
    if (homeTeamId === null || awayTeamId === null) {
      warnings.push(
        `Match ${match.matchId} (round ${match.round}) has a side not matched to a registered team`,
      );
    }

    const existing = await env.DB.prepare(
      'SELECT id, status, tp_played FROM fixture WHERE round_id = ? AND tourplay_match_id = ?',
    )
      .bind(roundId, match.matchId)
      .first<{ id: number; status: string; tp_played: number }>();

    if (!existing) {
      await env.DB.prepare(
        `INSERT INTO fixture (round_id, tourplay_match_id, match_order, home_team_id, away_team_id,
                              tp_home_score, tp_away_score, tp_home_cas, tp_away_cas, tp_state, tp_played, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          roundId,
          match.matchId,
          match.order,
          homeTeamId,
          awayTeamId,
          match.home.score,
          match.away.score,
          match.home.casualties,
          match.away.casualties,
          match.state,
          match.played ? 1 : 0,
          match.played ? 'played' : 'unplayed',
        )
        .run();
      if (match.played) newlyPlayed += 1;
    } else {
      // A ruled fixture keeps its status; only the mirror columns move.
      const keepStatus = RULED.has(existing.status);
      const nextStatus = keepStatus
        ? existing.status
        : match.played
          ? 'played'
          : existing.status === 'scheduled'
            ? 'scheduled'
            : 'unplayed';

      if (match.played && existing.tp_played === 0 && !keepStatus) newlyPlayed += 1;

      await env.DB.prepare(
        `UPDATE fixture SET
           match_order = ?, home_team_id = ?, away_team_id = ?,
           tp_home_score = ?, tp_away_score = ?, tp_home_cas = ?, tp_away_cas = ?,
           tp_state = ?, tp_played = ?, status = ?
         WHERE id = ?`,
      )
        .bind(
          match.order,
          homeTeamId,
          awayTeamId,
          match.home.score,
          match.away.score,
          match.home.casualties,
          match.away.casualties,
          match.state,
          match.played ? 1 : 0,
          nextStatus,
          existing.id,
        )
        .run();
    }
    fixtures += 1;
  }

  await env.DB.prepare(
    `UPDATE season SET
       tourplay_tournament_id = ?, tourplay_phase_id = ?, total_rounds = ?,
       name = CASE WHEN name = '' THEN ? ELSE name END,
       last_synced_at = ?, last_sync_error = NULL, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(tournament.id, schedule.phaseId, totalRounds, tournament.name, nowIso(), season.id)
    .run();

  const report: SyncReport = {
    seasonId: season.id,
    coaches,
    teams,
    rounds: totalRounds,
    fixtures,
    newlyPlayed,
    pendingRegistrations,
    warnings,
  };
  await audit(env, actor, 'tourplay.sync', season.tourplay_slug, report);
  return report;
}

export async function recordSyncFailure(env: Env, season: SeasonRow, cause: unknown): Promise<void> {
  await env.DB.prepare('UPDATE season SET last_sync_error = ? WHERE id = ?')
    .bind(String(cause).slice(0, 500), season.id)
    .run();
}

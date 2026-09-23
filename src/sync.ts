// Import from TourPlay into our mirror.
//
// TourPlay is the source of truth for who is in the league and what the results
// were, so a sync overwrites every tp_ column without ceremony. It must never
// touch what we own: window dates, chase state, and above all a fixture whose
// status came from a ruling — a forfeit does not evaporate because TourPlay
// still shows the game as unplayed.

import { audit, nowIso, type SeasonRow } from './db.js';
import { fetchEntrants, fetchSchedule, fetchTournament } from './tourplay.js';
import { RULED_STATUSES } from './types.js';
import type { Env } from './types.js';



export interface SyncReport {
  seasonId: number;
  coaches: number;
  teams: number;
  rounds: number;
  divisions: number;
  fixtures: number;
  friendlies: number;
  newlyPlayed: number;
  pendingRegistrations: number;
  hiddenRosters: number;
  warnings: string[];
}

export async function syncSeason(env: Env, season: SeasonRow, actor = 'sync'): Promise<SyncReport> {
  const warnings: string[] = [];
  const slug = season.tourplay_slug;

  const tournament = await fetchTournament(slug);
  const entrants = await fetchEntrants(slug);

  // Pre-season, TourPlay has registrations but no draw. That is a normal state,
  // not a failure: the entrants are exactly what the organiser wants to see
  // while signups are open, so import them and carry on without a schedule.
  let schedule: Awaited<ReturnType<typeof fetchSchedule>> | null = null;
  try {
    schedule = await fetchSchedule(slug, season.tourplay_phase_id);
  } catch (cause) {
    warnings.push(`No fixtures imported: ${String(cause).replace('Error: ', '')}`);
  }

  // --- divisions (§3.3) ----------------------------------------------------
  // TourPlay models a division as a *group on a match*, not as a category, so
  // divisions only become knowable once the draw exists. Categories look like
  // the obvious home for them but are not: TRUBBL's seasons all use one.
  // Divisions set up by hand in the portal before the draw are left alone.
  const groups = new Map<number, string>();
  for (const match of schedule?.matches ?? []) {
    if (match.group) groups.set(match.group.id, match.group.name);
  }

  for (const [groupId, name] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const tier = [...groups.keys()].sort((a, b) => a - b).indexOf(groupId) + 1;
    await env.DB.prepare(
      `INSERT INTO division (season_id, name, tier, tourplay_category_id)
         VALUES (?, ?, ?, ?)
       ON CONFLICT (season_id, name) DO UPDATE SET
         tourplay_category_id = excluded.tourplay_category_id,
         tier                 = excluded.tier`,
    )
      .bind(season.id, name || `Division ${tier}`, tier, groupId)
      .run();
  }

  const { results: divisionRows } = await env.DB.prepare(
    'SELECT id, tourplay_category_id FROM division WHERE season_id = ?',
  )
    .bind(season.id)
    .all<{ id: number; tourplay_category_id: number | null }>();
  const divisionByGroup = new Map(
    (divisionRows ?? [])
      .filter((d) => d.tourplay_category_id !== null)
      .map((d) => [d.tourplay_category_id as number, d.id]),
  );

  // --- coaches and teams ---------------------------------------------------
  let coaches = 0;
  let teams = 0;
  let pendingRegistrations = 0;
  let hiddenRosters = 0;

  for (const entrant of entrants) {
    if (!entrant.validated) pendingRegistrations += 1;
    if (entrant.rosterHidden) hiddenRosters += 1;

    // A coach may already exist without a TourPlay id: added by hand during
    // signups, before they registered. Claim that row rather than inserting a
    // second one, or the same person ends up in the season twice — once with
    // their division and Discord link, once with their TourPlay registration.
    await env.DB.prepare(
      `UPDATE coach SET tourplay_player_id = ?, naf_number = COALESCE(?, naf_number), naf_verified = ?
         WHERE season_id = ? AND tourplay_player_id IS NULL
           AND lower(display_name) = lower(?)`,
    )
      .bind(entrant.playerId, entrant.nafNumber, entrant.nafVerified ? 1 : 0, season.id, entrant.coachName)
      .run();

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

    // A team's division is learned from its fixtures, below — never from the
    // inscription, and never overwriting one set by hand before the draw.
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
  const totalRounds = Math.max(schedule?.totalRounds ?? 0, season.total_rounds, 0);
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
    'SELECT id, tourplay_roster_key, division_id FROM team WHERE season_id = ?',
  )
    .bind(season.id)
    .all<{ id: number; tourplay_roster_key: string | null; division_id: number | null }>();
  const teamIdByPlayer = new Map(
    (teamRows ?? [])
      .filter((t) => t.tourplay_roster_key)
      .map((t) => [t.tourplay_roster_key as string, t.id]),
  );
  const divisionByTeam = new Map((teamRows ?? []).map((t) => [t.id, t.division_id]));

  // --- fixtures ------------------------------------------------------------
  let fixtures = 0;
  let friendlies = 0;
  let newlyPlayed = 0;

  for (const match of schedule?.matches ?? []) {
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

    const matchDivision = match.group ? divisionByGroup.get(match.group.id) ?? null : null;

    // §3.3.2: a game between teams from two divisions is a friendly. With the
    // division on the match itself, that is a game whose two sides already
    // belong to different divisions from their league fixtures.
    const homeDivision = homeTeamId === null ? null : divisionByTeam.get(homeTeamId) ?? null;
    const awayDivision = awayTeamId === null ? null : divisionByTeam.get(awayTeamId) ?? null;
    const isFriendly =
      matchDivision === null && homeDivision !== null && awayDivision !== null && homeDivision !== awayDivision;
    if (isFriendly) friendlies += 1;

    // Learn each team's division from the league fixture it appears in.
    if (matchDivision !== null) {
      for (const teamId of [homeTeamId, awayTeamId]) {
        if (teamId !== null && divisionByTeam.get(teamId) !== matchDivision) {
          await env.DB.prepare('UPDATE team SET division_id = ? WHERE id = ?').bind(matchDivision, teamId).run();
          divisionByTeam.set(teamId, matchDivision);
        }
      }
    }

    const existing = await env.DB.prepare(
      'SELECT id, status, tp_played FROM fixture WHERE round_id = ? AND tourplay_match_id = ?',
    )
      .bind(roundId, match.matchId)
      .first<{ id: number; status: string; tp_played: number }>();

    if (!existing) {
      await env.DB.prepare(
        `INSERT INTO fixture (round_id, division_id, is_friendly, tourplay_match_id, match_order,
                              home_team_id, away_team_id,
                              tp_home_score, tp_away_score, tp_home_cas, tp_away_cas, tp_state, tp_played, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          roundId,
          isFriendly ? null : matchDivision,
          isFriendly ? 1 : 0,
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
      const keepStatus = RULED_STATUSES.has(existing.status);
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
           match_order = ?, division_id = ?, is_friendly = ?, home_team_id = ?, away_team_id = ?,
           tp_home_score = ?, tp_away_score = ?, tp_home_cas = ?, tp_away_cas = ?,
           tp_state = ?, tp_played = ?, status = ?
         WHERE id = ?`,
      )
        .bind(
          match.order,
          isFriendly ? null : matchDivision,
          isFriendly ? 1 : 0,
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
    .bind(
      tournament.id,
      schedule?.phaseId ?? season.tourplay_phase_id,
      totalRounds,
      tournament.name,
      nowIso(),
      season.id,
    )
    .run();

  const report: SyncReport = {
    seasonId: season.id,
    coaches,
    teams,
    rounds: totalRounds,
    divisions: groups.size,
    fixtures,
    friendlies,
    newlyPlayed,
    pendingRegistrations,
    hiddenRosters,
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

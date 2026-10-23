// Everything the portal and the bot both need to ask about the league.

import { settings } from './db.js';
import { windowState, type WindowView } from './rules.js';
import type { Env, FixtureStatus, RulingKind } from './types.js';

export interface RoundRow {
  id: number;
  season_id: number;
  number: number;
  opens_at: string | null;
  closes_at: string | null;
  status: string;
  notes: string;
}

export interface FixtureView {
  id: number;
  roundId: number;
  roundNumber: number;
  tourplayMatchId: string | null;
  status: FixtureStatus;
  scheduledFor: string | null;
  chaseState: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeam: string;
  awayTeam: string;
  /** True while TourPlay is still hiding the roster, so the name is a short code. */
  homeTeamProvisional: boolean;
  awayTeamProvisional: boolean;
  homeCoach: string;
  awayCoach: string;
  homeDiscordId: string | null;
  awayDiscordId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeCasualties: number | null;
  awayCasualties: number | null;
  homePoints: number | null;
  awayPoints: number | null;
  divisionId: number | null;
  divisionName: string | null;
  isFriendly: boolean;
  rulingKind: RulingKind | null;
  rulingReason: string | null;
  extendedTo: string | null;
}

/**
 * One query serving every fixture view in the app: the TourPlay mirror, the
 * live ruling if there is one, and the latest granted extension.
 */
const FIXTURE_SELECT = `
  SELECT f.id, f.round_id, r.number AS round_number, f.tourplay_match_id, f.status,
         f.scheduled_for, f.chase_state, f.is_friendly,
         f.division_id, d.name AS division_name,
         f.home_team_id, f.away_team_id,
         ht.name AS home_team, at.name AS away_team,
         ht.name_provisional AS home_team_provisional,
         at.name_provisional AS away_team_provisional,
         hc.display_name AS home_coach, ac.display_name AS away_coach,
         hc.discord_user_id AS home_discord, ac.discord_user_id AS away_discord,
         f.tp_home_score, f.tp_away_score, f.tp_home_cas, f.tp_away_cas,
         ru.kind AS ruling_kind, ru.reason AS ruling_reason,
         ru.home_score AS ruled_home_score, ru.away_score AS ruled_away_score,
         ru.home_points AS ruled_home_points, ru.away_points AS ruled_away_points,
         (SELECT MAX(e.extends_to) FROM extension e
           WHERE e.fixture_id = f.id AND e.status = 'granted') AS extended_to
    FROM fixture f
    JOIN round r  ON r.id = f.round_id
    LEFT JOIN division d ON d.id = f.division_id
    LEFT JOIN team ht ON ht.id = f.home_team_id
    LEFT JOIN team at ON at.id = f.away_team_id
    LEFT JOIN coach hc ON hc.id = ht.coach_id
    LEFT JOIN coach ac ON ac.id = at.coach_id
    LEFT JOIN ruling ru ON ru.fixture_id = f.id AND ru.reverted_at IS NULL
`;

function toView(row: any): FixtureView {
  const ruled = row.ruling_kind !== null && row.ruling_kind !== undefined;
  return {
    id: row.id,
    roundId: row.round_id,
    roundNumber: row.round_number,
    tourplayMatchId: row.tourplay_match_id,
    status: row.status,
    scheduledFor: row.scheduled_for,
    chaseState: row.chase_state,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    homeTeam: row.home_team ?? 'TBC',
    awayTeam: row.away_team ?? 'TBC',
    homeTeamProvisional: row.home_team_provisional === 1,
    awayTeamProvisional: row.away_team_provisional === 1,
    homeCoach: row.home_coach ?? '',
    awayCoach: row.away_coach ?? '',
    homeDiscordId: row.home_discord ?? null,
    awayDiscordId: row.away_discord ?? null,
    homeScore: ruled ? row.ruled_home_score : row.tp_home_score,
    awayScore: ruled ? row.ruled_away_score : row.tp_away_score,
    // A ruled game never awards casualties: nobody played.
    homeCasualties: ruled ? 0 : row.tp_home_cas,
    awayCasualties: ruled ? 0 : row.tp_away_cas,
    homePoints: ruled ? row.ruled_home_points : null,
    awayPoints: ruled ? row.ruled_away_points : null,
    divisionId: row.division_id ?? null,
    divisionName: row.division_name ?? null,
    isFriendly: row.is_friendly === 1,
    rulingKind: ruled ? row.ruling_kind : null,
    rulingReason: ruled ? row.ruling_reason : null,
    extendedTo: row.extended_to ?? null,
  };
}

export async function roundsFor(env: Env, seasonId: number): Promise<RoundRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM round WHERE season_id = ? ORDER BY number',
  )
    .bind(seasonId)
    .all<RoundRow>();
  return results ?? [];
}

/** The round the league is actually living in: the open one, else the next unplayed. */
export async function currentRound(env: Env, seasonId: number): Promise<RoundRow | null> {
  const open = await env.DB.prepare(
    "SELECT * FROM round WHERE season_id = ? AND status = 'open' ORDER BY number LIMIT 1",
  )
    .bind(seasonId)
    .first<RoundRow>();
  if (open) return open;

  const next = await env.DB.prepare(
    "SELECT * FROM round WHERE season_id = ? AND status = 'pending' ORDER BY number LIMIT 1",
  )
    .bind(seasonId)
    .first<RoundRow>();
  if (next) return next;

  return env.DB.prepare('SELECT * FROM round WHERE season_id = ? ORDER BY number DESC LIMIT 1')
    .bind(seasonId)
    .first<RoundRow>();
}

export async function fixturesForRound(env: Env, roundId: number): Promise<FixtureView[]> {
  const { results } = await env.DB.prepare(`${FIXTURE_SELECT} WHERE f.round_id = ? ORDER BY f.match_order, f.id`)
    .bind(roundId)
    .all<any>();
  return (results ?? []).map(toView);
}

export async function fixturesForSeason(env: Env, seasonId: number): Promise<FixtureView[]> {
  const { results } = await env.DB.prepare(`${FIXTURE_SELECT} WHERE r.season_id = ? ORDER BY r.number, f.match_order`)
    .bind(seasonId)
    .all<any>();
  return (results ?? []).map(toView);
}

export async function fixtureById(env: Env, fixtureId: number): Promise<FixtureView | null> {
  const row = await env.DB.prepare(`${FIXTURE_SELECT} WHERE f.id = ?`).bind(fixtureId).first<any>();
  return row ? toView(row) : null;
}

export async function roundWindow(env: Env, round: RoundRow, now = new Date()): Promise<WindowView> {
  const map = await settings(env);
  const closingSoon = Number(map['closing_soon_days'] ?? 3) || 3;
  return windowState(now, round.opens_at, round.closes_at, null, closingSoon);
}

export interface DivisionRow {
  id: number;
  season_id: number;
  name: string;
  tier: number;
  promote_count: number;
  relegate_count: number;
  chase_channel_id: string;
}

export async function divisionsFor(env: Env, seasonId: number): Promise<DivisionRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM division WHERE season_id = ? ORDER BY tier, name',
  )
    .bind(seasonId)
    .all<DivisionRow>();
  return results ?? [];
}

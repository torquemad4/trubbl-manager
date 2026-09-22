// Everything the portal and the bot both need to ask about the league.

import { audit, nowIso, scoringFrom, settings } from './db.js';
import { applyRuling, buildStandings, windowState, type StandingsFixture, type WindowView } from './rules.js';
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

/** The fixture a given coach still has to play in a round, if any. */
export async function fixtureForCoach(
  env: Env,
  roundId: number,
  coachId: number,
): Promise<FixtureView | null> {
  const row = await env.DB.prepare(
    `${FIXTURE_SELECT} WHERE f.round_id = ? AND (ht.coach_id = ? OR at.coach_id = ?) LIMIT 1`,
  )
    .bind(roundId, coachId, coachId)
    .first<any>();
  return row ? toView(row) : null;
}

/**
 * Fixtures still needing action. Inter-divisional friendlies (§3.3.2) are
 * voluntary extras, so they are never chased and never hold a round open.
 */
export function outstanding(fixtures: FixtureView[]): FixtureView[] {
  return fixtures.filter((f) => !f.isFriendly && (f.status === 'unplayed' || f.status === 'scheduled'));
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

/**
 * The table, one per division. Divisions are separate competitions under
 * §3.3, so each is scored on its own fixtures and its own head-to-head.
 */
export async function standingsFor(env: Env, seasonId: number) {
  const map = await settings(env);
  const scoring = scoringFrom(map);
  const fixtures = await fixturesForSeason(env, seasonId);
  const divisions = await divisionsFor(env, seasonId);

  const { results: teams } = await env.DB.prepare(
    `SELECT t.id, t.name, t.race, t.division_id, COALESCE(c.display_name, '') AS coach
       FROM team t LEFT JOIN coach c ON c.id = t.coach_id WHERE t.season_id = ?`,
  )
    .bind(seasonId)
    .all<{ id: number; name: string; race: string; division_id: number | null; coach: string }>();
  const byId = new Map((teams ?? []).map((t) => [t.id, t]));

  const toStandings = (list: FixtureView[]): StandingsFixture[] =>
    list.map((f) => ({
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      divisionId: f.divisionId,
      status: f.status,
      homeScore: f.homeScore,
      awayScore: f.awayScore,
      homeCasualties: f.homeCasualties,
      awayCasualties: f.awayCasualties,
      homePoints: f.homePoints,
      awayPoints: f.awayPoints,
      isFriendly: f.isFriendly,
    }));

  const decorate = (rows: ReturnType<typeof buildStandings>) =>
    rows.map((row, index) => ({
      position: index + 1,
      ...row,
      teamName: byId.get(row.teamId)?.name ?? `Team ${row.teamId}`,
      race: byId.get(row.teamId)?.race ?? '',
      coach: byId.get(row.teamId)?.coach ?? '',
    }));

  if (divisions.length === 0) {
    return [{ division: null, table: decorate(buildStandings(toStandings(fixtures), scoring)) }];
  }

  return divisions.map((division) => {
    const inDivision = fixtures.filter((f) => f.divisionId === division.id);
    // A team with no fixtures yet still belongs in its division's table.
    const seeded = (teams ?? [])
      .filter((t) => t.division_id === division.id)
      .map<StandingsFixture>((t) => ({
        homeTeamId: t.id,
        awayTeamId: null,
        divisionId: division.id,
        status: 'unplayed',
        homeScore: null,
        awayScore: null,
        homeCasualties: null,
        awayCasualties: null,
        homePoints: null,
        awayPoints: null,
        isFriendly: false,
      }));
    return {
      division,
      table: decorate(buildStandings([...toStandings(inDivision), ...seeded], scoring)),
    };
  });
}

export interface CoachRow {
  id: number;
  season_id: number;
  display_name: string;
  naf_number: number | null;
  discord_user_id: string | null;
  email: string | null;
}

export async function coachByDiscord(env: Env, seasonId: number, discordUserId: string): Promise<CoachRow | null> {
  return env.DB.prepare('SELECT * FROM coach WHERE season_id = ? AND discord_user_id = ?')
    .bind(seasonId, discordUserId)
    .first<CoachRow>();
}

/** Ruling a fixture. Any previous live ruling is retired rather than deleted. */
export async function ruleFixture(
  env: Env,
  fixtureId: number,
  kind: RulingKind,
  atFault: 'home' | 'away' | 'both' | null,
  reason: string,
  actor: string,
): Promise<FixtureView> {
  const fixture = await fixtureById(env, fixtureId);
  if (!fixture) throw new Error(`No fixture ${fixtureId}`);

  const map = await settings(env);
  const outcome = applyRuling(kind, atFault, scoringFrom(map));

  const atFaultTeamId =
    atFault === 'home' ? fixture.homeTeamId : atFault === 'away' ? fixture.awayTeamId : null;

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE ruling SET reverted_at = ?, reverted_by = ? WHERE fixture_id = ? AND reverted_at IS NULL",
    ).bind(nowIso(), actor, fixtureId),
    env.DB.prepare(
      `INSERT INTO ruling (fixture_id, kind, at_fault_team_id, home_score, away_score,
                           home_points, away_points, reason, ruled_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      fixtureId,
      kind,
      atFaultTeamId,
      outcome.homeScore,
      outcome.awayScore,
      outcome.homePoints,
      outcome.awayPoints,
      reason,
      actor,
    ),
    env.DB.prepare('UPDATE fixture SET status = ? WHERE id = ?').bind(outcome.status, fixtureId),
  ]);

  await audit(env, actor, `ruling.${kind}`, `fixture:${fixtureId}`, { atFault, reason, outcome });
  return (await fixtureById(env, fixtureId))!;
}

/** Undo a ruling, handing the fixture back to whatever TourPlay says. */
export async function revertRuling(env: Env, fixtureId: number, actor: string): Promise<FixtureView> {
  const fixture = await env.DB.prepare('SELECT tp_played FROM fixture WHERE id = ?')
    .bind(fixtureId)
    .first<{ tp_played: number }>();

  await env.DB.batch([
    env.DB.prepare(
      'UPDATE ruling SET reverted_at = ?, reverted_by = ? WHERE fixture_id = ? AND reverted_at IS NULL',
    ).bind(nowIso(), actor, fixtureId),
    env.DB.prepare('UPDATE fixture SET status = ? WHERE id = ?').bind(
      fixture?.tp_played ? 'played' : 'unplayed',
      fixtureId,
    ),
  ]);

  await audit(env, actor, 'ruling.revert', `fixture:${fixtureId}`);
  return (await fixtureById(env, fixtureId))!;
}

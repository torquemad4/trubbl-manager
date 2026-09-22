// TRUBBL's own rules: when a window is open, what an unplayed game is worth,
// and how the table is built. Pure functions with no I/O, so they are covered
// by test/rules.test.ts rather than only by being run in anger on a Sunday night.
//
// Scoring follows Season VI §2.4 and the unplayed-game procedure in §3.2.

import type { FixtureStatus, RulingKind } from './types.js';

export interface Scoring {
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;

  // §2.4 bonus points. A game is worth up to 6, not 3. A threshold of 0
  // switches that bonus off.
  bonusTouchdownThreshold: number; // 3+ TDs scored
  bonusTouchdownPoints: number;
  bonusShutoutPoints: number; // no TDs conceded
  bonusCasualtyThreshold: number; // 3+ casualties caused
  bonusCasualtyPoints: number;

  // §3.2(a): the coach who tried to organise takes it 2-0.
  concessionScoreWinner: number;
  concessionScoreLoser: number;
  // §3.2(b): both tried in good faith, no agreement reached.
  noAgreementScore: number;
}

export const DEFAULT_SCORING: Scoring = {
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  bonusTouchdownThreshold: 3,
  bonusTouchdownPoints: 1,
  bonusShutoutPoints: 1,
  bonusCasualtyThreshold: 3,
  bonusCasualtyPoints: 1,
  concessionScoreWinner: 2,
  concessionScoreLoser: 0,
  noAgreementScore: 1,
};

// ---------------------------------------------------------------- windows ---

export type WindowState = 'not_open' | 'open' | 'closing_soon' | 'overdue' | 'closed';

export interface WindowView {
  state: WindowState;
  daysRemaining: number | null;
  /** The deadline that actually applies, after any granted extension. */
  effectiveClose: string | null;
  extended: boolean;
}

const DAY_MS = 86_400_000;

/**
 * Whole days between two instants, rounded towards zero from the later one, so
 * "1 day remaining" means there is at least a day left rather than any part of one.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function windowState(
  now: Date,
  opensAt: string | null,
  closesAt: string | null,
  extendedTo: string | null,
  closingSoonDays = 3,
): WindowView {
  const effective = extendedTo ?? closesAt;
  const extended = Boolean(extendedTo && closesAt && Date.parse(extendedTo) > Date.parse(closesAt));

  if (!opensAt && !effective) {
    return { state: 'not_open', daysRemaining: null, effectiveClose: effective, extended };
  }
  if (opensAt && now.getTime() < Date.parse(opensAt)) {
    return { state: 'not_open', daysRemaining: null, effectiveClose: effective, extended };
  }
  if (!effective) {
    return { state: 'open', daysRemaining: null, effectiveClose: null, extended };
  }

  const remaining = daysBetween(now, new Date(Date.parse(effective)));
  if (remaining < 0) {
    return { state: 'overdue', daysRemaining: remaining, effectiveClose: effective, extended };
  }
  return {
    state: remaining <= closingSoonDays ? 'closing_soon' : 'open',
    daysRemaining: remaining,
    effectiveClose: effective,
    extended,
  };
}

/** A fixture still needing action from its coaches. */
export function isOutstanding(status: FixtureStatus): boolean {
  return status === 'unplayed' || status === 'scheduled';
}

/** Which nag thresholds have been crossed, given when the window closes. */
export function dueNags(daysRemaining: number | null, thresholds: number[]): number[] {
  if (daysRemaining === null) return [];
  return thresholds.filter((t) => t === daysRemaining).sort((a, b) => b - a);
}

export function parseNagDays(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => b - a);
}

// ---------------------------------------------------------------- rulings ---

export interface RulingOutcome {
  status: FixtureStatus;
  homeScore: number;
  awayScore: number;
  homePoints: number;
  awayPoints: number;
}

/**
 * The §3.2 procedure for a game that never got played.
 *
 *   concession     (a) one coach tried, no response  → 2-0 to the one who tried
 *   no_agreement   (b) both tried in good faith      → 1-1 draw
 *   no_attempt     (c) neither tried                 → 0-0 draw
 *
 * `forfeit` is the same award as a concession under a harsher name, and
 * `double_forfeit` is the one outcome worth nothing to either side — kept for
 * the auto-close setting and for a ruling made on its merits.
 *
 * No ruling earns §2.4 bonus points. Left to the letter of the rules a 0-0
 * draw would pay the shutout bonus to both sides, making it worth 2 points
 * each to ignore a fixture, against 0 for turning up and losing 0-1.
 */
export function applyRuling(
  kind: RulingKind,
  atFault: 'home' | 'away' | 'both' | null,
  scoring: Scoring,
): RulingOutcome {
  if (kind === 'void') {
    return { status: 'void', homeScore: 0, awayScore: 0, homePoints: 0, awayPoints: 0 };
  }
  if (kind === 'double_forfeit') {
    return { status: 'double_forfeit', homeScore: 0, awayScore: 0, homePoints: 0, awayPoints: 0 };
  }
  if (kind === 'no_agreement') {
    const score = scoring.noAgreementScore;
    return {
      status: 'no_agreement',
      homeScore: score,
      awayScore: score,
      homePoints: scoring.pointsDraw,
      awayPoints: scoring.pointsDraw,
    };
  }
  if (kind === 'no_attempt') {
    return {
      status: 'no_attempt',
      homeScore: 0,
      awayScore: 0,
      homePoints: scoring.pointsDraw,
      awayPoints: scoring.pointsDraw,
    };
  }

  // concession and forfeit both need a side at fault.
  if (atFault === 'both' || atFault === null) {
    throw new Error(`a ${kind} needs one side at fault`);
  }
  const status: FixtureStatus = kind === 'forfeit' ? 'forfeit' : 'concession';
  const win = scoring.concessionScoreWinner;
  const lose = scoring.concessionScoreLoser;

  return atFault === 'home'
    ? { status, homeScore: lose, awayScore: win, homePoints: scoring.pointsLoss, awayPoints: scoring.pointsWin }
    : { status, homeScore: win, awayScore: lose, homePoints: scoring.pointsWin, awayPoints: scoring.pointsLoss };
}

// -------------------------------------------------------------- standings ---

export interface StandingsFixture {
  homeTeamId: number | null;
  awayTeamId: number | null;
  divisionId: number | null;
  status: FixtureStatus;
  homeScore: number | null;
  awayScore: number | null;
  homeCasualties: number | null;
  awayCasualties: number | null;
  /** Set only by a ruling; when null the points come from the scoring table. */
  homePoints: number | null;
  awayPoints: number | null;
  /** §3.3.2 inter-divisional friendlies score nothing. */
  isFriendly: boolean;
}

export interface StandingsRow {
  teamId: number;
  divisionId: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  touchdownsFor: number;
  touchdownsAgainst: number;
  netTouchdowns: number;
  casualtiesFor: number;
  casualtiesAgainst: number;
  netCasualties: number;
  bonusPoints: number;
  concessionsGiven: number;
  points: number;
}

/** A fixture that counts towards the league table at all. */
function counts(fixture: StandingsFixture): boolean {
  return (
    !fixture.isFriendly &&
    fixture.homeTeamId !== null &&
    fixture.awayTeamId !== null &&
    fixture.status !== 'void' &&
    !isOutstanding(fixture.status)
  );
}

/** §2.4 bonuses, earned only by a game that was actually played. */
export function bonusFor(
  scored: number,
  conceded: number,
  casualties: number,
  scoring: Scoring,
): number {
  let bonus = 0;
  if (scoring.bonusTouchdownThreshold > 0 && scored >= scoring.bonusTouchdownThreshold) {
    bonus += scoring.bonusTouchdownPoints;
  }
  if (conceded === 0) bonus += scoring.bonusShutoutPoints;
  if (scoring.bonusCasualtyThreshold > 0 && casualties >= scoring.bonusCasualtyThreshold) {
    bonus += scoring.bonusCasualtyPoints;
  }
  return bonus;
}

function basePoints(scoreFor: number, scoreAgainst: number, scoring: Scoring): number {
  if (scoreFor > scoreAgainst) return scoring.pointsWin;
  if (scoreFor < scoreAgainst) return scoring.pointsLoss;
  return scoring.pointsDraw;
}

/**
 * The table, per division. §2.4 tiebreakers are head-to-head, then net TD,
 * then net CAS, then net TD + net CAS.
 */
export function buildStandings(fixtures: StandingsFixture[], scoring: Scoring): StandingsRow[] {
  const rows = new Map<number, StandingsRow>();

  const row = (teamId: number, divisionId: number | null): StandingsRow => {
    let existing = rows.get(teamId);
    if (!existing) {
      existing = {
        teamId,
        divisionId,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        touchdownsFor: 0,
        touchdownsAgainst: 0,
        netTouchdowns: 0,
        casualtiesFor: 0,
        casualtiesAgainst: 0,
        netCasualties: 0,
        bonusPoints: 0,
        concessionsGiven: 0,
        points: 0,
      };
      rows.set(teamId, existing);
    }
    if (existing.divisionId === null && divisionId !== null) existing.divisionId = divisionId;
    return existing;
  };

  for (const fixture of fixtures) {
    // Seed both teams so a team that has played nothing still appears.
    if (fixture.homeTeamId !== null) row(fixture.homeTeamId, fixture.divisionId);
    if (fixture.awayTeamId !== null) row(fixture.awayTeamId, fixture.divisionId);
    if (!counts(fixture)) continue;

    const home = row(fixture.homeTeamId!, fixture.divisionId);
    const away = row(fixture.awayTeamId!, fixture.divisionId);
    const homeScore = fixture.homeScore ?? 0;
    const awayScore = fixture.awayScore ?? 0;
    const homeCas = fixture.homeCasualties ?? 0;
    const awayCas = fixture.awayCasualties ?? 0;
    const ruled = fixture.homePoints !== null || fixture.awayPoints !== null;

    home.played += 1;
    away.played += 1;
    home.touchdownsFor += homeScore;
    home.touchdownsAgainst += awayScore;
    away.touchdownsFor += awayScore;
    away.touchdownsAgainst += homeScore;
    home.casualtiesFor += homeCas;
    home.casualtiesAgainst += awayCas;
    away.casualtiesFor += awayCas;
    away.casualtiesAgainst += homeCas;

    if (fixture.status === 'double_forfeit') {
      home.concessionsGiven += 1;
      away.concessionsGiven += 1;
      home.lost += 1;
      away.lost += 1;
    } else {
      if (fixture.status === 'forfeit' || fixture.status === 'concession') {
        if (homeScore > awayScore) away.concessionsGiven += 1;
        else home.concessionsGiven += 1;
      }
      if (homeScore > awayScore) {
        home.won += 1;
        away.lost += 1;
      } else if (awayScore > homeScore) {
        away.won += 1;
        home.lost += 1;
      } else {
        home.drawn += 1;
        away.drawn += 1;
      }
    }

    home.points += fixture.homePoints ?? basePoints(homeScore, awayScore, scoring);
    away.points += fixture.awayPoints ?? basePoints(awayScore, homeScore, scoring);

    // A ruled game is worth its base points only — never a §2.4 bonus.
    if (!ruled) {
      const homeBonus = bonusFor(homeScore, awayScore, homeCas, scoring);
      const awayBonus = bonusFor(awayScore, homeScore, awayCas, scoring);
      home.bonusPoints += homeBonus;
      away.bonusPoints += awayBonus;
      home.points += homeBonus;
      away.points += awayBonus;
    }
  }

  for (const entry of rows.values()) {
    entry.netTouchdowns = entry.touchdownsFor - entry.touchdownsAgainst;
    entry.netCasualties = entry.casualtiesFor - entry.casualtiesAgainst;
  }

  return orderTable([...rows.values()], fixtures);
}

/**
 * Points first, then the §2.4 tiebreakers. Head-to-head is not a total order,
 * so it is applied within each group of teams level on points: a mini-league of
 * the games those teams played against each other decides between them, and
 * anything still level falls through to net TD, net CAS, then their sum.
 */
function orderTable(rows: StandingsRow[], fixtures: StandingsFixture[]): StandingsRow[] {
  const byPoints = [...rows].sort((a, b) => b.points - a.points || a.teamId - b.teamId);
  const ordered: StandingsRow[] = [];

  for (let i = 0; i < byPoints.length; ) {
    let j = i;
    while (j < byPoints.length && byPoints[j]!.points === byPoints[i]!.points) j += 1;
    const group = byPoints.slice(i, j);

    if (group.length === 1) {
      ordered.push(group[0]!);
    } else {
      const h2h = headToHeadPoints(group, fixtures);
      group.sort(
        (a, b) =>
          (h2h.get(b.teamId) ?? 0) - (h2h.get(a.teamId) ?? 0) ||
          b.netTouchdowns - a.netTouchdowns ||
          b.netCasualties - a.netCasualties ||
          b.netTouchdowns + b.netCasualties - (a.netTouchdowns + a.netCasualties) ||
          a.teamId - b.teamId,
      );
      ordered.push(...group);
    }
    i = j;
  }
  return ordered;
}

/** Wins count 2 and draws 1 in the mini-league, so it needs no scoring config. */
function headToHeadPoints(group: StandingsRow[], fixtures: StandingsFixture[]): Map<number, number> {
  const ids = new Set(group.map((r) => r.teamId));
  const points = new Map<number, number>();
  for (const id of ids) points.set(id, 0);

  for (const fixture of fixtures) {
    if (!counts(fixture)) continue;
    if (!ids.has(fixture.homeTeamId!) || !ids.has(fixture.awayTeamId!)) continue;

    const homeScore = fixture.homeScore ?? 0;
    const awayScore = fixture.awayScore ?? 0;
    if (homeScore > awayScore) points.set(fixture.homeTeamId!, (points.get(fixture.homeTeamId!) ?? 0) + 2);
    else if (awayScore > homeScore) points.set(fixture.awayTeamId!, (points.get(fixture.awayTeamId!) ?? 0) + 2);
    else {
      points.set(fixture.homeTeamId!, (points.get(fixture.homeTeamId!) ?? 0) + 1);
      points.set(fixture.awayTeamId!, (points.get(fixture.awayTeamId!) ?? 0) + 1);
    }
  }
  return points;
}

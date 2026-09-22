// The league's own rules: when a window is open, what a forfeit is worth, and
// how the table is built. Pure functions with no I/O, so they are covered by
// test/rules.test.ts rather than only by being run in anger on a Sunday night.

import type { FixtureStatus, RulingKind } from './types.js';

export interface Scoring {
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  forfeitScoreWinner: number;
  forfeitScoreLoser: number;
  forfeitPointsWinner: number;
  forfeitPointsLoser: number;
  doubleForfeitPoints: number;
}

export const DEFAULT_SCORING: Scoring = {
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  forfeitScoreWinner: 2,
  forfeitScoreLoser: 0,
  forfeitPointsWinner: 3,
  forfeitPointsLoser: 0,
  doubleForfeitPoints: 0,
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
 * What a ruling awards. `atFault` is the side that failed to play — for a
 * concession it is the side that conceded, so both kinds resolve the same way.
 */
export function applyRuling(
  kind: RulingKind,
  atFault: 'home' | 'away' | 'both' | null,
  scoring: Scoring,
): RulingOutcome {
  if (kind === 'void') {
    return { status: 'void', homeScore: 0, awayScore: 0, homePoints: 0, awayPoints: 0 };
  }
  if (kind === 'double_forfeit' || atFault === 'both') {
    return {
      status: 'double_forfeit',
      homeScore: 0,
      awayScore: 0,
      homePoints: scoring.doubleForfeitPoints,
      awayPoints: scoring.doubleForfeitPoints,
    };
  }
  if (atFault === null) {
    throw new Error(`a ${kind} needs a side at fault`);
  }

  const status: FixtureStatus = kind === 'concession' ? 'concession' : 'forfeit';
  const winnerScore = scoring.forfeitScoreWinner;
  const loserScore = scoring.forfeitScoreLoser;
  const winnerPoints = scoring.forfeitPointsWinner;
  const loserPoints = scoring.forfeitPointsLoser;

  return atFault === 'home'
    ? { status, homeScore: loserScore, awayScore: winnerScore, homePoints: loserPoints, awayPoints: winnerPoints }
    : { status, homeScore: winnerScore, awayScore: loserScore, homePoints: winnerPoints, awayPoints: loserPoints };
}

// -------------------------------------------------------------- standings ---

export interface StandingsFixture {
  homeTeamId: number | null;
  awayTeamId: number | null;
  status: FixtureStatus;
  homeScore: number | null;
  awayScore: number | null;
  /** Set only by a ruling; when null the points come from the scoring table. */
  homePoints: number | null;
  awayPoints: number | null;
}

export interface StandingsRow {
  teamId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  touchdownsFor: number;
  touchdownsAgainst: number;
  touchdownDifference: number;
  forfeitsGiven: number;
  forfeitsReceived: number;
  points: number;
}

/**
 * The table. A void fixture counts for nothing on either side; a forfeit counts
 * as a played game for the team that turned up and as a forfeit given against
 * the one that did not, which is what makes repeat offenders visible.
 */
export function buildStandings(fixtures: StandingsFixture[], scoring: Scoring): StandingsRow[] {
  const rows = new Map<number, StandingsRow>();

  const row = (teamId: number): StandingsRow => {
    let existing = rows.get(teamId);
    if (!existing) {
      existing = {
        teamId,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        touchdownsFor: 0,
        touchdownsAgainst: 0,
        touchdownDifference: 0,
        forfeitsGiven: 0,
        forfeitsReceived: 0,
        points: 0,
      };
      rows.set(teamId, existing);
    }
    return existing;
  };

  for (const fixture of fixtures) {
    if (fixture.homeTeamId === null || fixture.awayTeamId === null) continue;
    if (fixture.status === 'void' || isOutstanding(fixture.status)) {
      // Still seed both teams so a team that has played nothing appears in the table.
      row(fixture.homeTeamId);
      row(fixture.awayTeamId);
      continue;
    }

    const home = row(fixture.homeTeamId);
    const away = row(fixture.awayTeamId);
    const homeScore = fixture.homeScore ?? 0;
    const awayScore = fixture.awayScore ?? 0;

    home.played += 1;
    away.played += 1;
    home.touchdownsFor += homeScore;
    home.touchdownsAgainst += awayScore;
    away.touchdownsFor += awayScore;
    away.touchdownsAgainst += homeScore;

    if (fixture.status === 'double_forfeit') {
      home.forfeitsGiven += 1;
      away.forfeitsGiven += 1;
      home.lost += 1;
      away.lost += 1;
    } else if (fixture.status === 'forfeit' || fixture.status === 'concession') {
      if (homeScore > awayScore) {
        home.won += 1;
        away.lost += 1;
        home.forfeitsReceived += 1;
        away.forfeitsGiven += 1;
      } else {
        away.won += 1;
        home.lost += 1;
        away.forfeitsReceived += 1;
        home.forfeitsGiven += 1;
      }
    } else if (homeScore > awayScore) {
      home.won += 1;
      away.lost += 1;
    } else if (awayScore > homeScore) {
      away.won += 1;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
    }

    home.points += fixture.homePoints ?? defaultPoints(homeScore, awayScore, scoring);
    away.points += fixture.awayPoints ?? defaultPoints(awayScore, homeScore, scoring);
  }

  for (const entry of rows.values()) {
    entry.touchdownDifference = entry.touchdownsFor - entry.touchdownsAgainst;
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.touchdownDifference - a.touchdownDifference ||
      b.touchdownsFor - a.touchdownsFor ||
      a.forfeitsGiven - b.forfeitsGiven ||
      a.teamId - b.teamId,
  );
}

function defaultPoints(scoreFor: number, scoreAgainst: number, scoring: Scoring): number {
  if (scoreFor > scoreAgainst) return scoring.pointsWin;
  if (scoreFor < scoreAgainst) return scoring.pointsLoss;
  return scoring.pointsDraw;
}

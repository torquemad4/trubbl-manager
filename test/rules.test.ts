import { describe, expect, it } from 'vitest';
import {
  applyRuling,
  buildStandings,
  DEFAULT_SCORING,
  daysBetween,
  dueNags,
  parseNagDays,
  windowState,
  type StandingsFixture,
} from '../src/rules.js';

const at = (iso: string) => new Date(iso);

describe('window state', () => {
  it('is not open before the opening date', () => {
    const view = windowState(at('2026-10-01T12:00:00Z'), '2026-10-05T00:00:00Z', '2026-10-26T21:00:00Z', null);
    expect(view.state).toBe('not_open');
  });

  it('is open well inside the window', () => {
    const view = windowState(at('2026-10-06T12:00:00Z'), '2026-10-05T00:00:00Z', '2026-10-26T21:00:00Z', null);
    expect(view.state).toBe('open');
    expect(view.daysRemaining).toBe(20);
  });

  it('flags closing soon inside the threshold', () => {
    const view = windowState(at('2026-10-24T12:00:00Z'), '2026-10-05T00:00:00Z', '2026-10-26T21:00:00Z', null, 3);
    expect(view.state).toBe('closing_soon');
    expect(view.daysRemaining).toBe(2);
  });

  it('goes overdue once the deadline passes', () => {
    const view = windowState(at('2026-10-28T12:00:00Z'), '2026-10-05T00:00:00Z', '2026-10-26T21:00:00Z', null);
    expect(view.state).toBe('overdue');
    expect(view.daysRemaining).toBeLessThan(0);
  });

  it('respects a granted extension over the round deadline', () => {
    const view = windowState(
      at('2026-10-28T12:00:00Z'),
      '2026-10-05T00:00:00Z',
      '2026-10-26T21:00:00Z',
      '2026-11-02T21:00:00Z',
    );
    expect(view.state).toBe('open');
    expect(view.extended).toBe(true);
    expect(view.effectiveClose).toBe('2026-11-02T21:00:00Z');
  });

  it('counts only whole days remaining', () => {
    expect(daysBetween(at('2026-10-01T23:00:00Z'), at('2026-10-03T01:00:00Z'))).toBe(1);
  });
});

describe('nags', () => {
  it('parses and orders the configured days', () => {
    expect(parseNagDays('1, 7,3')).toEqual([7, 3, 1]);
  });
  it('fires only on an exact threshold, so a missed day does not double up later', () => {
    expect(dueNags(3, [7, 3, 1])).toEqual([3]);
    expect(dueNags(2, [7, 3, 1])).toEqual([]);
    expect(dueNags(null, [7, 3, 1])).toEqual([]);
  });
});

describe('rulings', () => {
  it('awards the game against the side at fault', () => {
    const outcome = applyRuling('forfeit', 'home', DEFAULT_SCORING);
    expect(outcome).toEqual({ status: 'forfeit', homeScore: 0, awayScore: 2, homePoints: 0, awayPoints: 3 });
  });

  it('treats a concession the same way but keeps the label', () => {
    expect(applyRuling('concession', 'away', DEFAULT_SCORING).status).toBe('concession');
    expect(applyRuling('concession', 'away', DEFAULT_SCORING).homeScore).toBe(2);
  });

  it('gives a double forfeit nothing to either side', () => {
    const outcome = applyRuling('double_forfeit', 'both', DEFAULT_SCORING);
    expect(outcome.homePoints).toBe(0);
    expect(outcome.awayPoints).toBe(0);
    expect(outcome.homeScore).toBe(0);
  });

  it('voids a game to no score and no points', () => {
    expect(applyRuling('void', null, DEFAULT_SCORING).status).toBe('void');
  });

  it('refuses a one-sided forfeit with nobody at fault', () => {
    expect(() => applyRuling('forfeit', null, DEFAULT_SCORING)).toThrow();
  });

  it('honours a custom forfeit score', () => {
    const scoring = { ...DEFAULT_SCORING, forfeitScoreWinner: 1, forfeitPointsWinner: 2 };
    const outcome = applyRuling('forfeit', 'away', scoring);
    expect(outcome.homeScore).toBe(1);
    expect(outcome.homePoints).toBe(2);
  });
});

describe('standings', () => {
  const fixture = (over: Partial<StandingsFixture>): StandingsFixture => ({
    homeTeamId: 1,
    awayTeamId: 2,
    status: 'played',
    homeScore: 0,
    awayScore: 0,
    homePoints: null,
    awayPoints: null,
    ...over,
  });

  it('scores wins, draws and losses from the scoring table', () => {
    const rows = buildStandings(
      [
        fixture({ homeScore: 2, awayScore: 1 }),
        fixture({ homeTeamId: 2, awayTeamId: 3, homeScore: 1, awayScore: 1 }),
      ],
      DEFAULT_SCORING,
    );
    const byId = new Map(rows.map((r) => [r.teamId, r]));
    expect(byId.get(1)!.points).toBe(3);
    expect(byId.get(2)!.points).toBe(1);
    expect(byId.get(3)!.points).toBe(1);
  });

  it('counts a forfeit as played, and against the team that gave it', () => {
    const rows = buildStandings(
      [fixture({ status: 'forfeit', homeScore: 0, awayScore: 2, homePoints: 0, awayPoints: 3 })],
      DEFAULT_SCORING,
    );
    const byId = new Map(rows.map((r) => [r.teamId, r]));
    expect(byId.get(1)!.forfeitsGiven).toBe(1);
    expect(byId.get(2)!.forfeitsReceived).toBe(1);
    expect(byId.get(2)!.won).toBe(1);
    expect(byId.get(1)!.played).toBe(1);
  });

  it('charges a double forfeit to both sides', () => {
    const rows = buildStandings(
      [fixture({ status: 'double_forfeit', homePoints: 0, awayPoints: 0 })],
      DEFAULT_SCORING,
    );
    for (const row of rows) {
      expect(row.forfeitsGiven).toBe(1);
      expect(row.lost).toBe(1);
      expect(row.points).toBe(0);
    }
  });

  it('ignores a void game entirely but still lists both teams', () => {
    const rows = buildStandings([fixture({ status: 'void' })], DEFAULT_SCORING);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });

  it('does not count an unplayed game', () => {
    const rows = buildStandings([fixture({ status: 'unplayed', homeScore: null, awayScore: null })], DEFAULT_SCORING);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });

  it('breaks ties on touchdown difference, then touchdowns scored', () => {
    const rows = buildStandings(
      [
        fixture({ homeTeamId: 1, awayTeamId: 4, homeScore: 3, awayScore: 0 }),
        fixture({ homeTeamId: 2, awayTeamId: 5, homeScore: 1, awayScore: 0 }),
      ],
      DEFAULT_SCORING,
    );
    expect(rows[0]!.teamId).toBe(1);
    expect(rows[1]!.teamId).toBe(2);
  });

  it('prefers the ruled points over the scoring table when a ruling set them', () => {
    const rows = buildStandings(
      [fixture({ status: 'forfeit', homeScore: 0, awayScore: 2, homePoints: -1, awayPoints: 5 })],
      DEFAULT_SCORING,
    );
    const byId = new Map(rows.map((r) => [r.teamId, r]));
    expect(byId.get(1)!.points).toBe(-1);
    expect(byId.get(2)!.points).toBe(5);
  });

  it('skips a fixture with a side not yet drawn', () => {
    expect(buildStandings([fixture({ awayTeamId: null })], DEFAULT_SCORING)).toHaveLength(0);
  });
});

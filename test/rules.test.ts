import { describe, expect, it } from 'vitest';
import {
  applyRuling,
  bonusFor,
  buildStandings,
  DEFAULT_SCORING,
  daysBetween,
  dueNags,
  parseNagDays,
  windowState,
  type StandingsFixture,
} from '../src/rules.js';

const at = (iso: string) => new Date(iso);

describe('round windows (§3.2)', () => {
  it('is not open before the opening date', () => {
    expect(windowState(at('2026-10-01T12:00:00Z'), '2026-10-05T00:00:00Z', '2026-10-19T21:00:00Z', null).state)
      .toBe('not_open');
  });

  it('is open well inside the fortnight', () => {
    const view = windowState(at('2026-10-06T12:00:00Z'), '2026-10-05T00:00:00Z', '2026-10-19T21:00:00Z', null);
    expect(view.state).toBe('open');
    expect(view.daysRemaining).toBe(13);
  });

  it('flags closing soon inside the threshold', () => {
    const view = windowState(at('2026-10-17T12:00:00Z'), '2026-10-05T00:00:00Z', '2026-10-19T21:00:00Z', null, 3);
    expect(view.state).toBe('closing_soon');
    expect(view.daysRemaining).toBe(2);
  });

  it('goes overdue once the deadline passes', () => {
    expect(windowState(at('2026-10-21T12:00:00Z'), '2026-10-05T00:00:00Z', '2026-10-19T21:00:00Z', null).state)
      .toBe('overdue');
  });

  it('respects a granted extension over the round deadline', () => {
    const view = windowState(
      at('2026-10-21T12:00:00Z'),
      '2026-10-05T00:00:00Z',
      '2026-10-19T21:00:00Z',
      '2026-10-26T21:00:00Z',
    );
    expect(view.state).toBe('open');
    expect(view.extended).toBe(true);
  });

  it('counts only whole days remaining', () => {
    expect(daysBetween(at('2026-10-01T23:00:00Z'), at('2026-10-03T01:00:00Z'))).toBe(1);
  });
});

describe('chasing', () => {
  it('parses and orders the configured days', () => {
    expect(parseNagDays('1, 7,3')).toEqual([7, 3, 1]);
  });
  it('fires only on an exact threshold, so a missed day does not double up later', () => {
    expect(dueNags(3, [7, 3, 1])).toEqual([3]);
    expect(dueNags(2, [7, 3, 1])).toEqual([]);
  });
});

describe('§2.4 bonus points', () => {
  it('pays a point for three or more touchdowns', () => {
    expect(bonusFor(3, 1, 0, DEFAULT_SCORING)).toBe(1);
    expect(bonusFor(2, 1, 0, DEFAULT_SCORING)).toBe(0);
  });
  it('pays a point for conceding none', () => {
    expect(bonusFor(1, 0, 0, DEFAULT_SCORING)).toBe(1);
  });
  it('pays a point for three or more casualties', () => {
    expect(bonusFor(1, 1, 3, DEFAULT_SCORING)).toBe(1);
    expect(bonusFor(1, 1, 2, DEFAULT_SCORING)).toBe(0);
  });
  it('stacks all three, so a game is worth up to six points', () => {
    expect(bonusFor(3, 0, 3, DEFAULT_SCORING)).toBe(3);
    expect(DEFAULT_SCORING.pointsWin + bonusFor(3, 0, 3, DEFAULT_SCORING)).toBe(6);
  });
  it('switches a bonus off at a threshold of zero', () => {
    const scoring = { ...DEFAULT_SCORING, bonusCasualtyThreshold: 0 };
    expect(bonusFor(1, 1, 9, scoring)).toBe(0);
  });
});

describe('§3.2 unplayed-game procedure', () => {
  it('(a) awards 2-0 to the coach who tried to organise', () => {
    expect(applyRuling('concession', 'away', DEFAULT_SCORING)).toEqual({
      status: 'concession',
      homeScore: 2,
      awayScore: 0,
      homePoints: 3,
      awayPoints: 0,
    });
  });

  it('(b) is a 1-1 draw when both tried in good faith', () => {
    expect(applyRuling('no_agreement', null, DEFAULT_SCORING)).toEqual({
      status: 'no_agreement',
      homeScore: 1,
      awayScore: 1,
      homePoints: 1,
      awayPoints: 1,
    });
  });

  it('(c) is a 0-0 draw when neither tried', () => {
    expect(applyRuling('no_attempt', null, DEFAULT_SCORING)).toEqual({
      status: 'no_attempt',
      homeScore: 0,
      awayScore: 0,
      homePoints: 1,
      awayPoints: 1,
    });
  });

  it('refuses a concession with nobody named at fault', () => {
    expect(() => applyRuling('concession', null, DEFAULT_SCORING)).toThrow();
    expect(() => applyRuling('concession', 'both', DEFAULT_SCORING)).toThrow();
  });

  it('keeps double forfeit worth nothing to either side', () => {
    const outcome = applyRuling('double_forfeit', 'both', DEFAULT_SCORING);
    expect(outcome.homePoints).toBe(0);
    expect(outcome.awayPoints).toBe(0);
  });
});

describe('standings', () => {
  const fixture = (over: Partial<StandingsFixture>): StandingsFixture => ({
    homeTeamId: 1,
    awayTeamId: 2,
    divisionId: 1,
    status: 'played',
    homeScore: 0,
    awayScore: 0,
    homeCasualties: 0,
    awayCasualties: 0,
    homePoints: null,
    awayPoints: null,
    isFriendly: false,
    ...over,
  });

  const byId = (rows: ReturnType<typeof buildStandings>) => new Map(rows.map((r) => [r.teamId, r]));

  it('adds bonus points to the base result', () => {
    // 3-0 win with 3 casualties: 3 + 1 (TDs) + 1 (shutout) + 1 (CAS) = 6.
    const rows = byId(
      buildStandings([fixture({ homeScore: 3, awayScore: 0, homeCasualties: 3 })], DEFAULT_SCORING),
    );
    expect(rows.get(1)!.points).toBe(6);
    expect(rows.get(1)!.bonusPoints).toBe(3);
    expect(rows.get(2)!.points).toBe(0);
  });

  it('pays a bonus to a losing side that earned one', () => {
    // Loses 2-3 but caused 4 casualties: 0 + 1 = 1.
    const rows = byId(
      buildStandings([fixture({ homeScore: 2, awayScore: 3, homeCasualties: 4 })], DEFAULT_SCORING),
    );
    expect(rows.get(1)!.points).toBe(1);
  });

  it('never pays a bonus on a ruled game, so ignoring a fixture cannot beat losing one', () => {
    // §3.2(c) 0-0 draw: 1 point each. Taken literally the shutout bonus would
    // make it 2 each — more than a coach gets for turning up and losing 0-1.
    const ruled = byId(
      buildStandings(
        [fixture({ status: 'no_attempt', homeScore: 0, awayScore: 0, homePoints: 1, awayPoints: 1 })],
        DEFAULT_SCORING,
      ),
    );
    expect(ruled.get(1)!.points).toBe(1);
    expect(ruled.get(1)!.bonusPoints).toBe(0);

    const played = byId(buildStandings([fixture({ homeScore: 0, awayScore: 1 })], DEFAULT_SCORING));
    expect(played.get(1)!.points).toBe(0);
    expect(ruled.get(1)!.points).toBeGreaterThan(played.get(1)!.points - 2);
  });

  it('counts a concession against the coach who did not respond', () => {
    const rows = byId(
      buildStandings(
        [fixture({ status: 'concession', homeScore: 2, awayScore: 0, homePoints: 3, awayPoints: 0 })],
        DEFAULT_SCORING,
      ),
    );
    expect(rows.get(2)!.concessionsGiven).toBe(1);
    expect(rows.get(1)!.concessionsGiven).toBe(0);
    expect(rows.get(1)!.won).toBe(1);
  });

  it('ignores an inter-divisional friendly entirely (§3.3.2)', () => {
    const rows = byId(
      buildStandings([fixture({ isFriendly: true, homeScore: 5, awayScore: 0 })], DEFAULT_SCORING),
    );
    expect(rows.get(1)!.played).toBe(0);
    expect(rows.get(1)!.points).toBe(0);
  });

  it('ignores a void game but still lists both teams', () => {
    const rows = buildStandings([fixture({ status: 'void' })], DEFAULT_SCORING);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });

  it('breaks a tie on head-to-head before net TD', () => {
    // Both finish on 3 points from one win each, but 2 beat 1 head to head,
    // while 1 has the better net touchdowns. Head-to-head must win.
    const rows = buildStandings(
      [
        fixture({ homeTeamId: 1, awayTeamId: 3, homeScore: 2, awayScore: 0 }),
        fixture({ homeTeamId: 2, awayTeamId: 4, homeScore: 1, awayScore: 0 }),
        fixture({ homeTeamId: 2, awayTeamId: 1, homeScore: 1, awayScore: 0 }),
      ],
      { ...DEFAULT_SCORING, bonusTouchdownThreshold: 0, bonusShutoutPoints: 0, bonusCasualtyThreshold: 0 },
    );
    const order = rows.map((r) => r.teamId);
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(1));
  });

  it('falls through to net casualties when head-to-head and net TD are level', () => {
    const scoring = { ...DEFAULT_SCORING, bonusTouchdownThreshold: 0, bonusShutoutPoints: 0, bonusCasualtyThreshold: 0 };
    const rows = buildStandings(
      [
        fixture({ homeTeamId: 1, awayTeamId: 3, homeScore: 1, awayScore: 0, homeCasualties: 1 }),
        fixture({ homeTeamId: 2, awayTeamId: 4, homeScore: 1, awayScore: 0, homeCasualties: 4 }),
      ],
      scoring,
    );
    const order = rows.map((r) => r.teamId);
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(1));
  });

  it('tracks net casualties in both directions', () => {
    const rows = byId(
      buildStandings([fixture({ homeCasualties: 3, awayCasualties: 1, homeScore: 1, awayScore: 1 })], DEFAULT_SCORING),
    );
    expect(rows.get(1)!.netCasualties).toBe(2);
    expect(rows.get(2)!.netCasualties).toBe(-2);
  });

  it('skips a fixture with a side not yet drawn', () => {
    const rows = buildStandings([fixture({ awayTeamId: null })], DEFAULT_SCORING);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });
});

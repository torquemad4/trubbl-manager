import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FEED_BOT_ID,
  parseFeedMessage,
  parseFooter,
  parseScheduledWhen,
  parseSide,
  type FeedMessage,
} from '../src/feed.js';

const BOT = DEFAULT_FEED_BOT_ID;
const SLUG = 'trubbl-season-7';

// Shapes copied from real TourPlay posts in #league-result-input (Oct 2026).
const team = (name: string, tv: number, race: string, flag: string, coach: string) => ({
  name: `**${name}**\n\`${tv}\` ${race}\n${flag} ${coach}`,
  value: '`      0      `',
});

function post(embed: Record<string, unknown>, author = BOT): FeedMessage {
  return { id: '1', author: { id: author }, embeds: [embed as never] };
}

const endOfMatch = post({
  title: ':checkered_flag:  End of the match',
  description: 'Winner Brewtown Kegger-Boys in 2 hours and 32 minutes.',
  url: 'https://tourplay.net/en/blood-bowl/trubbl-season-7/match/734665',
  author: { name: 'TRUBBL Season 7' },
  fields: [
    { ...team('BLACK AND BLUE BRUISERS', 1000, 'Black Orc', ':flag_gb:', 'WedgieEdward'), value: '`      0      `' },
    { ...team('BREWTOWN KEGGER-BOYS', 1170, 'Human', ':flag_gb:', 'PlunderBeard'), value: '`      3      `' },
    { name: 'Total winnings', value: '` +55,000 ` ` +85,000 `' },
    { name: 'Dedicated fans', value: '` +0 ` ` +1 `' },
  ],
  footer: { text: 'Season | Regular · Second Division · Round 1' },
});

describe('reading a TourPlay end-of-match post', () => {
  it('gives the match, division, round and both scores', () => {
    const item = parseFeedMessage(endOfMatch, BOT, SLUG);
    expect(item).toMatchObject({
      kind: 'result',
      ruling: false,
      matchId: '734665',
      division: 'Second Division',
      round: 1,
      phase: 'Regular',
      home: { team: 'BLACK AND BLUE BRUISERS', coach: 'WedgieEdward', score: 0 },
      away: { team: 'BREWTOWN KEGGER-BOYS', coach: 'PlunderBeard', score: 3 },
    });
  });

  it('only trusts TourPlay’s own bot', () => {
    expect(parseFeedMessage({ ...endOfMatch, author: { id: '42' } }, BOT, SLUG)).toEqual({
      kind: 'ignored',
      reason: 'not posted by TourPlay',
    });
  });

  it('ignores another competition’s matches', () => {
    const other = post({
      ...(endOfMatch.embeds![0] as object),
      url: 'https://tourplay.net/en/blood-bowl/some-cup/match/1',
    });
    expect(parseFeedMessage(other, BOT, SLUG)).toMatchObject({ kind: 'ignored' });
  });

  it('marks an inter-divisional friendly as outside the league rounds', () => {
    const friendly = post({
      ...(endOfMatch.embeds![0] as object),
      footer: { text: 'Season | Interdivision ·  · Day 1' },
    });
    expect(parseFeedMessage(friendly, BOT, SLUG)).toMatchObject({ kind: 'result', round: null, phase: 'Interdivision' });
  });
});

describe('reading an organiser’s ruling', () => {
  it('treats "Match suspension resolved" as a result, flagged as a ruling', () => {
    const ruling = post({
      title: ':warning:  Match suspension resolved',
      description: 'Draw',
      url: 'https://tourplay.net/en/blood-bowl/trubbl-season-7/match/734680',
      fields: [
        team('PUTRID GRYPHONS', 1310, 'Nurgle', ':flag_gb:', 'Stephen Bourne'),
        team('CALIBAN CRUSADERS (TRUBBL)', 970, 'Bretonnian', ':flag_gb:', 'Captainfalcon'),
        { name: 'Total winnings', value: '` +0 ` ` +0 `' },
      ],
      footer: { text: 'Season | Regular · Second Division · Round 2' },
    });
    expect(parseFeedMessage(ruling, BOT, SLUG)).toMatchObject({
      kind: 'result',
      ruling: true,
      round: 2,
      home: { score: 0 },
      away: { score: 0 },
    });
  });
});

describe('reading a scheduled date', () => {
  it('turns the agreed date into UTC', () => {
    const scheduled = post({
      title: ':calendar_spiral:  Match scheduled',
      description: 'Wednesday, October 14, 2026 · 6:30:00 PM (UTC +1)',
      url: 'https://tourplay.net/en/blood-bowl/trubbl-season-7/match/734668',
      fields: [
        { name: '**EMO PHASE V2.026**\n`1000` Dark Elf\n:flag_gb: garvfield (Mike)', value: ':white_check_mark:' },
        { name: '**CLEVER GIRLS**\n`1000` Lizardmen\n:flag_gb: Krystian Kitka', value: ':white_check_mark:' },
      ],
      footer: { text: 'Season | Regular · Third Division · Round 1' },
    });
    expect(parseFeedMessage(scheduled, BOT, SLUG)).toMatchObject({
      kind: 'scheduled',
      when: '2026-10-14T17:30:00Z',
      matchId: '734668',
      home: { coach: 'garvfield (Mike)', score: null },
    });
  });

  it('handles morning times, single-digit days and GMT', () => {
    expect(parseScheduledWhen('Sunday, October 11, 2026 · 10:00:00 AM (UTC +1)')).toBe('2026-10-11T09:00:00Z');
    expect(parseScheduledWhen('Monday, November 2, 2026 · 12:15:00 PM (UTC +0)')).toBe('2026-11-02T12:15:00Z');
    expect(parseScheduledWhen('Monday, November 2, 2026 · 12:15:00 AM (UTC +0)')).toBe('2026-11-02T00:15:00Z');
    expect(parseScheduledWhen('Friday, March 6, 2026 · 7:00:00 PM (UTC -5)')).toBe('2026-03-07T00:00:00Z');
  });

  it('returns null rather than guessing at a format it does not know', () => {
    expect(parseScheduledWhen('next Tuesday')).toBeNull();
  });
});

describe('the pieces', () => {
  it('reads every footer shape TourPlay has used', () => {
    expect(parseFooter('Season | Regular · Premier Division · Round 7')).toEqual({
      phase: 'Regular',
      division: 'Premier Division',
      round: 7,
    });
    expect(parseFooter('Season | Main · Second Division · Matchday 3')).toMatchObject({ round: 3 });
    expect(parseFooter('Season | Interdivision ·  · Day 2')).toEqual({ phase: 'Interdivision', division: '', round: null });
    expect(parseFooter('Season | Play-Offs · A1 · Final')).toMatchObject({ round: null });
  });

  it('strips whatever flag emoji leads the coach line', () => {
    expect(parseSide(team('X', 1, 'Orc', ':england:', 'Torquemada'))?.coach).toBe('Torquemada');
    expect(parseSide(team('X', 1, 'Orc', ':pirate_flag:', 'Some Coach'))?.coach).toBe('Some Coach');
    expect(parseSide(team('X', 1, 'Orc', ':flag_ca:', 'Derek_S'))?.coach).toBe('Derek_S');
  });

  it('ignores in-match events: they never carry a final result', () => {
    const event = post({
      author: { name: 'Match Event', url: 'https://tourplay.net/en/blood-bowl/trubbl-season-7/match/734665' },
      fields: [{ name: '`#8` Ryansson *(Human Lineman)*', value: 'Casualty ` ★2 `' }],
      footer: { text: 'Brewtown Kegger-Boys' },
    });
    expect(parseFeedMessage(event, BOT, SLUG)).toMatchObject({ kind: 'ignored' });
  });
});

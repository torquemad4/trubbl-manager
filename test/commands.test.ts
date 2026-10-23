import { describe, expect, it } from 'vitest';
import { RETIRED_COMMANDS, divisionTitle, resultLine } from '../src/commands.js';

describe('divisionTitle', () => {
  it('leaves a name that already ends in Division alone', () => {
    expect(divisionTitle('Premier Division')).toBe('Premier Division');
    expect(divisionTitle('Second Division')).toBe('Second Division');
  });

  it('appends the word when it is missing', () => {
    expect(divisionTitle('Premier')).toBe('Premier Division');
  });

  it('is not fooled by a name that merely contains the word', () => {
    expect(divisionTitle('Division of Labour')).toBe('Division of Labour Division');
  });

  it('tolerates stray whitespace and case', () => {
    expect(divisionTitle('  Third DIVISION ')).toBe('Third DIVISION');
    expect(divisionTitle(' Third ')).toBe('Third Division');
  });
});


describe('the slimmed-down command set', () => {
  it('lists every command that gave answers the feed cannot support', () => {
    expect(RETIRED_COMMANDS.sort()).toEqual(['extend', 'forfeit', 'link', 'mygame', 'outstanding', 'schedule', 'table']);
  });

  it('prints a reported result home first', () => {
    expect(resultLine({ homeTeam: 'Pistachijoes', awayTeam: 'Knights of the Living Dead', homeScore: 1, awayScore: 2 })).toBe(
      '**Pistachijoes** 1–2 **Knights of the Living Dead**',
    );
  });
});

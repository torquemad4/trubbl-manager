import { describe, expect, it } from 'vitest';
import { divisionTitle } from '../src/commands.js';

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

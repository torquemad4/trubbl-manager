import { describe, expect, it } from 'vitest';
import { discordAlertText, parseDiscordAuthError } from '../src/discord.js';

const dead = { since: '2026-09-28T08:01:51Z', last: '2026-09-30T08:01:51Z', error: 'Discord 401: {"message": "401: Unauthorized"}' };

describe('the alarm when the bot stops getting through', () => {
  it('names a dead token, what it breaks, and the fix — and pings the owner', () => {
    const text = discordAlertText(dead, [], '276448913299341312');
    expect(text.startsWith('<@276448913299341312>')).toBe(true);
    expect(text).toContain('cannot post to Discord');
    expect(text).toContain('since 2026-09-28');
    expect(text).toContain('DISCORD_BOT_TOKEN');
  });

  it('does not repeat each 401 as a separate failure when the token is already reported', () => {
    const text = discordAlertText(dead, [{ kind: 'round_open', error: 'Discord 401: Unauthorized' }], null);
    expect(text).not.toContain('failed on today');
  });

  it('reports a channel permission failure on its own, with what a 403 means', () => {
    const text = discordAlertText(null, [{ kind: 'nag', error: 'Discord 403: Missing Access' }], null);
    expect(text).toContain('1 bot post failed');
    expect(text).toContain('nag: Discord 403: Missing Access');
    expect(text).toContain('View Channel or Send Messages');
    expect(text).not.toContain('<@');
  });

  it('reads a stored token error back, and ignores anything malformed', () => {
    expect(parseDiscordAuthError(JSON.stringify(dead))).toEqual(dead);
    expect(parseDiscordAuthError('')).toBeNull();
    expect(parseDiscordAuthError('not json')).toBeNull();
    expect(parseDiscordAuthError('{}')).toBeNull();
  });
});

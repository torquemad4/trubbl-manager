// The /trubbl slash commands.
//
// Since 23 Oct 2026 there is one: status. The bot's data comes from
// TourPlay's own Discord feed, which reports results and agreed dates but not
// the full draw or exact casualties, so every command that needed those — the
// table, outstanding, mygame, schedule, extend, forfeit — was retired rather
// than left to give wrong answers. link went with them: nothing used it.

import { activeSeason } from './db.js';
import { EPHEMERAL, ResponseType } from './discord.js';
import { currentRound, fixturesForRound, roundWindow, type FixtureView } from './league.js';
import type { Env } from './types.js';

interface InteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: InteractionOption[];
}

export interface Interaction {
  type: number;
  data?: { name: string; options?: InteractionOption[] };
  member?: { user?: { id: string; username?: string }; roles?: string[] };
  user?: { id: string; username?: string };
  guild_id?: string;
  channel_id?: string;
}

/** Subcommands that existed before 23 Oct 2026, so a stale Discord menu gets a straight answer. */
export const RETIRED_COMMANDS = ['table', 'outstanding', 'mygame', 'link', 'schedule', 'extend', 'forfeit'];

/** How old the last good read of TourPlay's feed can be before the bot says so. */
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

function replyJson(content: string, ephemeral = true) {
  return {
    type: ResponseType.Reply,
    data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } },
  };
}

function shortDate(iso: string | null): string {
  if (!iso) return 'no date';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
  });
}

/**
 * Divisions arrive from TourPlay already called "Premier Division", but one
 * added by hand may just be called "Premier". Append the word only if it is
 * missing, rather than producing "Premier Division Division".
 */
export function divisionTitle(name: string): string {
  return /\bdivisions?$/i.test(name.trim()) ? name.trim() : `${name.trim()} Division`;
}

/** One reported result, as the status reply lists it. */
export function resultLine(fixture: Pick<FixtureView, 'homeTeam' | 'awayTeam' | 'homeScore' | 'awayScore'>): string {
  return `**${fixture.homeTeam}** ${fixture.homeScore}–${fixture.awayScore} **${fixture.awayTeam}**`;
}

/** Discord hard-rejects anything over 2000 characters, so trim by whole lines. */
function clamp(lines: string[], limit = 1900): string {
  const out: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > limit) {
      out.push(`…and ${lines.length - out.length} more`);
      break;
    }
    out.push(line);
    length += line.length + 1;
  }
  return out.join('\n');
}

export async function handleCommand(env: Env, interaction: Interaction): Promise<unknown> {
  const sub = interaction.data?.options?.[0];
  const name = sub?.name ?? 'status';

  if (RETIRED_COMMANDS.includes(name)) {
    return replyJson(
      `\`/trubbl ${name}\` has been retired. The bot can no longer read TourPlay directly, so it only reports ` +
        `what TourPlay posts in Discord. Check TourPlay for fixtures and the table.`,
    );
  }
  if (name !== 'status') return replyJson(`I do not know the subcommand \`${name}\`.`);

  const season = await activeSeason(env);
  if (!season) return replyJson('No season is active yet.');
  return statusCommand(env, season.id, season.last_synced_at, season.last_sync_error);
}

async function statusCommand(
  env: Env,
  seasonId: number,
  lastRead: string | null,
  lastError: string | null,
) {
  const round = await currentRound(env, seasonId);
  if (!round) return replyJson('That season has no rounds yet.');

  const view = await roundWindow(env, round);
  const fixtures = await fixturesForRound(env, round.id);
  const reported = fixtures.filter((f) => f.status === 'played' && f.homeScore !== null && f.awayScore !== null);

  const window =
    view.effectiveClose === null
      ? 'no deadline set'
      : view.state === 'overdue'
        ? `closed ${shortDate(view.effectiveClose)}`
        : view.state === 'not_open'
          ? `opens ${shortDate(round.opens_at)}, closes ${shortDate(view.effectiveClose)}`
          : `closes ${shortDate(view.effectiveClose)} (${view.daysRemaining} day${view.daysRemaining === 1 ? '' : 's'} left)`;

  const lines = [`**Round ${round.number}** — ${window}`];
  if (reported.length === 0) {
    lines.push('No results reported on TourPlay yet this round.');
  } else {
    lines.push(`Results reported on TourPlay (${reported.length}):`);
    lines.push(...reported.map(resultLine));
  }

  // Say plainly when the bot's knowledge is old, rather than presenting it as current.
  const stale = !lastRead || Date.now() - Date.parse(lastRead) > STALE_AFTER_MS;
  if (stale || lastError) {
    lines.push('', `_Last read TourPlay's feed ${lastRead ? shortDate(lastRead) : 'never'} — this may be out of date._`);
  }
  return replyJson(clamp(lines), false);
}

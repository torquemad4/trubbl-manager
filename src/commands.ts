// The /trubbl slash commands. Everything a coach can do here they can also do
// in the portal; the point is that they will actually do it in Discord.

import { activeSeason, audit, nowIso, settings } from './db.js';
import { EPHEMERAL, ResponseType, mention, postToChannel } from './discord.js';
import {
  coachByDiscord,
  currentRound,
  fixtureById,
  fixtureForCoach,
  fixturesForRound,
  outstanding,
  roundWindow,
  ruleFixture,
  standingsFor,
  type FixtureView,
} from './league.js';
import type { Env, RulingKind } from './types.js';

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

function replyJson(content: string, ephemeral = true) {
  return {
    type: ResponseType.Reply,
    data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: ['users'] } },
  };
}

function invoker(interaction: Interaction): { id: string; username: string } {
  const user = interaction.member?.user ?? interaction.user;
  return { id: user?.id ?? '', username: user?.username ?? 'unknown' };
}

function optionMap(options: InteractionOption[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const option of options ?? []) {
    if (option.value !== undefined) map[option.name] = String(option.value);
  }
  return map;
}

// ------------------------------------------------------------- formatting ---

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

function fixtureLine(fixture: FixtureView, withMentions = false): string {
  const home = withMentions ? mention(fixture.homeDiscordId, fixture.homeCoach) : fixture.homeCoach;
  const away = withMentions ? mention(fixture.awayDiscordId, fixture.awayCoach) : fixture.awayCoach;
  const heading = `**${fixture.homeTeam}** (${home}) v **${fixture.awayTeam}** (${away})`;

  if (fixture.rulingKind) {
    return `${heading} — ${fixture.rulingKind.replace('_', ' ')} ${fixture.homeScore}–${fixture.awayScore}`;
  }
  if (fixture.status === 'played') {
    return `${heading} — ${fixture.homeScore}–${fixture.awayScore}`;
  }
  if (fixture.scheduledFor) {
    return `${heading} — scheduled ${shortDate(fixture.scheduledFor)}`;
  }
  return `${heading} — not played`;
}

/** Discord hard-rejects anything over 2000 characters, so trim by whole lines. */
function clamp(lines: string[], limit = 1900): string {
  const out: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > limit) {
      out.push(`…and ${lines.length - out.length} more — see the portal`);
      break;
    }
    out.push(line);
    length += line.length + 1;
  }
  return out.join('\n');
}

function isAdmin(interaction: Interaction, adminRoleId: string): boolean {
  if (!adminRoleId) return false;
  return (interaction.member?.roles ?? []).includes(adminRoleId);
}

function parseWhen(raw: string): string | null {
  const trimmed = raw.trim();
  // Accept "2026-10-05" and "2026-10-05 19:00", both read as UK local time.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const [, y, m, d, hh = '19', mm = '00'] = match;
  const parsed = new Date(`${y}-${m}-${d}T${hh}:${mm}:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// --------------------------------------------------------------- dispatch ---

export async function handleCommand(env: Env, interaction: Interaction): Promise<unknown> {
  const season = await activeSeason(env);
  if (!season) return replyJson('No season is active yet. Set one up in the portal first.');

  const sub = interaction.data?.options?.[0];
  const name = sub?.name ?? 'status';
  const options = optionMap(sub?.options);
  const map = await settings(env);
  const user = invoker(interaction);

  switch (name) {
    case 'status':
      return statusCommand(env, season.id, map['league_name'] ?? 'TRUBBL');
    case 'table':
      return tableCommand(env, season.id);
    case 'outstanding':
      return outstandingCommand(env, season.id);
    case 'mygame':
      return myGameCommand(env, season.id, user.id);
    case 'link':
      return linkCommand(env, season.id, user, options['naf'] ?? '', options['name'] ?? '');
    case 'schedule':
      return scheduleCommand(env, season.id, user, options['when'] ?? '');
    case 'extend':
      return extendCommand(env, season.id, user, options['days'] ?? '', options['reason'] ?? '', map);
    case 'forfeit':
      if (!isAdmin(interaction, map['discord_admin_role_id'] ?? '')) {
        return replyJson('Only league admins can rule a forfeit.');
      }
      return forfeitCommand(env, user, options, map);
    default:
      return replyJson(`I do not know the subcommand \`${name}\`.`);
  }
}

async function statusCommand(env: Env, seasonId: number, leagueName: string) {
  const round = await currentRound(env, seasonId);
  if (!round) return replyJson('That season has no rounds yet — import the fixtures from TourPlay first.');

  const view = await roundWindow(env, round);
  const fixtures = await fixturesForRound(env, round.id);
  const left = outstanding(fixtures);

  const deadline =
    view.effectiveClose === null
      ? 'no deadline set'
      : view.state === 'overdue'
        ? `**overdue** — closed ${shortDate(view.effectiveClose)}`
        : `closes ${shortDate(view.effectiveClose)} (${view.daysRemaining} day${view.daysRemaining === 1 ? '' : 's'} left)`;

  return replyJson(
    [
      `**${leagueName} — Round ${round.number}** (${round.status})`,
      `Window: ${deadline}`,
      `Played: ${fixtures.length - left.length} of ${fixtures.length}`,
      left.length ? `Still to play: ${left.length}` : 'Every game is in. ',
    ].join('\n'),
    false,
  );
}

async function tableCommand(env: Env, seasonId: number) {
  const rows = await standingsFor(env, seasonId);
  if (rows.length === 0) return replyJson('No results yet.');

  const lines = rows.map(
    (r) =>
      `${String(r.position).padStart(2)}. ${r.teamName} — ${r.points} pts ` +
      `(${r.won}/${r.drawn}/${r.lost}, TD ${r.touchdownDifference >= 0 ? '+' : ''}${r.touchdownDifference}` +
      `${r.forfeitsGiven ? `, ${r.forfeitsGiven} forfeit${r.forfeitsGiven === 1 ? '' : 's'} given` : ''})`,
  );
  return replyJson(`**League table**\n${clamp(lines)}`, false);
}

async function outstandingCommand(env: Env, seasonId: number) {
  const round = await currentRound(env, seasonId);
  if (!round) return replyJson('No rounds yet.');
  const left = outstanding(await fixturesForRound(env, round.id));
  if (left.length === 0) return replyJson(`Round ${round.number} is complete — nothing outstanding.`, false);

  return replyJson(
    `**Round ${round.number} — still to play**\n${clamp(left.map((f) => fixtureLine(f, true)))}`,
    false,
  );
}

async function myGameCommand(env: Env, seasonId: number, discordUserId: string) {
  const coach = await coachByDiscord(env, seasonId, discordUserId);
  if (!coach) {
    return replyJson('I do not know who you are yet. Run `/trubbl link naf:<your NAF number>` first.');
  }
  const round = await currentRound(env, seasonId);
  if (!round) return replyJson('No rounds yet.');

  const fixture = await fixtureForCoach(env, round.id, coach.id);
  if (!fixture) return replyJson(`You have no fixture in round ${round.number}.`);

  const view = await roundWindow(env, round);
  const deadline = view.effectiveClose ? shortDate(view.effectiveClose) : 'no deadline set';
  return replyJson([`**Round ${round.number}**`, fixtureLine(fixture, true), `Deadline: ${deadline}`].join('\n'));
}

async function linkCommand(
  env: Env,
  seasonId: number,
  user: { id: string; username: string },
  naf: string,
  name: string,
) {
  const nafNumber = Number(naf);
  const coach = Number.isFinite(nafNumber) && nafNumber > 0
    ? await env.DB.prepare('SELECT * FROM coach WHERE season_id = ? AND naf_number = ?')
        .bind(seasonId, nafNumber)
        .first<{ id: number; display_name: string; discord_user_id: string | null }>()
    : name
      ? await env.DB.prepare(
          'SELECT * FROM coach WHERE season_id = ? AND lower(display_name) = lower(?)',
        )
          .bind(seasonId, name.trim())
          .first<{ id: number; display_name: string; discord_user_id: string | null }>()
      : null;

  if (!coach) {
    return replyJson(
      'I could not find you in this season. Give your NAF number as it appears on TourPlay, ' +
        'or your TourPlay coach name with `name:`. If you have only just registered, your entry ' +
        'may still be pending validation.',
    );
  }
  if (coach.discord_user_id && coach.discord_user_id !== user.id) {
    return replyJson(`${coach.display_name} is already linked to another Discord account. Ask an admin.`);
  }

  await env.DB.prepare(
    "UPDATE coach SET discord_user_id = ?, discord_username = ?, linked_at = ? WHERE id = ?",
  )
    .bind(user.id, user.username, nowIso(), coach.id)
    .run();
  await audit(env, `discord:${user.username}`, 'coach.link', `coach:${coach.id}`);

  return replyJson(`Linked you to **${coach.display_name}**. Try \`/trubbl mygame\`.`);
}

async function scheduleCommand(
  env: Env,
  seasonId: number,
  user: { id: string; username: string },
  when: string,
) {
  const coach = await coachByDiscord(env, seasonId, user.id);
  if (!coach) return replyJson('Link your account first with `/trubbl link`.');

  const iso = parseWhen(when);
  if (!iso) return replyJson('I could not read that date. Use `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`.');

  const round = await currentRound(env, seasonId);
  if (!round) return replyJson('No rounds yet.');
  const fixture = await fixtureForCoach(env, round.id, coach.id);
  if (!fixture) return replyJson(`You have no fixture in round ${round.number}.`);
  if (fixture.status === 'played' || fixture.rulingKind) {
    return replyJson('That game is already settled.');
  }

  await env.DB.prepare(
    "UPDATE fixture SET scheduled_for = ?, scheduled_by = ?, status = 'scheduled' WHERE id = ?",
  )
    .bind(iso, `discord:${user.username}`, fixture.id)
    .run();
  await audit(env, `discord:${user.username}`, 'fixture.schedule', `fixture:${fixture.id}`, { when: iso });

  return replyJson(
    `Noted — **${fixture.homeTeam} v ${fixture.awayTeam}** is down for ${shortDate(iso)}. ` +
      'This is a note for the league, not a TourPlay booking.',
  );
}

async function extendCommand(
  env: Env,
  seasonId: number,
  user: { id: string; username: string },
  days: string,
  reason: string,
  map: Record<string, string>,
) {
  const coach = await coachByDiscord(env, seasonId, user.id);
  if (!coach) return replyJson('Link your account first with `/trubbl link`.');

  const requested = Number(days);
  if (!Number.isFinite(requested) || requested < 1 || requested > 28) {
    return replyJson('Ask for between 1 and 28 days.');
  }

  const round = await currentRound(env, seasonId);
  if (!round) return replyJson('No rounds yet.');
  const fixture = await fixtureForCoach(env, round.id, coach.id);
  if (!fixture) return replyJson(`You have no fixture in round ${round.number}.`);

  const base = fixture.extendedTo ?? round.closes_at;
  if (!base) return replyJson('That round has no deadline set, so there is nothing to extend.');

  const extendsTo = new Date(Date.parse(base) + requested * 86_400_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');

  await env.DB.prepare(
    `INSERT INTO extension (fixture_id, extends_to, reason, requested_by_coach_id, status)
       VALUES (?, ?, ?, ?, 'requested')`,
  )
    .bind(fixture.id, extendsTo, reason, coach.id)
    .run();
  await audit(env, `discord:${user.username}`, 'extension.request', `fixture:${fixture.id}`, {
    days: requested,
    reason,
  });

  const adminChannel = map['admin_channel_id'] ?? '';
  if (adminChannel) {
    await postToChannel(
      env,
      adminChannel,
      `**Extension requested** — Round ${round.number}: ${fixture.homeTeam} v ${fixture.awayTeam}\n` +
        `${mention(user.id, coach.display_name)} asks for ${requested} day(s) to ${shortDate(extendsTo)}.\n` +
        `Reason: ${reason || '_none given_'}\nApprove or refuse it in the portal.`,
    );
  }
  return replyJson(`Asked for ${requested} day(s), to ${shortDate(extendsTo)}. An admin has to approve it.`);
}

async function forfeitCommand(
  env: Env,
  user: { id: string; username: string },
  options: Record<string, string>,
  map: Record<string, string>,
) {
  const fixtureId = Number(options['match']);
  if (!Number.isFinite(fixtureId)) return replyJson('Give the fixture id — you can see it in the portal.');

  const side = (options['side'] ?? '').toLowerCase();
  if (!['home', 'away', 'both'].includes(side)) return replyJson('`side` must be home, away or both.');

  const kind: RulingKind = side === 'both' ? 'double_forfeit' : 'forfeit';
  const fixture = await fixtureById(env, fixtureId);
  if (!fixture) return replyJson(`No fixture ${fixtureId}.`);

  const ruled = await ruleFixture(
    env,
    fixtureId,
    kind,
    side as 'home' | 'away' | 'both',
    options['reason'] ?? '',
    `discord:${user.username}`,
  );

  const announceChannel = map['announce_channel_id'] ?? '';
  if (announceChannel) {
    await postToChannel(
      env,
      announceChannel,
      `**Ruling — Round ${ruled.roundNumber}**\n${fixtureLine(ruled, true)}` +
        (ruled.rulingReason ? `\nReason: ${ruled.rulingReason}` : ''),
    );
  }
  return replyJson(`Ruled: ${fixtureLine(ruled)}`);
}

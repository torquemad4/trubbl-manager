// What runs on the cron: pull TourPlay, move windows on, and chase people.
//
// Every message goes out through announceOnce, so a cron that fires twice, or
// a retry after a half-failed run, cannot nag the league twice for the same
// thing. That matters more than it sounds: the failure mode of a chaser bot is
// that people mute it.

import { activeSeason, audit, nagDaysFrom, nowIso, settings } from './db.js';
import { announceOnce, mention } from './discord.js';
import {
  currentRound,
  divisionsFor,
  fixturesForRound,
  outstanding,
  roundsFor,
  ruleFixture,
  type DivisionRow,
  type FixtureView,
  type RoundRow,
} from './league.js';
import { windowState } from './rules.js';
import { recordSyncFailure, syncSeason } from './sync.js';
import type { Env } from './types.js';

export interface TickReport {
  synced: boolean;
  syncError: string | null;
  opened: number[];
  closed: number[];
  settled: number[];
  nagged: string[];
  autoForfeited: number;
}

const DAY_MS = 86_400_000;

/** The deadline that applies to one fixture, after any granted extension. */
function effectiveDeadline(round: RoundRow, fixture: FixtureView): string | null {
  if (!round.closes_at) return fixture.extendedTo;
  if (!fixture.extendedTo) return round.closes_at;
  return Date.parse(fixture.extendedTo) > Date.parse(round.closes_at) ? fixture.extendedTo : round.closes_at;
}

function dayStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Split a chase list by division, so Premier coaches are nagged in the Premier
 * games-setup channel rather than everyone being nagged everywhere. Anything
 * with no division falls into one bucket keyed null and goes to the league-wide
 * channel.
 */
function byDivision(fixtures: FixtureView[]): Map<number | null, FixtureView[]> {
  const groups = new Map<number | null, FixtureView[]>();
  for (const fixture of fixtures) {
    const key = fixture.divisionId ?? null;
    const list = groups.get(key);
    if (list) list.push(fixture);
    else groups.set(key, [fixture]);
  }
  return groups;
}

function channelFor(
  divisionId: number | null,
  divisions: Map<number, DivisionRow>,
  fallback: string,
): string {
  if (divisionId === null) return fallback;
  return divisions.get(divisionId)?.chase_channel_id || fallback;
}

function divisionLabel(divisionId: number | null, divisions: Map<number, DivisionRow>): string {
  if (divisionId === null) return '';
  const name = divisions.get(divisionId)?.name;
  return name ? ` — ${name}` : '';
}

function describe(fixture: FixtureView): string {
  const scheduled = fixture.scheduledFor ? ` _(booked in)_` : '';
  return `• **${fixture.homeTeam}** v **${fixture.awayTeam}** — ${mention(fixture.homeDiscordId, fixture.homeCoach)} v ${mention(fixture.awayDiscordId, fixture.awayCoach)}${scheduled}`;
}

export async function tick(env: Env, now = new Date()): Promise<TickReport> {
  const report: TickReport = {
    synced: false,
    syncError: null,
    opened: [],
    closed: [],
    settled: [],
    nagged: [],
    autoForfeited: 0,
  };

  const season = await activeSeason(env);
  if (!season) return report;

  // 1. Pull TourPlay. A failure here must not stop the window work: the
  //    deadlines are ours and still need enforcing even if TourPlay is down.
  try {
    await syncSeason(env, season, 'cron');
    report.synced = true;
  } catch (cause) {
    report.syncError = String(cause);
    await recordSyncFailure(env, season, cause);
  }

  const map = await settings(env);
  const leagueName = map['league_name'] ?? 'TRUBBL';
  const announceChannel = map['announce_channel_id'] ?? '';
  const chaseChannel = map['chase_channel_id'] || announceChannel;
  const nagDays = nagDaysFrom(map);
  const closingSoon = Number(map['closing_soon_days'] ?? 3) || 3;
  const autoForfeit = (map['auto_forfeit_on_close'] ?? 'false') === 'true';

  const divisions = new Map((await divisionsFor(env, season.id)).map((d) => [d.id, d]));

  for (const round of await roundsFor(env, season.id)) {
    // 2. Open a round whose start date has arrived.
    if (round.status === 'pending' && round.opens_at && Date.parse(round.opens_at) <= now.getTime()) {
      await env.DB.prepare("UPDATE round SET status = 'open', opened_at = ? WHERE id = ?")
        .bind(nowIso(), round.id)
        .run();
      round.status = 'open';
      report.opened.push(round.number);

      const fixtures = await fixturesForRound(env, round.id);
      await announceOnce(
        env,
        `round-open:${round.id}`,
        'round_open',
        announceChannel,
        `**${leagueName} — Round ${round.number} is open.**\n` +
          (round.closes_at ? `Get your games played by **${formatDate(round.closes_at)}**.\n` : '') +
          `${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'} to play.\n` +
          `Use \`/trubbl mygame\` to see yours.`,
      );
    }

    if (round.status !== 'open') continue;

    const fixtures = await fixturesForRound(env, round.id);
    const left = outstanding(fixtures);
    const view = windowState(now, round.opens_at, round.closes_at, null, closingSoon);

    // 3. Nag on the configured days before the deadline, one post per division.
    if (view.daysRemaining !== null && nagDays.includes(view.daysRemaining) && left.length > 0) {
      for (const [divisionId, group] of byDivision(left)) {
        const key = `nag:${round.id}:${divisionId ?? 'none'}:${view.daysRemaining}`;
        const result = await announceOnce(
          env,
          key,
          'nag',
          channelFor(divisionId, divisions, chaseChannel),
          `**Round ${round.number}${divisionLabel(divisionId, divisions)} — ` +
            `${view.daysRemaining} day${view.daysRemaining === 1 ? '' : 's'} left.**\n` +
            `${group.length} game${group.length === 1 ? '' : 's'} still to play:\n` +
            group.map(describe).join('\n'),
        );
        if (!result.skipped) {
          report.nagged.push(key);
          await markChased(env, group, view.daysRemaining <= 1 ? 'chased' : 'nudged');
        }
      }
    }

    // 4. Past the deadline: chase daily, but leave alone anyone holding a
    //    granted extension that has not itself run out.
    if (view.state === 'overdue') {
      const stillOverdue = left.filter((fixture) => {
        const deadline = effectiveDeadline(round, fixture);
        return !deadline || Date.parse(deadline) <= now.getTime();
      });

      for (const [divisionId, group] of byDivision(stillOverdue)) {
        const key = `overdue:${round.id}:${divisionId ?? 'none'}:${dayStamp(now)}`;
        const result = await announceOnce(
          env,
          key,
          'overdue',
          channelFor(divisionId, divisions, chaseChannel),
          `**Round ${round.number}${divisionLabel(divisionId, divisions)} is past its deadline.**\n` +
            `${group.length} game${group.length === 1 ? '' : 's'} outstanding:\n` +
            group.map(describe).join('\n') +
            `\n\nPlay it, or ask for an extension with \`/trubbl extend\`.`,
        );
        if (!result.skipped) {
          report.nagged.push(key);
          await markChased(env, group, 'escalated');
        }
      }

      // 5. Close the round once nothing is outstanding but extensions.
      const blocking = left.filter((fixture) => {
        const deadline = effectiveDeadline(round, fixture);
        return !deadline || Date.parse(deadline) <= now.getTime();
      });

      if (autoForfeit && blocking.length > 0) {
        // §3.2(c): the window expired with nobody having asked for more time and
        // no evidence either coach tried, which is the "no attempt" outcome — a
        // 0-0 draw. It is never (a) or (b), because deciding those needs to know
        // who actually reached out, which only the Lord Commissioner can judge.
        // Reversible in the portal once he knows more.
        for (const fixture of blocking) {
          await ruleFixture(env, fixture.id, 'no_attempt', null, 'Round window expired', 'cron');
          report.autoForfeited += 1;
        }
        await announceOnce(
          env,
          `autoforfeit:${round.id}:${dayStamp(now)}`,
          'auto_forfeit',
          announceChannel,
          `**Round ${round.number} — ${blocking.length} game${blocking.length === 1 ? '' : 's'} ruled 0-0** ` +
            `on the expiry of the window.\n` +
            blocking.map(describe).join('\n') +
            `\n\nIf that is wrong, tell an admin — it can be re-ruled.`,
        );
      }

      const remaining = autoForfeit ? 0 : blocking.length;
      if (remaining === 0) {
        await env.DB.prepare("UPDATE round SET status = 'closed', closed_at = ? WHERE id = ?")
          .bind(nowIso(), round.id)
          .run();
        report.closed.push(round.number);
        await audit(env, 'cron', 'round.close', `round:${round.id}`);
      }
    }

    // 6. A round with every game in is done, deadline or no deadline.
    if (left.length === 0 && fixtures.length > 0) {
      await env.DB.prepare("UPDATE round SET status = 'settled', settled_at = ? WHERE id = ?")
        .bind(nowIso(), round.id)
        .run();
      report.settled.push(round.number);
      await announceOnce(
        env,
        `round-settled:${round.id}`,
        'round_settled',
        announceChannel,
        `**Round ${round.number} is complete.** Every game is in. \`/trubbl table\` for the standings.`,
      );
    }
  }

  await audit(env, 'cron', 'tick', season.tourplay_slug, report);
  return report;
}

async function markChased(env: Env, fixtures: FixtureView[], state: string): Promise<void> {
  if (fixtures.length === 0) return;
  const stamp = nowIso();
  await env.DB.batch(
    fixtures.map((fixture) =>
      env.DB.prepare('UPDATE fixture SET chase_state = ?, last_chased_at = ? WHERE id = ?').bind(
        state,
        stamp,
        fixture.id,
      ),
    ),
  );
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  });
}

/**
 * Lay out a whole season's windows back to back from a start date, which is the
 * only bit of round scheduling anyone wants to do by hand once.
 */
export async function layOutWindows(
  env: Env,
  seasonId: number,
  firstOpensAt: string,
  lengthDays: number,
  actor: string,
): Promise<number> {
  const rounds = await roundsFor(env, seasonId);
  let cursor = Date.parse(firstOpensAt);
  if (Number.isNaN(cursor)) throw new Error('The start date is not a valid date');

  const statements = rounds.map((round) => {
    const opens = new Date(cursor);
    const closes = new Date(cursor + lengthDays * DAY_MS - 1);
    cursor += lengthDays * DAY_MS;
    return env.DB.prepare('UPDATE round SET opens_at = ?, closes_at = ? WHERE id = ?').bind(
      opens.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      closes.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      round.id,
    );
  });

  if (statements.length > 0) await env.DB.batch(statements);
  await audit(env, actor, 'season.layout_windows', `season:${seasonId}`, { firstOpensAt, lengthDays });
  return statements.length;
}

export { currentRound };

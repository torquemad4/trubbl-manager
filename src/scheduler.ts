// What runs on the cron: read TourPlay's Discord feed, keep the round windows
// moving, and say when a round opens.
//
// Since 23 Oct 2026 the bot no longer chases anyone. Chasing needs the full
// draw, and TourPlay's feed only reveals a fixture once it is scheduled or
// played, so any "still to play" list would be built on missing data — which
// is exactly how the bot spent a week calling played games overdue. What it
// can still do correctly is report results and keep the calendar.
//
// Every message goes out through announceOnce, so a cron that fires twice, or
// a retry after a half-failed run, cannot post the same thing twice.

import { activeSeason, audit, settings } from './db.js';
import {
  alertOwner,
  announceOnce,
  DISCORD_AUTH_SETTING,
  discordAlertText,
  parseDiscordAuthError,
} from './discord.js';
import { ingestFeed, recordFeedFailure } from './feed.js';
import { currentRound, roundsFor } from './league.js';
import { followOnWindows, openAnnouncementDue } from './rules.js';
import type { Env } from './types.js';

export interface TickReport {
  /** True when TourPlay's feed was read successfully on this run. */
  synced: boolean;
  syncError: string | null;
  /** Results and schedules applied from the feed on this run. */
  results: number;
  schedules: number;
  /** Rounds that arrived without dates and were given a window running on from the round before. */
  windowsAdded: number[];
  opened: number[];
  closed: number[];
  /** A dead bot token, or failed posts, found on this run. Null when Discord is healthy. */
  discordProblem: string | null;
  /** What happened to the alarm about it, if one was needed. */
  alert: 'sent' | 'already_sent' | 'no_alert_channel' | 'failed' | null;
}

const DAY_MS = 86_400_000;

function dayStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function tick(env: Env, now = new Date()): Promise<TickReport> {
  const report: TickReport = {
    synced: false,
    syncError: null,
    results: 0,
    schedules: 0,
    windowsAdded: [],
    opened: [],
    closed: [],
    discordProblem: null,
    alert: null,
  };
  // audit.at is SQLite's datetime('now'): UTC, space-separated, to the second.
  const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const season = await activeSeason(env);
  if (!season) return report;

  // 1. Read TourPlay's feed. A failure here must not stop the calendar work.
  try {
    const feed = await ingestFeed(env, season, 'cron');
    report.synced = true;
    report.results = feed.results;
    report.schedules = feed.schedules;
  } catch (cause) {
    report.syncError = String(cause);
    await recordFeedFailure(env, season, cause);
  }

  const map = await settings(env);
  const leagueName = map['league_name'] ?? 'TRUBBL';
  const announceChannel = map['announce_channel_id'] ?? '';
  const datesChannel = map['dates_channel_id'] ?? '';

  // 2. A round the feed has just revealed arrives with no dates. Give it a
  //    window running on from the round before. Round one is left alone: the
  //    season start is a decision.
  const roundLength = Number(map['round_length_days'] ?? 14) || 14;
  const followOn = followOnWindows(await roundsFor(env, season.id), roundLength);
  if (followOn.length > 0) {
    await env.DB.batch(
      followOn.map(({ round, opens_at, closes_at }) =>
        env.DB.prepare('UPDATE round SET opens_at = ?, closes_at = ? WHERE id = ?').bind(opens_at, closes_at, round.id),
      ),
    );
    report.windowsAdded = followOn.map(({ round }) => round.number);
    await audit(env, 'cron', 'season.follow_on_windows', `season:${season.id}`, {
      lengthDays: roundLength,
      rounds: followOn.map(({ round, opens_at, closes_at }) => ({ number: round.number, opens_at, closes_at })),
    });
  }

  for (const round of await roundsFor(env, season.id)) {
    // 3. Open a round whose start date has arrived.
    if (round.status === 'pending' && round.opens_at && Date.parse(round.opens_at) <= now.getTime()) {
      await env.DB.prepare("UPDATE round SET status = 'open', opened_at = ? WHERE id = ?")
        .bind(now.toISOString().replace(/\.\d{3}Z$/, 'Z'), round.id)
        .run();
      round.status = 'open';
      report.opened.push(round.number);
    }

    // 4. Close a round whose window has ended. Nothing is posted: whether a
    //    game was played is TourPlay's to say, not the bot's.
    if (round.status === 'open' && round.closes_at && Date.parse(round.closes_at) < now.getTime()) {
      await env.DB.prepare("UPDATE round SET status = 'closed', closed_at = ? WHERE id = ?")
        .bind(now.toISOString().replace(/\.\d{3}Z$/, 'Z'), round.id)
        .run();
      round.status = 'closed';
      report.closed.push(round.number);
      continue;
    }

    // 5. The "round is open" posts: dates only. Tried on the run that opens
    //    the round and on every run after while it is open, so a post Discord
    //    refused goes out once the fault is fixed. Deduped, never repeated.
    if (openAnnouncementDue(round.status, round.closes_at, now)) {
      if (datesChannel) {
        await announceOnce(
          env,
          `dates-open:${round.id}`,
          'dates_round_open',
          datesChannel,
          `**Round ${round.number}** is open.\n` +
            (round.opens_at ? `Opens ${formatDate(round.opens_at)}\n` : '') +
            (round.closes_at ? `**Closes ${formatDate(round.closes_at)}**\n` : '') +
            `\nReport your results on TourPlay as soon as you have played.`,
        );
      }
      await announceOnce(
        env,
        `round-open:${round.id}`,
        'round_open',
        announceChannel,
        `**${leagueName} — Round ${round.number} is open.**\n` +
          (round.closes_at ? `Get your games played by **${formatDate(round.closes_at)}**.\n` : '') +
          `Report your results on TourPlay.`,
      );
    }
  }

  // 6. If the bot is not getting through, or cannot read TourPlay's feed, say
  //    so somewhere a person will see it, at most once a day.
  await raiseAlarm(env, report, startedAt, now);

  await audit(env, 'cron', 'tick', season.tourplay_slug, report);
  return report;
}

async function raiseAlarm(env: Env, report: TickReport, startedAt: string, now: Date): Promise<void> {
  const map = await settings(env);
  const authError = parseDiscordAuthError(map[DISCORD_AUTH_SETTING]);
  const { results } = await env.DB.prepare(
    "SELECT subject, detail FROM audit WHERE action = 'announce.failed' AND at >= ? ORDER BY id",
  )
    .bind(startedAt)
    .all<{ subject: string | null; detail: string | null }>();
  const failures = (results ?? []).map((row) => {
    let error = 'unknown error';
    try {
      error = String((JSON.parse(row.detail ?? '{}') as { error?: string }).error ?? error);
    } catch {
      // keep the placeholder
    }
    return { kind: row.subject ?? 'post', error };
  });
  // A feed that cannot be read is the same kind of silent failure as a dead
  // token: the bot carries on, knowing nothing new. Report it the same way.
  if (report.syncError) failures.push({ kind: 'reading the TourPlay feed', error: report.syncError });

  if (!authError && failures.length === 0) return;

  report.discordProblem = authError
    ? `bot token rejected since ${authError.since}: ${authError.error.slice(0, 120)}`
    : `${failures.length} problem${failures.length === 1 ? '' : 's'}: ${failures.map((f) => f.kind).join(', ')}`;

  const mentionUserId = map['alert_discord_user_id'] || null;
  report.alert = await alertOwner(
    env,
    `alert:discord:${dayStamp(now)}`,
    discordAlertText(authError, failures, mentionUserId),
    mentionUserId,
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
  firstRoundDays?: number,
): Promise<number> {
  const rounds = await roundsFor(env, seasonId);
  let cursor = Date.parse(firstOpensAt);
  if (Number.isNaN(cursor)) throw new Error('The start date is not a valid date');

  const statements = rounds.map((round, index) => {
    // The opening round usually runs longer: teams are still being drafted.
    const days = index === 0 ? firstRoundDays ?? lengthDays : lengthDays;
    const opens = new Date(cursor);
    const closes = new Date(cursor + days * DAY_MS - 1);
    cursor += days * DAY_MS;
    return env.DB.prepare('UPDATE round SET opens_at = ?, closes_at = ? WHERE id = ?').bind(
      opens.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      closes.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      round.id,
    );
  });

  if (statements.length > 0) await env.DB.batch(statements);
  await audit(env, actor, 'season.layout_windows', `season:${seasonId}`, {
    firstOpensAt,
    lengthDays,
    firstRoundDays: firstRoundDays ?? lengthDays,
  });
  return statements.length;
}

export { currentRound };

// TourPlay's own Discord bot, read as the manager's source of results.
//
// TourPlay blocked automated access to its JSON on 29 Sep 2026 with an
// anti-bot challenge. It still posts every match into TRUBBL's Discord
// (#league-result-input) through its official integration, so that is what
// the manager reads now: data TourPlay chooses to send to the league.
//
// What the feed gives, and so what the manager can know:
//   - "End of the match"          final score of a played game
//   - "Match suspension resolved" an organiser's ruling on a game, with its score
//   - "Match scheduled"           the date both coaches agreed
// each tagged with TourPlay's match id, the division and the round.
//
// What it does not give, and so what the manager no longer claims to know:
// the full draw (a fixture only appears once it is scheduled or played), and
// exact casualty totals (counting casualty events disagrees with TourPlay's
// own figure in about a quarter of Season 6 games). Anything that needed
// those — the table, chasing, outstanding lists — was removed on 23 Oct 2026.

import { audit, nowIso, settings, setSetting, type SeasonRow } from './db.js';
import type { Env } from './types.js';

const API = 'https://discord.com/api/v10';
const DISCORD_EPOCH = 1420070400000n;

/** TourPlay's bot user in TRUBBL's server. Only its posts are trusted. */
export const DEFAULT_FEED_BOT_ID = '1058800284794622062';
/** #league-result-input, where the TourPlay integration posts. */
export const DEFAULT_FEED_CHANNEL_ID = '1055086865696436267';
/** First run reads from here, so Season 7 is backfilled without the whole channel history. */
const BACKFILL_FROM = '2026-09-20T00:00:00Z';
/** Discord returns 100 messages a page; this caps one run at 2,000. */
const MAX_PAGES = 20;

// ------------------------------------------------------------------ parse ---

export interface FeedSide {
  team: string;
  coach: string;
  score: number | null;
}

export interface FeedPlace {
  matchId: string;
  slug: string;
  /** The division, e.g. "Second Division". Empty for a game outside the divisions. */
  division: string;
  /** League round number, or null for friendlies, play-offs and anything else. */
  round: number | null;
  /** The phase TourPlay names, e.g. "Regular" or "Interdivision". */
  phase: string;
}

export type FeedItem =
  | ({ kind: 'result'; ruling: boolean; home: FeedSide; away: FeedSide } & FeedPlace)
  | ({ kind: 'scheduled'; when: string | null; home: FeedSide; away: FeedSide } & FeedPlace)
  | { kind: 'ignored'; reason: string };

interface EmbedField {
  name: string;
  value: string;
}

interface Embed {
  title?: string;
  description?: string;
  url?: string;
  author?: { name?: string; url?: string };
  fields?: EmbedField[];
  footer?: { text?: string };
}

export interface FeedMessage {
  id: string;
  timestamp?: string;
  author: { id: string };
  embeds?: Embed[];
}

const MATCH_URL = /\/blood-bowl\/([^/?#]+)\/match\/(\d+)\/?(?:[?#].*)?$/;

/** "Season | Regular · Second Division · Round 1" → phase, division, round. */
export function parseFooter(text: string): { phase: string; division: string; round: number | null } {
  const afterBar = text.includes('|') ? text.slice(text.indexOf('|') + 1) : text;
  const parts = afterBar.split('·').map((part) => part.trim());
  const [phase = '', division = '', label = ''] = parts;
  const match = /^(?:Round|Matchday)\s+(\d+)$/i.exec(label);
  return { phase, division, round: match ? Number(match[1]) : null };
}

/** A team field: "**TEAM NAME**\n`1000` Race\n:flag_gb: Coach", value "`  3  `". */
export function parseSide(field: EmbedField | undefined): FeedSide | null {
  if (!field) return null;
  const lines = field.name.split('\n').map((line) => line.trim()).filter(Boolean);
  const team = (lines[0] ?? '').replace(/^\*\*|\*\*$/g, '').trim();
  // The coach line starts with a flag emoji (":flag_gb:", ":england:", ":pirate_flag:").
  const coachLine = lines.length >= 3 ? lines[lines.length - 1]! : '';
  const coach = coachLine.replace(/^(?::[a-z0-9_]+:\s*)+/i, '').trim();
  const raw = field.value.replace(/`/g, '').trim();
  const score = /^-?\d+$/.test(raw) ? Number(raw) : null;
  if (!team) return null;
  return { team, coach, score };
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** "Wednesday, October 14, 2026 · 6:30:00 PM (UTC +1)" → "2026-10-14T17:30:00Z". */
export function parseScheduledWhen(text: string): string | null {
  const match =
    /^\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})\s+·\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)\s+\(UTC\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\)$/i.exec(
      text.trim(),
    );
  if (!match) return null;
  const [, monthName, day, year, hh, mm, ss = '0', ampm, sign, offH, offM = '0'] = match;
  const month = MONTHS[monthName!.toLowerCase()];
  if (month === undefined) return null;
  let hour = Number(hh) % 12;
  if (ampm!.toUpperCase() === 'PM') hour += 12;
  const offsetMinutes = (sign === '-' ? -1 : 1) * (Number(offH) * 60 + Number(offM));
  const utc = Date.UTC(Number(year), month, Number(day), hour, Number(mm), Number(ss)) - offsetMinutes * 60_000;
  return new Date(utc).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Turn one Discord message into what it tells the league, or say why it is
 * ignored. Pure, so it is tested against real posts.
 */
export function parseFeedMessage(message: FeedMessage, botId: string, slug: string): FeedItem {
  if (message.author.id !== botId) return { kind: 'ignored', reason: 'not posted by TourPlay' };
  const embed = message.embeds?.[0];
  if (!embed) return { kind: 'ignored', reason: 'no embed' };

  const title = embed.title ?? '';
  const isEnd = /End of the match/i.test(title);
  const isRuling = /Match suspension resolved/i.test(title);
  const isScheduled = /Match scheduled/i.test(title);
  if (!isEnd && !isRuling && !isScheduled) return { kind: 'ignored', reason: 'not a result or schedule post' };

  const url = MATCH_URL.exec(embed.url ?? '');
  if (!url) return { kind: 'ignored', reason: 'no match link' };
  if (url[1] !== slug) return { kind: 'ignored', reason: `another competition (${url[1]})` };

  const home = parseSide(embed.fields?.[0]);
  const away = parseSide(embed.fields?.[1]);
  if (!home || !away) return { kind: 'ignored', reason: 'could not read the two teams' };

  const place: FeedPlace = { matchId: url[2]!, slug: url[1]!, ...parseFooter(embed.footer?.text ?? '') };

  if (isScheduled) {
    return { kind: 'scheduled', when: parseScheduledWhen(embed.description ?? ''), home, away, ...place };
  }
  if (home.score === null || away.score === null) return { kind: 'ignored', reason: 'result with no score' };
  return { kind: 'result', ruling: isRuling, home, away, ...place };
}

// ----------------------------------------------------------------- ingest ---

export interface FeedReport {
  read: number;
  results: number;
  schedules: number;
  newFixtures: number;
  newRounds: number;
  skipped: number;
  warnings: string[];
  lastMessageId: string | null;
}

function snowflakeAt(iso: string): string {
  return ((BigInt(Date.parse(iso)) - DISCORD_EPOCH) << 22n).toString();
}

function newer(a: string, b: string): boolean {
  return BigInt(a) > BigInt(b);
}

async function fetchPage(env: Env, channelId: string, after: string): Promise<FeedMessage[]> {
  if (!env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is not set, so the TourPlay feed cannot be read');
  const response = await fetch(`${API}/channels/${channelId}/messages?after=${after}&limit=100`, {
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(`Discord ${response.status} reading the TourPlay feed: ${(await response.text()).slice(0, 200)}`);
  }
  const page = (await response.json()) as FeedMessage[];
  // Discord returns newest first; the ledger has to be applied in order.
  return page.sort((a, b) => (newer(a.id, b.id) ? 1 : -1));
}

interface Lookup {
  coachTeam: Map<string, number>;
  divisionByName: Map<string, number>;
  roundByNumber: Map<number, number>;
}

async function lookups(env: Env, seasonId: number): Promise<Lookup> {
  const [teams, divisions, rounds] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id, c.display_name FROM team t JOIN coach c ON c.id = t.coach_id WHERE t.season_id = ?`,
    )
      .bind(seasonId)
      .all<{ id: number; display_name: string }>(),
    env.DB.prepare('SELECT id, name FROM division WHERE season_id = ?').bind(seasonId).all<{ id: number; name: string }>(),
    env.DB.prepare('SELECT id, number FROM round WHERE season_id = ?').bind(seasonId).all<{ id: number; number: number }>(),
  ]);
  return {
    coachTeam: new Map((teams.results ?? []).map((t) => [t.display_name.trim().toLowerCase(), t.id])),
    divisionByName: new Map((divisions.results ?? []).map((d) => [d.name.trim().toLowerCase(), d.id])),
    roundByNumber: new Map((rounds.results ?? []).map((r) => [r.number, r.id])),
  };
}

interface FixtureRow {
  id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  status: string;
}

async function findFixture(env: Env, seasonId: number, matchId: string): Promise<FixtureRow | null> {
  return env.DB.prepare(
    `SELECT f.id, f.home_team_id, f.away_team_id, f.status
       FROM fixture f JOIN round r ON r.id = f.round_id
      WHERE r.season_id = ? AND f.tourplay_match_id = ?`,
  )
    .bind(seasonId, matchId)
    .first<FixtureRow>();
}

/**
 * A league game the manager has not seen yet: a round drawn on TourPlay after
 * the last import. Create its round and fixture from what the post says.
 */
async function createFixture(
  env: Env,
  seasonId: number,
  item: Extract<FeedItem, { kind: 'result' | 'scheduled' }>,
  look: Lookup,
  report: FeedReport,
): Promise<FixtureRow | null> {
  if (item.round === null) return null;
  const homeTeam = look.coachTeam.get(item.home.coach.toLowerCase()) ?? null;
  const awayTeam = look.coachTeam.get(item.away.coach.toLowerCase()) ?? null;
  if (homeTeam === null || awayTeam === null) {
    report.warnings.push(
      `Match ${item.matchId}: no coach called "${homeTeam === null ? item.home.coach : item.away.coach}" in this season`,
    );
    return null;
  }

  let roundId = look.roundByNumber.get(item.round);
  if (roundId === undefined) {
    await env.DB.prepare('INSERT INTO round (season_id, number) VALUES (?, ?) ON CONFLICT (season_id, number) DO NOTHING')
      .bind(seasonId, item.round)
      .run();
    const row = await env.DB.prepare('SELECT id FROM round WHERE season_id = ? AND number = ?')
      .bind(seasonId, item.round)
      .first<{ id: number }>();
    if (!row) return null;
    roundId = row.id;
    look.roundByNumber.set(item.round, roundId);
    report.newRounds += 1;
  }

  const divisionId = look.divisionByName.get(item.division.toLowerCase()) ?? null;
  await env.DB.prepare(
    `INSERT INTO fixture (round_id, division_id, is_friendly, tourplay_match_id, home_team_id, away_team_id, status)
       VALUES (?, ?, 0, ?, ?, ?, 'unplayed')
     ON CONFLICT (round_id, tourplay_match_id) DO NOTHING`,
  )
    .bind(roundId, divisionId, item.matchId, homeTeam, awayTeam)
    .run();
  report.newFixtures += 1;
  return findFixture(env, seasonId, item.matchId);
}

/** Which way round the post lists the teams, against the stored fixture. */
function orient(
  fixture: FixtureRow,
  item: { home: FeedSide; away: FeedSide },
  look: Lookup,
): { home: FeedSide; away: FeedSide } {
  const firstTeam = look.coachTeam.get(item.home.coach.toLowerCase());
  if (firstTeam !== undefined && firstTeam === fixture.away_team_id) return { home: item.away, away: item.home };
  return { home: item.home, away: item.away };
}

const RULED = new Set(['forfeit', 'concession', 'no_agreement', 'no_attempt', 'double_forfeit', 'void']);

/**
 * Read every TourPlay post since the last one applied, and apply them in
 * order. Safe to run any number of times: a post is applied once, and the
 * position only moves forward after a page has been fully applied.
 */
export async function ingestFeed(env: Env, season: SeasonRow, actor = 'feed'): Promise<FeedReport> {
  const map = await settings(env);
  const channelId = map['tourplay_feed_channel_id'] || DEFAULT_FEED_CHANNEL_ID;
  const botId = map['tourplay_feed_bot_id'] || DEFAULT_FEED_BOT_ID;
  let after = map['tourplay_feed_last_id'] || snowflakeAt(BACKFILL_FROM);

  const report: FeedReport = {
    read: 0,
    results: 0,
    schedules: 0,
    newFixtures: 0,
    newRounds: 0,
    skipped: 0,
    warnings: [],
    lastMessageId: null,
  };
  const look = await lookups(env, season.id);

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const messages = await fetchPage(env, channelId, after);
    if (messages.length === 0) break;

    for (const message of messages) {
      report.read += 1;
      const item = parseFeedMessage(message, botId, season.tourplay_slug);
      if (item.kind === 'ignored') continue;
      if (item.round === null) {
        // Friendlies (§3.3.2), play-offs: not part of the league rounds.
        report.skipped += 1;
        continue;
      }

      const fixture =
        (await findFixture(env, season.id, item.matchId)) ?? (await createFixture(env, season.id, item, look, report));
      if (!fixture) continue;
      const { home, away } = orient(fixture, item, look);

      if (item.kind === 'result') {
        // Casualties are left empty on purpose: the feed cannot give an exact count.
        await env.DB.prepare(
          `UPDATE fixture SET tp_home_score = ?, tp_away_score = ?, tp_home_cas = NULL, tp_away_cas = NULL,
             tp_played = 1, status = CASE WHEN status IN (${[...RULED].map(() => '?').join(', ')}) THEN status ELSE 'played' END
           WHERE id = ?`,
        )
          .bind(home.score, away.score, ...RULED, fixture.id)
          .run();
        report.results += 1;
      } else if (item.when) {
        await env.DB.prepare(
          `UPDATE fixture SET scheduled_for = ?, scheduled_by = 'tourplay',
             status = CASE WHEN status = 'unplayed' THEN 'scheduled' ELSE status END
           WHERE id = ?`,
        )
          .bind(item.when, fixture.id)
          .run();
        report.schedules += 1;
      }
    }

    after = messages[messages.length - 1]!.id;
    report.lastMessageId = after;
    await setSetting(env, 'tourplay_feed_last_id', after);
    if (messages.length < 100) break;
  }

  await env.DB.prepare(
    "UPDATE season SET last_synced_at = ?, last_sync_error = NULL, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(nowIso(), season.id)
    .run();
  if (report.results || report.schedules || report.newFixtures || report.warnings.length) {
    await audit(env, actor, 'tourplay.feed', season.tourplay_slug, report);
  }
  return report;
}

export async function recordFeedFailure(env: Env, season: SeasonRow, cause: unknown): Promise<void> {
  await env.DB.prepare('UPDATE season SET last_sync_error = ? WHERE id = ?')
    .bind(String(cause).slice(0, 500), season.id)
    .run();
}

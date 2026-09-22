// The admin portal's REST surface. Every route here is behind requireAdmin.

import { requireAdmin, viewerFor } from './auth.js';
import { activeSeason, audit, json, nowIso, scoringFrom, seasonById, setSetting, settings } from './db.js';
import { RULING_LABELS } from './commands.js';
import { announceOnce, mention } from './discord.js';
import {
  currentRound,
  divisionsFor,
  fixtureById,
  fixturesForRound,
  outstanding,
  revertRuling,
  roundsFor,
  roundWindow,
  ruleFixture,
  standingsFor,
} from './league.js';
import { layOutWindows, tick } from './scheduler.js';
import { syncSeason } from './sync.js';
import { fetchTournament, probe } from './tourplay.js';
import { RULING_KINDS, type Env, type RulingKind } from './types.js';

export async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  const viewer = await viewerFor(request, env);

  if (path === '/api/me') {
    return json({ email: viewer.email, isAdmin: viewer.isAdmin, isOwner: viewer.isOwner, reason: viewer.reason });
  }

  const denied = requireAdmin(viewer);
  if (denied) return denied;

  const actor = viewer.email ?? 'admin';
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const body = method === 'POST' || method === 'PUT' ? await readJson(request) : {};

  // --- season --------------------------------------------------------------

  if (path === '/api/overview' && method === 'GET') {
    const season = await activeSeason(env);
    if (!season) return json({ season: null });

    const round = await currentRound(env, season.id);
    const fixtures = round ? await fixturesForRound(env, round.id) : [];
    const left = outstanding(fixtures);
    const window = round ? await roundWindow(env, round) : null;
    const pendingExtensions = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM extension WHERE status = 'requested'",
    ).first<{ n: number }>();

    return json({
      season,
      round,
      window,
      counts: {
        fixtures: fixtures.length,
        outstanding: left.length,
        played: fixtures.length - left.length,
        pendingExtensions: pendingExtensions?.n ?? 0,
      },
      outstanding: left,
    });
  }

  if (path === '/api/season' && method === 'POST') {
    const slug = String(body.tourplay_slug ?? '').trim();
    if (!slug) return json({ error: 'tourplay_slug is required' }, 400);

    const tournament = await fetchTournament(slug);
    await env.DB.prepare('UPDATE season SET is_active = 0').run();
    await env.DB.prepare(
      `INSERT INTO season (name, tourplay_slug, tourplay_tournament_id, is_active)
         VALUES (?, ?, ?, 1)
       ON CONFLICT (tourplay_slug) DO UPDATE SET
         name = excluded.name, tourplay_tournament_id = excluded.tourplay_tournament_id, is_active = 1`,
    )
      .bind(String(body.name ?? tournament.name), slug, tournament.id)
      .run();

    const season = await activeSeason(env);
    await audit(env, actor, 'season.activate', slug);
    const report = season ? await syncSeason(env, season, actor) : null;
    return json({ season, report });
  }

  if (path === '/api/sync' && method === 'POST') {
    const season = await activeSeason(env);
    if (!season) return json({ error: 'no active season' }, 400);
    return json(await syncSeason(env, season, actor));
  }

  if (path === '/api/tick' && method === 'POST') {
    return json(await tick(env));
  }

  // --- rounds and windows --------------------------------------------------

  if (path === '/api/rounds' && method === 'GET') {
    const season = await activeSeason(env);
    if (!season) return json({ rounds: [] });

    const rounds = await roundsFor(env, season.id);
    const { results: counts } = await env.DB.prepare(
      `SELECT round_id,
              COUNT(*) AS total,
              SUM(CASE WHEN status IN ('unplayed', 'scheduled') THEN 1 ELSE 0 END) AS outstanding
         FROM fixture GROUP BY round_id`,
    ).all<{ round_id: number; total: number; outstanding: number }>();
    const byRound = new Map((counts ?? []).map((c) => [c.round_id, c]));

    return json({
      rounds: rounds.map((round) => ({
        ...round,
        total: byRound.get(round.id)?.total ?? 0,
        outstanding: byRound.get(round.id)?.outstanding ?? 0,
      })),
    });
  }

  const roundWindowMatch = /^\/api\/rounds\/(\d+)\/window$/.exec(path);
  if (roundWindowMatch && method === 'POST') {
    const id = Number(roundWindowMatch[1]);
    await env.DB.prepare('UPDATE round SET opens_at = ?, closes_at = ?, notes = ? WHERE id = ?')
      .bind(nullableIso(body.opens_at), nullableIso(body.closes_at), String(body.notes ?? ''), id)
      .run();
    await audit(env, actor, 'round.window', `round:${id}`, body);
    return json({ ok: true });
  }

  const roundStatusMatch = /^\/api\/rounds\/(\d+)\/status$/.exec(path);
  if (roundStatusMatch && method === 'POST') {
    const id = Number(roundStatusMatch[1]);
    const status = String(body.status ?? '');
    if (!['pending', 'open', 'closed', 'settled'].includes(status)) {
      return json({ error: 'bad status' }, 400);
    }
    await env.DB.prepare('UPDATE round SET status = ? WHERE id = ?').bind(status, id).run();
    await audit(env, actor, 'round.status', `round:${id}`, { status });
    return json({ ok: true });
  }

  if (path === '/api/windows/layout' && method === 'POST') {
    const season = await activeSeason(env);
    if (!season) return json({ error: 'no active season' }, 400);
    const length = Number(body.lengthDays);
    if (!Number.isFinite(length) || length < 1) return json({ error: 'lengthDays must be a positive number' }, 400);
    const count = await layOutWindows(env, season.id, String(body.firstOpensAt ?? ''), length, actor);
    return json({ rounds: count });
  }

  // --- fixtures ------------------------------------------------------------

  if (path === '/api/fixtures' && method === 'GET') {
    const roundId = Number(url.searchParams.get('round'));
    if (Number.isFinite(roundId) && roundId > 0) {
      return json({ fixtures: await fixturesForRound(env, roundId) });
    }
    const season = await activeSeason(env);
    const round = season ? await currentRound(env, season.id) : null;
    return json({ fixtures: round ? await fixturesForRound(env, round.id) : [], round });
  }

  const ruleMatch = /^\/api\/fixtures\/(\d+)\/rule$/.exec(path);
  if (ruleMatch && method === 'POST') {
    const id = Number(ruleMatch[1]);
    const kind = String(body.kind ?? '') as RulingKind;
    if (!RULING_KINDS.includes(kind)) {
      return json({ error: `kind must be one of ${RULING_KINDS.join(', ')}` }, 400);
    }
    const atFault = body.atFault === null || body.atFault === undefined ? null : String(body.atFault);
    // §3.2(a): only a concession or forfeit names a side at fault; (b) and (c)
    // are draws in which neither coach is singled out.
    if (kind === 'forfeit' || kind === 'concession') {
      if (!['home', 'away'].includes(atFault ?? '')) {
        return json({ error: 'a concession needs atFault set to home or away' }, 400);
      }
    }
    const fixture = await ruleFixture(
      env,
      id,
      kind,
      (atFault as 'home' | 'away' | 'both' | null) ?? null,
      String(body.reason ?? ''),
      actor,
    );

    if (body.announce !== false) {
      const map = await settings(env);
      await announceOnce(
        env,
        `ruling:${id}:${nowIso()}`,
        'ruling',
        map['announce_channel_id'] ?? '',
        `**Ruling — Round ${fixture.roundNumber}**\n` +
          `${fixture.homeTeam} (${mention(fixture.homeDiscordId, fixture.homeCoach)}) ` +
          `${fixture.homeScore}–${fixture.awayScore} ` +
          `${fixture.awayTeam} (${mention(fixture.awayDiscordId, fixture.awayCoach)}) ` +
          `— ${RULING_LABELS[kind]}` +
          (fixture.rulingReason ? `\nReason: ${fixture.rulingReason}` : ''),
      );
    }
    return json({ fixture });
  }

  const revertMatch = /^\/api\/fixtures\/(\d+)\/revert$/.exec(path);
  if (revertMatch && method === 'POST') {
    return json({ fixture: await revertRuling(env, Number(revertMatch[1]), actor) });
  }

  const scheduleMatch = /^\/api\/fixtures\/(\d+)\/schedule$/.exec(path);
  if (scheduleMatch && method === 'POST') {
    const id = Number(scheduleMatch[1]);
    const when = nullableIso(body.when);
    await env.DB.prepare(
      `UPDATE fixture SET scheduled_for = ?, scheduled_by = ?,
         status = CASE WHEN ? IS NULL THEN 'unplayed' ELSE 'scheduled' END
       WHERE id = ? AND status IN ('unplayed', 'scheduled')`,
    )
      .bind(when, actor, when, id)
      .run();
    await audit(env, actor, 'fixture.schedule', `fixture:${id}`, { when });
    return json({ fixture: await fixtureById(env, id) });
  }

  // --- extensions ----------------------------------------------------------

  if (path === '/api/extensions' && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'requested';
    const { results } = await env.DB.prepare(
      `SELECT e.*, f.round_id, ht.name AS home_team, at.name AS away_team, c.display_name AS coach
         FROM extension e
         JOIN fixture f ON f.id = e.fixture_id
         LEFT JOIN team ht ON ht.id = f.home_team_id
         LEFT JOIN team at ON at.id = f.away_team_id
         LEFT JOIN coach c ON c.id = e.requested_by_coach_id
        WHERE e.status = ? ORDER BY e.created_at DESC`,
    )
      .bind(status)
      .all();
    return json({ extensions: results ?? [] });
  }

  const extensionMatch = /^\/api\/extensions\/(\d+)$/.exec(path);
  if (extensionMatch && method === 'POST') {
    const id = Number(extensionMatch[1]);
    const status = String(body.status ?? '');
    if (!['granted', 'refused'].includes(status)) return json({ error: 'status must be granted or refused' }, 400);

    await env.DB.prepare('UPDATE extension SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
      .bind(status, actor, nowIso(), id)
      .run();
    await audit(env, actor, `extension.${status}`, `extension:${id}`);

    const row = await env.DB.prepare(
      `SELECT e.extends_to, e.fixture_id, ht.name AS home_team, at.name AS away_team,
              hc.discord_user_id AS home_discord, ac.discord_user_id AS away_discord
         FROM extension e
         JOIN fixture f ON f.id = e.fixture_id
         LEFT JOIN team ht ON ht.id = f.home_team_id
         LEFT JOIN team at ON at.id = f.away_team_id
         LEFT JOIN coach hc ON hc.id = ht.coach_id
         LEFT JOIN coach ac ON ac.id = at.coach_id
        WHERE e.id = ?`,
    )
      .bind(id)
      .first<any>();

    if (row) {
      const map = await settings(env);
      await announceOnce(
        env,
        `extension:${id}:${status}`,
        'extension',
        map['chase_channel_id'] || (map['announce_channel_id'] ?? ''),
        status === 'granted'
          ? `**Extension granted** — ${row.home_team} v ${row.away_team} now has until ` +
              `${new Date(row.extends_to).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' })}. ` +
              `${mention(row.home_discord, '')} ${mention(row.away_discord, '')}`.trim()
          : `**Extension refused** — ${row.home_team} v ${row.away_team}. The original deadline stands.`,
      );
    }
    return json({ ok: true });
  }

  // --- divisions -----------------------------------------------------------

  if (path === '/api/divisions' && method === 'GET') {
    const season = await activeSeason(env);
    return json({ divisions: season ? await divisionsFor(env, season.id) : [] });
  }

  const divisionMatch = /^\/api\/divisions\/(\d+)$/.exec(path);
  if (divisionMatch && method === 'POST') {
    const id = Number(divisionMatch[1]);
    await env.DB.prepare('UPDATE division SET chase_channel_id = ? WHERE id = ?')
      .bind(String(body.chase_channel_id ?? '').trim(), id)
      .run();
    await audit(env, actor, 'division.channel', `division:${id}`, body);
    return json({ ok: true });
  }

  // --- reference data ------------------------------------------------------

  if (path === '/api/standings' && method === 'GET') {
    const season = await activeSeason(env);
    return json({ divisions: season ? await standingsFor(env, season.id) : [] });
  }

  if (path === '/api/coaches' && method === 'GET') {
    const season = await activeSeason(env);
    if (!season) return json({ coaches: [] });
    const { results } = await env.DB.prepare(
      `SELECT c.*, t.name AS team_name, t.race, d.name AS division_name
         FROM coach c
         LEFT JOIN team t ON t.coach_id = c.id
         LEFT JOIN division d ON d.id = t.division_id
        WHERE c.season_id = ? ORDER BY d.tier, c.display_name`,
    )
      .bind(season.id)
      .all();
    return json({ coaches: results ?? [] });
  }

  const coachMatch = /^\/api\/coaches\/(\d+)$/.exec(path);
  if (coachMatch && method === 'POST') {
    const id = Number(coachMatch[1]);
    await env.DB.prepare('UPDATE coach SET discord_user_id = ?, email = ? WHERE id = ?')
      .bind(emptyToNull(body.discord_user_id), emptyToNull(body.email), id)
      .run();
    await audit(env, actor, 'coach.update', `coach:${id}`, body);
    return json({ ok: true });
  }

  if (path === '/api/settings' && method === 'GET') {
    const map = await settings(env);
    return json({ settings: map, scoring: scoringFrom(map) });
  }

  if (path === '/api/settings' && method === 'POST') {
    const updates = body.settings ?? body;
    for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {
      await setSetting(env, key, String(value));
    }
    await audit(env, actor, 'settings.update', null, updates);
    return json({ settings: await settings(env) });
  }

  if (path === '/api/audit' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all();
    return json({ audit: results ?? [] });
  }

  // --- chasing by hand -----------------------------------------------------

  if (path === '/api/chase' && method === 'POST') {
    const season = await activeSeason(env);
    if (!season) return json({ error: 'no active season' }, 400);
    const round = await currentRound(env, season.id);
    if (!round) return json({ error: 'no round' }, 400);

    const left = outstanding(await fixturesForRound(env, round.id));
    if (left.length === 0) return json({ posted: false, reason: 'nothing outstanding' });

    const map = await settings(env);
    const view = await roundWindow(env, round);
    const result = await announceOnce(
      env,
      `manual-chase:${round.id}:${nowIso()}`,
      'manual_chase',
      map['chase_channel_id'] || (map['announce_channel_id'] ?? ''),
      `**Round ${round.number} — ${left.length} game${left.length === 1 ? '' : 's'} still to play**` +
        (view.effectiveClose
          ? ` (deadline ${new Date(view.effectiveClose).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' })})`
          : '') +
        '\n' +
        left
          .map(
            (f) =>
              `• **${f.homeTeam}** v **${f.awayTeam}** — ${mention(f.homeDiscordId, f.homeCoach)} v ${mention(f.awayDiscordId, f.awayCoach)}`,
          )
          .join('\n'),
    );
    return json({ posted: result.ok, skipped: result.skipped, error: result.error });
  }

  // --- TourPlay probe ------------------------------------------------------

  if (path === '/api/tourplay/probe' && method === 'GET') {
    const season = await activeSeason(env);
    const slug = url.searchParams.get('slug') ?? season?.tourplay_slug ?? '';
    const target = url.searchParams.get('path');
    if (!slug || !target) return json({ error: 'slug and path are both required' }, 400);
    try {
      return json({ path: target, body: await probe(target, slug) });
    } catch (cause) {
      return json({ error: String(cause) }, 502);
    }
  }

  return json({ error: `no route for ${method} ${path}` }, 404);
}

async function readJson(request: Request): Promise<Record<string, any>> {
  try {
    const parsed = await request.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function nullableIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function emptyToNull(value: unknown): string | null {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text === '' ? null : text;
}

export { seasonById };

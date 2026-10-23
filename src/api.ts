// The admin portal's REST surface. Every route here is behind requireAdmin.
//
// Since 23 Oct 2026 the manager reads results from TourPlay's Discord feed
// only, so the routes for things that feed cannot support — standings,
// rulings, extensions, chasing, the TourPlay import and probe — are gone.

import { requireAdmin, viewerFor } from './auth.js';
import { activeSeason, audit, json, seasonById, setSetting, settings } from './db.js';
import { DISCORD_AUTH_SETTING, parseDiscordAuthError } from './discord.js';
import { ingestFeed, recordFeedFailure } from './feed.js';
import { currentRound, fixturesForRound, roundsFor, roundWindow } from './league.js';
import { layOutWindows, tick } from './scheduler.js';
import type { Env } from './types.js';

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
    const reported = fixtures.filter((f) => f.status === 'played');
    const window = round ? await roundWindow(env, round) : null;
    const discordAuth = await env.DB.prepare('SELECT value FROM setting WHERE key = ?')
      .bind(DISCORD_AUTH_SETTING)
      .first<{ value: string }>();

    return json({
      season,
      round,
      window,
      reported,
      // The webhook URL is a credential: say only whether one is configured.
      discord: {
        authError: parseDiscordAuthError(discordAuth?.value),
        alertWebhook: Boolean(env.DISCORD_ALERT_WEBHOOK_URL),
      },
    });
  }

  if (path === '/api/sync' && method === 'POST') {
    const season = await activeSeason(env);
    if (!season) return json({ error: 'no active season' }, 400);
    try {
      return json(await ingestFeed(env, season, actor));
    } catch (cause) {
      await recordFeedFailure(env, season, cause);
      return json({ error: String(cause) }, 502);
    }
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
              COUNT(*) AS known,
              SUM(CASE WHEN status = 'played' THEN 1 ELSE 0 END) AS reported
         FROM fixture GROUP BY round_id`,
    ).all<{ round_id: number; known: number; reported: number }>();
    const byRound = new Map((counts ?? []).map((c) => [c.round_id, c]));

    return json({
      rounds: rounds.map((round) => ({
        ...round,
        known: byRound.get(round.id)?.known ?? 0,
        reported: byRound.get(round.id)?.reported ?? 0,
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
    const map = await settings(env);
    const firstRound = Number(body.firstRoundDays ?? map['first_round_length_days'] ?? length);
    const count = await layOutWindows(
      env,
      season.id,
      String(body.firstOpensAt ?? ''),
      length,
      actor,
      Number.isFinite(firstRound) && firstRound > 0 ? firstRound : length,
    );
    return json({ rounds: count, firstRoundDays: firstRound });
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

  // --- pre-season ----------------------------------------------------------

  if (path === '/api/preseason' && method === 'GET') {
    const season = await activeSeason(env);
    if (!season) return json({ rows: [], counts: {} });

    const { results } = await env.DB.prepare(
      `SELECT c.display_name, c.discord_username, c.discord_user_id, c.naf_number,
              c.poll_vote, c.preseason_note, c.last_season_note,
              c.tourplay_player_id IS NOT NULL AS on_tourplay,
              COALESCE(t.name, '') AS team_name, COALESCE(t.race, '') AS race,
              COALESCE(d.name, '') AS division, COALESCE(d.tier, 9) AS tier
         FROM coach c
         LEFT JOIN team t ON t.coach_id = c.id
         LEFT JOIN division d ON d.id = COALESCE(t.division_id, c.division_id)
        WHERE c.season_id = ?
        ORDER BY tier, c.display_name`,
    )
      .bind(season.id)
      .all<any>();

    const rows = results ?? [];
    return json({
      season: season.name,
      rows,
      counts: {
        total: rows.length,
        confirmed: rows.filter((r) => r.poll_vote === 'yes' && r.on_tourplay).length,
        awaitingTourplay: rows.filter((r) => r.poll_vote === 'yes' && !r.on_tourplay).length,
        declined: rows.filter((r) => r.poll_vote === 'no').length,
        noResponse: rows.filter((r) => r.poll_vote === '').length,
      },
    });
  }

  if (path === '/api/coaches' && method === 'GET') {
    const season = await activeSeason(env);
    if (!season) return json({ coaches: [] });
    const { results } = await env.DB.prepare(
      // A team's division comes from the draw; before there is one, the
      // coach's own assignment stands in.
      `SELECT c.*, t.name AS team_name, t.race, d.name AS division_name, d.tier AS division_tier
         FROM coach c
         LEFT JOIN team t ON t.coach_id = c.id
         LEFT JOIN division d ON d.id = COALESCE(t.division_id, c.division_id)
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
    return json({ settings: map });
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

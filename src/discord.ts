// Discord transport: verifying what arrives, and posting what goes out.
// The command logic itself lives in commands.ts.

import type { Env } from './types.js';

const API = 'https://discord.com/api/v10';

export const InteractionType = { Ping: 1, ApplicationCommand: 2, MessageComponent: 3, Autocomplete: 4 } as const;
export const ResponseType = { Pong: 1, Reply: 4, DeferredReply: 5 } as const;
export const EPHEMERAL = 64;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Discord signs every interaction with Ed25519 over (timestamp + raw body).
 * An unverified request must be rejected with 401 or Discord will not accept
 * the endpoint at all — and anyone could otherwise forge a forfeit.
 */
export async function verifyInteraction(request: Request, rawBody: string, publicKey: string): Promise<boolean> {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  if (!signature || !timestamp) return false;

  try {
    const key = await crypto.subtle.importKey('raw', hexToBytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + rawBody),
    );
  } catch {
    return false;
  }
}

export function reply(content: string, ephemeral = true): Response {
  return new Response(
    JSON.stringify({
      type: ResponseType.Reply,
      data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: ['users'] } },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

export function pong(): Response {
  return new Response(JSON.stringify({ type: ResponseType.Pong }), {
    headers: { 'content-type': 'application/json' },
  });
}

export interface PostResult {
  ok: boolean;
  messageId: string | null;
  error: string | null;
  /**
   * Discord refused the bot itself, not this one post: the token is missing,
   * or Discord answered 401. Every post fails until the secret is replaced.
   */
  authFailed?: boolean;
}

/** Where the bot's token health is kept, so a dead token outlives the request that found it. */
export const DISCORD_AUTH_SETTING = 'discord_auth_error';

export interface DiscordAuthError {
  since: string;
  last: string;
  error: string;
}

export function parseDiscordAuthError(raw: string | undefined | null): DiscordAuthError | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DiscordAuthError>;
    return parsed && parsed.since && parsed.error
      ? { since: parsed.since, last: parsed.last ?? parsed.since, error: parsed.error }
      : null;
  } catch {
    return null;
  }
}

/**
 * Record whether Discord still accepts the bot. A 401 is remembered, keeping
 * the time it was first seen; any successful post clears it. Only an auth
 * failure is tracked here: a 403 on one channel is that channel's problem,
 * not the token's, and is reported per post instead.
 */
async function noteDiscordHealth(env: Env, result: PostResult): Promise<void> {
  try {
    if (result.ok) {
      await env.DB.prepare(
        "UPDATE setting SET value = '', updated_at = datetime('now') WHERE key = ? AND value != ''",
      )
        .bind(DISCORD_AUTH_SETTING)
        .run();
      return;
    }
    if (!result.authFailed) return;
    const row = await env.DB.prepare('SELECT value FROM setting WHERE key = ?')
      .bind(DISCORD_AUTH_SETTING)
      .first<{ value: string }>();
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const next: DiscordAuthError = {
      since: parseDiscordAuthError(row?.value)?.since ?? stamp,
      last: stamp,
      error: result.error ?? 'unauthorised',
    };
    await env.DB.prepare(
      `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
      .bind(DISCORD_AUTH_SETTING, JSON.stringify(next))
      .run();
  } catch {
    // Health tracking must never turn a post's own result into an exception.
  }
}

export async function postToChannel(env: Env, channelId: string, content: string): Promise<PostResult> {
  if (!env.DISCORD_BOT_TOKEN) {
    const result = { ok: false, messageId: null, error: 'DISCORD_BOT_TOKEN is not set', authFailed: true };
    await noteDiscordHealth(env, result);
    return result;
  }
  if (!channelId) return { ok: false, messageId: null, error: 'no channel configured' };

  let response: Response;
  try {
    response = await fetch(`${API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content, allowed_mentions: { parse: ['users', 'roles'] } }),
    });
  } catch (cause) {
    // Discord unreachable is a failed post like any other, not an exception
    // that aborts the rest of the cron run — and with it the alarm.
    return { ok: false, messageId: null, error: `Discord unreachable: ${String(cause).slice(0, 200)}` };
  }

  let result: PostResult;
  if (!response.ok) {
    result = {
      ok: false,
      messageId: null,
      error: `Discord ${response.status}: ${(await response.text()).slice(0, 300)}`,
      authFailed: response.status === 401,
    };
  } else {
    const body = (await response.json()) as { id?: string };
    result = { ok: true, messageId: body?.id ?? null, error: null };
  }
  await noteDiscordHealth(env, result);
  return result;
}

/**
 * Post once and only once. The dedupe key is what stops a retried cron from
 * nagging the whole league twice.
 */
export async function announceOnce(
  env: Env,
  dedupeKey: string,
  kind: string,
  channelId: string,
  content: string,
): Promise<PostResult & { skipped: boolean }> {
  const claimed = await env.DB.prepare(
    'INSERT INTO announcement (dedupe_key, kind, channel_id, body) VALUES (?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING',
  )
    .bind(dedupeKey, kind, channelId, content)
    .run();

  if (!claimed.meta.changes) {
    return { ok: true, messageId: null, error: null, skipped: true };
  }

  const result = await postToChannel(env, channelId, content);

  if (!result.ok) {
    // Give the claim back. Discord rejects with a non-2xx before delivering, so
    // a failure here means nothing was posted, and holding the dedupe key would
    // suppress this announcement for good — a missing token or a minute of
    // Discord downtime would silently cost the league a whole round's chasing.
    await env.DB.batch([
      env.DB.prepare('INSERT INTO audit (actor, action, subject, detail) VALUES (?, ?, ?, ?)').bind(
        'discord',
        'announce.failed',
        kind,
        JSON.stringify({ dedupeKey, error: result.error }),
      ),
      env.DB.prepare('DELETE FROM announcement WHERE dedupe_key = ? AND posted_at IS NULL').bind(dedupeKey),
    ]);
    return { ...result, skipped: false };
  }

  await env.DB.prepare('UPDATE announcement SET message_id = ?, posted_at = ?, error = NULL WHERE dedupe_key = ?')
    .bind(result.messageId, new Date().toISOString(), dedupeKey)
    .run();

  return { ...result, skipped: false };
}

/**
 * What to tell the Lord Commissioner when the bot has stopped getting through.
 * Kept free of I/O so the wording is tested.
 */
export function discordAlertText(
  authError: DiscordAuthError | null,
  failures: { kind: string; error: string }[],
  mentionUserId: string | null,
): string {
  const lines: string[] = [];
  if (mentionUserId) lines.push(`<@${mentionUserId}>`);
  if (authError) {
    lines.push(
      `**commish-bot cannot post to Discord.** Discord has rejected its token since ${authError.since.slice(0, 10)}` +
        ` (${authError.error.slice(0, 120)}).`,
      'Nothing the bot posts is getting through: round announcements, chase nags, rulings, extension requests.',
      'Fix: put the current bot token into the Worker secret `DISCORD_BOT_TOKEN`. ' +
        'Missed round announcements go out by themselves on the next daily run.',
    );
  }
  const others = failures.filter((f) => !authError || !/^Discord 401|not set/.test(f.error));
  if (others.length > 0) {
    lines.push(`**${others.length} bot post${others.length === 1 ? '' : 's'} failed** on today's run:`);
    for (const failure of others.slice(0, 10)) {
      lines.push(`• ${failure.kind}: ${failure.error.slice(0, 160)}`);
    }
    if (others.some((f) => /^Discord 403/.test(f.error))) {
      lines.push('A 403 means commish-bot lacks View Channel or Send Messages in that channel.');
    }
  }
  return lines.join('\n');
}

/**
 * Tell the Lord Commissioner something is broken, through a channel webhook
 * rather than the bot. A webhook carries its own credential, so it still
 * works when the bot token is exactly what has died. Deduped like any post.
 */
export async function alertOwner(
  env: Env,
  dedupeKey: string,
  content: string,
  mentionUserId: string | null,
): Promise<'sent' | 'already_sent' | 'no_alert_channel' | 'failed'> {
  const url = env.DISCORD_ALERT_WEBHOOK_URL;
  if (!url) return 'no_alert_channel';

  const claimed = await env.DB.prepare(
    "INSERT INTO announcement (dedupe_key, kind, channel_id, body) VALUES (?, 'owner_alert', 'webhook', ?) ON CONFLICT (dedupe_key) DO NOTHING",
  )
    .bind(dedupeKey, content)
    .run();
  if (!claimed.meta.changes) return 'already_sent';

  let error: string | null = null;
  let messageId: string | null = null;
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content,
        username: 'commish-bot alarm',
        allowed_mentions: { users: mentionUserId ? [mentionUserId] : [] },
      }),
    });
    if (response.ok) {
      messageId = ((await response.json().catch(() => ({}))) as { id?: string })?.id ?? null;
    } else {
      error = `webhook ${response.status}: ${(await response.text()).slice(0, 200)}`;
    }
  } catch (cause) {
    error = `webhook unreachable: ${String(cause).slice(0, 200)}`;
  }

  if (error) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO audit (actor, action, subject, detail) VALUES (?, ?, ?, ?)').bind(
        'discord',
        'alert.failed',
        dedupeKey,
        JSON.stringify({ error }),
      ),
      env.DB.prepare('DELETE FROM announcement WHERE dedupe_key = ? AND posted_at IS NULL').bind(dedupeKey),
    ]);
    return 'failed';
  }
  await env.DB.prepare('UPDATE announcement SET message_id = ?, posted_at = ? WHERE dedupe_key = ?')
    .bind(messageId, new Date().toISOString(), dedupeKey)
    .run();
  return 'sent';
}

export function mention(discordUserId: string | null | undefined, fallback: string): string {
  return discordUserId ? `<@${discordUserId}>` : fallback;
}

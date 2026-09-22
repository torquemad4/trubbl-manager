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
}

export async function postToChannel(env: Env, channelId: string, content: string): Promise<PostResult> {
  if (!env.DISCORD_BOT_TOKEN) return { ok: false, messageId: null, error: 'DISCORD_BOT_TOKEN is not set' };
  if (!channelId) return { ok: false, messageId: null, error: 'no channel configured' };

  const response = await fetch(`${API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ content, allowed_mentions: { parse: ['users', 'roles'] } }),
  });

  if (!response.ok) {
    return { ok: false, messageId: null, error: `Discord ${response.status}: ${(await response.text()).slice(0, 300)}` };
  }
  const body = (await response.json()) as { id?: string };
  return { ok: true, messageId: body?.id ?? null, error: null };
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

export function mention(discordUserId: string | null | undefined, fallback: string): string {
  return discordUserId ? `<@${discordUserId}>` : fallback;
}

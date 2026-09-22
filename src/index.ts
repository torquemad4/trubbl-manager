import { handleApi } from './api.js';
import { handleCommand, type Interaction } from './commands.js';
import { InteractionType, pong, verifyInteraction } from './discord.js';
import { tick } from './scheduler.js';
import { PORTAL_HTML } from './ui.js';
import type { Env } from './types.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }

    if (path === '/discord/interactions') {
      return handleInteractions(request, env);
    }

    if (path.startsWith('/api/')) {
      return handleApi(request, env, path);
    }

    if (path === '/' && request.method === 'GET') {
      return new Response(PORTAL_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      tick(env).catch(async (cause) => {
        await env.DB.prepare('INSERT INTO audit (actor, action, subject, detail) VALUES (?, ?, ?, ?)')
          .bind('cron', 'tick.error', null, String(cause).slice(0, 500))
          .run();
      }),
    );
  },
};

async function handleInteractions(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!env.DISCORD_PUBLIC_KEY) return new Response('Discord is not configured', { status: 503 });

  const rawBody = await request.text();
  const verified = await verifyInteraction(request, rawBody, env.DISCORD_PUBLIC_KEY);
  // Discord requires a 401 on a bad signature, and checks for it when you save
  // the endpoint URL. Anything else and it refuses the endpoint outright.
  if (!verified) return new Response('invalid request signature', { status: 401 });

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody) as Interaction;
  } catch {
    return new Response('bad request', { status: 400 });
  }

  if (interaction.type === InteractionType.Ping) return pong();

  if (interaction.type === InteractionType.ApplicationCommand) {
    try {
      const result = await handleCommand(env, interaction);
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
    } catch (cause) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: { content: `That went wrong: ${String(cause).slice(0, 300)}`, flags: 64 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
  }

  return new Response(JSON.stringify({ type: 4, data: { content: 'Unsupported interaction.', flags: 64 } }), {
    headers: { 'content-type': 'application/json' },
  });
}

// Admin portal authentication via Cloudflare Access.
//
// Access terminates the login in front of the Worker and hands us a signed JWT.
// We still verify it: a Worker is reachable on its workers.dev hostname whether
// or not an Access policy sits in front of the custom domain, and an unverified
// header is not an identity.

import type { Env, Viewer } from './types.js';

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

let cachedKeys: { teamDomain: string; keys: Jwk[]; fetchedAt: number } | null = null;
const KEY_TTL_MS = 60 * 60 * 1000;

async function accessKeys(teamDomain: string): Promise<Jwk[]> {
  if (cachedKeys && cachedKeys.teamDomain === teamDomain && Date.now() - cachedKeys.fetchedAt < KEY_TTL_MS) {
    return cachedKeys.keys;
  }
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs returned ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  cachedKeys = { teamDomain, keys, fetchedAt: Date.now() };
  return keys;
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function decodeSegment(segment: string): any {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

/** Verify the Access JWT and return the email it carries, or null with a reason. */
export async function verifyAccess(
  request: Request,
  env: Env,
): Promise<{ email: string | null; reason: string | null }> {
  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    cookieValue(request.headers.get('cookie'), 'CF_Authorization');

  if (!token) return { email: null, reason: 'no Access token on the request' };
  if (!env.ACCESS_TEAM_DOMAIN) return { email: null, reason: 'ACCESS_TEAM_DOMAIN is not configured' };

  const parts = token.split('.');
  if (parts.length !== 3) return { email: null, reason: 'the Access token is not a JWT' };

  let header: any;
  let payload: any;
  try {
    header = decodeSegment(parts[0]!);
    payload = decodeSegment(parts[1]!);
  } catch {
    return { email: null, reason: 'the Access token could not be decoded' };
  }

  const keys = await accessKeys(env.ACCESS_TEAM_DOMAIN);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { email: null, reason: 'the Access token was signed by an unknown key' };

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]!),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) return { email: null, reason: 'the Access token signature did not verify' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    return { email: null, reason: 'the Access token has expired' };
  }
  if (payload.iss && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) {
    return { email: null, reason: 'the Access token came from another team' };
  }
  // An unchecked aud would let a token minted for any other app in the same
  // account through, so treat a missing ACCESS_AUD as a misconfiguration.
  if (!env.ACCESS_AUD) return { email: null, reason: 'ACCESS_AUD is not configured' };
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(env.ACCESS_AUD)) {
    return { email: null, reason: 'the Access token was issued for a different application' };
  }
  if (!payload.email) return { email: null, reason: 'the Access token carries no email' };

  return { email: String(payload.email).toLowerCase(), reason: null };
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export async function viewerFor(request: Request, env: Env): Promise<Viewer> {
  // Local development only: wrangler dev has no Access in front of it.
  if (!env.ACCESS_TEAM_DOMAIN && env.DEV_ADMIN_EMAIL) {
    return { email: env.DEV_ADMIN_EMAIL.toLowerCase(), isAdmin: true, isOwner: true, reason: 'dev override' };
  }

  const { email, reason } = await verifyAccess(request, env);
  if (!email) return { email: null, isAdmin: false, isOwner: false, reason };

  const row = await env.DB.prepare('SELECT email, is_owner FROM admin_user WHERE email = ?')
    .bind(email)
    .first<{ email: string; is_owner: number }>();

  // Bootstrap: the first person through an empty admin table becomes the owner,
  // which is safe because Access has already decided who may reach the Worker.
  if (!row) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_user').first<{ n: number }>();
    if ((count?.n ?? 0) === 0) {
      await env.DB.prepare('INSERT INTO admin_user (email, is_owner) VALUES (?, 1)').bind(email).run();
      return { email, isAdmin: true, isOwner: true, reason: null };
    }
    return { email, isAdmin: false, isOwner: false, reason: 'not on the admin list' };
  }

  return { email, isAdmin: true, isOwner: row.is_owner === 1, reason: null };
}

export function requireAdmin(viewer: Viewer): Response | null {
  if (viewer.isAdmin) return null;
  return new Response(
    JSON.stringify({ error: viewer.email ? `${viewer.email} is not a league admin` : (viewer.reason ?? 'not signed in') }),
    { status: viewer.email ? 403 : 401, headers: { 'content-type': 'application/json' } },
  );
}

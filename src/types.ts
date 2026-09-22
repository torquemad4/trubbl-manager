export interface Env {
  DB: D1Database;

  // Cloudflare Access (admin portal auth)
  ACCESS_TEAM_DOMAIN?: string; // e.g. torquemada.cloudflareaccess.com
  ACCESS_AUD?: string;         // Application Audience tag

  // Discord
  DISCORD_PUBLIC_KEY?: string; // verifies inbound interactions
  DISCORD_BOT_TOKEN?: string;  // posts announcements and command replies
  DISCORD_APP_ID?: string;
  DISCORD_GUILD_ID?: string;

  // Local development only. Never set in production.
  DEV_ADMIN_EMAIL?: string;
}

export type RoundStatus = 'pending' | 'open' | 'closed' | 'settled';

export type FixtureStatus =
  | 'unplayed'
  | 'scheduled'
  | 'played'
  | 'concession'
  | 'no_agreement'
  | 'no_attempt'
  | 'forfeit'
  | 'double_forfeit'
  | 'void';

/** The §3.2 unplayed-game procedure, plus the two catch-all rulings. */
export type RulingKind =
  | 'concession'
  | 'no_agreement'
  | 'no_attempt'
  | 'forfeit'
  | 'double_forfeit'
  | 'void';

export const RULING_KINDS: RulingKind[] = [
  'concession',
  'no_agreement',
  'no_attempt',
  'forfeit',
  'double_forfeit',
  'void',
];

/** Statuses that came from a ruling, which a TourPlay sync must not overwrite. */
export const RULED_STATUSES = new Set<string>([
  'concession',
  'no_agreement',
  'no_attempt',
  'forfeit',
  'double_forfeit',
  'void',
]);

export type ChaseState = 'none' | 'nudged' | 'chased' | 'escalated';

export interface Viewer {
  email: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  reason: string | null;
}

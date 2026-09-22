// Thin helpers over D1. Everything that reads settings or writes audit goes
// through here so the call sites stay about the league, not about SQL.

import { DEFAULT_SCORING, parseNagDays, type Scoring } from './rules.js';
import type { Env } from './types.js';

export interface SeasonRow {
  id: number;
  name: string;
  tourplay_slug: string;
  tourplay_tournament_id: number | null;
  tourplay_phase_id: number | null;
  total_rounds: number;
  timezone: string;
  is_active: number;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

export async function activeSeason(env: Env): Promise<SeasonRow | null> {
  return env.DB.prepare('SELECT * FROM season WHERE is_active = 1 LIMIT 1').first<SeasonRow>();
}

export async function seasonById(env: Env, id: number): Promise<SeasonRow | null> {
  return env.DB.prepare('SELECT * FROM season WHERE id = ?').bind(id).first<SeasonRow>();
}

export async function settings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare('SELECT key, value FROM setting').all<{
    key: string;
    value: string;
  }>();
  const map: Record<string, string> = {};
  for (const row of results ?? []) map[row.key] = row.value;
  return map;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  )
    .bind(key, value)
    .run();
}

function num(map: Record<string, string>, key: string, fallback: number): number {
  const parsed = Number(map[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function scoringFrom(map: Record<string, string>): Scoring {
  return {
    pointsWin: num(map, 'points_win', DEFAULT_SCORING.pointsWin),
    pointsDraw: num(map, 'points_draw', DEFAULT_SCORING.pointsDraw),
    pointsLoss: num(map, 'points_loss', DEFAULT_SCORING.pointsLoss),
    bonusTouchdownThreshold: num(map, 'bonus_touchdown_threshold', DEFAULT_SCORING.bonusTouchdownThreshold),
    bonusTouchdownPoints: num(map, 'bonus_touchdown_points', DEFAULT_SCORING.bonusTouchdownPoints),
    bonusShutoutPoints: num(map, 'bonus_shutout_points', DEFAULT_SCORING.bonusShutoutPoints),
    bonusCasualtyThreshold: num(map, 'bonus_casualty_threshold', DEFAULT_SCORING.bonusCasualtyThreshold),
    bonusCasualtyPoints: num(map, 'bonus_casualty_points', DEFAULT_SCORING.bonusCasualtyPoints),
    concessionScoreWinner: num(map, 'concession_score_winner', DEFAULT_SCORING.concessionScoreWinner),
    concessionScoreLoser: num(map, 'concession_score_loser', DEFAULT_SCORING.concessionScoreLoser),
    noAgreementScore: num(map, 'no_agreement_score', DEFAULT_SCORING.noAgreementScore),
  };
}

export function nagDaysFrom(map: Record<string, string>): number[] {
  return parseNagDays(map['nag_days_before_close'] ?? '7,3,1');
}

export async function audit(
  env: Env,
  actor: string,
  action: string,
  subject: string | null,
  detail: unknown = null,
): Promise<void> {
  await env.DB.prepare('INSERT INTO audit (actor, action, subject, detail) VALUES (?, ?, ?, ?)')
    .bind(actor, action, subject, detail === null ? null : JSON.stringify(detail))
    .run();
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Midnight-anchored ISO instant, so windows close at a sane hour rather than whenever cron ran. */
export function atEndOfDay(date: Date): string {
  const copy = new Date(date);
  copy.setUTCHours(21, 0, 0, 0); // 22:00 BST / 21:00 GMT — late evening in the UK
  return copy.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

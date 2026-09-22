// Read-only client for TourPlay.
//
// TourPlay publishes no documented API and no admin API at all: everything here
// is the JSON its own web app fetches, so it can change without notice and we
// must never assume a field is present. Nothing in this module writes — results
// and registrations are still entered on tourplay.net by hand.

const BASE = 'https://tourplay.net';

/** TourPlay serves JSON only to something that looks like its own front end. */
function browserHeaders(slug: string): HeadersInit {
  return {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-GB,en;q=0.9',
    origin: BASE,
    referer: `${BASE}/en/blood-bowl/${slug}/news`,
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
  };
}

export class TourplayError extends Error {}

async function getJson<T>(path: string, slug: string): Promise<T> {
  const response = await fetch(`${BASE}/${path}`, { headers: browserHeaders(slug) });
  const text = await response.text();

  if (!response.ok) {
    throw new TourplayError(
      `TourPlay GET /${path} returned ${response.status}` +
        (response.status === 401 ? ' (this endpoint needs a logged-in account)' : ''),
    );
  }
  // An HTML body means TourPlay served the SPA shell instead of data, which is
  // how it signals "no such tournament" as often as a 404 does.
  const head = text.slice(0, 20).toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    throw new TourplayError(`TourPlay GET /${path} returned the web page, not JSON`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TourplayError(`TourPlay GET /${path} returned malformed JSON`);
  }
}

/** TourPlay's race names differ from the rulebook's in a handful of places. */
const RACE_ALIASES: Record<string, string> = {
  Necromantic: 'Necromantic Horror',
  Undead: 'Shambling Undead',
  Lizardman: 'Lizardmen',
  Underworld: 'Underworld Denizens',
  Nobility: 'Imperial Nobility',
};

export function raceName(teamRace: string | null | undefined): string {
  if (!teamRace) return '';
  const stripped = teamRace.replace(/_BB\d+$/i, '');
  if (RACE_ALIASES[stripped]) return RACE_ALIASES[stripped]!;
  const spaced = stripped.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return RACE_ALIASES[spaced] ?? spaced;
}

export interface TourplayCategory {
  id: number;
  name: string;
}

export interface TourplayTournament {
  id: number | null;
  name: string;
  slug: string;
  /** TourPlay categories. TRUBBL uses one per division (§3.3). */
  categories: TourplayCategory[];
  initDate: string | null;
  finishDate: string | null;
}

export async function fetchTournament(slug: string): Promise<TourplayTournament> {
  let raw: any;
  try {
    raw = await getJson<any>(`api/tournament/${slug}`, slug);
  } catch (cause) {
    throw new TourplayError(
      `No TourPlay tournament called "${slug}" (${String(cause).replace('Error: ', '')})`,
    );
  }
  return {
    id: raw?.id ?? null,
    name: raw?.name ?? slug,
    slug: raw?.nameNormalized ?? slug,
    categories: (raw?.categories ?? [])
      .filter((c: any) => typeof c?.id === 'number')
      // Keep the name exactly as TourPlay gives it, blank included: an unnamed
      // single category means the season is not divided, and inventing a name
      // here would make it look as though it were.
      .map((c: any) => ({
        id: c.id as number,
        name: String(c?.name ?? c?.categoryName ?? '').trim(),
      })),
    initDate: raw?.initDate ?? null,
    finishDate: raw?.finishDate ?? null,
  };
}

export interface TourplayEntrant {
  playerId: string;
  categoryId: number | null;
  coachName: string;
  teamName: string;
  race: string;
  rosterId: number | null;
  nafNumber: number | null;
  nafVerified: boolean;
  validated: boolean;
  /** TourPlay hides roster details until the season opens (isHiddenRoster). */
  rosterHidden: boolean;
}

/**
 * Everyone registered in the season, validated or not. The pending ones matter:
 * chasing an unvalidated registration is half of what a new season needs.
 */
export async function fetchEntrants(slug: string): Promise<TourplayEntrant[]> {
  const tournament = await fetchTournament(slug);
  const entrants: TourplayEntrant[] = [];
  const seen = new Set<string>();

  for (const { id: categoryId } of tournament.categories) {
    let payload: any;
    try {
      payload = await getJson<any>(`api/inscriptions/${slug}/category/${categoryId}/inscriptions`, slug);
    } catch {
      continue; // one bad category should not lose the rest of the league
    }
    const inner = payload?.[String(categoryId)] ?? {};
    const groups: any[] = Array.isArray(inner) ? [inner] : Object.values(inner);

    for (const rows of groups) {
      for (const row of rows ?? []) {
        const playerId = row?.player?.id;
        if (playerId === undefined || playerId === null) continue;
        const key = String(playerId);
        if (seen.has(key)) continue;
        seen.add(key);

        const naf = row?.player?.nafNumber;
        // An inscription row carries the roster as a nested object, not as
        // teamName/teamRace at the top level. Until the organiser opens the
        // season TourPlay returns those blank, leaving only the short name.
        const roster = row?.roster ?? {};
        const fullName = typeof roster.teamName === 'string' ? roster.teamName.trim() : '';
        const shortName = typeof roster.shortTeamName === 'string' ? roster.shortTeamName.trim() : '';

        entrants.push({
          playerId: key,
          categoryId,
          coachName: row?.player?.userNameToShow ?? '',
          teamName: fullName || shortName,
          race: raceName(roster.teamRace),
          rosterId: typeof roster.id === 'number' ? roster.id : null,
          nafNumber: typeof naf === 'number' && naf > 0 ? naf : null,
          nafVerified: row?.player?.nafVerified === true,
          // state 1 means the organiser has validated the registration.
          validated: row?.state === 1,
          rosterHidden: !fullName,
        });
      }
    }
  }
  return entrants;
}

export interface TourplaySide {
  playerId: string | null;
  coachName: string;
  teamName: string;
  race: string;
  score: number | null;
  casualties: number | null;
}

export interface TourplayMatch {
  matchId: string | null;
  categoryId: number | null;
  round: number;
  order: number;
  state: number | null;
  played: boolean;
  home: TourplaySide;
  away: TourplaySide;
}

function side(roster: any, score: number | null, casualties: number | null): TourplaySide {
  const playerId = roster?.inscription?.player?.id;
  return {
    playerId: playerId === undefined || playerId === null ? null : String(playerId),
    coachName: roster?.inscription?.player?.userNameToShow ?? '',
    teamName: roster?.teamName ?? '',
    race: raceName(roster?.teamRace),
    score,
    casualties,
  };
}

export interface TourplaySchedule {
  phaseId: number;
  currentRound: number;
  totalRounds: number;
  matches: TourplayMatch[];
}

/**
 * The whole season's fixture list. `phases?phaseId=` returns every match in the
 * phase with its round number, so one call covers all rounds — which is what a
 * league needs, as against the single live round a tournament day needs.
 */
export async function fetchSchedule(slug: string, phaseIdHint?: number | null): Promise<TourplaySchedule> {
  const status = await getJson<Record<string, unknown>>(`api/tournament/${slug}/phase-status`, slug);
  const phaseIds = Object.keys(status).map(Number).filter((n) => Number.isFinite(n));
  if (phaseIds.length === 0) {
    throw new TourplayError('That season has no fixtures drawn on TourPlay yet, so there is nothing to import');
  }
  // Prefer the phase we already synced; otherwise the most recent one.
  const phaseId =
    phaseIdHint && phaseIds.includes(phaseIdHint) ? phaseIdHint : phaseIds[phaseIds.length - 1]!;

  const phases = await getJson<any>(`api/tournament/${slug}/phases?phaseId=${phaseId}`, slug);
  const rawMatches: any[] = phases?.matches ?? [];
  const currentRound = Number(phases?.currentRound ?? 0) || 0;

  const matches: TourplayMatch[] = rawMatches.map((m) => {
    const score = m?.scoreResume ?? {};
    const homeScore = numberOrNull(score.totalScoreLocal);
    const awayScore = numberOrNull(score.totalScoreVisitor);
    const state = numberOrNull(m?.state);
    return {
      matchId: m?.matchId === undefined || m?.matchId === null ? null : String(m.matchId),
      categoryId: typeof m?.categoryId === 'number' ? m.categoryId : null,
      round: Number(m?.round ?? currentRound) || 0,
      order: Number(m?.order ?? 0) || 0,
      state,
      // TourPlay has no single "is finished" flag we can rely on, so treat a
      // match as played once it carries a score for both sides.
      played: homeScore !== null && awayScore !== null,
      home: side(m?.rosterLocal, homeScore, numberOrNull(score.casualtiesLocal)),
      away: side(m?.rosterVisitor, awayScore, numberOrNull(score.casualtiesVisitor)),
    };
  });

  const declaredRounds = (phases?.rounds ?? [])
    .map((r: any) => Number(r?.roundNumber))
    .filter((n: number) => Number.isFinite(n));
  const totalRounds = declaredRounds.length
    ? Math.max(...declaredRounds)
    : matches.reduce((max, m) => Math.max(max, m.round), 0);

  return { phaseId, currentRound, totalRounds, matches };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Raw passthrough for the admin "probe" screen. TourPlay's shapes are only ever
 * confirmed against the live site, so keep a way to look at them without a deploy.
 */
export async function probe(path: string, slug: string): Promise<unknown> {
  return getJson<unknown>(path.replace(/^\/+/, ''), slug);
}

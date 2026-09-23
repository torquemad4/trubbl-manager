# TRUBBL Manager

A league manager for TRUBBL: round windows, chasing, forfeits and rulings, with
TourPlay imported and Discord wired in. Runs as a single Cloudflare Worker on
D1, at `trubbl.torquemada.uk`.

Rules implemented: **Season VI v1.1**. Section references throughout the code
point at that document.

## What it does

- **Round windows.** Every round gets an open and close date. Lay a whole
  season out from one start date, then adjust individual rounds. A round drawn
  on TourPlay after that arrives without dates, and the cron gives it a window
  running on from the round before (`round_length_days`), so a mid-season draw
  never needs the layout re-run. Round one is never invented that way.
- **Chasing.** On a cron it posts the outstanding-games list to Discord at
  configurable intervals before the deadline (7, 3 and 1 days by default), then
  daily once a round is overdue, naming the coaches.
- **Extensions.** Coaches ask with `/trubbl extend`; you grant or refuse in the
  portal. A granted extension takes that one fixture out of the chase list
  without moving the round.
- **Divisions.** Premier, Second and Third (§3.3), imported from TourPlay's
  categories. Each is scored as its own competition with its own table.
- **Unplayed games.** The full §3.2 procedure, from the portal or with
  `/trubbl forfeit`: (a) one coach tried and got no response → 2-0 concession;
  (b) both tried in good faith → 1-1 draw; (c) neither tried → 0-0 draw. A
  ruling overrides TourPlay, survives every later sync, and is reversible —
  the superseded ruling is kept, not deleted.
- **Standings.** §2.4 scoring in full, including the bonus points, with the
  real tiebreakers and concessions given tracked per team.
- **TourPlay import.** Coaches, teams, fixtures and results, on the cron and on
  demand. Pending registrations are counted so you know who still needs
  validating.

## How the pieces divide

TourPlay is the source of truth for **who is in the league and what the results
were**. Every `tp_`-prefixed column is a mirror and is overwritten on each sync.

This app owns **everything TourPlay has no concept of**: window dates,
extensions, chase state, rulings, Discord links, the audit trail.

TourPlay has no admin API and no write API of any kind — its JSON is what its
own front end fetches. So results are still entered on tourplay.net by the
coaches or by you. Nothing here writes back to TourPlay, and nothing can.

## Setup

### 1. Cloudflare

The D1 database `trubbl` already exists (`42a7db67-c76c-4a03-8cc2-a8667d7d2bf5`)
with the schema applied.

```bash
npm install
npx wrangler deploy
```

Then add the custom domain `trubbl.torquemada.uk` — the route is already in
`wrangler.jsonc`, so deploying with the zone on the account is enough.

### 2. Cloudflare Access (this gates the admin portal)

Create a self-hosted Access application for `trubbl.torquemada.uk`, with a
policy allowing your email. Then set the two vars in `wrangler.jsonc`:

- `ACCESS_TEAM_DOMAIN` — e.g. `torquemada.cloudflareaccess.com`
- `ACCESS_AUD` — the application's Audience tag

**Until both are set, nobody can reach the portal**, which is deliberate: the
Worker verifies the Access JWT itself rather than trusting a header, because the
`workers.dev` hostname is reachable whether or not Access sits in front of the
custom domain.

The first email through an empty admin table becomes the owner. Access has
already decided who may reach the Worker by then.

One path must stay outside the Access policy: **`/discord/interactions`**.
Discord cannot log in. Add a bypass rule for that path, or Discord will never
be able to reach the endpoint.

### 3. Discord

Create an application at <https://discord.com/developers/applications>, add a
bot, and invite it to the TRUBBL server with the `bot` and
`applications.commands` scopes and permission to send messages.

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY   # Application -> General Information
npx wrangler secret put DISCORD_BOT_TOKEN    # Application -> Bot
```

Set `DISCORD_APP_ID` and `DISCORD_GUILD_ID` in `wrangler.jsonc`, then register
the commands:

```bash
DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npm run discord:register
```

Finally set the **Interactions Endpoint URL** on the Discord application to
`https://trubbl.torquemada.uk/discord/interactions`. Discord verifies it by
sending a deliberately bad signature and expecting a 401, which the Worker
returns.

In the portal's Settings tab, fill in the channel ids (announcements, chase,
admin) and the admin role id — `/trubbl forfeit` checks that role.

### 4. Import the season

Open the portal and give it the slug `trubbl-season-7`. That imports divisions,
coaches, teams, rounds and fixtures. Then go to Rounds, set a start date and a
window length (14 days per §3.2), and apply it across the season.

Divisions come from TourPlay's categories, ordered as TourPlay lists them —
Premier first. Check the Coaches tab after the first import and correct any team
whose division did not come through.

## Commands

| Command | Who | What |
|---|---|---|
| `/trubbl status` | anyone | Where the round stands |
| `/trubbl mygame` | linked coach | Your fixture and its deadline |
| `/trubbl outstanding` | anyone | Everything still to play |
| `/trubbl table` | anyone | The league table |
| `/trubbl link naf:<n>` | anyone | Link Discord to a TourPlay coach |
| `/trubbl schedule when:<date>` | linked coach | Note an agreed date |
| `/trubbl extend days:<n>` | linked coach | Ask for more time |
| `/trubbl forfeit match:<id> outcome:<a\|b\|c>` | admin role | Rule on an unplayed game (§3.2) |

## The scoring, and one thing it does not do

§2.4 pays bonus points on top of the result: one each for 3+ touchdowns scored,
conceding none, and causing 3+ casualties. A game is worth up to **6** points,
not 3. Casualties come from TourPlay, so they need logging during the game —
§2.2 already makes that mandatory.

Tiebreakers are head-to-head, then net TD, then net CAS, then net TD + net CAS.
Head-to-head is not a total order, so it is applied as a mini-league within each
group of teams level on points, and anything still level falls through.

**No ruling earns a bonus point**, which is a deliberate departure from the
letter of the rules. Read literally, the §3.2(c) 0-0 draw pays the "no TDs
conceded" bonus to both sides: 2 points each for neither coach organising the
game, against 0 for turning up and losing 0-1. Ignoring a fixture would outscore
playing one. Rulings therefore pay base points only — (a) 3-0, (b) and (c) 1
each. If you would rather the rules were followed to the letter, set
`bonus_shutout_points` to 0 or raise it with the coaches.

## Settings worth understanding

**`auto_forfeit_on_close`** is `false` by default, which suits a league §3.2
calls "loosely enforced". Turned on, a window expiring with a game unplayed and
no extension granted applies **§3.2(c)** — a 0-0 draw. It is never (a) or (b),
because telling those apart means knowing who actually reached out, which only
the Lord Commissioner can judge. Reversible once you know more.

**`nag_days_before_close`** fires on exact thresholds. A nag missed because the
cron did not run that day does not pile up and fire later.

Every Discord post is claimed under a dedupe key before it is sent, so a retried
or double-fired cron cannot nag the league twice. A post that *fails* releases
its claim so the next run retries it, and records the failure in the audit log.

## Development

```bash
npm test          # the rules: windows, forfeits, standings
npm run typecheck
npx wrangler d1 migrations apply trubbl --local
npx wrangler dev --local
```

`.dev.vars` with `DEV_ADMIN_EMAIL=you@example.com` stands in for Access locally.
It only applies when `ACCESS_TEAM_DOMAIN` is unset, so it cannot weaken
production.

TourPlay blocks datacentre IPs, so the import cannot be exercised from a dev
sandbox — only from the deployed Worker. The admin API has
`GET /api/tourplay/probe?path=api/tournament/trubbl-season-7` for looking at raw
TourPlay JSON from production when a field mapping needs checking.

## Layout

```
src/tourplay.ts   read-only TourPlay client
src/rules.ts      windows, §2.4 scoring, §3.2 rulings, standings — pure, tested
src/sync.ts       TourPlay -> D1, never clobbering a ruling
src/scheduler.ts  the cron: sync, move windows on, chase
src/discord.ts    signature verification and posting
src/commands.ts   the /trubbl subcommands
src/auth.ts       Cloudflare Access JWT verification
src/api.ts        admin REST
src/ui.ts         the portal, served inline
```

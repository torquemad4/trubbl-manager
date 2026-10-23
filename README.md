# TRUBBL Manager

A league helper for TRUBBL: round windows and round announcements, with
results read from TourPlay's own Discord bot. Runs as a single Cloudflare
Worker on D1, at `trubbl.torquemada.uk`, with the public rules pack at
`trubbl-rules.torquemada.uk`.

## Why it reads Discord, not TourPlay

Until 29 Sep 2026 the manager read TourPlay's undocumented JSON. TourPlay then
put an anti-bot proof-of-work challenge in front of that API. Getting past a
gate an operator has deliberately put up is not something this project does,
so the TourPlay client was deleted on 23 Oct 2026.

What TourPlay still does, officially, is post every match into the league's
Discord through its own integration (#league-result-input). The manager reads
those posts with the bot's normal Discord access:

| Post | What the manager takes from it |
|---|---|
| End of the match | final score, by TourPlay match id |
| Match suspension resolved | an organiser's ruling, with its score |
| Match scheduled | the date both coaches agreed |

Each carries the division and round in its footer. In-match events (touchdowns,
casualties, injuries) are ignored: the end-of-match score is authoritative for
touchdowns, and counting casualty events disagrees with TourPlay's own figure in
about a quarter of Season 6 games.

## What it does — and what it deliberately no longer does

- **Results.** Read from the feed every morning, or on demand from the portal.
  `/trubbl status` lists the results reported this round.
- **Round windows.** Every round gets an open and close date. Lay a whole season
  out from one start date, then adjust individual rounds. A round first seen in
  the feed arrives without dates, and the cron gives it a window running on from
  the round before (`round_length_days`). Round one is never invented that way.
- **Round announcements.** One post in the dates channel and one in
  announcements when a round opens. Rounds open and close by date.
- **Alarms.** A dead bot token, a failed post, or a feed that cannot be read
  raises one alarm a day through a webhook (below).

Removed on 23 Oct 2026, because the feed cannot support them correctly:

- **The table**, which needs exact casualty totals for the §2.4 bonus and the
  net-CAS tiebreak. TourPlay shows the table.
- **Chasing, overdue posts, `outstanding`, `mygame`, extensions, rulings.**
  These need the full draw, and the feed only reveals a fixture once it is
  scheduled or played. Built on a partial draw they accuse coaches of games they
  have already played, which is what happened between 11 and 23 Oct 2026.

The scoring rules (`src/rules.ts`) are kept, tested, for the self-built system
that is meant to replace TourPlay.

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

Give the bot **Message Content** (Developer Portal → Bot → Privileged Gateway
Intents) and read access to #league-result-input, or it sees TourPlay's posts
with their content blank. In the portal's Settings tab, fill in the dates and
announcements channel ids.

### 4. Connect TourPlay's Discord integration

In TourPlay's organiser settings, connect the competition to the league's
Discord channel. The manager finds TourPlay's posts in the channel named by
`tourplay_feed_channel_id`, trusting only the bot user in `tourplay_feed_bot_id`
(both default to TRUBBL's).

## Commands

| Command | Who | What |
|---|---|---|
| `/trubbl status` | anyone | The round's dates and the results reported so far |

Any of the retired subcommands still cached in a Discord client gets a reply
saying it has been retired.

## Posting and alarms

Every Discord post is claimed under a dedupe key before it is sent, so a retried
or double-fired cron cannot post the same thing twice. A post that *fails* releases
its claim and records the failure in the audit log. The "round is open" posts
are retried on every daily run while the round is open and its window has not
closed, so an announcement Discord refused goes out once the fault is fixed.

**When the bot stops getting through.** A 401 from Discord means the bot token
itself is dead (usually regenerated in the developer portal without updating
the Worker), and every post fails until `DISCORD_BOT_TOKEN` is replaced. The
Worker records that, shows a red banner on the portal dashboard, and at the end
of each daily run sends one alarm a day through `DISCORD_ALERT_WEBHOOK_URL` —
a channel webhook, which carries its own credential and so still works when
the bot token is the thing that died. It mentions the Discord user in the
`alert_discord_user_id` setting. Other failed posts on a run (a 403 means the
bot lacks permission in that channel), and a TourPlay feed that could not be
read, are included in the same alarm. With no webhook configured, the portal
banners are the only warning.

```bash
npx wrangler secret put DISCORD_ALERT_WEBHOOK_URL   # Channel -> Integrations -> Webhooks -> Copy URL
```

## Development

```bash
npm test          # windows, the feed parser, scoring, alarms
npm run typecheck
npx wrangler d1 migrations apply trubbl --local
npx wrangler dev --local
```

`.dev.vars` with `DEV_ADMIN_EMAIL=you@example.com` stands in for Access locally.
It only applies when `ACCESS_TEAM_DOMAIN` is unset, so it cannot weaken
production.

## Layout

```
src/feed.ts       TourPlay's Discord posts -> D1: parser (pure, tested) and ingest
src/rules.ts      windows; §2.4 scoring and §3.2 rulings kept for the replacement
src/scheduler.ts  the cron: read the feed, move windows on, announce rounds
src/discord.ts    signature verification, posting, alarms
src/commands.ts   /trubbl status
src/auth.ts       Cloudflare Access JWT verification
src/api.ts        admin REST
src/ui.ts         the portal, served inline
```

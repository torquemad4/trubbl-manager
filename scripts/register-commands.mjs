// Registers /trubbl and its subcommands with Discord.
//
// Guild commands appear immediately; global ones take up to an hour, so this
// registers to DISCORD_GUILD_ID when it is set.
//
//   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npm run discord:register

const appId = process.env.DISCORD_APP_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !token) {
  console.error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN.');
  process.exit(1);
}

const SUBCOMMAND = 1;

// Since 23 Oct 2026 the bot reads results from TourPlay's Discord feed and
// offers only status. Registering this list replaces the old eight
// subcommands, so they vanish from Discord's menu.
const command = {
  name: 'trubbl',
  description: 'TRUBBL league — round dates and results',
  options: [{ type: SUBCOMMAND, name: 'status', description: 'Where the current round stands, and results so far' }],
};

const url = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

const response = await fetch(url, {
  method: 'PUT',
  headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify([command]),
});

if (!response.ok) {
  console.error(`Discord ${response.status}:`, await response.text());
  process.exit(1);
}
console.log(`Registered /trubbl${guildId ? ` to guild ${guildId}` : ' globally'}.`);

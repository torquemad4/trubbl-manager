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

const STRING = 3;
const INTEGER = 4;
const SUBCOMMAND = 1;

const command = {
  name: 'trubbl',
  description: 'TRUBBL league — rounds, fixtures and deadlines',
  options: [
    { type: SUBCOMMAND, name: 'status', description: 'Where the current round stands' },
    { type: SUBCOMMAND, name: 'mygame', description: 'Your fixture this round and its deadline' },
    { type: SUBCOMMAND, name: 'outstanding', description: 'Every game still to play this round' },
    { type: SUBCOMMAND, name: 'table', description: 'The league table' },
    {
      type: SUBCOMMAND,
      name: 'link',
      description: 'Link your Discord account to your TourPlay coach',
      options: [
        { type: INTEGER, name: 'naf', description: 'Your NAF number', required: false },
        { type: STRING, name: 'name', description: 'Your TourPlay coach name, if you have no NAF number', required: false },
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'schedule',
      description: 'Note the date you have agreed for your game',
      options: [{ type: STRING, name: 'when', description: 'YYYY-MM-DD or YYYY-MM-DD HH:MM', required: true }],
    },
    {
      type: SUBCOMMAND,
      name: 'extend',
      description: 'Ask for more time on your fixture',
      options: [
        { type: INTEGER, name: 'days', description: 'How many extra days (1–28)', required: true },
        { type: STRING, name: 'reason', description: 'Why', required: false },
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'forfeit',
      description: 'Admin: rule a forfeit on a fixture',
      options: [
        { type: INTEGER, name: 'match', description: 'Fixture id, from the portal', required: true },
        {
          type: STRING,
          name: 'side',
          description: 'Who is at fault',
          required: true,
          choices: [
            { name: 'home', value: 'home' },
            { name: 'away', value: 'away' },
            { name: 'both', value: 'both' },
          ],
        },
        { type: STRING, name: 'reason', description: 'Why', required: false },
      ],
    },
  ],
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

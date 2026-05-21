// One-off: push the slash command JSON to Discord. Run after adding/changing commands.
//   node scripts/register-commands.js          -> guild scope (instant, dev)
//   node scripts/register-commands.js --global -> global scope (slow propagation)
//
// We default to guild scope because the spec targets a single server.

import { REST, Routes } from 'discord.js';
import { env } from '../src/utils/config.js';
import { commandData } from '../src/commands/index.js';

const global = process.argv.includes('--global');

async function main() {
  const rest = new REST({ version: '10' }).setToken(env.discord.token);

  const route = global
    ? Routes.applicationCommands(env.discord.clientId)
    : Routes.applicationGuildCommands(env.discord.clientId, env.discord.guildId);

  console.log(`Registering ${commandData.length} commands (${global ? 'global' : 'guild'})...`);
  await rest.put(route, { body: commandData });
  console.log('done.');
}

main().catch((e) => { console.error(e); process.exit(1); });

// User-facing message templates that appear in more than one place.
// Kept here so /link's DM, the verify panel's ephemeral reply, and any future
// surface stay in sync without copy-paste drift.

import { env } from './config.js';
import { getSetting } from '../systems/settings/index.js';

/**
 * The "here's your code + how to use it" instructions. Used by:
 *   - /link slash command (DM body)
 *   - verify panel button handler (ephemeral reply)
 */
export function buildVerifyInstructions(code) {
  const verifyAddr = env.servers.verifyAddress || '(VERIFY_SERVER_ADDRESS not set)';
  const bedrockName = env.servers.bedrockFriendName;

  const bedrockBlock = bedrockName
    ? (
        `📱 **Bedrock/Console players:**\n` +
        `Add \`${bedrockName}\` on the friends page and then join them!\n` +
        `Once in-game, type \`${code}\` in chat.`
      )
    : (
        `📱 **Bedrock/Console players:**\n` +
        `Bedrock support is being set up. Java only for now.`
      );

  return (
    `**Your verification code: \`${code}\`**\n\n` +
    `🖥️ **Java players:**\n` +
    `Server: \`${verifyAddr}\`\n` +
    `Run \`/verify ${code}\` in chat OR just type \`${code}\`\n\n` +
    `${bedrockBlock}\n\n` +
    `You'll be kicked when linked, then go find a sponsor to play on ${getSetting('bot_persona_name')}.\n` +
    `Code expires in ${getSetting('link_code_ttl_minutes')} minutes.`
  );
}

/**
 * Reply shown when someone tries to /link or click the verify button while
 * already linked. Status-gated: triggers for linked/sponsee/trusted/banned.
 */
export function alreadyLinkedMessage(mcName) {
  return (
    `You're already linked to MC account \`${mcName}\`. ` +
    `If you need to unlink, run \`/unlink\`.`
  );
}

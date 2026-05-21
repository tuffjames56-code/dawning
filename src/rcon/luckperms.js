// LuckPerms RCON helpers. Phase 2's sponsor system will call these to grant
// or revoke the in-game group tied to a status change (sponsee, trusted...).
//
// Not wired into any flow yet - the sponsor system imports these directly
// when it lands. Group names live in env.luckperms.* (config.js) so they're
// easy to rename per deployment without touching code.

import { rconSend } from './client.js';

// Sets the user's primary parent group. LuckPerms replaces any existing parent,
// so this is a "switch to this group" not "add this group".
export async function setLpGroup(mcName, groupName) {
  return rconSend(`lp user ${mcName} parent set ${groupName}`);
}

// Resets the user back to the default group. Symmetric with setLpGroup -
// used when removing a sponsorship or banning.
export async function clearLpGroup(mcName) {
  return rconSend(`lp user ${mcName} parent set default`);
}

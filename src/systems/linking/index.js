// Linking is now done via HTTP from the verify-mod (see src/api/server.js).
// The mineflayer whisper event re-emission in src/mineflayer/bot.js stays
// registered so future systems can use it, but no link parser runs here.
//
// Kept as a no-op stub so the call site in index.js doesn't need to change.

export function registerLinking(/* discordClient */) {
  // intentionally empty - HTTP /verify endpoint replaces this in phase 2.
}

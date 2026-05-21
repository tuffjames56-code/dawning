// Custom-id keyed registries that the Discord interaction router consults.
// Panel modules add themselves on import-side-effect.
//
// Convention: customId is "<panel>:<action>[:<arg1>:<arg2>...]"
// Routing tries an exact match first, then greedy prefix match (trimming
// trailing `:`-segments) so handlers can register on a static prefix and
// receive the remaining segments as args. Example:
//
//   buttonHandlers.set('admin:settings:set', (i, key) => {...})
//   // matches customId "admin:settings:set:link_code_ttl_minutes"
//   // handler is called with (interaction, "link_code_ttl_minutes")

export const buttonHandlers     = new Map();
export const modalHandlers      = new Map();
export const selectMenuHandlers = new Map();

// Used by bot/client.js. Exported here so all routing logic lives next to
// the registries themselves.
export function resolveHandler(registry, customId) {
  let handler = registry.get(customId);
  if (handler) return { handler, args: [] };
  const parts = customId.split(':');
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(':');
    handler = registry.get(prefix);
    if (handler) return { handler, args: parts.slice(i) };
  }
  return null;
}

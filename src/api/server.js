// HTTP server for verify-mod -> bot communication. Plain node:http so we
// don't pull in express; small surface area.
//
// All routes use POST + JSON. Auth is a shared `sharedSecret` field in the body,
// timing-safe compared against MOD_API_SECRET. Routes:
//
//   POST /verify        body { mcUuid, mcName, code, sharedSecret }
//                       resp { success: bool, message: string }
//                       performs the Discord<->MC link; DMs the user on success.
//
//   POST /check-linked  body { mcUuid, sharedSecret }
//                       resp { linked: bool, mcName: string|null }
//                       lookup by UUID (stable); used by the mod's JOIN check
//                       to kick already-linked players off the verify server.

import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { performLink } from '../systems/linking/perform.js';
import { getUserByMcUuid } from '../db/queries.js';
import { getSetting } from '../systems/settings/index.js';
import { setNicknameToMc } from '../utils/discord-nickname.js';
import { postPushEvent } from '../changelog/index.js';

const log = logger.child('api');

// Lightweight in-memory stats consumed by the System Info subpanel.
export const apiStats = {
  lastRequestAt: null,
  recent: [], // unix ms timestamps; trimmed to last hour on read
};

function noteRequest() {
  const now = Date.now();
  apiStats.lastRequestAt = now;
  apiStats.recent.push(now);
  if (apiStats.recent.length > 5000) apiStats.recent.shift();
}

export function recentApiRequestCount() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  apiStats.recent = apiStats.recent.filter((t) => t >= cutoff);
  return apiStats.recent.length;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 16 * 1024) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function secretMatches(provided) {
  const expected = env.api.secret || '';
  if (!expected || typeof provided !== 'string' || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---------- route handlers ----------

async function handleVerify(body, discordClient) {
  const { mcUuid, mcName, code } = body;
  if (!mcUuid || !mcName || !code) {
    return { status: 400, body: { success: false, message: 'missing fields' } };
  }

  // Hard gate. When maintenance is on, in-flight codes still fail closed.
  if (getSetting('maintenance_mode')) {
    return { status: 200, body: { success: false, message: 'Linking is temporarily disabled.' } };
  }

  const result = await performLink({ mcUuid, mcName, code });

  // Best-effort post-link side effects. DM and role are gated by separate
  // settings so admins can toggle each independently.
  if (result.success && result.discordId) {
    if (getSetting('send_link_dms')) {
      try {
        const user = await discordClient.users.fetch(result.discordId);
        const displayName = String(result.mcName ?? mcName).replace(/^\./, '');
        const requestChannel = env.discord.requestSponsorChannelId
          ? `<#${env.discord.requestSponsorChannelId}>`
          : '#request-sponsor';
        await user.send(
          `✅ Your Discord is linked to MC account \`${displayName}\`.\n` +
          `To play on the server, ask a trusted member to sponsor you via ${requestChannel}.`,
        );
      } catch (e) {
        log.warn(`could not DM ${result.discordId}: ${e.message}`);
      }
    }

    if (env.discord.verifiedRoleId && getSetting('assign_verified_role')) {
      try {
        const guild = await discordClient.guilds.fetch(env.discord.guildId);
        const member = await guild.members.fetch(result.discordId);
        await member.roles.add(env.discord.verifiedRoleId, 'auto-assigned on MC link');
      } catch (e) {
        log.warn(`could not add Verified role to ${result.discordId}: ${e.message}`);
      }
    }

    // Best-effort nickname sync. Always runs; never blocks the verify HTTP
    // response.
    setNicknameToMc(discordClient, result.discordId, result.mcName ?? mcName)
      .catch((e) => log.warn(`nickname sync failed: ${e.message}`));
  }

  return { status: 200, body: { success: result.success, message: result.message } };
}

async function handleCheckLinked(body) {
  const { mcUuid } = body;
  if (!mcUuid) {
    return { status: 400, body: { linked: false, mcName: null } };
  }
  const user = await getUserByMcUuid(mcUuid);
  const linked = !!(user && user.status && user.status !== 'none');
  return { status: 200, body: { linked, mcName: linked ? user.mc_name : null } };
}

// Mod routes share a body-secret auth model. GitHub uses its own HMAC header
// auth, so it's routed separately below.
const MOD_ROUTES = {
  'POST /verify':       handleVerify,
  'POST /check-linked': handleCheckLinked,
};

// ---------- GitHub webhook ----------

// Verifies GitHub's X-Hub-Signature-256 header against env.api.githubSecret.
// If no secret is configured we fail closed: the webhook is rejected.
function verifyGithubSignature(raw, signatureHeader) {
  const secret = env.api.githubSecret || '';
  if (!secret) return false;
  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

async function handleGithubWebhook(req, raw, discordClient) {
  const sig    = req.headers['x-hub-signature-256'];
  const event  = req.headers['x-github-event'];
  if (!verifyGithubSignature(raw, sig)) {
    log.warn(`github webhook auth fail from ${req.socket.remoteAddress}`);
    return { status: 401, body: { ok: false } };
  }
  if (event === 'ping') return { status: 200, body: { ok: true, message: 'pong' } };
  if (event !== 'push') return { status: 200, body: { ok: true, ignored: event } };

  let payload;
  try { payload = JSON.parse(raw); }
  catch { return { status: 400, body: { ok: false, message: 'invalid json' } }; }

  const result = await postPushEvent(discordClient, payload);
  return { status: 200, body: result };
}

// ---------- server ----------

export function startApiServer(discordClient) {
  const server = http.createServer(async (req, res) => {
    const key = `${req.method} ${req.url}`;
    noteRequest();

    try {
      // GitHub webhook: HMAC-signed, separate auth model.
      if (key === 'POST /github') {
        const raw = await readBody(req);
        const { status, body } = await handleGithubWebhook(req, raw, discordClient);
        return sendJson(res, status, body);
      }

      // Verify-mod routes: body-secret auth.
      const handler = MOD_ROUTES[key];
      if (!handler) {
        sendJson(res, 404, { success: false, message: 'not found' });
        return;
      }

      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); }
      catch { return sendJson(res, 400, { success: false, message: 'invalid json' }); }

      if (!secretMatches(body?.sharedSecret)) {
        log.warn(`auth fail on ${key} from ${req.socket.remoteAddress}`);
        return sendJson(res, 401, { success: false, message: 'unauthorized' });
      }

      const { status, body: respBody } = await handler(body, discordClient);
      sendJson(res, status, respBody);
    } catch (e) {
      log.error(`error on ${key}:`, e);
      sendJson(res, 500, { success: false, message: 'internal error' });
    }
  });

  server.listen(env.api.port, () => log.info(`HTTP API listening on :${env.api.port}`));
  return server;
}

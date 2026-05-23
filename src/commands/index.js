import { Collection } from 'discord.js';

// User-facing
import * as link from './link.js';
import * as unlink from './unlink.js';
import * as verifySetup from './verify-setup.js';
import * as sponsorSetup from './sponsor-setup.js';
import * as requestSponsorSetup from './request-sponsor-setup.js';

// Phase 3 (bounty)
import * as bountySetup     from './bounty-setup.js';
import * as bountyBlocklist from './bounty-blocklist.js';

// Admin: panel
import * as adminSetup from './admin-setup.js';

// Admin: settings
import * as adminConfigList   from './admin-config-list.js';
import * as adminConfigGet    from './admin-config-get.js';
import * as adminConfigSet    from './admin-config-set.js';
import * as adminConfigReset  from './admin-config-reset.js';

// Admin: users
import * as adminUserInfo            from './admin-user-info.js';
import * as adminUserStatus          from './admin-user-status.js';
import * as adminUserForceSponsor    from './admin-user-force-sponsor.js';
import * as adminUserClearCooldowns  from './admin-user-clear-cooldowns.js';
import * as adminUserResetStrikes    from './admin-user-reset-strikes.js';
import * as adminUserForceUnlink     from './admin-user-force-unlink.js';
import * as adminUserDm              from './admin-user-dm.js';

// Admin: sponsorships
import * as adminForceSponsor   from './admin-force-sponsor.js';
import * as adminForceUnsponsor from './admin-force-unsponsor.js';
import * as adminForcePromote   from './admin-force-promote.js';
import * as adminSponsorPunish  from './admin-sponsor-punish.js';

// Admin: operations
import * as adminRefreshPanels from './admin-refresh-panels.js';
import * as adminTriggerTask   from './admin-trigger-task.js';
import * as adminMaintenance   from './admin-maintenance.js';

// Admin: system / audit
import * as adminSystemInfo     from './admin-system-info.js';
import * as adminAuditLog       from './admin-audit-log.js';
import * as adminSettingsAudit  from './admin-settings-audit.js';
import * as adminClearUnlinkCooldown from './admin-clear-unlink-cooldown.js';
import * as adminSyncNicknames      from './admin-sync-nicknames.js';
import * as block      from './block.js';
import * as unblock    from './unblock.js';
import * as blocklist  from './blocklist.js';
import * as say        from './say.js';
import * as giveaway   from './giveaway.js';
import * as poll       from './poll.js';
import * as info       from './info.js';
import * as online     from './online.js';
import * as fun        from './fun.js';
import * as reactionRoles from './reaction-roles.js';
import * as ticketSetup   from './ticket-setup.js';
import * as adminIp       from './admin-ip.js';

const all = [
  link, unlink, verifySetup, sponsorSetup, requestSponsorSetup,
  bountySetup, bountyBlocklist,
  adminSetup,
  adminConfigList, adminConfigGet, adminConfigSet, adminConfigReset,
  adminUserInfo, adminUserStatus, adminUserForceSponsor,
  adminUserClearCooldowns, adminUserResetStrikes, adminUserForceUnlink, adminUserDm,
  adminForceSponsor, adminForceUnsponsor, adminForcePromote, adminSponsorPunish,
  adminRefreshPanels, adminTriggerTask, adminMaintenance,
  adminSystemInfo, adminAuditLog, adminSettingsAudit,
  adminClearUnlinkCooldown,
  adminSyncNicknames,
  block, unblock, blocklist, say,
  giveaway, poll, info, online, fun,
  reactionRoles, ticketSetup, adminIp,
];

export const commands = new Collection();
for (const c of all) commands.set(c.data.name, c);

export const commandData = all.map((c) => c.data.toJSON());

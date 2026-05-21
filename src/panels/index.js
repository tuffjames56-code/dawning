// Barrel that triggers panel handler registration via import side-effects.
// Each module's top-level code adds handlers to the registry maps.

export { buttonHandlers, modalHandlers, selectMenuHandlers, resolveHandler } from './registry.js';

import './verify.js';
import './unlink-confirm.js';
import './admin.js';
import './admin-settings.js';
import './admin-users.js';
import './admin-sponsorships.js';
import './admin-operations.js';
import './admin-system-info.js';
import './sponsor.js';
import './request-sponsor.js';
import './bounty.js';
import './giveaway.js';
import './tickets.js';

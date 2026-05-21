// Runtime-tunable settings. Backed by the `settings` Postgres table and an
// in-memory cache loaded on bot startup. getSetting() is synchronous (reads
// cache, falls back to the registered default). Writes go through
// setSetting()/resetSetting(), which mutate DB + cache + append an audit row.
//
// Lifecycle (called from index.js bootstrap):
//   registerDefaults();   // sync - populates settingDefs
//   await initSettings(); // async - loads cache from DB
//   <bot starts accepting interactions; getSetting() is safe>
//
// Throwing on unknown keys is deliberate: forces every setting to be declared
// in defaults.js, which is where the admin panel UI sources metadata.

import { supabase } from '../../db/client.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('settings');

// key -> { type, defaultValue, description, min, max, category }
const settingDefs = new Map();

// key -> typed override (only present when DB has a value)
const cache = new Map();

let inited = false;

// ---------- type plumbing ----------

function coerce(type, raw) {
  if (raw === null || raw === undefined) {
    throw new Error('value is null/undefined');
  }
  switch (type) {
    case 'int': {
      const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      if (!Number.isInteger(n)) throw new Error(`not an integer: ${raw}`);
      return n;
    }
    case 'float': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isFinite(n)) throw new Error(`not a finite number: ${raw}`);
      return n;
    }
    case 'bool': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).toLowerCase();
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
      throw new Error(`not a boolean: ${raw}`);
    }
    case 'string':
      return String(raw);
    default:
      throw new Error(`unknown type: ${type}`);
  }
}

function validateBounds(meta, value) {
  if (meta.type === 'int' || meta.type === 'float') {
    if (meta.min !== undefined && value < meta.min) {
      throw new Error(`below min ${meta.min}: ${value}`);
    }
    if (meta.max !== undefined && value > meta.max) {
      throw new Error(`above max ${meta.max}: ${value}`);
    }
  }
}

// ---------- public API ----------

export function registerSetting({ key, defaultValue, type, description, min, max, category = 'misc' }) {
  if (settingDefs.has(key)) throw new Error(`Setting already registered: ${key}`);
  if (!type) throw new Error(`registerSetting(${key}): missing type`);
  const coerced = coerce(type, defaultValue);
  validateBounds({ type, min, max }, coerced);
  settingDefs.set(key, { type, defaultValue: coerced, description: description ?? '', min, max, category });
}

export async function initSettings() {
  const { data, error } = await supabase.from('settings').select('*');
  if (error) throw error;
  cache.clear();
  for (const row of data ?? []) {
    const meta = settingDefs.get(row.key);
    let parsed;
    try { parsed = JSON.parse(row.value); }
    catch { parsed = row.value; }
    if (!meta) {
      // Unknown key (perhaps deprecated). Keep it in cache so a redeploy
      // doesn't silently drop user-configured state, but don't trust it.
      log.warn(`unknown setting in DB (kept raw in cache): ${row.key}`);
      cache.set(row.key, parsed);
      continue;
    }
    try {
      const coerced = coerce(meta.type, parsed);
      validateBounds(meta, coerced);
      cache.set(row.key, coerced);
    } catch (e) {
      log.warn(`invalid DB value for ${row.key}, ignoring (using default): ${e.message}`);
    }
  }
  inited = true;
  log.info(`settings initialized: ${settingDefs.size} registered, ${cache.size} overridden`);
}

export function getSetting(key) {
  if (!inited) throw new Error(`getSetting('${key}') called before initSettings()`);
  const meta = settingDefs.get(key);
  if (!meta) throw new Error(`unknown setting: ${key}`);
  return cache.has(key) ? cache.get(key) : meta.defaultValue;
}

export function getSettingMeta(key) {
  return settingDefs.get(key);
}

export function listSettings() {
  return Array.from(settingDefs.entries()).map(([key, meta]) => ({
    key,
    type: meta.type,
    description: meta.description,
    min: meta.min,
    max: meta.max,
    category: meta.category,
    defaultValue: meta.defaultValue,
    value: cache.has(key) ? cache.get(key) : meta.defaultValue,
    overridden: cache.has(key),
  }));
}

export async function setSetting(key, value, actor) {
  if (!actor) throw new Error('setSetting requires an actor (discord id or "system")');
  const meta = settingDefs.get(key);
  if (!meta) throw new Error(`unknown setting: ${key}`);

  const coerced = coerce(meta.type, value);
  validateBounds(meta, coerced);

  const oldValue = cache.has(key) ? cache.get(key) : meta.defaultValue;

  const { error: upsertErr } = await supabase
    .from('settings')
    .upsert({
      key,
      value: JSON.stringify(coerced),
      type: meta.type,
      updated_by: actor,
      updated_at: new Date().toISOString(),
    });
  if (upsertErr) throw upsertErr;

  const { error: auditErr } = await supabase
    .from('settings_audit')
    .insert({
      key,
      old_value: JSON.stringify(oldValue),
      new_value: JSON.stringify(coerced),
      changed_by: actor,
    });
  if (auditErr) log.warn(`audit insert failed for ${key}: ${auditErr.message}`);

  cache.set(key, coerced);
  log.info(`set ${key}=${JSON.stringify(coerced)} (by ${actor})`);
  return { key, oldValue, newValue: coerced };
}

export async function resetSetting(key, actor) {
  if (!actor) throw new Error('resetSetting requires an actor');
  const meta = settingDefs.get(key);
  if (!meta) throw new Error(`unknown setting: ${key}`);

  const wasOverridden = cache.has(key);
  const oldValue = wasOverridden ? cache.get(key) : meta.defaultValue;

  const { error: delErr } = await supabase.from('settings').delete().eq('key', key);
  if (delErr) throw delErr;

  if (wasOverridden) {
    const { error: auditErr } = await supabase
      .from('settings_audit')
      .insert({
        key,
        old_value: JSON.stringify(oldValue),
        new_value: JSON.stringify(meta.defaultValue),
        changed_by: actor,
      });
    if (auditErr) log.warn(`audit insert failed for ${key} reset: ${auditErr.message}`);
  }

  cache.delete(key);
  log.info(`reset ${key} to default (by ${actor})`);
  return { key, oldValue, newValue: meta.defaultValue, wasOverridden };
}

// For tests / forced reloads (admin panel "Reload Settings" button later).
export async function reloadSettings() {
  inited = false;
  await initSettings();
}

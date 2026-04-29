/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(APP_ROOT, 'config');
const DEFAULT_CONFIG_PATH = path.join(CONFIG_DIR, 'default-config.json');
const USER_CONFIG_PATH = path.join(CONFIG_DIR, 'user-config.json');

const DEFAULT_CONFIG = {
  scopes: {
    womenNew: true,
    womenFull: true
  },
  filters: {
    colorKeywords: [
      'melange',
      'grey',
      'light grey',
      'light blue',
      'sky blue',
      'ice blue',
      'greenish',
      'sage',
      'sea green'
    ],
    targetFabrics: ['cotton', 'silk', 'mulberry silk', 'viscose', 'wool', 'cashmere'],
    mixedMainMinTargetPercent: 70,
    requiredSize: 'S',
    requireMontenegroInStock: true,
    rejectDoNotWash: true
  },
  schedule: {
    timeZone: 'Europe/Podgorica',
    weekdays: ['MON', 'THU'],
    hour: 10,
    allowedMinutes: [0, 1, 2, 3, 4]
  },
  runtime: {
    browserChannel: 'chrome',
    headless: false
  }
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return { ...base };
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) out[key] = [...value];
    else if (value && typeof value === 'object') out[key] = deepMerge(base[key] || {}, value);
    else out[key] = value;
  }
  return out;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function ensureDefaultConfigFile() {
  ensureDir(CONFIG_DIR);
  if (!fs.existsSync(DEFAULT_CONFIG_PATH)) {
    fs.writeFileSync(DEFAULT_CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  }
}

function loadAppConfig() {
  ensureDefaultConfigFile();
  const defaultFromDisk = readJsonSafe(DEFAULT_CONFIG_PATH) || DEFAULT_CONFIG;
  const user = readJsonSafe(USER_CONFIG_PATH) || {};
  return deepMerge(defaultFromDisk, user);
}

function saveUserConfig(userConfigPatch) {
  ensureDefaultConfigFile();
  const currentUser = readJsonSafe(USER_CONFIG_PATH) || {};
  const merged = deepMerge(currentUser, userConfigPatch || {});
  fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = {
  APP_ROOT,
  CONFIG_DIR,
  DEFAULT_CONFIG_PATH,
  USER_CONFIG_PATH,
  DEFAULT_CONFIG,
  loadAppConfig,
  saveUserConfig
};

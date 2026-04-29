#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { runMonitor, OUTPUT_DIR } = require('./monitor.cjs');
const { loadAppConfig } = require('./config.cjs');

const APP_ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(OUTPUT_DIR, 'scheduler-state.json');
const APP_CONFIG = loadAppConfig();
const SCHEDULE = APP_CONFIG.schedule || {};
const TARGET_TIME_ZONE = SCHEDULE.timeZone || 'Etc/GMT-1';
const TARGET_WEEKDAYS = new Set((SCHEDULE.weekdays || ['MON', 'THU']).map((d) => String(d).toUpperCase()));
const TARGET_HOUR = Number(SCHEDULE.hour ?? 10);
const ALLOWED_MINUTES = new Set(Array.isArray(SCHEDULE.allowedMinutes) ? SCHEDULE.allowedMinutes : [0, 1, 2, 3, 4]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { runs: {} };
  }
}

function writeState(state) {
  ensureDir(path.dirname(STATE_FILE));
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function getGmt1Parts() {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TARGET_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const value = {};
  for (const part of parts) value[part.type] = part.value;

  return {
    weekday: (value.weekday || '').toUpperCase(),
    dateKey: `${value.year}-${value.month}-${value.day}`,
    hour: Number(value.hour || 0),
    minute: Number(value.minute || 0),
    second: Number(value.second || 0)
  };
}

function shouldRunNow() {
  const now = getGmt1Parts();
  const correctWeekday = TARGET_WEEKDAYS.has(now.weekday);
  const correctHour = now.hour === TARGET_HOUR;
  const correctMinute = ALLOWED_MINUTES.has(now.minute);
  return {
    due: correctWeekday && correctHour && correctMinute,
    now
  };
}

function formatScopeStats(scopeStats) {
  if (!Array.isArray(scopeStats) || scopeStats.length === 0) return 'n/a';
  return scopeStats
    .map((scope) => `${scope.id}: catalog=${scope.catalogProductCount}, processed=${scope.processedProductCount}, matches=${scope.matchCount}`)
    .join(' | ');
}

async function runScheduled() {
  const state = readState();
  const { due, now } = shouldRunNow();
  const alreadyRan = Boolean(state.runs[now.dateKey]);

  if (!due) {
    console.log(`[scheduler] Not due. GMT+1 now: ${now.weekday} ${now.dateKey} ${now.hour}:${String(now.minute).padStart(2, '0')}`);
    return;
  }
  if (alreadyRan) {
    console.log(`[scheduler] Skipped. Already ran for ${now.dateKey}.`);
    return;
  }

  console.log(`[scheduler] Running Zara monitor for ${now.dateKey} at GMT+1 target window.`);
  const result = await runMonitor({ headless: false });
  state.runs[now.dateKey] = {
    ranAtIso: new Date().toISOString(),
    productCount: result.productCount,
    matchCount: result.matchCount,
    xlsxPath: result.xlsxPath,
    jsonPath: result.jsonPath
  };
  writeState(state);
  console.log(`[scheduler] Done. Catalog: ${result.catalogProductCount}, processed new: ${result.processedProductCount}, matches: ${result.matchCount}`);
  console.log(`[scheduler] Scope stats: ${formatScopeStats(result.scopeStats)}`);
  console.log(`[scheduler] XLSX: ${result.xlsxPath}`);
}

async function runNow(forceFullRescan = false) {
  console.log('[scheduler] Manual run started.');
  const result = await runMonitor({ headless: false, forceFullRescan });
  console.log(`[scheduler] Done. Catalog: ${result.catalogProductCount}, processed new: ${result.processedProductCount}, matches: ${result.matchCount}`);
  console.log(`[scheduler] Scope stats: ${formatScopeStats(result.scopeStats)}`);
  console.log(`[scheduler] XLSX: ${result.xlsxPath}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--run-now')) {
    await runNow(args.has('--full-rescan'));
    return;
  }
  if (args.has('--scheduled')) {
    await runScheduled();
    return;
  }

  console.log('Usage:');
  console.log('  node src/scheduler.cjs --run-now');
  console.log('  node src/scheduler.cjs --run-now --full-rescan');
  console.log('  node src/scheduler.cjs --scheduled');
}

main().catch((error) => {
  console.error('[scheduler] Failed:', error.message);
  process.exit(1);
});

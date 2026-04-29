#!/usr/bin/env node
/* eslint-disable no-console */
const readline = require('readline');
const { loadAppConfig, saveUserConfig, USER_CONFIG_PATH } = require('../src/config.cjs');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer || '');
    });
  });
}

function parseCsv(value, fallback) {
  const parts = String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

function parseYesNo(answer, fallback) {
  const normalized = String(answer || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['y', 'yes', '1', 'true'].includes(normalized)) return true;
  if (['n', 'no', '0', 'false'].includes(normalized)) return false;
  return fallback;
}

function parseIntSafe(answer, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(answer || '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

async function main() {
  const cfg = loadAppConfig();
  const current = cfg.filters || {};
  const currentScopes = cfg.scopes || {};
  const currentSchedule = cfg.schedule || {};

  console.log('=== Zara Monitor Configuration Wizard ===');
  console.log('Answer questions one by one. Press Enter to keep current value.\n');

  const womenNew = parseYesNo(
    await ask(`Enable scope Women -> The New? [${currentScopes.womenNew ? 'Y' : 'N'}]: `),
    Boolean(currentScopes.womenNew)
  );

  const womenFull = parseYesNo(
    await ask(`Enable scope Women -> Full Catalog? [${currentScopes.womenFull ? 'Y' : 'N'}]: `),
    Boolean(currentScopes.womenFull)
  );

  const colors = parseCsv(
    await ask(`Color keywords (comma-separated) [${(current.colorKeywords || []).join(', ')}]: `),
    current.colorKeywords || []
  );

  const fabrics = parseCsv(
    await ask(`Target fabrics (comma-separated) [${(current.targetFabrics || []).join(', ')}]: `),
    current.targetFabrics || []
  );

  const mixedThreshold = parseIntSafe(
    await ask(`Mixed main fabric min target percent [${current.mixedMainMinTargetPercent ?? 70}]: `),
    current.mixedMainMinTargetPercent ?? 70,
    0,
    100
  );

  const requiredSizeRaw = await ask(`Required size token [${current.requiredSize || 'S'}]: `);
  const requiredSize = String(requiredSizeRaw || current.requiredSize || 'S').trim().toUpperCase();

  const requireStock = parseYesNo(
    await ask(`Require Montenegro in stock? [${current.requireMontenegroInStock ? 'Y' : 'N'}]: `),
    Boolean(current.requireMontenegroInStock)
  );

  const rejectDoNotWash = parseYesNo(
    await ask(`Reject items with "Do not wash"? [${current.rejectDoNotWash ? 'Y' : 'N'}]: `),
    Boolean(current.rejectDoNotWash)
  );

  const weekdays = parseCsv(
    await ask(`Schedule weekdays (e.g. MON,THU) [${(currentSchedule.weekdays || []).join(', ')}]: `),
    currentSchedule.weekdays || ['MON', 'THU']
  ).map((v) => v.toUpperCase());

  const scheduleHour = parseIntSafe(
    await ask(`Schedule hour (0-23, target timezone) [${currentSchedule.hour ?? 10}]: `),
    currentSchedule.hour ?? 10,
    0,
    23
  );

  const timezone = String(
    (await ask(`Schedule timezone [${currentSchedule.timeZone || 'Etc/GMT-1'}]: `)).trim() ||
      currentSchedule.timeZone ||
      'Etc/GMT-1'
  );

  const patch = {
    scopes: {
      womenNew,
      womenFull
    },
    filters: {
      colorKeywords: colors,
      targetFabrics: fabrics,
      mixedMainMinTargetPercent: mixedThreshold,
      requiredSize,
      requireMontenegroInStock: requireStock,
      rejectDoNotWash
    },
    schedule: {
      weekdays,
      hour: scheduleHour,
      timeZone: timezone
    }
  };

  saveUserConfig(patch);
  console.log('\nSaved config to:');
  console.log(USER_CONFIG_PATH);
  console.log('\nYou can rerun this wizard anytime: npm run configure');
}

main().catch((error) => {
  console.error('Configuration failed:', error.message);
  process.exit(1);
});

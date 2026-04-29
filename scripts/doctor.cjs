#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.resolve(process.env.ZARA_OUTPUT_DIR || path.join(APP_ROOT, 'output'));
const PROFILE_DIR = path.resolve(process.env.ZARA_PROFILE_DIR || path.join(APP_ROOT, '.playwright-zara-profile'));

function check(name, ok, details) {
  const mark = ok ? 'OK ' : 'FAIL';
  console.log(`${mark} ${name}${details ? ` - ${details}` : ''}`);
  return ok;
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'pipe' });
  return result.status === 0;
}

function main() {
  let allOk = true;

  allOk = check('Node.js available', commandExists('node'), 'required') && allOk;
  allOk = check('npm available', commandExists('npm'), 'required') && allOk;

  const pkgLockExists = fs.existsSync(path.join(APP_ROOT, 'package-lock.json'));
  allOk = check('package-lock.json exists', pkgLockExists, 'recommended for reproducible installs') && allOk;

  const nodeModulesExists = fs.existsSync(path.join(APP_ROOT, 'node_modules'));
  allOk = check('dependencies installed', nodeModulesExists, nodeModulesExists ? '' : 'run: npm install') && allOk;

  const playwrightCacheHint = fs.existsSync(path.join(process.env.HOME || '', '.cache', 'ms-playwright')) ||
    fs.existsSync(path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright'));
  allOk = check(
    'Playwright browser runtime',
    playwrightCacheHint,
    playwrightCacheHint ? '' : 'run: npx playwright install chrome'
  ) && allOk;

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  allOk = check('output directory writable', fs.existsSync(OUTPUT_DIR), OUTPUT_DIR) && allOk;

  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });
  allOk = check('profile directory writable', fs.existsSync(PROFILE_DIR), PROFILE_DIR) && allOk;

  console.log('');
  console.log('Environment variables (optional):');
  console.log('- ZARA_PROFILE_DIR=/absolute/path/to/chrome-profile');
  console.log('- ZARA_OUTPUT_DIR=/absolute/path/to/output');
  console.log('- ZARA_BROWSER_CHANNEL=chrome');
  console.log('- ZARA_HEADLESS=1');

  if (!allOk) process.exit(1);
}

main();

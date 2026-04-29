#!/usr/bin/env node
/* eslint-disable no-console */
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim().toLowerCase());
    });
  });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: APP_ROOT,
    stdio: 'inherit',
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function exists(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    cwd: APP_ROOT,
    stdio: 'ignore',
    shell: false
  });
  return result.status === 0;
}

function runOptional(command, args) {
  const result = spawnSync(command, args, {
    cwd: APP_ROOT,
    stdio: 'inherit',
    shell: false
  });
  return result.status === 0;
}

async function ensureNodeInstalled() {
  if (exists('node') && exists('npm')) return true;

  console.log('Node.js is not detected on this machine.');
  const auto = await ask('Try automatic Node.js LTS install now? (y/N): ');
  if (auto !== 'y' && auto !== 'yes') return false;

  if (isMac && exists('brew')) {
    console.log('Trying: brew install node');
    if (runOptional('brew', ['install', 'node'])) return exists('node') && exists('npm');
  }

  if (isWindows) {
    if (exists('winget', ['--version'])) {
      console.log('Trying: winget install OpenJS.NodeJS.LTS');
      if (runOptional('winget', ['install', '-e', '--id', 'OpenJS.NodeJS.LTS'])) {
        return exists('node') && exists('npm');
      }
    }
    if (exists('choco', ['-v'])) {
      console.log('Trying: choco install nodejs-lts -y');
      if (runOptional('choco', ['install', 'nodejs-lts', '-y'])) {
        return exists('node') && exists('npm');
      }
    }
  }

  return false;
}

async function main() {
  console.log('=== Zara Montenegro Monitor: Interactive Setup ===');
  console.log(`OS: ${os.platform()} ${os.release()}`);
  console.log(`Project: ${APP_ROOT}`);
  console.log('');
  console.log('This setup will:');
  console.log('1) Ensure Node.js/npm are available (auto-install attempt optional)');
  console.log('2) Install Node dependencies');
  console.log('3) Install Playwright Chrome runtime');
  console.log('4) (Optional) Open dedicated Chrome profile for manual Zara onboarding');
  console.log('5) (Optional) Install local scheduler');
  console.log('');

  const proceed = await ask('Continue setup? (y/N): ');
  if (proceed !== 'y' && proceed !== 'yes') {
    console.log('Setup cancelled.');
    process.exit(0);
  }

  console.log('\n[Step 1/5] Checking Node.js/npm...');
  const hasNode = await ensureNodeInstalled();
  if (!hasNode) {
    console.log('\nAutomatic Node.js installation did not complete.');
    console.log('Please install Node.js LTS manually: https://nodejs.org');
    console.log('Then run this setup again.');
    process.exit(1);
  }

  console.log('\n[Step 2/5] Installing dependencies...');
  run('npm', ['install']);

  console.log('\n[Step 3/5] Installing Playwright Chrome runtime...');
  run('npx', ['playwright', 'install', 'chrome']);

  const runOnboarding = await ask('\n[Step 4/5] Open dedicated profile onboarding now? (y/N): ');
  if (runOnboarding === 'y' || runOnboarding === 'yes') {
    run('node', ['scripts/profile-onboarding.cjs']);
  } else {
    console.log('Skipped profile onboarding.');
  }

  const installSchedule = await ask('\n[Step 5/5] Install scheduler on this machine now? (y/N): ');
  if (installSchedule === 'y' || installSchedule === 'yes') {
    if (isMac) run('npm', ['run', 'install-schedule:mac']);
    else if (isWindows) run('npm', ['run', 'install-schedule:win']);
    else console.log('Scheduler auto-install is supported only on macOS/Windows. Skipped.');
  } else {
    console.log('Skipped scheduler install.');
  }

  console.log('\nSetup complete.');
  console.log('Next commands:');
  console.log('- npm run doctor');
  console.log('- npm run run-once');
  console.log('- npm run run-full');
}

main().catch((error) => {
  console.error('\nSetup failed:', error.message);
  process.exit(1);
});

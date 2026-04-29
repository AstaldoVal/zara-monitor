#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');

const APP_ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(process.env.ZARA_PROFILE_DIR || path.join(APP_ROOT, '.playwright-zara-profile'));
const BROWSER_CHANNEL = process.env.ZARA_BROWSER_CHANNEL || 'chrome';

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  console.log('Opening Zara with dedicated browser profile...');
  console.log(`Profile path: ${PROFILE_DIR}`);
  console.log('');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: BROWSER_CHANNEL,
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB'
  });

  try {
    const page = await context.newPage();
    await page.goto('https://www.zara.com/me/en/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    console.log('Manual actions (if prompted by Zara):');
    console.log('- Accept cookies');
    console.log('- Complete captcha/human checks');
    console.log('- Optionally sign in');
    console.log('');
    await waitForEnter('When done, press Enter here to close onboarding browser...');
  } finally {
    await context.close();
  }

  console.log('Profile onboarding complete.');
}

main().catch((error) => {
  console.error('Profile onboarding failed:', error.message);
  process.exit(1);
});

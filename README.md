# Zara Montenegro Monitor (Portable Local Product)

This folder is a standalone local product that can be copied to another computer and run there with the same behavior.

It monitors Zara Montenegro (`https://www.zara.com/me/`) in two scopes:
- `Women -> The New`
- `Women -> Full Catalog`

It exports:
- `output/zara-montenegro-matches-*.xlsx` (human-readable result),
- `output/zara-montenegro-scan-*.json` (full debug snapshot).

## Filters Used

A product is included in `*_matches` only if all checks pass:
- color matches target keywords,
- composition passes strict main-fabric logic,
- care is washable (`Do not wash` rejects item),
- size `S` is available,
- order is available for Montenegro.

Excel diagnostics include:
- `main_fabric_raw`, `secondary_fabric_raw`, `unknown_section_raw`,
- `target_fabric_percent`, `target_fabric_percent_secondary`,
- `composition_mode`, `composition_reason`,
- `care_raw`, `care_source`, `washable`, `care_reason`.

## New Computer Setup (Beginner Friendly)

### 0) Prerequisites

Required:
1. Google Chrome stable

Node.js LTS:
- setup wizard will try to install it automatically (best effort) using `brew` (macOS) or `winget/choco` (Windows),
- if auto-install is unavailable/fails, install manually: [https://nodejs.org](https://nodejs.org)

### 1) Run interactive setup

From this folder:

- macOS: double-click `setup.command`
- Windows: double-click `setup.bat`

Or in terminal:

```bash
npm run setup
```

The interactive setup will:
1. install npm dependencies,
2. install Playwright Chrome runtime,
3. ask configuration questions one-by-one and save answers,
4. optionally open a dedicated Chrome profile for manual Zara onboarding,
5. optionally install local scheduler.

### 2) Manual onboarding step (if prompted)

During profile onboarding, browser opens with a dedicated profile.
Do these manual actions if Zara asks:
- accept cookies,
- solve captcha/human checks,
- optionally sign in.

Then return to terminal and press Enter.

### 3) Validate environment

```bash
npm run doctor
```

### 4) First full run (recommended)

```bash
npm run run-full
```

## Commands

```bash
# interactive setup wizard
npm run setup

# non-interactive dependency setup only
npm run setup:deps

# environment checks
npm run doctor

# re-open interactive config wizard (one question at a time)
npm run configure

# open dedicated profile onboarding
npm run profile:onboard

# run one incremental scan
npm run run-once

# run full rescan
npm run run-full
```

## Project Docs

- `README.md` - setup and usage
- `ARCHITECTURE.md` - system design and extension points
- `CONTRIBUTING.md` - development workflow and PR checklist
- `LICENSE` - MIT license

## Configuration

- Defaults live in `config/default-config.json`.
- User answers are stored in `config/user-config.json` (created by setup/configure wizard).
- To update later, run:

```bash
npm run configure
```

Scheduler:

```bash
# macOS
npm run install-schedule:mac
npm run status-schedule:mac
npm run uninstall-schedule:mac

# Windows
npm run install-schedule:win
npm run status-schedule:win
npm run uninstall-schedule:win
```

## Schedule Behavior

- scheduler ticks every 5 minutes,
- actual scraping runs only on **Mon/Thu 10:00 GMT+1** window,
- dedup state is stored in `output/zara-montenegro-state.json`.

## Profile Isolation

By default, dedicated Chrome profile is:
- `.playwright-zara-profile`

You can override with environment variables:

```bash
ZARA_PROFILE_DIR=/absolute/path/to/profile
ZARA_OUTPUT_DIR=/absolute/path/to/output
ZARA_BROWSER_CHANNEL=chrome
ZARA_HEADLESS=1
```

## Troubleshooting

- `Playwright browser not found`:
  - run `npx playwright install chrome`
- `Captcha or blocked requests`:
  - run `npm run profile:onboard` and complete manual checks
- `No schedule activity`:
  - run scheduler status script for your OS
- `Profile lock` errors:
  - close all Chrome instances using that profile path
